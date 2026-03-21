# TASKS.md - BigLot.ai Development Roadmap
> Goal: World's best trading LLM

---

## Phase 1: Core Trading Intelligence

- [x] **T-101**: Technical Indicator Engine
  - Status: DONE
  - Spec: Standalone TA module with 20+ indicators (SMA, EMA, RSI, MACD, Bollinger, ATR, Stochastic, ADX, OBV, VWAP, Ichimoku, Fibonacci, Pivot Points, Williams %R, CCI, MFI, Parabolic SAR, Donchian, Keltner, SuperTrend). Pure functions taking OHLCV[] returning IndicatorDataPoint[].
  - Create: `frontend/src/lib/server/indicators/engine.ts`, `engine.test.ts`
  - Modify: `frontend/src/lib/server/tools/charts.tool.ts` (replace inline RSI/MACD)
  - Tests: Each indicator against known reference values. Edge cases: empty arrays, insufficient data, NaN.

- [x] **T-102**: Signal Generator Tool
  - Status: DONE | Depends: T-101
  - Spec: Tool `generate_signals` — multi-indicator confluence detection. Scans: MA crossovers, RSI divergences, MACD signal crosses, Bollinger squeeze/breakout, S/R touches. Returns TradeSetupBlock when strong confluence found.
  - Create: `frontend/src/lib/server/tools/signals.tool.ts`, `frontend/src/lib/server/indicators/confluence.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts` (import)
  - Tests: Feed known historical setups, verify signal detection.

- [x] **T-103**: Strategy Definition Schema
  - Status: DONE
  - Spec: JSON schema for trading strategies — entry conditions (indicator + threshold + comparison), exit conditions, position sizing, risk params, timeframe, asset filters. Store in Supabase `strategies` table.
  - Create: `frontend/src/lib/types/strategy.ts`, `frontend/src/lib/server/strategy.server.ts`, `strategy.server.test.ts`
  - Create: `frontend/sql/strategies.sql`
  - Tests: Schema validation, reject invalid strategies, CRUD ops.

- [x] **T-104**: Backtesting Engine
  - Status: DONE | Depends: T-101, T-103
  - Spec: Takes Strategy + OHLCV[] and simulates trades. Metrics: total return, max drawdown, Sharpe, Sortino, win rate, avg R-multiple, profit factor, max consecutive losses. Walk-forward validation (70/30).
  - Create: `frontend/src/lib/server/backtest/engine.ts`, `metrics.ts`, `engine.test.ts`
  - Create: `frontend/src/lib/server/tools/backtest.tool.ts`, `frontend/src/lib/types/backtest.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts` (import)
  - Tests: Backtest simple MA crossover on known data, verify PnL matches hand-calc.

- [x] **T-105**: Backtest Results Visualization
  - Status: DONE | Depends: T-104
  - Spec: BacktestBlock — equity curve (line chart), drawdown chart, trade markers on price, metrics table. Use lightweight-charts.
  - Modify: `frontend/src/lib/types/contentBlock.ts` (add BacktestBlock)
  - Create: `frontend/src/lib/components/blocks/BacktestBlock.svelte`
  - Modify: `frontend/src/lib/components/blocks/ContentBlockRenderer.svelte`
  - Tests: Snapshot test with mock backtest data.

---

## Phase 2: Data & Analysis

- [x] **T-201**: Economic Calendar Tool
  - Status: DONE
  - Spec: Tool `get_economic_calendar` — upcoming high-impact events (FOMC, NFP, CPI, ECB, BOJ). Return TableBlock with date, event, forecast, previous, impact level.
  - Create: `frontend/src/lib/server/tools/economicCalendar.tool.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock API response, verify table format, timezone handling.

- [x] **T-202**: Sentiment Analysis Tool
  - Status: DONE
  - Spec: Tool `get_sentiment` — aggregates Fear & Greed (existing), social sentiment via web search, funding rates (Binance/Bybit), long/short ratios. Returns GaugeBlock + MetricCardBlock.
  - Create: `frontend/src/lib/server/tools/sentiment.tool.ts`, `frontend/src/lib/server/data/sentiment.data.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock each data source, verify aggregation.

