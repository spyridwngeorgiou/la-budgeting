import { notFound } from "next/navigation";
import { LegacyProjectPage } from "./LegacyProjectPage";

// A malformed id (an old or mistyped link) is «not found», not a database
// error on the error page.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Σύνοψη Έργου: the one-pager (./LegacyProjectPage.tsx) -- «Σύνοψη +
// ανάπτυξη»: three or four figures per block, the details behind «▸».
// ?s=<scenario id> picks the scenario the page shows and edits (default:
// the base). ?show=plan | partners opens the full planner block or the
// partner management in place of its summary line.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ s?: string | string[]; show?: string | string[] }>;
}) {
  const [{ id }, { s, show }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  const panel = show === "plan" || show === "partners" ? show : undefined;
  return <LegacyProjectPage id={id} requestedScenario={s} show={panel} />;
}
