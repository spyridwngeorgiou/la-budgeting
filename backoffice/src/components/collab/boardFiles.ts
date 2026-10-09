import type { SupabaseClient } from "@supabase/supabase-js";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { Database } from "@/lib/db/types";
import { collabStoragePath } from "@/lib/collab/paths";

// Binary files for a board. Excalidraw keeps images in memory as data URLs;
// we never persist those (they'd bloat every element read and every
// broadcast). Instead the bytes go to the private `collab` bucket at
// <org>/<project>/<board>/<file> (0038, collab_path_ok) and a board_files
// row records the Excalidraw fileId -> object path mapping. Project-level
// files (0060: the Files card, chat attachments) live under
// <org>/<project>/shared/ with board_id null.

export const COLLAB_MAX_BYTES = 25 * 1024 * 1024;
export const COLLAB_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const COLLAB_FILE_TYPES = [...COLLAB_IMAGE_TYPES, "application/pdf"] as const;

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

type Client = SupabaseClient<Database>;
// boardId null: a project-level file.
export interface BoardScope {
  orgId: string;
  projectId: string;
  boardId: string | null;
}

export function isAllowedCollabFile(mimeType: string, size: number) {
  return (COLLAB_FILE_TYPES as readonly string[]).includes(mimeType) && size > 0 && size <= COLLAB_MAX_BYTES;
}

export function isImageType(mimeType: string) {
  return (COLLAB_IMAGE_TYPES as readonly string[]).includes(mimeType);
}

export async function dataUrlToBlob(dataURL: string): Promise<Blob> {
  return (await fetch(dataURL)).blob();
}

export function fileToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function imageSize(dataURL: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 400, h: img.naturalHeight || 300 });
    img.onerror = () => resolve({ w: 400, h: 300 });
    img.src = dataURL;
  });
}

// Uploads once per (board, fileId): Excalidraw's fileIds are content
// hashes, so pasting the same image twice is a no-op here. Returns the
// board_files row id (used for the /files/<id> download route).
// `derivedFrom`: the PDF a page bitmap was rendered from (0060).
export async function uploadBoardFile(
  supabase: Client,
  scope: BoardScope,
  file: { fileId: string; blob: Blob; mimeType: string; name?: string | null; derivedFrom?: string | null },
): Promise<string> {
  if (!isAllowedCollabFile(file.mimeType, file.blob.size)) throw new Error("unsupported");

  const findExisting = async () => {
    let q = supabase.from("board_files").select("id").eq("project_id", scope.projectId).eq("file_id", file.fileId);
    q = scope.boardId ? q.eq("board_id", scope.boardId) : q.is("board_id", null);
    return (await q.maybeSingle()).data;
  };
  const existing = await findExisting();
  if (existing) return existing.id;

  const storagePath = collabStoragePath(
    scope.orgId,
    scope.projectId,
    scope.boardId ?? "shared",
    `${file.fileId}.${EXT[file.mimeType] ?? "bin"}`,
  );
  const { error: uploadError } = await supabase.storage
    .from("collab")
    .upload(storagePath, file.blob, { contentType: file.mimeType, upsert: false });
  // A concurrent upload of the same hash by another collaborator is fine.
  if (uploadError && !/exist|duplicate/i.test(uploadError.message)) throw uploadError;

  const { data, error } = await supabase
    .from("board_files")
    .insert({
      board_id: scope.boardId,
      // Overwritten from the board / project by trigger; sent only to satisfy types.
      org_id: scope.orgId,
      project_id: scope.projectId,
      file_id: file.fileId,
      storage_path: storagePath,
      mime_type: file.mimeType,
      size_bytes: file.blob.size,
      original_name: file.name?.slice(0, 255) ?? null,
      derived_from: file.derivedFrom ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // Lost the race to another collaborator's insert -- theirs is identical.
    const again = await findExisting();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}

// Fetches image bytes for the given Excalidraw fileIds and returns them in
// the shape api.addFiles() wants. `missing` lists ids with no board_files
// row at all: either a collaborator is still uploading, or the file was
// deleted (0060) -- the caller tells the two apart by retrying.
export async function loadBoardFiles(
  supabase: Client,
  boardId: string,
  fileIds: string[],
): Promise<{ loaded: BinaryFileData[]; missing: string[] }> {
  if (fileIds.length === 0) return { loaded: [], missing: [] };
  const { data: rows, error } = await supabase
    .from("board_files")
    .select("file_id, storage_path, mime_type")
    .eq("board_id", boardId)
    .in("file_id", fileIds);
  const present = new Set((rows ?? []).map((r) => r.file_id));
  // On a query error nothing is "missing" -- it's just not known yet.
  const missing = error ? [] : fileIds.filter((id) => !present.has(id));
  const images = (rows ?? []).filter((r) => isImageType(r.mime_type));
  if (images.length === 0) return { loaded: [], missing };

  const { data: signed } = await supabase.storage.from("collab").createSignedUrls(
    images.map((r) => r.storage_path),
    300,
  );
  const results = await Promise.all(
    images.map(async (row, i) => {
      const url = signed?.[i]?.signedUrl;
      if (!url) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        return {
          id: row.file_id as FileId,
          mimeType: row.mime_type as BinaryFileData["mimeType"],
          dataURL: (await fileToDataUrl(await res.blob())) as DataURL,
          created: Date.now(),
          lastRetrieved: Date.now(),
        } satisfies BinaryFileData;
      } catch {
        return null;
      }
    }),
  );
  return { loaded: results.filter((r): r is NonNullable<typeof r> => r !== null), missing };
}
