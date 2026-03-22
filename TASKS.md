# TASKS.md - BigLot.ai Active Tasks
> Goal: Claude for Traders — the world's best AI trading assistant
> Completed: 57 tasks across 11 phases (see .claude/archive/COMPLETED.md)
> Tests: 2535 passing
> Changelog: CHANGELOG.md

---

## Phase 12: Real-Time Intelligence & Automation

- [x] **T-1201**: Smart Alert Engine + Telegram Push
  - Status: DONE
  - Spec: Tool `manage_smart_alerts` — compound alert conditions (price AND RSI threshold, price AND volume spike >3x, multi-asset correlation break). Polling loop checks every 60s. Push triggered alerts via existing Telegram integration. Store alert config + history in Supabase. Returns MetricCard (active alerts, triggered today) + TableBlock (alert list with status/condition/last triggered).
  - Create: `data/smartAlerts.data.ts`, `tools/smartAlerts.tool.ts`
  - Modify: none
  - Reuse: `alertEngine`, `telegram.server.ts`, indicator engine

- [x] **T-1202**: Market Anomaly Detector
  - Status: DONE
  - Spec: Tool `detect_anomalies` — scan watchlist for statistical anomalies: volume spikes >3x 20-day avg, price gaps >2 ATR, unusual volatility expansion, correlation breaks vs BTC/SPX, liquidation cascades. Rank by severity score. LLM generates explanation for each anomaly. Returns MetricCard (anomaly count, highest severity) + TableBlock (ranked anomalies) + TextBlock (AI explanation).
  - Create: `data/anomalyDetector.data.ts`, `tools/anomalyDetector.tool.ts`
  - Reuse: `derivatives.data.ts`, `crossAsset.tool.ts`, indicator engine (ATR, volume)

- [x] **T-1205**: Multi-Exchange Price Aggregator
  - Status: DONE
  - Spec: Tool `compare_exchanges` — fetch price/volume from Binance, Bybit (v5 public), OKX (v5 public), Coinbase (public) for a symbol. Compute: price spread between exchanges, volume distribution %, best bid/ask across venues, arbitrage opportunity if spread > fee threshold. Returns MetricCard (best buy/sell venue, max spread%) + TableBlock (per-exchange price/volume/spread) + TextBlock (arb analysis if spread > 0.1%).
  - Create: `data/multiExchange.data.ts`, `tools/multiExchange.tool.ts`

- [x] **T-1206**: Liquidation Heatmap
  - Status: DONE
  - Spec: Tool `get_liquidation_heatmap` — estimate liquidation clusters by leverage tier (5x, 10x, 25x, 50x, 100x) from open interest distribution + funding rate direction. Project liquidation levels above/below current price. Identify "magnetic" price levels. Returns MetricCard (nearest cluster, estimated volume) + HeatmapBlock (price levels × leverage tiers) + TextBlock (interpretation).
  - Create: `data/liquidationHeatmap.data.ts`, `tools/liquidationHeatmap.tool.ts`
  - Reuse: `derivatives.data.ts`

