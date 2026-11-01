// Tradetron Developer API helpers. The key comes ONLY from the TT_API_KEY secret (GitHub Actions).
const BASE = process.env.TT_BASE || "https://tradetron.tech/api/v1";
export const IDS = ["30168334", "30168338", "30168342", "30169714", "31353714"]; // TF Part 1–5

export async function ttGet(path) {
  const key = process.env.TT_API_KEY;
  if (!key) throw new Error("TT_API_KEY secret is not set in the GitHub repo (Settings → Secrets and variables → Actions)");
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": "hvk-tf-dashboard/1.0" } });
  const txt = await r.text();
  let j;
  try { j = JSON.parse(txt); } catch { throw new Error(`Tradetron HTTP ${r.status}: ${txt.slice(0, 200)}`); }
  if (!r.ok || j.success === false) throw new Error(`Tradetron HTTP ${r.status}: ${j.error || txt.slice(0, 200)}`);
  return j.data !== undefined ? j.data : j;
}
export function listOf(d) {
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
export function normPnl(data) {
  const out = {};
  for (const it of listOf(data)) { const id = idOf(it); if (id) out[id] = pick(it, ["pnl", "total_pnl", "live_pnl", "today_pnl", "pnl_today", "mtm", "net_pnl", "PNL", "profit"]); }
  return out;
}
export function normDeps(data) {
  const out = {};
  for (const it of listOf(data)) { const id = idOf(it); if (id) out[id] = { status: it.status ?? it.state ?? it.deployment_status ?? null, run_counter: it.run_counter ?? it.runCounter ?? null }; }
  return out;
}
export function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
}
export async function takeSnapshot() {
  const now = istNow();
  const pnlRaw = await ttGet(`/me/live-pnl?ids=${IDS.join(",")}`);
  const pnlAll = normPnl(pnlRaw);
  let statusAll = {};
  try {
    for (let page = 1; page <= 5; page++) {
      const got = normDeps(await ttGet(`/me/deployments?page=${page}`));
      Object.assign(statusAll, got);
      if (IDS.every((id) => statusAll[id]) || !Object.keys(got).length) break;
    }
  } catch (e) { statusAll = { _error: String(e.message || e) }; }
  const pnl = {}, status = {};
  for (const id of IDS) { pnl[id] = pnlAll[id] ?? null; status[id] = statusAll[id] ?? null; }
  return { date: now.date, time: now.time, at: new Date().toISOString(), pnl, status, statusError: statusAll._error || null, pnlRaw };
}
