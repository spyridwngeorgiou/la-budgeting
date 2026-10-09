import type { SupabaseClient } from "@supabase/supabase-js";
import type { BinaryFileData, DataURL } from "@excalidraw/excalidraw/types";
import type { FileId } from "@excalidraw/excalidraw/element/types";
import type { Database } from "@/lib/db/types";
import { collabStoragePath } from "@/lib/collab/paths";

// Binary files for a board. Excalidraw keeps images in memory as data URLs;
// we never persist those (they'd bloat every element read and every
// broadcast). Instead the bytes go to the private `collab` bucket at
// <org>/<project>/<board>/<file> (0038, collab_path_ok) and a board_files
// row records the Excalidraw fileId -> object path mapping.

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
export interface BoardScope {
  orgId: string;
  projectId: string;
  boardId: string;
}

export function isAllowedCollabFile(mimeType: string, size: number) {
  return (COLLAB_FILE_TYPES as readonly string[]).includes(mimeType) && size > 0 && size <= COLLAB_MAX_BYTES;
}

export async function dataUrlToBlob(dataURL: string): Promise<Blob> {
  return (await fetch(dataURL)).blob();
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Uploads once per (board, fileId): Excalidraw's fileIds are content
// hashes, so pasting the same image twice is a no-op here. Returns the
// board_files row id (used for the /files/<id> download route).
export async function uploadBoardFile(
  supabase: Client,
  scope: BoardScope,
  file: { fileId: string; blob: Blob; mimeType: string; name?: string | null },
): Promise<string> {
  if (!isAllowedCollabFile(file.mimeType, file.blob.size)) throw new Error("unsupported");

  const { data: existing } = await supabase
    .from("board_files")
    .select("id")
    .eq("board_id", scope.boardId)
    .eq("file_id", file.fileId)
    .maybeSingle();
  if (existing) return existing.id;

  const storagePath = collabStoragePath(
    scope.orgId,
    scope.projectId,
    scope.boardId,
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
      // Overwritten from the board by trigger; sent only to satisfy types.
      org_id: scope.orgId,
      project_id: scope.projectId,
      file_id: file.fileId,
      storage_path: storagePath,
      mime_type: file.mimeType,
      size_bytes: file.blob.size,
      original_name: file.name?.slice(0, 255) ?? null,
    })
    .select("id")
    .single();
  if (error) {
    // Lost the race to another collaborator's insert -- theirs is identical.
    const { data: again } = await supabase
      .from("board_files")
      .select("id")
      .eq("board_id", scope.boardId)
      .eq("file_id", file.fileId)
      .maybeSingle();
    if (again) return again.id;
    throw error;
  }
  return data.id;
}

// Fetches image bytes for the given Excalidraw fileIds and returns them in
// the shape api.addFiles() wants. Ids with no board_files row yet (another
// collaborator still uploading) are simply absent from the result.
export async function loadBoardFiles(supabase: Client, boardId: string, fileIds: string[]): Promise<BinaryFileData[]> {
  if (fileIds.length === 0) return [];
  const { data: rows } = await supabase
    .from("board_files")
    .select("file_id, storage_path, mime_type")
    .eq("board_id", boardId)
    .in("file_id", fileIds);
  const images = (rows ?? []).filter((r) => (COLLAB_IMAGE_TYPES as readonly string[]).includes(r.mime_type));
  if (images.length === 0) return [];

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
          dataURL: (await blobToDataUrl(await res.blob())) as DataURL,
          created: Date.now(),
          lastRetrieved: Date.now(),
        } satisfies BinaryFileData;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}
