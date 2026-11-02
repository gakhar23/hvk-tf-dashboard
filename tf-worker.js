// HVK TF Part 1–5 dashboard on Cloudflare.
//  • Serves the page from /public.
//  • GET /api/data  → live Tradetron P&L (fetched at that moment) + saved history.
//  • Every 15 min (Mon–Fri, 08:30–16:15 IST) → saves a snapshot to KV, even if nobody has the page open.
// The Tradetron key is the Worker secret TT_API_KEY. It never leaves Cloudflare.
import initial from "./data/live.json";

const BASE = "https://tradetron.tech/api/v1";
const IDS = ["30168334", "30168338", "30168342", "30169714", "31353714"]; // TF Part 1–5
const STATE_KEY = "state";
const LIVE_CACHE_SECONDS = 20;   // many visitors at once = one Tradetron call per 20 s
const SAVE_EVERY_MIN = 5;        // page visits also add intraday points, at most every 5 min

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
  if (!env.TT_API_KEY) throw new Error("TT_API_KEY secret is not set on the Cloudflare Worker");
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
  return { date, time, at: new Date().toISOString(), pnl, status, statusError };
}

async function loadState(env) {
  const s = await env.TF.get(STATE_KEY, "json");
  return s || JSON.parse(JSON.stringify(initial));
}
const mins = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);

// Same rules as the old GitHub job: "latest" only moves when a part has P&L.
function apply(state, s, force) {
  state.lastCheck = { at: s.at, date: s.date, time: s.time, status: s.status, statusError: s.statusError };
  state.lastError = null;
  const traded = IDS.some((id) => s.pnl[id] != null && s.pnl[id] !== 0);
  if (!traded) return false;
  if (!state.latest || state.latest.date !== s.date) state.intraday = [];
  state.latest = s;
  const total = IDS.reduce((a, id) => a + (s.pnl[id] || 0), 0);
  const last = state.intraday[state.intraday.length - 1];
  let added = false;
  if (!last || (last.t !== s.time && (force || mins(s.time) - mins(last.t) >= SAVE_EVERY_MIN))) { state.intraday.push({ t: s.time, total }); added = true; }
  state.days = (state.days || []).filter((d) => d.date !== s.date);
  state.days.push({ date: s.date, pnl: s.pnl, final_at: s.time });
  return added;
}

async function scheduledRun(env) {
  const state = await loadState(env);
  try { apply(state, await snapshot(env), true); }
  catch (e) { state.lastError = { at: new Date().toISOString(), error: String(e.message || e) }; }
  await env.TF.put(STATE_KEY, JSON.stringify(state));
}

async function apiData(env, ctx) {
  const state = await loadState(env);
  let refreshError = null;
  try {
    const added = apply(state, await snapshot(env), false);
    if (added) ctx.waitUntil(env.TF.put(STATE_KEY, JSON.stringify(state)));
  } catch (e) { refreshError = String(e.message || e); }
  return { ok: true, latest: state.latest, lastCheck: state.lastCheck, lastError: state.lastError,
    intraday: state.latest ? (state.intraday || []) : [], days: state.days || [], refreshError };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/data") return env.ASSETS.fetch(request);
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    const cache = caches.default;
    const key = new Request(url.origin + "/__tf_data");
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { headers });
    const body = JSON.stringify(await apiData(env, ctx));
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": `max-age=${LIVE_CACHE_SECONDS}` } })));
    return new Response(body, { headers });
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledRun(env));
  },
};