- [x] **T-203**: Multi-Source OHLCV Provider
  - Status: DONE
  - Spec: Provider pattern for OHLCV — Binance, Yahoo Finance, CoinGecko with auto-fallback. Normalize to OHLCV[] type. Support 1m to 1M timeframes.
  - Create: `frontend/src/lib/server/data/ohlcvProvider.ts`, `ohlcvProvider.test.ts`
  - Modify: `frontend/src/lib/server/tools/charts.tool.ts`, `gold.tool.ts` (use provider)
  - Tests: Fallback chain, normalization, error handling.

- [x] **T-204**: On-Chain Data Tool
  - Status: DONE
  - Spec: Tool `get_onchain_data` — BTC/ETH on-chain: active addresses, exchange flows, MVRV, NUPL, hash rate. Free APIs (Blockchain.com, Glassnode public). Returns MetricCardBlock.
  - Create: `frontend/src/lib/server/tools/onchain.tool.ts`, `frontend/src/lib/server/data/onchain.data.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock API responses, verify metric calculations.
  - Session notes (2026-03-22): Implemented using CoinMetrics Community API (AdrActCnt, HashRate, NVTAdj, CapMrktCurUSD, CapRealUSD, TxCnt) + Blockchain.com fallback for BTC. MVRV computed as CapMrktCurUSD/CapRealUSD. Hash rate converted GH/s→EH/s (BTC) or TH/s (ETH). 28 tests, all passing. 583 total tests passing.

- [x] **T-205**: Derivatives Data Tool
  - Status: DONE
  - Spec: Tool `get_derivatives_data` — open interest, funding rates, liquidations, options max pain, put/call ratio. Binance/Deribit public APIs. Returns TableBlock + MetricCardBlock.
  - Create: `frontend/src/lib/server/tools/derivatives.tool.ts`, `frontend/src/lib/server/data/derivatives.data.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock Binance futures API, verify OI aggregation.
  - Session notes (2026-03-22): Implemented with Binance Futures API (funding rates, OI, L/S ratios, liquidations) and Deribit (BTC options: put/call ratio, max pain via pain minimisation algorithm). `annualiseFundingRate` converts 8h rate → yearly %. 39 tests, 622 total passing.

- [x] **T-206**: Market Breadth Dashboard
  - Status: DONE
  - Spec: Dashboard section — advance/decline ratio, % above 200 SMA, sector rotation heatmap, relative strength by sector (XLF, XLK, XLE ETFs via Yahoo Finance).
  - Create: `frontend/src/lib/server/data/breadth.data.ts`, `frontend/src/lib/components/dashboard/MarketBreadth.svelte`
  - Modify: `frontend/src/routes/dashboard/+page.svelte`, `frontend/src/routes/api/dashboard/+server.ts`
  - Tests: Breadth calculations, mock Yahoo Finance.
  - Session notes (2026-03-22): Sector rotation heatmap for 11 sector ETFs vs SPY using Yahoo Finance 2-month daily data. `BreadthData` added to DashboardResponse type. MarketBreadth.svelte has 1D/1W/1M/vsSPY toggle. Added `SectorPerformance` and `BreadthData` types to dashboardMeta.ts. 25 tests, 647 total passing.

---

## Phase 3: Risk & Portfolio

