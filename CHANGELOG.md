# CHANGELOG - BigLot.ai

## 2026-03-22
- **T-1307**: Trading Journal Pattern Analyzer — `analyze_journal_patterns` tool mines trade journal for behavioral/performance patterns; setup-type win rates + avg R, day-of-week breakdown, emotion win rates, streak analysis (current/max win/loss streaks), position sizing consistency + oversized-on-loss detection, discipline score (0–100 composite of plan adherence, emotional discipline, journal completeness); LLM generates personalized coaching with rule-based fallback; returns `MetricCard` + `TableBlock` (setup patterns) + `TableBlock` (emotion + day breakdown) + `GaugeBlock` (discipline score) + `TextBlock` (AI coaching). 41 tests (2451 total)
- **T-1306**: Risk Scenario Simulator (What-If) — `simulate_scenario` tool accepts NL scenario ("What if Fed cuts 50bps and BTC breaks $100k?"); LLM parses to quantitative asset shocks with keyword-based fallback (Fed cut/hike, BTC bull/crash, recession); reuses `applyScenario` from `risk/stressTest.ts` via custom `Scenario` object; second LLM call generates implications + hedging suggestions; portfolio from `listPositions` or custom symbols/weights; returns `MetricCard` (projected PnL, most exposed position, confidence) + `TableBlock` (per-asset shock/impact) + `TextBlock` (implications + hedging); 15-min cache. 28 tests (2410 total)
- **T-1303**: AI Post-Trade Analyst — `analyze_trade` tool for deep post-mortem on completed trades; fetches OHLCV and replays RSI(14), EMA(20/50), MACD, ATR(14) at entry/exit timestamps; calculates timing efficiency (actual PnL vs max possible) and entry/exit slippage %; LLM generates structured coaching feedback (thesis accuracy, went well, to improve, key lesson) with rule-based fallback; adds `ChartMarker` type + optional `markers` field to `ChartBlock`; returns `MetricCard` + `ChartBlock` (with entry/exit markers) + `TableBlock` (signal replay) + `TextBlock` (AI coaching). 30 tests (2382 total)
- **T-1304**: Adaptive Strategy Recommender — `recommend_strategy` tool scores 8 strategies (trend following, mean reversion, breakout, range trading, momentum, carry trade, pairs/spread, volatility) against current market conditions; scoring across regime match (50pts), ADX fit (20pts), macro alignment (20pts), volatility level (10pts); fetches OHLCV + macro in parallel for real-time regime + risk signal; LLM synthesizes bilingual explanation with concrete tactical suggestion; rule-based fallback when LLM unavailable; returns `MetricCard` + `TableBlock` (ranked strategies with win rates) + `TextBlock`. 34 tests (2352 total)
- **T-1305**: Narrative Market Explainer — `explain_market` tool answers "Why is BTC dropping?" style questions; gathers regime + confluence + divergence + news sentiment + macro (DXY/yields/SPX) + on-chain + derivatives in parallel; LLM synthesizes bilingual Thai/English narrative as `ResearchReportBlock` with 4 sections (Price Action Summary, Key Drivers, Supporting Data, What to Watch Next) + Thai summary; rule-based fallback when LLM unavailable. 35 tests (2318 total)
- **T-1302**: Pre-Trade Checklist Enforcer — `check_trade` tool runs 8-point pre-trade checklist (clear edge, regime aligned, R:R ≥ 2:1, position size, conflicting signals, event risk, in trading plan, not revenge trading); each item returns pass/fail/warning/skip with explanation; regime + confluence + divergence from OHLCV; high-impact event scan via Forex Factory; plan adherence + emotional state from trade journal; new `ChecklistBlock` content type with score arc + recommendation badge; `GaugeBlock` for readiness score 0–100. 24 tests (2283 total)

