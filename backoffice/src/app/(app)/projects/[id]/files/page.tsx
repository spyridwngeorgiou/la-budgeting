import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { Card } from "@/components/ui";
import { UploadButton } from "./UploadButton";

// Αρχεία Έργου -- the project's files as the same folder tree they have in
// Google Drive. Folders start closed and open on click (native <details>, no
// client JS). Each file links to the live original in Drive, so it opens where
// it is worked on. Duplicates (duplicate_of set) are counted, not listed.
// Files uploaded here (source = upload) sit in the private "documents" bucket
// and open through a short-lived signed link. ?q= filters by name.

type FileRow = {
  id: string;
  folder: string[];
  title: string;
  mime_type: string | null;
  size_bytes: number | null;
  url: string | null;
  storage_path?: string | null;
  file_modified_at: string | null;
  duplicate_of: string | null;
};

type FolderNode = { name: string; folders: Map<string, FolderNode>; files: FileRow[] };

const newNode = (name: string): FolderNode => ({ name, folders: new Map(), files: [] });

function buildTree(files: FileRow[], folderPaths: string[][]): FolderNode {
  const root = newNode("");
  const at = (path: string[]) => {
    let node = root;
    for (const segment of path) {
      if (!node.folders.has(segment)) node.folders.set(segment, newNode(segment));
      node = node.folders.get(segment)!;
    }
    return node;
  };
  for (const p of folderPaths) at(p); // keep empty folders, as Drive shows them
  for (const f of files) at(f.folder).files.push(f);
  return root;
}

const countFiles = (node: FolderNode): number =>
  node.files.length + [...node.folders.values()].reduce((s, n) => s + countFiles(n), 0);

const byName = (a: string, b: string) => a.localeCompare(b, "el", { numeric: true });

// Readable labels: "5_ΣΧΕΔΙΑ_ΦΩΤΟ" -> "ΣΧΕΔΙΑ ΦΩΤΟ" (the number only orders),
// "Q003_2026-04-05_ΟΙΚΟΔΟΜΙΚΗ-ΑΔΕΙΑ-899-1977.pdf" -> "ΟΙΚΟΔΟΜΙΚΗ ΑΔΕΙΑ 899 1977".
// Case is kept as written: lower-casing Greek capitals would drop the accents.
function sentence(s: string) {
  return s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}
const folderLabel = (name: string) => sentence(name.replace(/^\d+_/, ""));
const fileLabel = (title: string) =>
  sentence(title.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/^Q\d{3}_/, "").replace(/^\d{4}-\d{2}-\d{2}_/, "")) || title;

function icon(mime: string | null) {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼️";
  if (mime.startsWith("video/")) return "🎬";
  if (mime === "application/pdf") return "📕";
  if (mime.includes("sheet") || mime.includes("excel")) return "📊";
  if (mime.includes("presentation")) return "📽️";
  return "📄";
}

function FolderView({ node, depth }: { node: FolderNode; depth: number }) {
  const folders = [...node.folders.values()].sort((a, b) => byName(a.name, b.name));
  const files = [...node.files].sort((a, b) => byName(a.title, b.title));
  return (
    <ul className={depth > 0 ? "ml-5 border-l border-line pl-3" : ""}>
      {folders.map((f) => (
        <li key={f.name}>
          <details>
            <summary className="flex cursor-pointer items-center gap-2 rounded px-1 py-2 hover:bg-bg">
              <span>📁</span>
              <span className="font-medium">{folderLabel(f.name)}</span>
              <span className="text-xs text-ink-faint">({countFiles(f)})</span>
            </summary>
            <FolderView node={f} depth={depth + 1} />
          </details>
        </li>
      ))}
      {files.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-3 px-1 py-1.5 text-sm">
          <a href={f.url ?? "#"} target="_blank" rel="noreferrer" title={f.title} className="flex min-w-0 items-center gap-2 hover:underline">
            <span>{icon(f.mime_type)}</span>
            <span className="truncate">{fileLabel(f.title)}</span>
          </a>
          <span className="shrink-0 text-xs text-ink-faint">{formatDate(f.file_modified_at)}</span>
        </li>
      ))}
      {folders.length === 0 && files.length === 0 && <li className="px-1 py-1 text-xs text-ink-faint">Κενός φάκελος</li>}
    </ul>
  );
}

