# HVK TF Part 1–5 dashboard (GitHub Pages)

- `index.html` — the dashboard (₹ / % per section, live tiles, charts, calendar).
- `seed.json` — daily history 23-Jun → 30-Oct-2026 (Tradetron reconciled).
- `data/live.json` — written every 15 min (Mon–Fri, 08:30–16:15 IST) by GitHub Actions.
- `scripts/update.mjs` — reads Tradetron Developer API (`/me/live-pnl`, `/me/deployments`).
- `.github/workflows/update.yml` — the 15-minute schedule.

The Tradetron key lives ONLY in the repo secret `TT_API_KEY`
(Settings → Secrets and variables → Actions). Never commit it.

Note: this repo is public, so the P&L data in `data/` and `seed.json` is public too.
