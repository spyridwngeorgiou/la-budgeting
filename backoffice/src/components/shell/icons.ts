import { CalendarRange, FolderKanban, House, Inbox, Wallet, type LucideIcon } from "lucide-react";
import type { DestinationKey } from "@/lib/navigation";

// One line icon per destination (rail, icon rail, bottom bar).
export const DESTINATION_ICON: Record<DestinationKey, LucideIcon> = {
  today: House,
  inbox: Inbox,
  money: Wallet,
  projects: FolderKanban,
  planner: CalendarRange,
};
