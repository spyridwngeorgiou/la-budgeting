// Kansha connector -- lets the Claude app (phone, claude.ai, desktop) read the
// back office and record entries, as the signed-in Kansha user.
//
// One Worker, two roles (workers-oauth-provider):
//   /authorize            our sign-in + consent page (Kansha email and password)
//   /mcp                  the MCP endpoint, reached only with a token we issued
//   discovery, /token, /register  handled by the library
//
// Safety rules, the same everywhere an entry can come from:
//   - reading is free; every write is two steps: kansha_prepare_* shows exactly
//     what would be written and returns a signed, single-use token; only
//     kansha_confirm writes, and only after the user said yes.
//   - the duplicate check (possible_duplicates, migration 0030) runs at both
//     steps; a match needs the user to say "separate" (allow_duplicate).
//   - a confirm token can be used once: its nonce becomes legacy_excel_id
//     "claude:<nonce>", so a repeated yes finds the row instead of adding one.
//   - nothing is ever deleted; every write lands in the activity log as
//     "<email> via Claude".

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: import("@cloudflare/workers-oauth-provider").OAuthHelpers;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CONFIRM_SECRET: string;
  PUBLIC_URL: string;
}
type Props = { userId: string; email: string; orgId: string; client?: string };

// Tokens go only to Claude's and ChatGPT's own redirect hosts.
const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "claude.com", "www.claude.ai", "www.claude.com", "chatgpt.com", "www.chatgpt.com"];
const clientLabel = (host: string) => (host.includes("chatgpt") ? "ChatGPT" : "Claude");

// ---------------------------------------------------------------- helpers
const eur = new Intl.NumberFormat("el-GR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => `${eur.format(n)} €`;
const today = () => new Date().toISOString().slice(0, 10);
const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

function db(env: Env, props?: Props): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: props ? { "x-actor-email": props.email } : {} },
  });
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

type Pending =
  | { kind: "entry"; row: Record<string, unknown>; summary: string }
  | { kind: "mark_paid"; id: string; paid_on: string; account_id: string | null; summary: string };

async function signPending(env: Env, props: Props, p: Pending) {
  const body = b64(JSON.stringify({ ...p, org: props.orgId, user: props.userId, nonce: crypto.randomUUID(), exp: Date.now() + 30 * 60_000 }));
  return `${body}.${await hmac(env.CONFIRM_SECRET, body)}`;
}
async function readPending(env: Env, props: Props, token: string) {
  const [body, sig] = token.split(".");
  if (!body || !sig || sig !== (await hmac(env.CONFIRM_SECRET, body))) throw new Error("Μη έγκυρος κωδικός έγκρισης.");
  const p = JSON.parse(unb64(body)) as Pending & { org: string; user: string; nonce: string; exp: number };
  if (p.org !== props.orgId || p.user !== props.userId) throw new Error("Ο κωδικός έγκρισης δεν είναι για αυτόν τον χρήστη.");
  if (Date.now() > p.exp) throw new Error("Η πρόταση έληξε (30 λεπτά). Ξεκίνα ξανά με kansha_prepare_*.");
  return p;
}

async function duplicates(sb: SupabaseClient, orgId: string, date: string, amount: number, direction: string, exceptId?: string) {
  const { data, error } = await sb.rpc("possible_duplicates", { p_org: orgId, p_date: date, p_amount: amount, p_direction: direction });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; tx_date: string; due_date: string | null; paid_on: string | null; status: string; gross_amount: number; account: string | null; project: string | null; description: string | null }[])
    .filter((d) => d.id !== exceptId);
}
const dupLines = (d: Awaited<ReturnType<typeof duplicates>>) =>
  d.map((x) => `  • ${x.paid_on ?? x.due_date ?? x.tx_date} · ${money(Number(x.gross_amount))} · ${x.status} · ${x.account ?? "—"} · ${x.project ?? "—"} · ${x.description ?? ""}`).join("\n");

