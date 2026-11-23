# token-radar
[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/2099818422a-gif/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/2099818422a-gif/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: ranks pre-token DeFi protocols by what their token would be worth, and shows how to farm each one.

## What it does

`main.ts` (Node 22, standard library only) reads the sealed DefiLlama snapshot at `/input/snapshot.json` and writes:

- `board.json` — 226 ranked rows: all 40 watchlist protocols plus 186 pre-token protocols below the watchlist floor, each with an implied value and an 8-step farm plan.
- `dashboard/` — a static, offline page: sortable board, search + category + chain filters, watchlist-only and live-token views, and a detail drawer per protocol showing the model's arithmetic and the farm plan.
- `screenshots/` — three views of the dashboard, rendered in a headless browser.
- `dossier.json` — built with the vendored `vendor/makefun-board.ts`.

## The value model

```
implied = round( tvl_usd × multiple × growth × maturity )
```

- **multiple** — the median market-cap-per-TVL of the live-token protocols in the same category (at least 3 of them, else the global median), clamped to 0.05–1.00x.
- **growth** — `1 + 0.5 × clamp(change_7d, −50, +100) / 100`.
- **maturity** — `0.7 + 0.6 × min(age_days, 1460) / 1460`: the longer a protocol has run with no token, the higher.

No protocol name is special-cased. Live-token protocols are kept apart and shown with their market caps. Implied value is the radar's own estimate, not a price and not a prediction that a token launches.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
node gate.mjs out path/to/snapshot.json
```

The run is deterministic: the same snapshot bytes in give the same output bytes out.

## Referral

Built with [superbot.gg](https://superbot.gg) — use referral code `stsp86ma` when you sign up.

## License

MIT — see [LICENSE](LICENSE).
