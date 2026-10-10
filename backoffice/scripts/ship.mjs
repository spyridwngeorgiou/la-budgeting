// The release loop in one command, printing only summaries and failures
// (so an agent spends tokens on what broke, not on build logs).
//
//   node scripts/ship.mjs check              typecheck + lint + vitest
//   node scripts/ship.mjs ci                 wait for CI on HEAD, print failing lines
//   node scripts/ship.mjs smoke <env> [paths...]   logged-in GETs as a throwaway owner
//   node scripts/ship.mjs staging [paths...]       check -> push -> ci -> deploy -> smoke
//   node scripts/ship.mjs prod [paths...]          ci green on HEAD -> backup -> migrate -> deploy -> light smoke
//
// <env> is staging | prod. Needs SUPABASE_ACCESS_TOKEN (backoffice/.env.migrate).
// smoke on prod hits only a few pages, slowly: the Workers Free plan has a tiny
// CPU budget and a burst of SSR requests locks real users out (error 1102).
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, root } from "./lib/supabase-api.mjs";

loadEnv();
const ENVS = {
  staging: { ref: "jpxxixhiudwjbzagidmn", url: "https://kansha-back-office-staging.spyridwngeorgiou.workers.dev", deploy: "cf:deploy:staging" },
  prod: { ref: "hjypszddhwohgvubirkc", url: "https://kansha-back-office.spyridwngeorgiou.workers.dev", deploy: "cf:deploy" },
};
const REPO = "spyridwngeorgiou/la-budgeting";
const DEFAULT_PATHS = ["/dashboard", "/transactions", "/projects", "/planner", "/reports/cash", "/reports/pnl", "/accounts", "/contacts", "/inbox", "/collab"];

const sh = (cmd, opts = {}) => {
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 64 << 20, env: { ...process.env, MSYS_NO_PATHCONV: "1" }, ...opts });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const tail = (s, re, n = 30) => s.split(/\r?\n/).filter((l) => re.test(l)).slice(0, n).join("\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check() {
  rmSync(join(root, ".next", "dev"), { recursive: true, force: true });
  rmSync(join(root, ".next", "types"), { recursive: true, force: true });
  const tc = sh("npm run typecheck");
  if (!tc.ok) fail(`typecheck\n${tail(tc.out, /error TS/)}`);
  const lint = sh("npm run lint");
  if (!lint.ok) fail(`lint\n${tail(lint.out, /error|✖/)}`);
  const t = sh("npx vitest run");
  const summary = tail(t.out, /Test Files|Tests /, 2);
  if (!t.ok) fail(`vitest\n${tail(t.out, /FAIL|✗|×|AssertionError|Expected|Received/, 40)}\n${summary}`);
  console.log(`✓ check  ${summary.replace(/\s+/g, " ").trim()}`);
}

