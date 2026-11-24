# Token Radar v3 — pre-token protocols, priced from the market itself

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Steveales-1122/token-radar-01-v3/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Steveales-1122/token-radar-01-v3/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Entry for the [token-radar-01](https://make.fun/bounty/token-radar-01) bounty on make.fun: a dashboard that finds protocols without a token, ranks them by an implied token value, and shows how to farm each one.

## What changed from v2

v2 priced every protocol with hand-written multiples per category — a judgement table. v3 calibrates **empirically from the snapshot itself**: for each category it takes the protocols in the snapshot that already have a token, computes the market-cap / TVL ratio of each, and uses the **median ratio as that category's multiple**. A category with fewer than 3 priced peers falls back to the global median, and the dashboard says so. The 25th/75th percentiles of the same peer set give every row a low/high value range.

The dashboard also shows the full calibration table (peers, median, p25/p75, fallback flag) and a step-by-step calculation for every protocol: TVL × category multiple × momentum × maturity × risk = implied value.

The dashboard gate fix: `dashboard/` carries no network address of any kind — no favicon, no links, no imports — so the `dashboard_files` check passes.

## Model

```
implied value = TVL × category multiple × momentum × maturity × risk
```

- **category multiple** — median mcap/TVL of priced protocols in the same category (global median fallback when peers < 3)
- **momentum** — 7-day TVL change, clamped to [-50%, +100%], mapped to [0.75, 1.50]
- **maturity** — days since listing: <90d ×0.85, 90–364d ×0.95, 1–3y ×1.05, >3y ×1.10, unknown ×0.95
- **risk** — chain spread: 1 chain ×0.95, 2 chains ×1.00, 3+ chains ×1.05
- **range** — the same factors applied to the peers' 25th and 75th percentile multiples

Board: **198 rows** — the full 40-protocol watchlist plus the 158 pre-token protocols below the $50M floor that could plausibly launch a token of their own — ranked by implied value, each with 7 concrete farm steps. The below-floor picks use the snapshot's own watchlist logic: wrapped, staked and bridged products of a token that already trades, versioned copies and centralised exchanges are left out, because ranking them would put WBTC and the chain bridges at the top of the board and the radar would be a TVL sort, not a radar.

## Dashboard

- Sortable, filterable board (search, category, watchlist-only) with a sandbox slider that rescales every implied value by a TVL-growth assumption
- Calibration table with peer counts and fallback flags
- Detail view per protocol: the calculation line by line, the value range, and the farm plan
- Static page, no network, no framework: `dashboard/index.html` + `app.css` + `app.js` reading `data.js`

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Requires Node.js 22.18 or later. The program reads the snapshot, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory, and checks the board against the gate's shape before writing anything.

## Layout

- `main.ts` — entry program: read snapshot, build board, write outputs, build dossier
- `lib/model.ts` — empirical calibration, implied-value model, farm plans, gate checks
- `dashboard/` — the static page (index.html, app.css, app.js)
- `screenshots/` — board, detail and filtered views of the dashboard
- `vendor/makefun-board.ts` — make.fun dossier library (vendored)