// ---------------------------------------------------------------- MCP tools
function buildServer(env: Env, props: Props) {
  const sb = db(env, props);
  const org = props.orgId;
  const server = new McpServer(
    { name: "kansha", version: "1.0.0" },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Kansha back office (Χρήστος Λάμπρου). Απαντάς στα ελληνικά. Στην αρχή διάβασε kansha_notes (κοινός πίνακας με τα άλλα προγράμματα). Διαβάζεις ελεύθερα. ΠΟΤΕ δεν γράφεις χωρίς ρητό «ναι» του χρήστη: " +
        "πρώτα kansha_prepare_entry / kansha_prepare_mark_paid, δείχνεις αυτούσια την προεπισκόπηση, και μόνο μετά το «ναι» καλείς kansha_confirm. " +
        "Αν η προεπισκόπηση δείχνει πιθανή διπλή εγγραφή, ρωτάς «ίδια ή δύο;» και περνάς allow_duplicate μόνο αν πει ότι είναι ξεχωριστή. " +
        "Κανόνας: ό,τι δεν έχει γίνει ακόμα (μελλοντικό) μπαίνει ως pending, όχι ως πληρωμένο. Λείπει έργο/λογαριασμός; Ρωτάς, δεν μαντεύεις.",
    },
  );

  server.registerTool(
    "kansha_overview",
    { title: "Πού βρίσκομαι", description: "Υπόλοιπα ανά λογαριασμό (μετρητά/τράπεζες), σύνολο ρευστών, ληξιπρόθεσμα και τι πληρώνεται τις επόμενες 7 ημέρες.", annotations: { readOnlyHint: true } },
    async () => {
      const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      const [{ data: bal }, { data: open }] = await Promise.all([
        sb.from("v_account_balances").select("name, kind, current_balance").eq("org_id", org).order("name"),
        sb.from("transactions").select("tx_date, due_date, gross_amount, direction, description, notes, accounts(name), projects(display_name)")
          .eq("org_id", org).in("status", ["pending", "scheduled"]).lte("tx_date", week).order("tx_date").limit(200),
      ]);
      const cash = (bal ?? []).filter((b) => b.kind === "cash").reduce((s, b) => s + Number(b.current_balance), 0);
      const bank = (bal ?? []).filter((b) => b.kind !== "cash").reduce((s, b) => s + Number(b.current_balance), 0);
      const real = (open ?? []).filter((t) => !/^\[(ΠΡΟΒΛΕΨΗ|ΜΕ ΔΑΝΕΙΟ)\]/.test(t.notes ?? ""));
      const t0 = today();
      const overdue = real.filter((t) => String(t.due_date ?? t.tx_date) < t0);
      const soon = real.filter((t) => String(t.due_date ?? t.tx_date) >= t0);
      const line = (t: (typeof real)[number]) =>
        `  • ${t.due_date ?? t.tx_date} · ${t.direction === "income" ? "+" : "−"}${money(Number(t.gross_amount))} · ${one(t.accounts)?.name ?? "—"} · ${one(t.projects)?.display_name ?? "—"} · ${t.description ?? ""}`;
      return text(
        [
          `Υπόλοιπα (${t0}):`,
          ...(bal ?? []).map((b) => `  • ${b.name}: ${money(Number(b.current_balance))}`),
          `Μετρητά ${money(cash)} · Τράπεζες ${money(bank)} · Σύνολο ${money(cash + bank)}`,
          "",
          `Ληξιπρόθεσμα (${overdue.length}):`, ...overdue.map(line),
          "", `Επόμενες 7 ημέρες (${soon.length}):`, ...soon.map(line),
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "kansha_reference",
    { title: "Έργα, λογαριασμοί, κατηγορίες", description: "Οι κωδικοί που χρειάζονται για μια καταχώριση: έργα (code), λογαριασμοί (όνομα), κατηγορίες (code).", annotations: { readOnlyHint: true } },
    async () => {
      const [{ data: p }, { data: a }, { data: c }] = await Promise.all([
        sb.from("projects").select("code, display_name").eq("org_id", org).order("sort_order"),
        sb.from("accounts").select("name, kind").eq("org_id", org).order("name"),
        sb.from("categories").select("code, name, scope").eq("org_id", org).order("name"),
      ]);
      return text(
        ["Έργα:", ...(p ?? []).map((x) => `  • ${x.code} — ${x.display_name}`), "Λογαριασμοί:", ...(a ?? []).map((x) => `  • ${x.name} (${x.kind === "cash" ? "μετρητά" : "τράπεζα"})`),
          "Κατηγορίες:", ...(c ?? []).map((x) => `  • ${x.code} — ${x.name}${x.scope === "personal" ? " (προσωπικά)" : ""}`)].join("\n"),
      );
    },
  );

  server.registerTool(
    "kansha_search",
    {
      title: "Αναζήτηση κινήσεων",
      description: "Βρίσκει κινήσεις με λέξη (περιγραφή/αντισυμβαλλόμενος), ποσό, διάστημα ημερομηνιών ή κατάσταση. Για έλεγχο «υπάρχει ήδη;» και για ερωτήσεις.",
      inputSchema: {
        text: z.string().optional().describe("λέξη στην περιγραφή ή στον αντισυμβαλλόμενο"),
        amount: z.number().optional().describe("ακριβές συνολικό ποσό"),
        from: z.string().optional().describe("από YYYY-MM-DD"),
        to: z.string().optional().describe("έως YYYY-MM-DD"),
        status: z.enum(["paid", "pending", "scheduled"]).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ text: q, amount, from, to, status }) => {
      let r = sb.from("transactions").select("id, tx_date, due_date, paid_on, status, direction, gross_amount, description, counterparty_name, accounts(name), projects(display_name)")
        .eq("org_id", org).neq("status", "cancelled").order("tx_date", { ascending: false }).limit(40);
      if (q) r = r.or(`description.ilike.%${q.replace(/[%,()]/g, " ")}%,counterparty_name.ilike.%${q.replace(/[%,()]/g, " ")}%`);
      if (amount != null) r = r.gte("gross_amount", amount - 0.005).lte("gross_amount", amount + 0.005);
      if (from) r = r.gte("tx_date", from);
      if (to) r = r.lte("tx_date", to);
      if (status) r = r.eq("status", status);
      const { data, error } = await r;
      if (error) throw new Error(error.message);
      if (!data?.length) return text("Δεν βρέθηκε τίποτα.");
      return text(data.map((t) => `• [${t.id}] ${t.paid_on ?? t.due_date ?? t.tx_date} · ${t.status} · ${t.direction === "income" ? "+" : "−"}${money(Number(t.gross_amount))} · ${one(t.accounts)?.name ?? "—"} · ${one(t.projects)?.display_name ?? "—"} · ${t.description ?? t.counterparty_name ?? ""}`).join("\n"));
    },
  );

  server.registerTool(
    "kansha_upcoming",
    {
      title: "Τι πληρώνω / εισπράττω",
      description: "Ανοιχτές (μη πληρωμένες) κινήσεις μέχρι N ημέρες μπροστά, μαζί με τα ληξιπρόθεσμα. Οι προβλέψεις σημειώνονται.",
      inputSchema: { days: z.number().int().min(1).max(365).default(30) },
      annotations: { readOnlyHint: true },
    },
    async ({ days }) => {
      const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const { data, error } = await sb.from("transactions").select("id, tx_date, due_date, direction, gross_amount, description, notes, accounts(name), projects(display_name)")
        .eq("org_id", org).in("status", ["pending", "scheduled"]).lte("tx_date", until).order("tx_date").limit(300);
      if (error) throw new Error(error.message);
      if (!data?.length) return text("Τίποτα ανοιχτό σε αυτό το διάστημα.");
      return text(data.map((t) => `• [${t.id}] ${t.due_date ?? t.tx_date} · ${t.direction === "income" ? "+" : "−"}${money(Number(t.gross_amount))} · ${one(t.accounts)?.name ?? "—"} · ${one(t.projects)?.display_name ?? "—"} · ${t.description ?? ""}${/^\[ΠΡΟΒΛΕΨΗ\]/.test(t.notes ?? "") ? " (πρόβλεψη)" : /^\[ΜΕ ΔΑΝΕΙΟ\]/.test(t.notes ?? "") ? " (μόνο με δάνειο)" : ""}`).join("\n"));
    },
  );

  server.registerTool(
    "kansha_prepare_entry",
    {
      title: "Νέα κίνηση — προεπισκόπηση",
      description:
        "Ετοιμάζει (ΔΕΝ γράφει) μια νέα πληρωμή ή είσπραξη: ελέγχει έργο/λογαριασμό/κατηγορία, ψάχνει πιθανή διπλή εγγραφή (ίδιο ποσό ±7 ημέρες) και επιστρέφει προεπισκόπηση + κωδικό έγκρισης. " +
        "Δείξε την προεπισκόπηση στον χρήστη· γράφεται μόνο με kansha_confirm μετά το «ναι» του.",
      inputSchema: {
        date: z.string().describe("ημερομηνία YYYY-MM-DD (πληρωμής, ή αναμενόμενη αν δεν έχει γίνει)"),
        amount: z.number().positive().describe("συνολικό ποσό (με ΦΠΑ) σε €"),
        direction: z.enum(["expense", "income"]),
        account: z.string().describe("όνομα λογαριασμού, π.χ. «Μετρητά», «Optima Εταιρικός», «Πειραιώς Προσωπικός»"),
        description: z.string(),
        project_code: z.string().optional().describe("κωδικός έργου από kansha_reference"),
        category_code: z.string().optional(),
        counterparty: z.string().optional(),
        status: z.enum(["paid", "pending"]).default("paid").describe("paid μόνο αν έχει ήδη γίνει"),
        due_date: z.string().optional().describe("λήξη, για pending"),
        scope: z.enum(["business", "personal"]).default("business"),
        vat: z.number().min(0).optional().describe("ΦΠΑ μέσα στο ποσό, αν είναι γνωστός"),
        invoice_number: z.string().optional(),
        notes: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const errors: string[] = [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date)) errors.push("Η ημερομηνία πρέπει να είναι YYYY-MM-DD.");
      if (a.status === "paid" && a.date > today()) errors.push("Μελλοντική ημερομηνία: δεν μπορεί να είναι «πληρωμένο» — χρησιμοποίησε status pending.");
      const [{ data: acc }, proj, cat] = await Promise.all([
        sb.from("accounts").select("id, name, kind").eq("org_id", org).eq("name", a.account).maybeSingle(),
        a.project_code ? sb.from("projects").select("id, display_name").eq("org_id", org).eq("code", a.project_code).maybeSingle() : Promise.resolve({ data: null }),
        a.category_code ? sb.from("categories").select("id, name").eq("org_id", org).eq("code", a.category_code).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (!acc) errors.push(`Άγνωστος λογαριασμός «${a.account}» (δες kansha_reference).`);
      if (a.project_code && !proj.data) errors.push(`Άγνωστο έργο «${a.project_code}».`);
      if (a.category_code && !cat.data) errors.push(`Άγνωστη κατηγορία «${a.category_code}».`);
      if (errors.length) return text("Δεν μπορεί να ετοιμαστεί:\n" + errors.map((e) => "  • " + e).join("\n"));

      const vat = Math.round((a.vat ?? 0) * 100) / 100;
      const gross = Math.round(a.amount * 100) / 100;
      const dupDay = a.status === "paid" ? a.date : (a.due_date ?? a.date);
      const dups = await duplicates(sb, org, dupDay, gross, a.direction);
      const row = {
        org_id: org, tx_date: a.date, paid_on: a.status === "paid" ? a.date : null, due_date: a.status === "pending" ? (a.due_date ?? a.date) : null,
        status: a.status, direction: a.direction, scope: a.scope, origin: "ai_nl",
        account_id: acc!.id, project_id: proj.data?.id ?? null, category_id: cat.data?.id ?? null,
        gross_amount: gross, net_amount: Math.round((gross - vat) * 100) / 100, vat_amount: vat, withholding_amount: 0,
        has_invoice: !!a.invoice_number || vat > 0, invoice_number: a.invoice_number ?? null,
        counterparty_name: a.counterparty ?? null, description: a.description,
        notes: [a.notes, `Μέσω ${props.client ?? "Claude"} (${props.email}).`].filter(Boolean).join(" · "),
      };
      const summary =
        `${a.status === "paid" ? "Πληρωμένο" : "Ανοιχτό (θα πληρωθεί)"} · ${a.direction === "income" ? "ΕΙΣΠΡΑΞΗ" : "ΠΛΗΡΩΜΗ"} ${money(gross)}${vat ? ` (ΦΠΑ ${money(vat)})` : ""}\n` +
        `Ημερομηνία ${a.date}${row.due_date && row.due_date !== a.date ? ` · λήξη ${row.due_date}` : ""} · ${acc!.name} · ${proj.data?.display_name ?? "χωρίς έργο"}${cat.data ? ` · ${cat.data.name}` : ""}\n` +
        `«${a.description}»${a.counterparty ? ` — ${a.counterparty}` : ""}${a.invoice_number ? ` · παραστατικό ${a.invoice_number}` : ""}`;
      const token = await signPending(env, props, { kind: "entry", row, summary });
      return text(
        `ΠΡΟΕΠΙΣΚΟΠΗΣΗ (δεν έχει γραφτεί τίποτα):\n${summary}\n\n` +
          (dups.length ? `⚠ ΠΙΘΑΝΗ ΔΙΠΛΗ ΕΓΓΡΑΦΗ — υπάρχει ήδη ίδιο ποσό ±7 ημέρες:\n${dupLines(dups)}\nΡώτα τον χρήστη: «ίδια ή δύο διαφορετικές;». Μόνο αν πει δύο: kansha_confirm με allow_duplicate=true.\n\n` : "Δεν βρέθηκε ίδια κίνηση ±7 ημέρες.\n\n") +
          `Κωδικός έγκρισης (για kansha_confirm, ισχύει 30 λεπτά): ${token}`,
      );
    },
  );

  server.registerTool(
    "kansha_prepare_mark_paid",
    {
      title: "Σημείωση ως πληρωμένο — προεπισκόπηση",
      description: "Ετοιμάζει (ΔΕΝ γράφει) τη σημείωση μιας ανοιχτής κίνησης ως πληρωμένης (id από kansha_upcoming/kansha_search). Γράφεται μόνο με kansha_confirm μετά το «ναι».",
      inputSchema: {
        transaction_id: z.string().uuid(),
        paid_on: z.string().describe("ημερομηνία πληρωμής YYYY-MM-DD"),
        account: z.string().optional().describe("αν πληρώθηκε από άλλον λογαριασμό από τον προγραμματισμένο"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ transaction_id, paid_on, account }) => {
      if (paid_on > today()) return text("Η ημερομηνία πληρωμής δεν μπορεί να είναι στο μέλλον.");
      const { data: t } = await sb.from("transactions").select("id, status, tx_date, due_date, gross_amount, direction, description, account_id, accounts(name), projects(display_name)")
        .eq("org_id", org).eq("id", transaction_id).maybeSingle();
      if (!t) return text("Δεν βρέθηκε αυτή η κίνηση.");
      if (t.status === "paid") return text("Είναι ήδη πληρωμένη — δεν χρειάζεται τίποτα.");
      let accountId: string | null = null;
      let accountName = one(t.accounts)?.name ?? "—";
      if (account) {
        const { data: acc } = await sb.from("accounts").select("id, name").eq("org_id", org).eq("name", account).maybeSingle();
        if (!acc) return text(`Άγνωστος λογαριασμός «${account}».`);
        accountId = acc.id;
        accountName = acc.name;
      }
      const summary = `Σημείωση ΠΛΗΡΩΜΕΝΟ στις ${paid_on}: ${t.direction === "income" ? "είσπραξη" : "πληρωμή"} ${money(Number(t.gross_amount))} · ${accountName} · ${one(t.projects)?.display_name ?? "—"} · «${t.description ?? ""}» (ήταν για ${t.due_date ?? t.tx_date})`;
      const token = await signPending(env, props, { kind: "mark_paid", id: t.id, paid_on, account_id: accountId, summary });
      return text(`ΠΡΟΕΠΙΣΚΟΠΗΣΗ (δεν έχει γραφτεί τίποτα):\n${summary}\n\nΚωδικός έγκρισης (για kansha_confirm, ισχύει 30 λεπτά): ${token}`);
    },
  );

  server.registerTool(
    "kansha_confirm",
    {
      title: "Έγκριση — καταχώριση",
      description: "Γράφει στη βάση ό,τι ετοίμασε ένα kansha_prepare_*. Κάλεσέ το ΜΟΝΟ αφού ο χρήστης είπε ρητά «ναι» στην προεπισκόπηση. Ο ίδιος κωδικός δεν γράφει ποτέ δύο φορές.",
      inputSchema: {
        token: z.string().describe("ο κωδικός έγκρισης από το kansha_prepare_*"),
        allow_duplicate: z.boolean().default(false).describe("true μόνο αν ο χρήστης είπε ότι είναι ξεχωριστή από την πιθανή διπλή"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ token, allow_duplicate }) => {
      const p = await readPending(env, props, token);
      const ref = `claude:${p.nonce}`;
      if (p.kind === "entry") {
        const { data: done } = await sb.from("transactions").select("id").eq("org_id", org).eq("legacy_excel_id", ref).maybeSingle();
        if (done) return text(`Έχει ήδη καταχωριστεί (δεν γράφτηκε δεύτερη φορά).\n${p.summary}`);
        const r = p.row as { tx_date: string; paid_on: string | null; due_date: string | null; gross_amount: number; direction: string };
        const dups = await duplicates(sb, org, r.paid_on ?? r.due_date ?? r.tx_date, r.gross_amount, r.direction);
        if (dups.length && !allow_duplicate) return text(`ΣΤΟΠ — δεν γράφτηκε. Υπάρχει ήδη ίδιο ποσό ±7 ημέρες:\n${dupLines(dups)}\nΡώτα «ίδια ή δύο;».`);
        const { data, error } = await sb.from("transactions").insert({ ...p.row, legacy_excel_id: ref }).select("id").single();
        if (error) throw new Error(error.message);
        return text(`✓ Καταχωρίστηκε [${data.id}]\n${p.summary}`);
      }
      const { data: t } = await sb.from("transactions").select("status").eq("org_id", org).eq("id", p.id).maybeSingle();
      if (!t) return text("Η κίνηση δεν υπάρχει πια.");
      if (t.status === "paid") return text(`Ήταν ήδη πληρωμένη (δεν άλλαξε τίποτα).\n${p.summary}`);
      const patch: Record<string, unknown> = { status: "paid", paid_on: p.paid_on };
      if (p.account_id) patch.account_id = p.account_id;
      const { error } = await sb.from("transactions").update(patch).eq("org_id", org).eq("id", p.id);
      if (error) throw new Error(error.message);
      return text(`✓ Ενημερώθηκε\n${p.summary}`);
    },
  );

  // «Εντολές & σημειώσεις»: the board shared by Claude, ChatGPT and VS Code.
  server.registerTool(
    "kansha_notes",
    {
      title: "Εντολές & σημειώσεις",
      description:
        "Ο κοινός πίνακας ανάμεσα σε Claude, ChatGPT και VS Code: ανοιχτές εντολές (τι πρέπει να γίνει) και σημειώσεις (αποφάσεις, πληροφορίες). " +
        "Διάβασέ τον στην αρχή κάθε συζήτησης για τα οικονομικά, για να ξέρεις τι ζήτησε ο χρήστης από άλλο πρόγραμμα.",
      inputSchema: { status: z.enum(["open", "done", "all"]).default("open") },
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => {
      let r = sb.from("ai_notes").select("id, kind, title, body, status, due_date, created_by, created_via, created_at, done_via, done_note, projects(display_name)")
        .eq("org_id", org).order("created_at", { ascending: false }).limit(60);
      if (status !== "all") r = r.eq("status", status);
      const { data, error } = await r;
      if (error) throw new Error(error.message);
      if (!data?.length) return text(status === "open" ? "Καμία ανοιχτή εντολή ή σημείωση." : "Τίποτα.");
      return text(data.map((n) =>
        `• [${n.id}] ${n.kind === "task" ? "ΕΝΤΟΛΗ" : "ΣΗΜΕΙΩΣΗ"}${n.status === "done" ? " (έγινε)" : ""} — ${n.title}` +
        `${one(n.projects)?.display_name ? ` · ${one(n.projects)!.display_name}` : ""}${n.due_date ? ` · έως ${n.due_date}` : ""}` +
        `\n    από ${n.created_via ?? "—"}, ${String(n.created_at).slice(0, 10)}${n.body ? `\n    ${n.body}` : ""}${n.done_note ? `\n    ✓ ${n.done_via ?? ""}: ${n.done_note}` : ""}`,
      ).join("\n"));
    },
  );

  server.registerTool(
    "kansha_note_add",
    {
      title: "Νέα εντολή ή σημείωση",
      description:
        "Γράφει στον κοινό πίνακα μια εντολή (για να την κάνει άλλο πρόγραμμα, π.χ. «στο VS Code: πέρασε το extrait Πειραιώς») ή μια σημείωση (απόφαση/πληροφορία). " +
        "Μόνο όταν ο χρήστης το ζητήσει ρητά. Δεν αγγίζει οικονομικά δεδομένα.",
      inputSchema: {
        kind: z.enum(["task", "note"]),
        title: z.string().min(3),
        body: z.string().optional(),
        project_code: z.string().optional(),
        due_date: z.string().optional().describe("YYYY-MM-DD"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (a) => {
      let project_id: string | null = null;
      if (a.project_code) {
        const { data: p } = await sb.from("projects").select("id").eq("org_id", org).eq("code", a.project_code).maybeSingle();
        if (!p) return text(`Άγνωστο έργο «${a.project_code}».`);
        project_id = p.id;
      }
      const { data, error } = await sb.from("ai_notes")
        .insert({ org_id: org, kind: a.kind, title: a.title, body: a.body ?? null, project_id, due_date: a.due_date ?? null, created_by: props.email, created_via: props.client ?? "Claude" })
        .select("id").single();
      if (error) throw new Error(error.message);
      return text(`✓ ${a.kind === "task" ? "Εντολή" : "Σημείωση"} καταχωρίστηκε [${data.id}]: ${a.title}`);
    },
  );

  server.registerTool(
    "kansha_note_done",
    {
      title: "Εντολή ολοκληρώθηκε",
      description: "Κλείνει μια εντολή του κοινού πίνακα, με σύντομο σχόλιο για το τι έγινε. Μόνο αφού έγινε πράγματι.",
      inputSchema: { id: z.string().uuid(), note: z.string().min(2).describe("τι έγινε") },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ id, note }) => {
      const { data, error } = await sb.from("ai_notes")
        .update({ status: "done", done_at: new Date().toISOString(), done_by: props.email, done_via: props.client ?? "Claude", done_note: note })
        .eq("org_id", org).eq("id", id).eq("status", "open").select("title").maybeSingle();
      if (error) throw new Error(error.message);
      return text(data ? `✓ Έκλεισε: ${data.title}` : "Δεν βρέθηκε ανοιχτή εντολή με αυτό το id.");
    },
  );

  return server;
}

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }) {
    const server = buildServer(env, ctx.props);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

// ---------------------------------------------------------------- sign-in page
const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f5f2;color:#16181a;margin:0;padding:24px}main{max-width:420px;margin:6vh auto;background:#fff;border:1px solid #e3e1dc;border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p{color:#555;font-size:14px}label{display:block;font-size:13px;margin:14px 0 4px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d6d3cc;border-radius:8px;font-size:15px}
.row{display:flex;gap:8px;margin-top:18px}button{flex:1;padding:11px;border-radius:8px;border:1px solid #16181a;font-size:15px;cursor:pointer}.ok{background:#16181a;color:#fff}.no{background:#fff}.err{color:#b42318;font-size:14px}ul{font-size:14px;color:#333;padding-left:18px}</style></head>
<body><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );

function consentBody(redirectHost: string, handle: string, error?: string) {
  return `<h1>Σύνδεση Kansha με το Claude</h1>
<p>Το <strong>Claude</strong> ζητά πρόσβαση στο Kansha Back Office. Η πρόσβαση θα σταλεί στο <strong>${html(redirectHost)}</strong>.</p>
<ul><li>Διαβάζει υπόλοιπα, κινήσεις και προγραμματισμένα.</li><li>Καταχωρίζει μόνο αφού δεις την προεπισκόπηση και πεις «ναι».</li><li>Δεν σβήνει τίποτα. Όλα γράφονται στο Ιστορικό.</li></ul>
${error ? `<p class="err">${html(error)}</p>` : ""}
<form method="post"><input type="hidden" name="handle" value="${html(handle)}">
<label>Email</label><input name="email" type="email" autocomplete="username" required>
<label>Κωδικός εφαρμογής Kansha</label><input name="password" type="password" autocomplete="current-password" required>
<!-- approve first in the markup, so Enter in the password field approves; shown on the right -->
<div class="row" style="flex-direction:row-reverse"><button class="ok" name="decision" value="approve">Σύνδεση και έγκριση</button><button class="no" name="decision" value="deny" formnovalidate>Άρνηση</button></div></form>`;
}

const defaultHandler = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    // A connector added without "/mcp" lands here: say so instead of serving HTML.
    if (url.pathname === "/" && request.method === "POST") {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Λάθος διεύθυνση: η σύνδεση πρέπει να τελειώνει σε /mcp — https://kansha-connector.kansha-chris.workers.dev/mcp" } }, { status: 404 });
    }
    if (url.pathname === "/") return page("Kansha connector", "<h1>Kansha connector</h1><p>Σύνδεση για το Claude. Προσθήκη στο claude.ai → Settings → Connectors με το URL <code>/mcp</code>.</p>");
    // Public policy pages (required by the bank-data provider registration).
    if (url.pathname === "/privacy") return page("Privacy — Kansha Back Office", "<h1>Privacy</h1><p>Kansha Back Office is a private bookkeeping tool used only by KANSHA Μονοπρόσωπη Α.Ε. (ΑΦΜ 802801650) and its owner. Bank account data (balances and transactions) is read only with the account holder’s explicit consent, used solely for the company’s own bookkeeping and cash planning, stored in the company’s private database in the EU (Supabase, Frankfurt), never sold or shared with third parties, and deleted on request. Contact: create@chriskansha.com</p>");
    if (url.pathname === "/terms") return page("Terms — Kansha Back Office", "<h1>Terms</h1><p>Kansha Back Office is an internal application of KANSHA Μονοπρόσωπη Α.Ε., not offered to the public. Access is limited to the company’s owner and authorised staff. Bank access is read-only (account information only); the application cannot initiate payments. Contact: create@chriskansha.com</p>");
    if (url.pathname !== "/authorize") return new Response("Not found", { status: 404 });
    const oauth = env.OAUTH_PROVIDER;

    if (request.method === "GET") {
      let req;
      try {
        req = await oauth.parseAuthRequest(request);
      } catch (e) {
        const redirectTo = (e as { redirectTo?: string }).redirectTo;
        if (redirectTo) return Response.redirect(redirectTo, 302);
        return page("Σφάλμα", `<h1>Μη έγκυρο αίτημα</h1><p class="err">${html(e instanceof Error ? e.message : String(e))}</p>`);
      }
      const details = await oauth.describeConsent(req);
      if (!ALLOWED_REDIRECT_HOSTS.includes(details.redirectHost)) {
        return page("Δεν επιτρέπεται", `<h1>Δεν επιτρέπεται</h1><p class="err">Αυτή η σύνδεση δέχεται μόνο το Claude (claude.ai). Αίτημα για: ${html(details.redirectHost)}</p>`);
      }
      const consent = await oauth.beginConsent(req);
      const res = page("Σύνδεση Kansha", consentBody(details.redirectHost, consent.handle).replace(/Claude/g, clientLabel(details.redirectHost)));
      consent.headers.forEach((v, k) => res.headers.append(k, v));
      return res;
    }

    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      console.log("authorize: decision", String(form.get("decision") ?? "(none)"));
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      // Kansha credentials -> Supabase user -> must belong to an org.
      const auth = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
      const { data: signin, error } = await auth.auth.signInWithPassword({ email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") });
      console.log("authorize: sign-in", error ? "failed: " + error.message : "ok");
      if (error || !signin.user) {
        return page("Σύνδεση Kansha", `<h1>Λάθος στοιχεία</h1><p class="err">Το email ή ο κωδικός δεν είναι σωστά. Γύρνα πίσω στο Claude και ξεκίνα ξανά τη σύνδεση.</p>`);
      }
      const { data: member } = await db(env).from("org_members").select("org_id, role").eq("user_id", signin.user.id).in("role", ["owner", "admin", "editor"]).limit(1).maybeSingle();
      console.log("authorize: member", member ? member.role : "none");
      if (!member) return page("Σύνδεση Kansha", `<h1>Χωρίς δικαίωμα</h1><p class="err">Ο λογαριασμός δεν έχει δικαίωμα καταχώρισης στην Kansha.</p>`);
      const approved = await oauth.approveConsent(request, handle);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: signin.user.id,
        metadata: { email: signin.user.email },
        scope: approved.request.scope,
        props: { userId: signin.user.id, email: signin.user.email ?? "", orgId: member.org_id, client: clientLabel(new URL(approved.request.redirectUri).hostname) } satisfies Props,
      });
      { const u = new URL(redirectTo); console.log("authorize: redirect", u.host + u.pathname, [...u.searchParams.keys()].join(","), u.searchParams.get("error") ?? ""); }
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response("Method not allowed", { status: 405 });
  },
};

const PUBLIC = "https://kansha-connector.kansha-chris.workers.dev";
export default new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpHandler as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["kansha"],
  resourceMetadata: { resource: `${PUBLIC}/mcp`, authorization_servers: [PUBLIC] },
  clientIdMetadataDocumentEnabled: true,
  refreshTokenIdleTTL: 60 * 60 * 24 * 30,
  onError: ({ code, description, status, internal, request }) => {
    console.log("oauth error", status, code, description, JSON.stringify(internal), request ? new URL(request.url).pathname : "");
  },
  // Only Claude or ChatGPT may register: every redirect URI on their hosts.
  clientRegistrationCallback: ({ clientMetadata }) => {
    const uris = Array.isArray(clientMetadata.redirect_uris) ? (clientMetadata.redirect_uris as unknown[]) : [];
    const ok = uris.length > 0 && uris.every((u) => {
      try {
        return ALLOWED_REDIRECT_HOSTS.includes(new URL(String(u)).hostname);
      } catch {
        return false;
      }
    });
    return ok ? undefined : { code: "invalid_redirect_uri", description: "Only Claude or ChatGPT may use this connector.", status: 400 };
  },
});
