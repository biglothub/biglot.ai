# CHANGELOG - BigLot.ai

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