- [x] **T-301**: Position Size Calculator Tool
  - Status: DONE
  - Spec: Tool `calculate_position_size` — fixed fractional, Kelly criterion, volatility-adjusted (ATR), equal risk contribution. Input: account size, risk %, entry, stop, instrument type. Returns MetricCardBlock.
  - Create: `frontend/src/lib/server/tools/positionSize.tool.ts`, `frontend/src/lib/server/risk/positionSizing.ts`, `positionSizing.test.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Verify each method against known calculations.
  - Session notes (2026-03-22): 4 methods: Fixed Fractional (pure risk%), Half-Kelly (capped at user risk%), ATR-adjusted (uses max of ATR*multiple vs user stop), Equal Risk Contribution (risk%/numPositions). Recommends ATR > Kelly > FF. MetricCardBlock + comparison table. 31 tests, 678 total passing.

- [x] **T-302**: Portfolio Tracker
  - Status: DONE
  - Spec: Persistent portfolio in Supabase — positions (entry, size, current price, PnL), closed trades (R-multiple), equity curve. Tool `portfolio_snapshot`. Dashboard widget.
  - Create: `frontend/src/lib/server/portfolio/tracker.ts`, `tracker.test.ts`, `frontend/src/lib/server/tools/portfolio.tool.ts`
  - Create: `frontend/src/lib/types/portfolio.ts`, `frontend/sql/portfolio.sql`
  - Create: `frontend/src/lib/components/dashboard/PortfolioWidget.svelte`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: CRUD, PnL calculations, equity curve generation.
  - Session notes (2026-03-22): CRUD via Supabase (addPosition, listPositions, closePosition, listClosedTrades, deletePosition). Tools: portfolio_snapshot, add_position, close_position, delete_position. Pure helpers for unrealised PnL, R-multiple, win rate, avg R. PortfolioWidget.svelte shows open positions with live PnL, stats row. Fixed buildPortfolioSnapshot mock (order() must be thenable for listPositions). 703 tests passing.

- [x] **T-303**: Drawdown Monitor
  - Status: DONE
  - Spec: Real-time risk monitoring — current drawdown %, daily loss limit, max open risk, correlation-aware portfolio risk. Alert on threshold breach. GaugeBlock for risk level.
  - Create: `frontend/src/lib/server/risk/drawdownMonitor.ts`, `drawdownMonitor.test.ts`
  - Create: `frontend/src/lib/server/tools/riskMonitor.tool.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Simulate drawdown scenarios, verify alerts.
  - Session notes (2026-03-22): calcCurrentDrawdown (peak equity tracking), calcDailyPnL (today realised+unrealised), calcOpenRisk (stop-distance × size per position), buildRiskSnapshot (composite 0-100 score with weighted dimensions). Tool: monitor_portfolio_risk returns GaugeBlock + MetricCard + alerts table. 31 tests, 734 total passing.

- [x] **T-304**: Correlation Matrix Tool
  - Status: DONE
  - Spec: Enhanced correlation — user-defined asset lists, rolling window (30/60/90/180d), Pearson correlations. Returns HeatmapBlock.
  - Modify: `frontend/src/lib/server/tools/crossAsset.tool.ts` (extend)
  - Create: `frontend/src/lib/server/risk/correlation.ts`, `correlation.test.ts`
  - Tests: Known correlation values, edge cases.
  - Session notes (2026-03-22): risk/correlation.ts with pearsonCorrelation, toReturns, alignSeries, buildCorrelationMatrix (n×n symmetric, minPoints filter). get_correlation_matrix tool appended to crossAsset.tool.ts — symbol aliases, 30/60/90/180d windows, HeatmapBlock output. 28 tests, 762 total passing.

- [x] **T-305**: Trade Journal with AI Review
  - Status: DONE
  - Spec: Tools `log_trade` and `review_trades` — journaling with AI pattern analysis: best/worst days, common mistakes, emotional trading detection. Supabase `trade_journal` table.
  - Create: `frontend/src/lib/server/tools/tradeJournal.tool.ts`, `frontend/src/lib/server/portfolio/journal.ts`, `journal.test.ts`
  - Create: `frontend/sql/trade_journal.sql`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Journal CRUD, statistics calculation.
  - Session notes (2026-03-22): trade_journal table with emotion/setup_type/mistakes[]/followed_plan. journal.ts: logTrade, listJournalEntries, calcJournalStats (win rate, avg PnL/R, best/worst day, mistake counts, emotion breakdown, plan adherence rate, emotional trading %). Tools: log_trade, review_trades. 18 tests, 780 total passing.

---

