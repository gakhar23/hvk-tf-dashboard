# HVK TF Part 1–5 dashboard (GitHub Pages)

- `index.html` — the dashboard (₹ / % per section, live tiles, charts, calendar).
- `seed.json` — daily history 23-Jun → 30-Oct-2026 (Tradetron reconciled).
- `data/live.json` — written every 15 min (Mon–Fri, 08:30–16:15 IST) by GitHub Actions.
- `scripts/update.mjs` — reads Tradetron Developer API (`/me/live-pnl`, `/me/deployments`).
- `.github/workflows/update.yml` — the 15-minute schedule.

The Tradetron key lives ONLY in the repo secret `TT_API_KEY`
(Settings → Secrets and variables → Actions). Never commit it.

Note: this repo is public, so the P&L data in `data/` and `seed.json` is public too.

## Live data on every page open (Cloudflare Worker)

GitHub Pages can only serve saved files, so `data/live.json` is up to ~15 min old.
`worker/worker.js` reads Tradetron the moment someone opens the page.

1. dash.cloudflare.com → Workers & Pages → Create → Worker → name it `hvk-tf-live` → Deploy.
2. Edit code → replace everything with `worker/worker.js` → Deploy.
3. Worker → Settings → Variables and Secrets → add **Secret** `TT_API_KEY` (same key as the GitHub secret).
4. Copy the Worker URL (e.g. `https://hvk-tf-live.<you>.workers.dev`) into `LIVE_URL` in `index.html`.

The GitHub Action stays on: its saved snapshots build the history (equity curve, calendar).
