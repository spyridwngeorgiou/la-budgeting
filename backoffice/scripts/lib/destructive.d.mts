export const MAX_BACKUP_AGE_MS: number;
export interface BackupManifest {
  ref: string;
  createdAt: string;
  complete: boolean;
  tables: Record<string, number>;
  path?: string;
}
export function findDestructive(sql: string): string[];
export function latestManifest(backupsDir: string, ref: string): BackupManifest | null;
export function destructiveRefusal(args: {
  destructiveFiles: string[];
  confirm: boolean;
  manifest: BackupManifest | null;
  now?: number;
}): string | null;