- [x] **T-1207**: Footprint Chart / Tape Reader
  - Status: DONE
  - Spec: Tool `get_footprint_data` — aggregate Binance aggTrades into footprint data: bid/ask volume per price level per candle, delta (buy - sell) per level, cumulative volume delta (CVD), absorption detection (large opposing orders that don't move price), iceberg order detection, aggressive buyer/seller imbalance zones. Returns MetricCard (net delta, absorption events, dominant side) + TableBlock (footprint: price level, bid vol, ask vol, delta) + GaugeBlock (buy/sell pressure).
  - Create: `data/footprint.data.ts`, `tools/footprint.tool.ts`
  - Reuse: `orderFlow.data.ts` patterns

- [x] **T-1203**: DCA Bot Engine (Paper)
  - Status: DONE
  - Spec: Tool `manage_dca_bot` — automated Dollar-Cost Averaging on paper trading. Config: asset, amount per interval, interval (daily/weekly/biweekly/monthly), optional buy-the-dip multiplier (2x when price < MA by X%). Track cost basis, avg price, total invested, unrealised PnL. Uses existing paperTrader for execution. Returns MetricCard (avg cost, total invested, current value, PnL%) + TableBlock (execution history) + ChartBlock (DCA equity vs lump sum).
  - Create: `data/dcaBot.data.ts`, `tools/dcaBot.tool.ts`
  - Reuse: `paperTrader.ts`, Binance OHLCV

- [x] **T-1204**: Grid Bot Engine (Paper)
  - Status: DONE
  - Spec: Tool `manage_grid_bot` — paper grid bot for ranging markets. Config: asset, upper/lower price bounds, grid levels, investment amount. Place virtual buy orders below current price, sell orders above. Track filled grids, profit from completions, estimated APY from recent volatility. Warn if regime detector says market is trending. Returns MetricCard (grid profit, fill rate, est APY) + TableBlock (grid levels with status) + TextBlock (regime warning if trending).
  - Create: `data/gridBot.data.ts`, `tools/gridBot.tool.ts`
  - Reuse: `paperTrader.ts`, regime detector

- [x] **T-1208**: Automated Morning Briefing + Telegram
  - Status: DONE
  - Spec: Tool `configure_briefing` — scheduled delivery of daily briefing. Config: delivery time (e.g. 07:00 ICT), watchlist, sections (macro/crypto/gold/portfolio), channel (in-app + Telegram). At scheduled time, runs get_daily_briefing internally, formats as compact Telegram HTML, pushes. Returns MetricCard (next delivery, active/paused) + TableBlock (configured sections) + TextBlock (preview).
  - Create: `data/scheduledBriefing.data.ts`, `tools/scheduledBriefing.tool.ts`
  - Reuse: `dailyBriefing.tool.ts`, `telegram.server.ts`

---

## Phase 13: AI Trading Brain

- [x] **T-1301**: Trade Reasoning Engine ("Trading-R1")
  - Status: DONE
  - Spec: Tool `reason_trade` — flagship AI feature. Given symbol + direction, orchestrate existing tools internally (regime, confluence, patterns, sentiment, macro, on-chain, intermarket) and produce structured reasoning trace. Shows: evidence FOR, evidence AGAINST, key unknowns, confidence 1-10, final verdict. New content block `ReasoningBlock` (expandable chain-of-thought with bullish/bearish/neutral evidence tags). Returns ReasoningBlock + MetricCard (conviction, evidence balance) + TradeSetupBlock (if conviction > 6).
  - Create: `data/tradeReasoning.data.ts`, `tools/tradeReasoning.tool.ts`, `types/contentBlock.ts` (add ReasoningBlock), `components/blocks/ReasoningBlock.svelte`
  - Reuse: analyzeRegime, detectConfluence, scanDivergences, get_news_sentiment, get_macro_indicators, get_onchain_data

- [x] **T-1302**: Pre-Trade Checklist Enforcer
  - Status: DONE
  - Spec: Tool `check_trade` — 8-point checklist before any trade: (1) Clear edge? (2) Regime aligned? (3) R:R > 2:1? (4) Position size within limits? (5) Conflicting signals? (6) Event risk nearby? (7) In trading plan? (8) Revenge trading / tilted? Each returns pass/fail/warning + explanation. Custom checklist from user memory. New content block `ChecklistBlock`. Returns ChecklistBlock + MetricCard (pass rate) + GaugeBlock (trade readiness score).
  - Create: `data/tradeChecklist.data.ts`, `tools/tradeChecklist.tool.ts`, `types/contentBlock.ts` (add ChecklistBlock), `components/blocks/ChecklistBlock.svelte`
  - Reuse: regime, confluence, position sizing, economic calendar, trade journal

- [x] **T-1305**: Narrative Market Explainer
  - Status: DONE
  - Spec: Tool `explain_market` — "Why is BTC dropping?" Collect recent price action, news, macro events, on-chain flows, sentiment shifts, correlations. LLM synthesizes coherent narrative explaining current market behavior. Bilingual Thai/English. Returns ResearchReportBlock (sections: Price Action Summary, Key Drivers, Supporting Data, What to Watch Next) + SourcesBlock.
  - Create: `data/narrativeExplainer.data.ts`, `tools/narrativeExplainer.tool.ts`
  - Reuse: all existing data tools (news, macro, on-chain, derivatives, indicators)

- [x] **T-1304**: Adaptive Strategy Recommender
  - Status: DONE
  - Spec: Tool `recommend_strategy` — match current market conditions to strategy library: trend following, mean reversion, breakout, range trading, momentum, carry trade, pairs/spread, volatility. Each strategy has ideal conditions profile. Rank by expected edge in current regime. Include historical win-rate per regime. Returns MetricCard (top strategy, current regime) + TableBlock (ranked strategies with match score) + TextBlock (AI explanation).
  - Create: `data/strategyRecommender.data.ts`, `tools/strategyRecommender.tool.ts`
  - Reuse: regime detector, macro indicators, correlation data

- [x] **T-1303**: AI Post-Trade Analyst
  - Status: DONE
  - Spec: Tool `analyze_trade` — deep post-mortem on completed trade. Fetch chart for trade period, replay signals at entry/exit timestamps, check if thesis held, compare actual vs optimal execution (hindsight), calculate slippage + timing cost. LLM generates coaching feedback. Returns ChartBlock (trade period with entry/exit markers) + MetricCard (R-multiple, timing efficiency, thesis accuracy) + TextBlock (AI coaching) + TableBlock (signal replay).
  - Create: `data/postTradeAnalyst.data.ts`, `tools/postTradeAnalyst.tool.ts`
  - Reuse: `journal.ts`, indicator engine, OHLCV provider

- [x] **T-1306**: Risk Scenario Simulator (What-If)
  - Status: DONE
  - Spec: Tool `simulate_scenario` — NL input ("What if Fed cuts 50bps and BTC breaks $100k?"). LLM parses to quantitative assumptions (asset shocks, correlation changes, vol shifts). Apply to portfolio via existing stress test infrastructure. Returns MetricCard (projected PnL, most exposed position) + TableBlock (per-asset impact) + TextBlock (implications + hedging suggestions).
  - Create: `data/scenarioSimulator.data.ts`, `tools/scenarioSimulator.tool.ts`
  - Reuse: `stressTest.ts`, portfolio tracker

- [x] **T-1307**: Trading Journal Pattern Analyzer
  - Status: DONE
  - Spec: Tool `analyze_journal_patterns` — find behavioral/performance patterns in trade journal: best/worst setup types, time-of-day/day-of-week patterns, win rate by emotion, streak analysis, position sizing patterns, common mistakes. LLM coaching: "You win 73% on pullbacks but 31% on breakouts — consider dropping breakouts." Returns MetricCard (total trades, key insight) + TableBlock (patterns by setup/emotion/day) + TextBlock (AI coaching) + GaugeBlock (discipline score).
  - Create: `data/journalPatterns.data.ts`, `tools/journalPatterns.tool.ts`
  - Reuse: `journal.ts`

- [x] **T-1308**: Multi-AI War Room
  - Status: DONE
  - Spec: Tool `start_war_room` — 4 specialist AI panelists: Technical Analyst (charts/patterns), Macro Strategist (yields/COT/DXY), Quant (correlations/regime/statistics), Risk Manager (position sizing/drawdown/portfolio risk). Each gets tool data for their specialty. Risk Manager speaks last. Consensus recommendation with dissent noted. Returns enhanced DiscussionBlock (panelist specialties + data citations) + MetricCard (consensus direction, confidence, dissent count) + TradeSetupBlock (if consensus actionable).
  - Create: `data/warRoom.data.ts`, `tools/warRoom.tool.ts`
  - Reuse: `discussionLoop.server.ts`

---

## Phase 14: Trader Experience & Polish

- [x] **T-1401**: Unified Risk Dashboard
  - Status: DONE
  - Spec: Tool `get_risk_dashboard` — consolidate all risk tools into one view: portfolio drawdown, position-level risk, correlation risk, liquidation risk, concentration risk (largest position %), beta-adjusted exposure, VaR (Monte Carlo), stress test summary. Unified risk score 0-100. Returns GaugeBlock (risk score) + MetricCard (VaR, max drawdown, concentration, beta) + HeatmapBlock (risk contribution per asset) + TableBlock (per-position breakdown) + TextBlock (AI commentary).
  - Create: `data/riskDashboard.data.ts`, `tools/riskDashboard.tool.ts`
  - Reuse: all existing risk tools, portfolio tracker, Monte Carlo, stress test

- [ ] **T-1402**: P&L Statement & Tax Report
  - Status: PENDING
  - Spec: Tool `generate_pnl_report` — P&L from trade journal + paper trading. Accounting methods: FIFO, LIFO, average cost. Realised/unrealised PnL, fees, net PnL, holding period (short/long-term). Thai tax 15% capital gains estimate. Group by asset, month, quarter. Returns MetricCard (total realised PnL, fees, net, tax estimate) + TableBlock (monthly summary) + TableBlock (per-asset breakdown) + TextBlock (tax notes + disclaimers).
  - Create: `data/pnlReport.data.ts`, `tools/pnlReport.tool.ts`
  - Reuse: `journal.ts`, `paperTrader.ts`

- [ ] **T-1403**: Interactive Trading Quiz
  - Status: PENDING
  - Spec: Tool `start_quiz` — categories: Technical Analysis (identify patterns on real charts), Risk Management (position sizing scenarios), Market Microstructure (order flow), Trading Psychology (scenario decisions), Macro (interpret economic data). Real historical data for questions. LLM generates + evaluates dynamically. Adaptive difficulty. Score tracking via memory. Returns TextBlock (question) + ChartBlock (chart questions) + MetricCard (score, streak, strengths) + TextBlock (explanation after answer).
  - Create: `data/tradingQuiz.data.ts`, `tools/tradingQuiz.tool.ts`
  - Reuse: OHLCV provider, indicator engine, memory tool

- [ ] **T-1405**: Custom Indicator Builder
  - Status: PENDING
  - Spec: Tool `build_indicator` — NL input ("EMA 20 crossover EMA 50 + RSI below 30") → composable indicator definition using existing engine functions. Generate equivalent PineScript v6 code. Test on recent data. Store custom indicators in Supabase. Returns ChartBlock (custom indicator on recent data) + TextBlock (PineScript v6 code) + MetricCard (signal count, current state).
  - Create: `data/indicatorBuilder.data.ts`, `tools/indicatorBuilder.tool.ts`
  - Reuse: indicator engine (`engine.ts`, `confluence.ts`)

- [ ] **T-1404**: Strategy Sharing & Community Library
  - Status: PENDING
  - Spec: Tool `share_strategy` / `browse_strategies` — publish backtested strategies to community library. Validate backtest exists, capture metrics (Sharpe, win rate, max DD), tag by asset class + regime. Browse: sort by Sharpe/win rate/newest, filter by asset/type. Clone to own backtest. Returns MetricCard (total shared, top-rated) + TableBlock (strategy list with metrics) + BacktestBlock (viewing specific strategy).
  - Create: `data/strategySharing.data.ts`, `tools/strategySharing.tool.ts`
  - Reuse: backtest tool

- [ ] **T-1406**: Correlation Regime Change Detector
  - Status: PENDING
  - Spec: Tool `detect_correlation_shifts` — monitor rolling correlations: BTC/SPX, BTC/Gold, BTC/DXY, Gold/DXY, SPX/Bonds + user-defined pairs. Compare 30d vs 90d rolling correlation. Z-score of change + breakpoint detection. Correlation regime shifts often precede major moves. Returns MetricCard (active shifts, most significant) + HeatmapBlock (current vs 90d avg correlation matrix) + TableBlock (detected shifts with z-score) + TextBlock (AI interpretation).
  - Create: `data/correlationRegime.data.ts`, `tools/correlationRegime.tool.ts`
  - Reuse: `crossAsset.tool.ts`, `correlation.ts`

- [ ] **T-1407**: Trading Performance Gamification
  - Status: PENDING | Depends: T-1403
  - Spec: Tool `get_achievements` — badges/XP/levels: "First Trade", "10-Trade Streak Following Plan", "100% Week", "Risk Manager (30d no daily loss breach)", "Pattern Master (>80% quiz)", "Journal Streak (7d)", "Profitable Month", "R-Multiple Master (avg R>1.5 over 20 trades)". Trader XP level from activity + performance. Weekly progress. Returns MetricCard (level, XP, next milestone) + TableBlock (recent achievements) + GaugeBlock (weekly activity) + TextBlock (encouragement/challenge).
  - Create: `data/gamification.data.ts`, `tools/gamification.tool.ts`
  - Reuse: trade journal, quiz results, risk monitor, memory

- [ ] **T-1408**: Portfolio Export & Snapshot Sharing
  - Status: PENDING
  - Spec: Tool `export_portfolio` — export formats: JSON (full portfolio + metrics), Markdown (Discord/Telegram shareable), CSV (trades + positions). Optional shareable public link with expiry (Supabase). Privacy controls: redact sizes, show allocations as %. Returns MetricCard (portfolio value, return, Sharpe) + TableBlock (positions summary) + TextBlock (formatted report) + TextBlock (shareable link if public).
  - Create: `data/portfolioExport.data.ts`, `tools/portfolioExport.tool.ts`
  - Reuse: portfolio tracker, attribution tool
