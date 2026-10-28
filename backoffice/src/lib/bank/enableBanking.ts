// Enable Banking API (PSD2 account information, read-only). Every call is
// authorised by a short JWT signed with the application's private key
// (Worker secrets ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY).
// Web Crypto only, so it runs on Cloudflare Workers and in Node.

const API = "https://api.enablebanking.com";

export function bankConfigured() {
  return !!(process.env.ENABLE_BANKING_APP_ID && process.env.ENABLE_BANKING_PRIVATE_KEY);
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64urlJson = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

let keyCache: CryptoKey | null = null;
async function signingKey() {
  if (keyCache) return keyCache;
  const pem = (process.env.ENABLE_BANKING_PRIVATE_KEY ?? "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  keyCache = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return keyCache;
}

async function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64urlJson({ typ: "JWT", alg: "RS256", kid: process.env.ENABLE_BANKING_APP_ID });
  const body = b64urlJson({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await signingKey(), new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await jwt()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Enable Banking ${method} ${path.split("?")[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export type EbAccount = {
  uid: string;
  account_id?: { iban?: string; other?: { identification?: string } };
  name?: string;
  currency?: string;
  details?: string;
  product?: string;
};
export type EbTransaction = {
  entry_reference?: string | null;
  transaction_id?: string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: string; // BOOK, PDNG, ...
  remittance_information?: string[] | null;
  creditor?: { name?: string } | null;
  debtor?: { name?: string } | null;
  note?: string | null;
  balance_after_transaction?: { amount: string } | null;
};

export const startAuthorization = (p: { aspsp: string; psuType: "personal" | "business"; state: string; redirectUrl: string; validUntil: string }) =>
  call<{ url: string; authorization_id: string }>("POST", "/auth", {
    access: { valid_until: p.validUntil },
    aspsp: { name: p.aspsp, country: "GR" },
    state: p.state,
    redirect_url: p.redirectUrl,
    psu_type: p.psuType,
  });

export const createSession = (code: string) =>
  call<{ session_id: string; accounts: EbAccount[]; access?: { valid_until?: string } }>("POST", "/sessions", { code });

export const accountBalances = (uid: string) =>
  call<{ balances: { balance_amount: { amount: string; currency: string }; balance_type: string; reference_date?: string }[] }>("GET", `/accounts/${uid}/balances`);

export async function accountTransactions(uid: string, dateFrom: string) {
  const out: EbTransaction[] = [];
  let key: string | undefined;
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ date_from: dateFrom });
    if (key) q.set("continuation_key", key);
    const r = await call<{ transactions: EbTransaction[]; continuation_key?: string | null }>("GET", `/accounts/${uid}/transactions?${q}`);
    out.push(...(r.transactions ?? []));
    key = r.continuation_key ?? undefined;
    if (!key) break;
  }
  return out;
}
