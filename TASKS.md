# TASKS.md - BigLot.ai Active Tasks
> Goal: World's best trading LLM
> Completed: 57 tasks across 11 phases (see .claude/archive/COMPLETED.md)
> Tests: 1913 passing
> Changelog: CHANGELOG.md

---

## Phase 11: Portfolio Intelligence & Optimization (continued)

- [x] **T-1101**: Efficient Frontier & Portfolio Optimization
  - Status: DONE
  - Spec: Tool `optimize_portfolio` — 180d OHLCV, log returns, covariance matrix, Monte Carlo 2000 portfolios. Min-variance, max-Sharpe, equal-weight. MetricCard + comparison TableBlock + frontier scatter.

- [x] **T-1102**: Historical Scenario / Stress Test Tool
  - Status: DONE | Depends: T-1101
  - Spec: Tool `stress_test_portfolio` — apply 8 predefined historical shock scenarios (COVID -34%, GFC -57%, Crypto Winter -75%, BTC Halving +300%, DotCom -78%, 2013 BTC +5000%, Taper Tantrum, 2018 Bear -84%). Per scenario: portfolio PnL from weights + asset betas. Returns MetricCard (worst/best scenario) + scenarios TableBlock.
  - Session notes (2026-03-22): stressTest.ts: 8 SCENARIOS (COVID Crash, GFC 2008, 2022 Crypto Winter, 2018 BTC Bear, DotCom Crash, 2020 BTC Halving Bull, Taper Tantrum, 2013 BTC Rally). normaliseSymbol (strips USDT/USD/-USD/-USDT suffixes). findShock (exact base match → '*' wildcard). applyScenario (per-asset PnL using USD value × shock, portfolioPnlPct = totalPnlUsd/totalValue). runStressTest (runs all 8, sorts worst→best). stress_test_portfolio tool: loads from portfolio tracker or custom symbols/weights, 1h cache. 34 tests, 1913 total passing.

- [ ] **T-1103**: Funding Rate Arbitrage Scanner
  - Status: PENDING
  - Spec: Tool `scan_funding_arb` — top 20 USDT perps on Binance. Per symbol: funding rate (annualised %), spot vs perp basis (%), carry = funding - basis decay. Positive carry (buy spot + short perp) / negative carry. Min 10% annualised. Returns MetricCard (best opportunity, +/- carry count) + opportunities TableBlock.
  - Create: `frontend/src/lib/server/data/fundingArb.data.ts`, `fundingArb.data.test.ts`
  - Create: `frontend/src/lib/server/tools/fundingArb.tool.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`, `agentLoop.server.test.ts`
  - Tests: Carry calculation, basis computation, opportunity classification, threshold filtering.