## Phase 4: UX & Automation

- [x] **T-401**: Alert System
  - Status: DONE
  - Spec: Price alerts via chat ("alert me when BTC hits 100k"). Store in Supabase. Check via cron/server hooks. Notify via Telegram + in-app. Tools: `set_alert`, `list_alerts`, `delete_alert`.
  - Create: `frontend/src/lib/server/alerts/alertEngine.ts`, `alertEngine.test.ts`
  - Create: `frontend/src/lib/server/tools/alerts.tool.ts`, `frontend/src/lib/types/alert.ts`
  - Create: `frontend/sql/alerts.sql`
  - Modify: `frontend/src/lib/server/telegram.server.ts`, `agentLoop.server.ts`
  - Tests: Alert creation, trigger conditions, notification dispatch.
  - Session notes (2026-03-22): price_alerts table with above/below/crosses conditions. alertEngine.ts: createAlert, listAlerts, deleteAlert, markAlertTriggered, checkAlerts. shouldTrigger handles all conditions including crosses with prevPrice. Tools: set_alert, list_alerts, delete_alert. 26 tests, 806 total passing.

- [x] **T-402**: Automated Signal Scanner
  - Status: DONE | Depends: T-102, T-401
  - Spec: Scheduled scanner on watchlist assets. High-confluence signals auto-push TradeSetupBlock via Telegram. Configurable interval + min confluence score.
  - Create: `frontend/src/lib/server/scanner/signalScanner.ts`, `signalScanner.test.ts`
  - Create: `frontend/src/routes/api/scanner/+server.ts`
  - Tests: Mock market data, verify detection.
  - Session notes (2026-03-22): normaliseSymbol, buildTradeSetup (±0.5 ATR entry zone, 1.5 ATR stop, T1/T2/T3 at 1.5R/3R/5R), scanSymbol (Binance klines, null if <50 candles), scanWatchlist (parallel Promise.allSettled, sort desc). /api/scanner GET+POST with optional Telegram notification and x-scanner-secret auth. Fixed EquityCurve.svelte {@const}→$derived bug. 22 tests, 854 total passing.

- [x] **T-403**: Performance Analytics Dashboard
  - Status: DONE
  - Spec: Enhanced `/analytics` — equity curve chart, monthly returns heatmap, win/loss distribution, R-multiple histogram, drawdown chart, Sharpe/Sortino over time.
  - Modify: `frontend/src/routes/analytics/+page.svelte`
  - Create: `frontend/src/lib/components/analytics/EquityCurve.svelte`, `MonthlyReturns.svelte`, `TradeDistribution.svelte`
  - Create: `frontend/src/routes/api/analytics/performance/+server.ts`
  - Tests: Chart data generation from mock trades.
  - Session notes (2026-03-22): performanceData.ts with buildEquityCurve, buildMonthlyReturns, buildTradeDistribution, calcSharpe/Sortino/Calmar. EquityCurve.svelte (SVG with area fill+drawdown), MonthlyReturns.svelte (heatmap table), TradeDistribution.svelte (win/loss + R-histogram). /api/analytics/performance endpoint. Injected into analytics page. 26 tests, 854 total passing.

