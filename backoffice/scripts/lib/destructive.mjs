// The destructive-migration guard (used by migrate-remote.mjs, tested in
// src/test/destructive.test.ts). A migration that deletes data runs only
// with --confirm-destructive AND a JSON backup of that project taken less
// than 24 hours ago (scripts/backup-json.mjs writes
// backups/<ref>/<stamp>/manifest.json).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DESTRUCTIVE = /\b(drop\s+table|drop\s+column|delete\s+from|truncate)\b/gi;
export const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;

// The destructive statements in a migration, comments ignored ("-- we never
// delete from x" is not a delete).
export function findDestructive(sql) {
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  return [...new Set([...code.matchAll(DESTRUCTIVE)].map((m) => m[1].toLowerCase().replace(/\s+/g, " ")))];
}

// The newest backup manifest for `ref` under backupsDir, or null.
export function latestManifest(backupsDir, ref) {
  const dir = join(backupsDir, ref);
  if (!existsSync(dir)) return null;
  let best = null;
  for (const stamp of readdirSync(dir)) {
    const file = join(dir, stamp, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const m = JSON.parse(readFileSync(file, "utf8"));
      if (m.ref !== ref || !m.complete || !m.createdAt) continue;
      if (!best || Date.parse(m.createdAt) > Date.parse(best.createdAt)) best = { ...m, path: file };
    } catch {
      // unreadable manifest: not a backup
    }
  }
  return best;
}

// Why the run must stop, or null when it may go ahead.
export function destructiveRefusal({ destructiveFiles, confirm, manifest, now = Date.now() }) {
  if (destructiveFiles.length === 0) return null;
  if (!confirm) return "destructive migrations pending: re-run with --confirm-destructive after a backup";
  if (!manifest) return "no backup found: run node scripts/backup-json.mjs <ref> first";
  const age = now - Date.parse(manifest.createdAt);
  if (!(age >= 0 && age < MAX_BACKUP_AGE_MS)) {
    return `latest backup is ${Math.round(age / 3600000)}h old (${manifest.createdAt}); take a fresh one (< 24h)`;
  }
  return null;
}