const gh = async (p) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}/${p}`, { headers: { "User-Agent": "kansha-ship", Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`GitHub ${r.status} ${p}`);
  return r.json();
};

async function ci() {
  const sha = sh("git rev-parse HEAD").out.trim();
  for (let i = 0; i < 60; i++) {
    const runs = (await gh(`commits/${sha}/check-runs`)).check_runs.filter((c) => !c.name.startsWith("Workers"));
    if (runs.length && runs.every((c) => c.status === "completed")) {
      const bad = runs.filter((c) => c.conclusion !== "success");
      for (const c of bad) {
        const notes = await gh(`check-runs/${c.id}/annotations?per_page=50`);
        const msg = notes.filter((a) => a.annotation_level === "failure" && !/exit code/.test(a.message)).map((a) => a.message.slice(0, 1500));
        console.error(`✗ ci ${c.name}\n${msg.join("\n")}`);
      }
      if (bad.length) process.exit(1);
      console.log(`✓ ci ${sha.slice(0, 7)} (${runs.map((c) => c.name).join(", ")})`);
      return;
    }
    await sleep(20_000);
  }
  fail("ci: timed out after 20 min");
}

async function smoke(envName, paths, { gapMs = 0 } = {}) {
  const env = ENVS[envName] ?? fail(`unknown env ${envName}`);
  const token = process.env.SUPABASE_ACCESS_TOKEN ?? fail("SUPABASE_ACCESS_TOKEN missing");
  const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "kansha-ship" };
  const mgmt = (p, init) => fetch(`https://api.supabase.com/v1/projects/${env.ref}${p}`, { ...init, headers: H }).then((r) => r.json());
  const sql = (q) => mgmt("/database/query", { method: "POST", body: JSON.stringify({ query: q }) });
  const keys = await mgmt("/api-keys");
  const anon = keys.find((k) => k.name === "anon").api_key;
  const service = keys.find((k) => k.name === "service_role").api_key;
  const auth = `https://${env.ref}.supabase.co/auth/v1`;
  const AH = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };

  const email = `smoke-${Date.now()}@test.local`;
  const password = `S${crypto.randomUUID()}!`;
  const user = await fetch(`${auth}/admin/users`, { method: "POST", headers: AH, body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
  let bad = 0;
  try {
    const [{ org_id }] = await sql("select org_id from transactions group by org_id order by count(*) desc limit 1");
    await sql(`delete from orgs where id in (select org_id from org_members where user_id='${user.id}') and id <> '${org_id}';
      insert into org_members (org_id, user_id, role) values ('${org_id}', '${user.id}', 'owner') on conflict (org_id, user_id) do update set role='owner';`);
    const [proj] = await sql(`select id from projects where org_id='${org_id}' order by created_at limit 1`);
    const session = await fetch(`${auth}/token?grant_type=password`, { method: "POST", headers: { apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
    const name = `sb-${env.ref}-auth-token`;
    const chunks = ("base64-" + Buffer.from(JSON.stringify(session)).toString("base64url")).match(/.{1,3180}/g);
    let cookie = chunks.length === 1 ? `${name}=${chunks[0]}` : chunks.map((c, i) => `${name}.${i}=${c}`).join("; ");
    if (process.env.UI) cookie += `; kansha_ui=${process.env.UI}`;

    const list = (paths.length ? paths : [...DEFAULT_PATHS, ...(proj ? [`/projects/${proj.id}`] : [])]).map((p) => p.replace("{project}", proj?.id ?? ""));
    for (const p of list) {
      const t0 = Date.now();
      const r = await fetch(env.url + p, { headers: { cookie }, redirect: "manual" });
      const html = await r.text();
      const ms = Date.now() - t0;
      // A streamed redirect (NEXT_REDIRECT digest) is fine; any other digest is a render error.
      const err = /Application error/.test(html) || /data-dgst="(?!NEXT_REDIRECT|NEXT_HTTP_ERROR)/.test(html);
      const toLogin = r.status >= 300 && r.status < 400 && /\/login/.test(r.headers.get("location") ?? "");
      if (r.status >= 400 || err || toLogin) {
        bad++;
        console.error(`✗ ${r.status}${err ? " render-error" : ""}${toLogin ? " -> login" : ""} ${p} (${ms}ms)`);
      }
      if (gapMs) await sleep(gapMs);
    }
    console.log(`${bad ? "✗" : "✓"} smoke ${envName}: ${list.length - bad}/${list.length} ok`);
  } finally {
    await fetch(`${auth}/admin/users/${user.id}`, { method: "DELETE", headers: AH });
  }
  if (bad) process.exit(1);
}

function deploy(envName) {
  const r = sh(`npm run ${ENVS[envName].deploy}`);
  if (!r.ok || !/Deployed/.test(r.out)) fail(`deploy ${envName}\n${tail(r.out, /ERROR|Error|error/, 20)}`);
  console.log(`✓ deploy ${envName}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "check") check();
else if (cmd === "ci") await ci();
else if (cmd === "smoke") await smoke(args[0], args.slice(1), { gapMs: args[0] === "prod" ? 1500 : 0 });
else if (cmd === "staging") {
  check();
  const push = sh("git push -q origin HEAD:main");
  if (!push.ok) fail(`push\n${push.out.slice(-800)}`);
  await ci();
  // Destructive migrations refuse to run here (no fresh backup): run
  // backup-json.mjs + migrate-remote.mjs --confirm-destructive by hand.
  const m = sh(`node scripts/migrate-remote.mjs ${ENVS.staging.ref}`);
  if (!m.ok) fail(`migrate staging\n${m.out.slice(-1500)}`);
  console.log(`✓ migrate staging ${tail(m.out, /pending/, 1).trim()}`);
  deploy("staging");
  await smoke("staging", args);
} else if (cmd === "prod") {
  await ci();
  const b = sh(`node scripts/backup-json.mjs ${ENVS.prod.ref}`);
  if (!b.ok) fail(`backup\n${b.out.slice(-800)}`);
  console.log(`✓ backup ${tail(b.out, /backup of/, 1).trim()}`);
  const m = sh(`node scripts/migrate-remote.mjs ${ENVS.prod.ref}`);
  if (!m.ok) fail(`migrate\n${m.out.slice(-1500)}`);
  console.log(`✓ migrate ${tail(m.out, /pending|applying/, 10).replace(/\n/g, "; ")}`);
  deploy("prod");
  await smoke("prod", args.length ? args : ["/dashboard", "/transactions", "/projects"], { gapMs: 1500 });
} else {
  console.error("usage: node scripts/ship.mjs check | ci | smoke <staging|prod> [paths] | staging [paths] | prod [paths]");
  process.exit(2);
}