## 2026-03-22
- **T-1301**: Trade Reasoning Engine ("Trading-R1") — `reason_trade` tool orchestrates regime, confluence, divergence, sentiment, macro, and on-chain data; LLM (GPT-4o with Claude/DeepSeek fallback) synthesizes structured chain-of-thought with evidence FOR/AGAINST, key unknowns, confidence 1-10, verdict; new `ReasoningBlock` content type with expandable UI; `TradeSetupBlock` appended when conviction > 6. 24 tests (2259 total)

## 2026-03-22
- **T-1208**: Automated Morning Briefing + Telegram — `configure_briefing` tool with configure/status/pause/resume/deliver_now actions; per-user schedule stored in Supabase `scheduled_briefings`; 5-minute delivery window with 23h double-send guard; multi-section support (crypto, macro, gold, portfolio); in-app + Telegram channels; `/api/briefing/cron` POST endpoint for external cron triggers. 31 tests (2235 total)
- **T-1204**: Grid Bot Engine (Paper) — paper grid bot for ranging markets; create/list/delete/status/run_now; evenly-spaced price grids with crossing detection; profit tracking per completed cycle; estimated APY; regime warning when market is trending (ADX-based); backed by Supabase grid_bots + grid_executions tables. 44 tests (2204 total)
- **T-1203**: DCA Bot Engine (Paper) — automated Dollar-Cost Averaging with paper trades; create/list/delete/status/run_now actions; optional dip multiplier (Nx when price X% below MAn); avg cost basis, unrealised PnL, lump-sum comparison chart; all backed by Supabase dca_bots + dca_executions tables. 44 tests (2160 total)
- **T-1207**: Footprint Chart / Tape Reader — aggregates Binance aggTrades into footprint: bid/ask volume per price level per 1-min candle, CVD, absorption detection (bid/ask absorbed near candle extremes), imbalance zones; MetricCard + TableBlock + GaugeBlock. 41 tests (2116 total)
- **T-1206**: Liquidation Heatmap — estimates long/short liquidation clusters by leverage tier (5x–100x) from Binance OI + long/short ratio; signed HeatmapBlock (red=long liq↓, green=short liq↑), MetricCard, magnetic price levels. 41 tests (2075 total)
- **T-1205**: Multi-Exchange Price Aggregator — fetches BTC/ETH/any spot price from Binance, Bybit, OKX, Coinbase in parallel; computes max spread, best buy/sell venue, cross-exchange arb detection (>0.1% threshold), volume distribution. 23 tests (2034 total)
- **T-1202**: Market Anomaly Detector — scans watchlist for volume spikes >3x avg, price gaps >2 ATR, volatility expansion, liquidation cascades, correlation breaks vs BTC; ranked by severity score. 26 tests (2011 total)
- **Pipeline v2**: Auto-dev pipeline with research phase, quality gates, git rollback
- **T-1103**: Funding Rate Arbitrage Scanner. 29 tests (1942 total)
- **T-1201**: Smart Alert Engine + Telegram Push — compound alert conditions (price+RSI, price+volume spike, correlation break), check_now evaluates via live OHLCV+RSI+Pearson correlation, pushes Telegram. 43 tests (1985 total)
- **T-1102**: Historical Scenario / Stress Test Tool. 34 tests (1913 total)
- **T-1101**: Efficient Frontier & Portfolio Optimization

## 2026-03-21
- **T-1003**: Pairs Trading & Spread Analysis Tool
- **T-1002**: Divergence Scanner Tool
- **T-1001**: Harmonic Pattern Scanner
- **T-915**: Strategy Performance Attribution Tool
- **T-914**: LLM-Powered Market Summary Tool
- **T-913**: Heatmap Block Renderer
- **T-911**: Watchlist Scanner Dashboard
- **T-905**: AI Trade Idea Generator
- **T-904**: Monte Carlo Portfolio Simulation
- **T-903**: Fibonacci Confluence Zone Scanner
- **T-902**: Crypto Market Dominance Tool
- **T-901**: Technical Asset Screener
