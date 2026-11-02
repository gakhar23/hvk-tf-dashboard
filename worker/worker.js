// Cloudflare Worker: live Tradetron P&L for the TF Part 1–5 dashboard.
// The page calls this every time it is opened, so it always shows the latest numbers.
// Secret needed in Cloudflare (Settings → Variables and Secrets): TT_API_KEY  (same key as the GitHub secret)
// Optional variable: ALLOW_ORIGIN (default https://gakhar23.github.io)

const BASE = "https://tradetron.tech/api/v1";
const IDS = ["30168334", "30168338", "30168342", "30169714", "31353714"]; // TF Part 1–5
const CACHE_SECONDS = 20; // many visitors at once = one Tradetron call per 20 s

async function ttGet(env, path) {
  const r = await fetch(BASE + path, {
    headers: { Authorization: `Bearer ${env.TT_API_KEY}`, Accept: "application/json", "User-Agent": "hvk-tf-dashboard/1.0" },
  });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`Tradetron HTTP ${r.status}: ${txt.slice(0, 200)}`); }
  if (!r.ok || j.success === false) throw new Error(`Tradetron HTTP ${r.status}: ${j.error || txt.slice(0, 200)}`);
  return j.data !== undefined ? j.data : j;
}
function listOf(d) {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const k of ["deployments", "items", "rows", "results", "data", "list"]) if (Array.isArray(d[k])) return d[k];
    const ents = Object.entries(d);
    if (ents.length && ents.every(([, v]) => v && typeof v === "object" && !Array.isArray(v))) return ents.map(([k, v]) => ({ id: k, ...v }));
  }
  return [];
}
const num = (v) => { const n = typeof v === "string" ? parseFloat(v.replace(/[,₹\s]/g, "")) : v; return Number.isFinite(n) ? n : null; };
function pick(o, keys) {
  for (const k of keys) if (o[k] != null) { const n = num(o[k]); if (n != null) return n; }
  for (const v of Object.values(o)) if (v && typeof v === "object" && !Array.isArray(v))
    for (const k of keys) if (v[k] != null) { const n = num(v[k]); if (n != null) return n; }
  return null;
}
const idOf = (it) => String(it.deployment_id ?? it.deploymentId ?? it.id ?? it.strategy_id ?? it.sid ?? "");

async function snapshot(env) {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  const date = d.toISOString().slice(0, 10), time = d.toISOString().slice(11, 16);

  const pnlAll = {};
  for (const it of listOf(await ttGet(env, `/me/live-pnl?ids=${IDS.join(",")}`))) {
    const id = idOf(it);
    if (id) pnlAll[id] = pick(it, ["pnl", "total_pnl", "live_pnl", "today_pnl", "pnl_today", "mtm", "net_pnl", "PNL", "profit"]);
  }
  const statusAll = {}; let statusError = null;
  try {
    for (let page = 1; page <= 5; page++) {
      const got = listOf(await ttGet(env, `/me/deployments?page=${page}`));
      for (const it of got) { const id = idOf(it); if (id) statusAll[id] = { status: it.status ?? it.state ?? it.deployment_status ?? null, run_counter: it.run_counter ?? it.runCounter ?? null }; }
      if (IDS.every((id) => statusAll[id]) || !got.length) break;
    }
  } catch (e) { statusError = String(e.message || e); }

  const pnl = {}, status = {};
  for (const id of IDS) { pnl[id] = pnlAll[id] ?? null; status[id] = statusAll[id] ?? null; }
  return { ok: true, date, time, at: new Date().toISOString(), pnl, status, statusError };
}

export default {
  async fetch(request, env, ctx) {
    const origin = env.ALLOW_ORIGIN || "https://gakhar23.github.io";
    const headers = { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": "no-store" };
    if (request.method === "OPTIONS") return new Response(null, { headers });
    if (!env.TT_API_KEY) return new Response(JSON.stringify({ ok: false, error: "TT_API_KEY secret not set on the Worker" }), { status: 500, headers });

    const cache = caches.default;
    const key = new Request(new URL(request.url).origin + "/__tf_live");
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers });

    try {
      const body = JSON.stringify(await snapshot(env));
      ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": `max-age=${CACHE_SECONDS}` } })));
      return new Response(body, { headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 502, headers });
    }
  },
};
