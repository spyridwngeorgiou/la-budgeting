// The design system's building blocks (P15 Light Blue). Import from
// "@/components/ui"; the files behind it are one component family each.
// Rules (see src/app/globals.css): one canvas, no cards or shadows, square
// corners, 1px hairlines, navy the only solid fill, Inter only.

export { cn } from "./cn";
export * as tokens from "./tokens";

export { Button, ButtonLink, buttonClass, withPlus, AiSpark, type ButtonVariant, type ButtonSize } from "./Button";
export { Input, MoneyInput, Select, Textarea, Checkbox, Label, Field, Term } from "./Field";
export { Badge, StatusDot, type Tone } from "./Badge";
export { Stat, StatRow, GlancePanel, figureFit } from "./Stat";
export { PageHeader, SectionHeader, MetaList, KeyValue } from "./PageHeader";
export { DataTable, Amount, type Column } from "./DataTable";
export { SpecTable, Th, Td, Tr, TH_CLASS, TD_CLASS, NUM_CLASS, LINK_CLASS, SUB_CLASS } from "./SpecTable";
export { Notice, type NoticeTone } from "./Notice";
export { Toolbar, FilterChip, Segmented, ViewSwitch } from "./Toolbar";
export { Tabs } from "./Tabs";
export { Drawer, FormDrawer } from "./Drawer";
export { Modal, FormModal, DialogForm } from "./Modal";
export { Menu, MenuItem, MenuLink, MenuSeparator } from "./Menu";
export { EmptyState } from "./EmptyState";
export { ToastProvider, useToast, type ToastOptions } from "./Toast";
export { Worklist, WorklistItem, type Severity } from "./Worklist";
export { Sparkline } from "./Sparkline";
export { chartTheme, compactNumber, ReferenceKey, STACK_PALETTE, type ReferenceKeyKind } from "./chart";
// TrendChart, BarChart and BandChart (recharts) are imported from
// "@/components/ui/<Name>" directly, so recharts never rides into a bundle
// through this barrel.
export {
  ReportSection,
  KpiBand,
  ReportChart,
  ReportHistory,
  ReportFooter,
  type KpiItem,
} from "./ReportSection";
export { Skeleton, PageSkeleton, Card } from "./Skeleton";
export { Brand, LogoMark, Wordmark } from "./Brand";
