import { LegacyProjectPage } from "./LegacyProjectPage";

// Σύνοψη Έργου: the one-pager (./LegacyProjectPage.tsx).
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LegacyProjectPage id={id} />;
}
