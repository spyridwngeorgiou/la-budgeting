// The board trash («Κάδος»): 0060 keeps boards there for 30 days before the
// nightly purge removes them.
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days until the purge, never negative. 0 means "today".
export function trashDaysLeft(deletedAt: string | Date, now: Date = new Date()): number {
  const t = typeof deletedAt === "string" ? Date.parse(deletedAt) : deletedAt.getTime();
  if (Number.isNaN(t)) return 0;
  const left = t + TRASH_DAYS * DAY_MS - now.getTime();
  return Math.max(0, Math.floor(left / DAY_MS));
}

// Mirrors 0060's boards_guard: the creator, a project lead or an org editor
// may trash / restore / delete for good. A UI hint only; the database decides.
export function canTrashBoard(board: { created_by: string | null }, me: { userId: string; canManage: boolean }): boolean {
  return me.canManage || (board.created_by !== null && board.created_by === me.userId);
}

// Mirrors 0060's board_files_delete policy.
export function canDeleteFile(
  file: { created_by: string | null },
  me: { userId: string; canManage: boolean; canEdit: boolean },
): boolean {
  return me.canManage || (me.canEdit && file.created_by !== null && file.created_by === me.userId);
}
