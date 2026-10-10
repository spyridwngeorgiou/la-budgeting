import { LegacyComparePage } from "../LegacyComparePage";

// Side-by-side view of every scenario of a project (../LegacyComparePage.tsx).
export default async function ProjectComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LegacyComparePage id={id} />;
}