- [x] **T-404**: Voice Input (Speech-to-Text)
  - Status: DONE
  - Spec: Web Speech API in InputArea.svelte. Thai + English support. Mic button in input area.
  - Modify: `frontend/src/lib/components/InputArea.svelte`
  - Create: `frontend/src/lib/utils/speechInput.ts`
  - Tests: Speech result handling.
  - Session notes (2026-03-22): createSpeechInput wrapper (lang: th-TH/en-US/auto, continuous, interimResults, onResult/onError/onEnd), isSpeechSupported. Mic button with red pulse when active. Local Web Speech API interfaces (TypeScript DOM lib doesn't include all types). 19 tests, 901 total passing.

- [x] **T-405**: Chat Export & Sharing
  - Status: DONE
  - Spec: Export as PDF/Markdown. Share as public read-only link. Includes all content blocks.
  - Create: `frontend/src/lib/utils/chatExport.ts`, `frontend/src/routes/api/chat/export/+server.ts`
  - Create: `frontend/src/routes/share/[id]/+page.svelte`
  - Modify: `frontend/src/lib/components/ChatArea.svelte`
  - Tests: Markdown generation, export formats.
  - Session notes (2026-03-22): messagesToMarkdown serializes all block types (metric_card, gauge, trade_setup, chart, table, error, sources). downloadMarkdown/downloadJson trigger browser downloads. buildShareUrl. /api/chat/export GET (admin Supabase, UUID capability URL). /share/[id] SSR page. ChatArea share button with dropdown. 23 tests, 950 total passing.

---

## Phase 5: Advanced Features

- [x] **T-501**: Chart Pattern Recognition
  - Status: DONE
  - Spec: Heuristic pattern detection — H&S, double top/bottom, triangles, flags, wedges, cup & handle. Annotate on ChartBlock.
  - Create: `frontend/src/lib/server/indicators/patterns.ts`, `patterns.test.ts`
  - Create: `frontend/src/lib/server/tools/patternScan.tool.ts`
  - Modify: `frontend/src/lib/types/contentBlock.ts` (PatternAnnotation), `agentLoop.server.ts`
  - Tests: Known pattern formations, detection accuracy.
  - Session notes (2026-03-22): PatternAnnotation type added to contentBlock.ts + ChartBlock extended. patterns.ts: findPivots (lookback window), detectDoubleTop/Bottom (similarity threshold), detectH&S/Inverse, detectTriangles (slope analysis), detectFlags (pole+consolidation). scan_chart_patterns tool. Fixed pre-existing T-404 type errors. 28 tests, 901 total passing.

- [x] **T-502**: Multi-Timeframe Analysis Tool
  - Status: DONE
  - Spec: Tool `multi_timeframe_analysis` — analyze across 1D, 4H, 1H, 15M simultaneously. Trend alignment, key levels per TF, confluence zones. Returns HeatmapBlock + ChartBlocks.
  - Create: `frontend/src/lib/server/tools/multiTimeframe.tool.ts`, `frontend/src/lib/server/indicators/multiTF.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock multi-TF data, verify trend alignment.
  - Session notes (2026-03-22): multiTF.ts: detectTrend, classifyMACD, calcBiasScore (-2..+2), findKeyLevels, analyseTimeframe, findConfluenceZones, buildMTFAnalysis. Tool: multi_timeframe_analysis parallel-fetches all TFs, returns HeatmapBlock + MetricCard + table + confluence zones. 26 tests, 927 total passing.

- [x] **T-503**: Order Flow Analysis
  - Status: DONE
  - Spec: Tool `get_order_flow` — whale tracking, order book depth, CVD, buy/sell volume ratio. Binance depth API + Blockchain.com.
  - Create: `frontend/src/lib/server/tools/orderFlow.tool.ts`, `frontend/src/lib/server/data/orderFlow.data.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Mock order book, CVD calculation.
  - Session notes (2026-03-22): orderFlow.data.ts: calcOrderBookStats (bid/ask walls, spread, buy pressure %), buildCVD (cumulative delta), calcBuySellRatio, classifyBuyPressure. fetchOrderBook + fetchCandleVolumes (FAPI→spot fallback, aggTrades bucketed into 5-min). get_order_flow tool: MetricCard + order book walls table. 27 tests, 977 total passing.

- [x] **T-504**: Strategy Marketplace
  - Status: DONE | Depends: T-103, T-104
  - Spec: Publish strategies to shared marketplace. Browse, fork, backtest community strategies. Rate & review. RLS per user.
  - Create: `frontend/src/routes/strategies/+page.svelte`, `[id]/+page.svelte`
  - Create: `frontend/src/routes/api/strategies/+server.ts`
  - Create: `frontend/src/lib/components/strategies/StrategyCard.svelte`, `StrategyList.svelte`
  - Create: `frontend/sql/published_strategies.sql`
  - Tests: CRUD, publish/fork, access control.
  - Session notes (2026-03-22): marketplace.ts: publishStrategy, listPublished (sort/filter/search), forkStrategy, rateStrategy (upsert+recompute avg), unpublishStrategy. published_strategies + strategy_ratings tables with avg_rating trigger. StrategyCard + StrategyList components. /api/strategies + /api/strategies/[id] REST routes. Browse and detail pages. 20 tests, 997 total passing.

- [ ] **T-505**: AI Strategy Optimizer
  - Status: PENDING | Depends: T-103, T-104
  - Spec: LLM suggests parameter optimizations from backtest results. Grid search on key params, AI analyzes robust vs overfit regions. Tool: `optimize_strategy`.
  - Create: `frontend/src/lib/server/backtest/optimizer.ts`, `optimizer.test.ts`
  - Create: `frontend/src/lib/server/tools/strategyOptimizer.tool.ts`
  - Modify: `frontend/src/lib/server/agentLoop.server.ts`
  - Tests: Parameter sweep, robustness scoring.

- [ ] **T-506**: Real-Time WebSocket Price Feed
  - Status: PENDING
  - Spec: Binance WebSocket for real-time prices. Multi-symbol support. Reconnect with exponential backoff. Feed into dashboard + alerts.
  - Create: `frontend/src/lib/server/websocket/priceFeed.ts`, `priceFeed.test.ts`
  - Modify: `frontend/src/lib/components/dashboard/DashboardMiniChart.svelte`, `WatchlistBar.svelte`
  - Tests: Mock WebSocket, reconnect logic.

---

## Completed
<!-- Tasks move here when done -->

## Session Notes

### Session 2026-03-22 (T-203)
- Completed: T-203 Multi-Source OHLCV Provider
- Result: `ohlcvProvider.ts` with `fetchOHLCV(symbol, interval, limit)` — Binance → Yahoo Finance → CoinGecko auto-fallback. Exports `normalizeBinanceSymbol`, `normalizeBinanceInterval`, `resolveCoinGeckoId`, plus individual source fetchers. Routing: forex/commodity → Yahoo only; crypto → Binance → Yahoo → CoinGecko. `charts.tool.ts` and `gold.tool.ts` updated to use the provider. 31 tests. Total: 555 tests.
- Issues: `extractBase` was stripping the base symbol (e.g. 'btc' from 'btcusdt') due to `.replace(/btc$/)` after USDT removal; fixed with a loop-based approach.
- Next: T-204 On-Chain Data Tool

### Session 2026-03-22 (T-202)
- Completed: T-202 Sentiment Analysis Tool
- Result: `sentiment.data.ts` with pure helpers (computeFundingSentiment, computeLongShortSentiment, computeCompositeScore, sentimentLabel, annualisedFundingRate) + fetchers (fetchFearGreed from alternative.me, fetchFundingRates from Binance premiumIndex, fetchLongShortRatios from Binance futures, fetchSentimentSnapshot). `sentiment.tool.ts` registers `get_sentiment` tool — returns GaugeBlock (composite 0–100) + MetricCardBlock (F&G, funding ann.%, L/S ratios). Weighted composite: F&G 50%, funding 30%, L/S 20%. 42 tests passing. Total: 524 tests.
- Issues: All files were pre-created in a previous session.
- Next: T-203 Multi-Source OHLCV Provider

### Session 2026-03-22 (T-201)
- Completed: T-201 Economic Calendar Tool
- Result: `economicCalendar.tool.ts` with `get_economic_calendar` tool — fetches from ForexFactory unofficial JSON feed (thisWeek + nextWeek via `Promise.allSettled`). Filters by `impact_filter` (high/medium_and_high/all), `currency_filter` (comma-separated), `days_ahead` (1-14). Returns TableBlock with 7 columns: Date/Time, CCY, Event, Impact, Forecast, Previous, Actual. Full failure detection (anySuccess flag). Cache mock added to tests. 31 tests all passing. Total: 482 tests.
- Issues: Test file and agentLoop import were already pre-created; agentLoop.server.test.ts was missing the `vi.mock` for economicCalendar.tool — added.
- Next: T-202 Sentiment Analysis Tool

### Session 2026-03-22 (T-105)
- Completed: T-105 Backtest Results Visualization
- Result: `BacktestBlock.svelte` with equity curve (lightweight-charts LineSeries, 160px), drawdown chart (80px, red), 10-metric grid (5-col), walk-forward validation panel (in/out-of-sample + degradation), trades table (last 20 reversed). `BacktestBlock` type + 3 helper types in `contentBlock.ts`. Lazy-loaded in `ContentBlockRenderer.svelte`. 22 tests (type shape, trades, equity, metrics, formatting, snapshots) — 451 total, all passing.
- Issues: None
- Next: T-201 Economic Calendar Tool (no hard dependency)

### Session 2026-03-22 (T-104)
- Completed: T-104 Backtesting Engine
- Result: `backtest.ts` types (Trade, EquityPoint, BacktestMetrics, BacktestResult, WalkForwardResult). `metrics.ts` with pure metric functions (maxDrawdown, Sharpe, Sortino, CAGR, profitFactor, consecutive losses, equity curve builder). `engine.ts` with IndicatorCatalogue (lazy pre-computation of all strategy indicators), condition evaluator supporting all operators incl. crosses_above/below, stop/TP/trailing/time/indicator exits, max-drawdown circuit breaker, ATR-based position sizing. `backtest.tool.ts` registers `run_backtest` tool (fetches OHLCV from Binance/Yahoo, returns MetricCardBlock + TableBlock, optional walk-forward). 39 tests all passing. Total: 429 tests.
- Issues: agentLoop.server.test.ts needed `vi.mock('./tools/backtest.tool', () => ({}))` to pass
- Next: T-105 Backtest Results Visualization (depends on T-104 ✓)

### Session 2026-03-22 (continued)
- Completed: T-101 Technical Indicator Engine
- Result: 20 indicators (SMA, EMA, RSI, MACD, BB, ATR, Stochastic, ADX, OBV, VWAP, Ichimoku, Fibonacci, Pivot Points, Williams %R, CCI, MFI, Parabolic SAR, Donchian, Keltner, SuperTrend) in `frontend/src/lib/server/indicators/engine.ts`. 69 tests all passing. charts.tool.ts updated to import from engine.
- Issues: None
- Next: T-102 Signal Generator (depends on T-101 ✓)

- Completed: T-102 Signal Generator Tool
- Result: `confluence.ts` with 8 detectors (MA crossover ×2, trend alignment, RSI divergence, MACD cross, Bollinger breakout/squeeze, S/R touch via pivot points, SuperTrend flip, Stochastic cross). `signals.tool.ts` registers `generate_signals` tool — fetches OHLCV from Binance/Yahoo, runs all detectors, returns MetricCardBlock + TradeSetupBlock when confluenceScore ≥ 4. 36 tests in `confluence.test.ts`, all passing. Total: 340 tests.
- Issues: agentLoop.server.test.ts needed new `vi.mock('./tools/signals.tool', () => ({}))` to pass
- Next: T-103 Strategy Definition Schema (no hard dependency, can start any time)

- Completed: T-103 Strategy Definition Schema
- Result: `strategy.ts` with full type system (IndicatorCondition, ConditionGroup, EntryCondition, ExitCondition union ×5 types, PositionSizing ×4 methods, RiskParams, AssetFilter, Strategy). `validateStrategy()` collects all errors (not fail-fast). `strategy.server.ts` with createStrategy/getStrategy/listStrategies/updateStrategy/deleteStrategy using biglot_user_id. `strategies.sql` with indexes, RLS policies, updated_at trigger. 50 tests all passing. Total: 390 tests.
- Issues: MockQueryBuilder needed fix — `.select()` after `.insert()` was overwriting the action; fixed by tracking primaryAction separately.
- Next: T-104 Backtesting Engine (depends on T-101 ✓, T-103 ✓)