// Local development only: until migration 0023 is applied to the database the
// app points at, read the Drive inventory that scripts/staging.cjs would load
// (seed/local/drive/<PROJECT CODE>.json, gitignored). Never used in production.
async function localInventory(code: string): Promise<{ files: FileRow[]; folders: string[][] } | null> {
  if (process.env.NODE_ENV === "production") return null;
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    const raw = await readFile(path.join(process.cwd(), "seed", "local", "drive", `${code}.json`), "utf8");
    const inv = JSON.parse(raw.replace(/^﻿/, "")) as {
      folders?: { path: string[] }[];
      files: { id: string; title: string; mimeType?: string; fileSize?: number | null; modifiedTime?: string; viewUrl: string; path?: string[]; duplicateOf?: string }[];
    };
    return {
      folders: (inv.folders ?? []).map((f) => f.path),
      files: inv.files.map((f) => ({
        id: f.id, folder: f.path ?? [], title: f.title, mime_type: f.mimeType ?? null,
        size_bytes: f.fileSize ?? null, url: f.viewUrl, file_modified_at: f.modifiedTime ?? null, duplicate_of: f.duplicateOf ?? null,
      })),
    };
  } catch {
    return null;
  }
}

export default async function ProjectFilesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const { id } = await params;
  const q = ((await searchParams).q ?? "").trim();
  const supabase = await createClient();

  const [{ data: project }, { data: files, error: dbError }] = await Promise.all([
    supabase.from("projects").select("code, display_name, org_id").eq("id", id).maybeSingle(),
    supabase
      .from("project_files")
      .select("id, folder, title, mime_type, size_bytes, url, storage_path, file_modified_at, duplicate_of")
      .eq("project_id", id),
  ]);
  if (!project) notFound();

  const local = dbError && project.code ? await localInventory(project.code) : null;
  const error = local ? null : dbError;
  const all = (local?.files ?? files ?? []) as FileRow[];
  // Uploaded files: sign their links (1 hour) so they open from the list.
  const toSign = all.filter((f) => !f.url && f.storage_path).map((f) => f.storage_path!);
  if (toSign.length) {
    const { data: signed } = await supabase.storage.from("documents").createSignedUrls(toSign, 3600);
    const byPath = new Map((signed ?? []).map((x) => [x.path, x.signedUrl]));
    for (const f of all) if (!f.url && f.storage_path) f.url = byPath.get(f.storage_path) ?? null;
  }
  const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const unique = all.filter((f) => !f.duplicate_of && (!q || norm(f.title).includes(norm(q))));
  const duplicates = all.length - unique.length;
  const tree = buildTree(unique, local?.folders ?? []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`/projects/${id}`} className="text-sm text-ink-muted hover:underline">
          ← {project.display_name}
        </Link>
        <h1 className="text-xl font-semibold">Αρχεία</h1>
        <p className="text-sm text-ink-muted">{unique.length} {unique.length === 1 ? "έγγραφο" : "έγγραφα"}{q ? ` για «${q}»` : ""}. Πατήστε έναν φάκελο για να ανοίξει.</p>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <form className="flex min-w-0 flex-1 gap-2">
          <input name="q" defaultValue={q} placeholder="Αναζήτηση εγγράφου…" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm" />
          {q && <Link href={`/projects/${id}/files`} className="self-center text-sm text-ink-muted hover:underline">Καθαρισμός</Link>}
        </form>
        <UploadButton projectId={id} orgId={project.org_id} />
      </div>

      {error && (
        <Card className="border-amber-300 bg-amber-50 text-sm text-amber-800">
          Τα αρχεία έργου δεν είναι ακόμα διαθέσιμα σε αυτή τη βάση ({error.message}).
        </Card>
      )}

      {!error && unique.length === 0 && (
        <p className="p-6 text-center text-sm text-ink-muted">{q ? "Κανένα έγγραφο με αυτό το όνομα." : "Δεν έχουν καταχωρηθεί ακόμα αρχεία για αυτό το έργο."}</p>
      )}

      {unique.length > 0 && (
        <Card>
          <FolderView node={tree} depth={0} />
        </Card>
      )}
    </div>
  );
}
