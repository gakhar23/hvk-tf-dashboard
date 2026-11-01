// Run by GitHub Actions every 15 min. Reads Tradetron, updates data/live.json.
// "latest" changes only when at least one part has P&L, so evenings/weekends keep the last session.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { takeSnapshot, IDS } from "./tt.mjs";

const FILE = "data/live.json";
const load = async (f, d) => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };

const live = await load(FILE, { latest: null, lastCheck: null, lastError: null, intraday: [], days: [] });
try {
  const s = await takeSnapshot();
  if (process.env.SHOW_RAW) console.log("RAW live-pnl:", JSON.stringify(s.pnlRaw).slice(0, 2000));
  delete s.pnlRaw;
  console.log("parsed pnl:", JSON.stringify(s.pnl));
  live.lastCheck = { at: s.at, date: s.date, time: s.time, status: s.status, statusError: s.statusError };
  const traded = IDS.some((id) => s.pnl[id] != null && s.pnl[id] !== 0);
  if (traded) {
    if (!live.latest || live.latest.date !== s.date) live.intraday = [];
    live.latest = s;
    const total = IDS.reduce((a, id) => a + (s.pnl[id] || 0), 0);
    if (!live.intraday.length || live.intraday[live.intraday.length - 1].t !== s.time) live.intraday.push({ t: s.time, total });
    live.days = (live.days || []).filter((d) => d.date !== s.date);
    live.days.push({ date: s.date, pnl: s.pnl, final_at: s.time });
    await mkdir("data/intraday", { recursive: true });
    await writeFile(`data/intraday/${s.date}.json`, JSON.stringify(live.intraday));
  }
  live.lastError = null;
  console.log(traded ? `Recorded ${s.date} ${s.time}` : `No P&L yet today (${s.date} ${s.time}); kept last session`);
} catch (e) {
  live.lastError = { at: new Date().toISOString(), error: String(e.message || e) };
  console.error("Tradetron read failed:", live.lastError.error);
  process.exitCode = 1;
}
await mkdir("data", { recursive: true });
await writeFile(FILE, JSON.stringify(live));
