// Registry-driven wrappers around the tradingview-mcp HTTP service.
//
// Every tool here is a thin proxy: validate args → call the remote endpoint
// → fold the JSON result into BigLot's ToolResult shape (textSummary +
// contentBlocks). We deliberately reuse generic blocks (text, table,
// metric_card) rather than minting new types — keeps the surface small.
//
// To add or remove a tradingview tool, edit TV_TOOLS below and that's it.

import type { ContentBlock } from '$lib/types/contentBlock';
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { callTradingviewTool, TradingviewClientError } from '../tradingviewClient.server';

type TvCategory =
	| 'screener'
	| 'analysis'
	| 'candles'
	| 'volume'
	| 'sentiment'
	| 'backtest'
	| 'yahoo'
	| 'options'
	| 'egx';

type TvTool = {
	/** Local BigLot name (prefixed with `tv_`). */
	name: string;
	/** Remote tradingview-mcp tool name (no prefix). */
	remote: string;
	description: string;
	parameters: Record<string, unknown>;
	timeout: number;
	cacheTtlMs: number;
	category: TvCategory;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// --- Exchange / timeframe enums (kept in sync with the Python server) -------

const CRYPTO_EXCHANGES = ['KUCOIN', 'BINANCE', 'BYBIT', 'MEXC', 'BITGET', 'OKX', 'GATEIO'];
const STOCK_EXCHANGES = ['NASDAQ', 'NYSE', 'EGX', 'BIST', 'BURSA', 'HKEX', 'SSE', 'SZSE', 'TWSE', 'TPEX'];
const ALL_EXCHANGES = [...CRYPTO_EXCHANGES, ...STOCK_EXCHANGES];
const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '1D', '1W', '1M'];
const STRATEGIES = ['rsi', 'bollinger', 'macd', 'ema_cross', 'supertrend', 'donchian'];

// --- Tool catalogue ---------------------------------------------------------

const TV_TOOLS: TvTool[] = [
	// === Screener ===========================================================
	{
		name: 'tv_top_gainers',
		remote: 'top_gainers',
		category: 'screener',
		description:
			'Top gaining symbols on a given exchange and timeframe, ranked by Bollinger Band analysis. Works for crypto (KUCOIN, BINANCE, BYBIT, MEXC) and stocks (NASDAQ, NYSE, EGX, BIST, HKEX).',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES, description: 'Exchange code (default KUCOIN)' },
				timeframe: { type: 'string', enum: TIMEFRAMES, description: 'Default 15m' },
				limit: { type: 'number', description: 'Max rows (1-50, default 25)' }
			}
		},
		timeout: 20_000,
		cacheTtlMs: 2 * MINUTE
	},
	{
		name: 'tv_top_losers',
		remote: 'top_losers',
		category: 'screener',
		description: 'Top losing symbols on a given exchange and timeframe.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 20_000,
		cacheTtlMs: 2 * MINUTE
	},
	{
		name: 'tv_bollinger_scan',
		remote: 'bollinger_scan',
		category: 'screener',
		description:
			'Scan for symbols with tight Bollinger Bands (squeeze) — early warning for breakouts. Returns symbols sorted by BB width ascending.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES, description: 'Default 4h' },
				bbw_threshold: { type: 'number', description: 'Max BB width (default 0.04)' },
				limit: { type: 'number' }
			}
		},
		timeout: 25_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_rating_filter',
		remote: 'rating_filter',
		category: 'screener',
		description:
			'Filter symbols by TradingView technical rating (-2 strong sell to +2 strong buy). Use to find consensus-rated setups.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES, description: 'Default 5m' },
				rating: { type: 'number', enum: [-2, -1, 0, 1, 2], description: '2=Strong Buy, 1=Buy, 0=Neutral, -1=Sell, -2=Strong Sell (default 2)' },
				limit: { type: 'number' }
			}
		},
		timeout: 20_000,
		cacheTtlMs: 2 * MINUTE
	},

	// === Analysis ===========================================================
	{
		name: 'tv_coin_analysis',
		remote: 'coin_analysis',
		category: 'analysis',
		description:
			'Full TradingView technical analysis for one symbol: RSI, MACD, Bollinger, 23 indicators with BUY/SELL/HOLD recommendations.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'e.g. BTCUSDT, AAPL, EURUSD' },
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES }
			},
			required: ['symbol']
		},
		timeout: 15_000,
		cacheTtlMs: MINUTE
	},
	{
		name: 'tv_multi_agent_analysis',
		remote: 'multi_agent_analysis',
		category: 'analysis',
		description:
			'Three specialised AI agents (Technical, Sentiment/Momentum, Risk) debate findings and converge on STRONG BUY / BUY / HOLD / SELL / STRONG SELL with confidence score.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES }
			},
			required: ['symbol']
		},
		timeout: 45_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_multi_timeframe_analysis',
		remote: 'multi_timeframe_analysis',
		category: 'analysis',
		description:
			'Multi-timeframe alignment check (Weekly → Daily → 4H → 1H → 15m). Returns whether the trend is consistent across timeframes — high-conviction setups have alignment.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				exchange: { type: 'string', enum: ALL_EXCHANGES }
			},
			required: ['symbol']
		},
		timeout: 30_000,
		cacheTtlMs: 3 * MINUTE
	},

	// === Candle patterns ====================================================
	{
		name: 'tv_consecutive_candles_scan',
		remote: 'consecutive_candles_scan',
		category: 'candles',
		description: 'Scan for symbols printing N consecutive bullish or bearish candles — momentum / exhaustion signal.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				direction: { type: 'string', enum: ['bullish', 'bearish'] },
				consecutive_count: { type: 'number', description: 'Number of candles in a row (default 3)' },
				limit: { type: 'number' }
			}
		},
		timeout: 25_000,
		cacheTtlMs: 2 * MINUTE
	},
	{
		name: 'tv_advanced_candle_pattern',
		remote: 'advanced_candle_pattern',
		category: 'candles',
		description: 'Detect 15 candlestick patterns (engulfing, doji, hammer, etc.) on a symbol.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				lookback: { type: 'number', description: 'How many candles back to scan (default 20)' }
			},
			required: ['symbol']
		},
		timeout: 20_000,
		cacheTtlMs: 2 * MINUTE
	},

	// === Volume =============================================================
	{
		name: 'tv_volume_breakout_scanner',
		remote: 'volume_breakout_scanner',
		category: 'volume',
		description: 'Symbols with volume spikes vs their average — institutional accumulation signals.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				volume_multiplier: { type: 'number', description: 'Default 2.0 (2x average volume)' },
				limit: { type: 'number' }
			}
		},
		timeout: 25_000,
		cacheTtlMs: 2 * MINUTE
	},
	{
		name: 'tv_volume_confirmation_analysis',
		remote: 'volume_confirmation_analysis',
		category: 'volume',
		description: 'For one symbol: does today\'s price action have volume confirmation (true breakout vs fakeout)?',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES }
			},
			required: ['symbol']
		},
		timeout: 15_000,
		cacheTtlMs: MINUTE
	},
	{
		name: 'tv_smart_volume_scanner',
		remote: 'smart_volume_scanner',
		category: 'volume',
		description: 'Smart-money volume scan — large green candles with above-average volume on supportive levels.',
		parameters: {
			type: 'object',
			properties: {
				exchange: { type: 'string', enum: ALL_EXCHANGES },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 30_000,
		cacheTtlMs: 3 * MINUTE
	},

	// === Sentiment & news ===================================================
	{
		name: 'tv_market_sentiment',
		remote: 'market_sentiment',
		category: 'sentiment',
		description:
			'Reddit community sentiment for a symbol — bullish/bearish score, post count, top posts. Categories: stocks, crypto, all.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'e.g. NVDA, BTC, AAPL' },
				category: { type: 'string', enum: ['stocks', 'crypto', 'all'] },
				limit: { type: 'number', description: 'Max Reddit posts to scan (default 20)' }
			},
			required: ['symbol']
		},
		timeout: 25_000,
		cacheTtlMs: 10 * MINUTE
	},
	{
		name: 'tv_financial_news',
		remote: 'financial_news',
		category: 'sentiment',
		description:
			'Latest financial RSS headlines from Reuters, CoinDesk, CoinTelegraph. Filter by symbol or category.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'Optional — filter to a ticker' },
				category: { type: 'string', enum: ['stocks', 'crypto', 'forex', 'commodities', 'all'] },
				limit: { type: 'number' }
			}
		},
		timeout: 20_000,
		cacheTtlMs: 10 * MINUTE
	},
	{
		name: 'tv_combined_analysis',
		remote: 'combined_analysis',
		category: 'sentiment',
		description:
			'Power tool: TradingView technicals + Reddit sentiment + live news → confluence-based BUY/SELL/HOLD recommendation. Best single tool when the user wants "should I buy X?".',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				exchange: { type: 'string', enum: ALL_EXCHANGES, description: 'Default NASDAQ' },
				timeframe: { type: 'string', enum: TIMEFRAMES, description: 'Default 1D' }
			},
			required: ['symbol']
		},
		timeout: 60_000,
		cacheTtlMs: 5 * MINUTE
	},

	// === Backtest ===========================================================
	{
		name: 'tv_backtest_strategy',
		remote: 'backtest_strategy',
		category: 'backtest',
		description:
			'Run one of 6 quant strategies (rsi, bollinger, macd, ema_cross, supertrend, donchian) against historical data. Returns Sharpe, Calmar, win rate, max drawdown, expectancy, vs buy-and-hold, with realistic commission + slippage.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string', description: 'Yahoo-style: AAPL, BTC-USD, ETH-USD, ^GSPC' },
				strategy: { type: 'string', enum: STRATEGIES },
				period: { type: 'string', description: 'e.g. "1y", "2y", "5y", "max" (default 1y)' },
				interval: { type: 'string', enum: ['1h', '1d', '1wk'], description: 'Default 1d' },
				initial_capital: { type: 'number', description: 'Default 10000' },
				commission_pct: { type: 'number', description: 'Round-trip commission % (default 0.1)' },
				slippage_pct: { type: 'number', description: 'Slippage % per trade (default 0.05)' }
			},
			required: ['symbol', 'strategy']
		},
		timeout: 90_000,
		cacheTtlMs: HOUR
	},
	{
		name: 'tv_compare_strategies',
		remote: 'compare_strategies',
		category: 'backtest',
		description:
			'Run all 6 strategies on the same symbol/period and rank by performance. Use when user asks "which strategy works best on X?".',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				period: { type: 'string' },
				interval: { type: 'string', enum: ['1h', '1d', '1wk'] },
				initial_capital: { type: 'number' }
			},
			required: ['symbol']
		},
		timeout: 180_000,
		cacheTtlMs: HOUR
	},
	{
		name: 'tv_walk_forward_backtest',
		remote: 'walk_forward_backtest_strategy',
		category: 'backtest',
		description:
			'Walk-forward backtest with rolling in-sample / out-of-sample windows. Detects overfitting — out-of-sample performance should approximate in-sample.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				strategy: { type: 'string', enum: STRATEGIES },
				period: { type: 'string', description: 'Total history (default 5y)' },
				in_sample_pct: { type: 'number', description: 'Default 0.7' },
				num_splits: { type: 'number', description: 'Number of rolling windows (default 3)' }
			},
			required: ['symbol', 'strategy']
		},
		timeout: 180_000,
		cacheTtlMs: HOUR
	},

	// === Yahoo Finance ======================================================
	{
		name: 'tv_yahoo_price',
		remote: 'yahoo_price',
		category: 'yahoo',
		description:
			'Real-time Yahoo Finance quote: price, change %, 52w high/low, market state. Works for stocks (AAPL), crypto (BTC-USD), ETFs (SPY), indices (^GSPC), FX (EURUSD=X), Turkish (THYAO.IS).',
		parameters: {
			type: 'object',
			properties: { symbol: { type: 'string' } },
			required: ['symbol']
		},
		timeout: 15_000,
		cacheTtlMs: 30_000
	},
	{
		name: 'tv_market_snapshot',
		remote: 'market_snapshot',
		category: 'yahoo',
		description:
			'Global market dashboard: S&P500, NASDAQ, VIX, BTC, ETH, EUR/USD, SPY, GLD. Use when user asks "how are markets today?" or "give me a market snapshot".',
		parameters: { type: 'object', properties: {} },
		timeout: 20_000,
		cacheTtlMs: MINUTE
	},
	{
		name: 'tv_bitcoin_market_pulse',
		remote: 'bitcoin_market_pulse',
		category: 'yahoo',
		description: 'Bitcoin-focused dashboard: BTC price, dominance, fear/greed proxy, key levels.',
		parameters: { type: 'object', properties: {} },
		timeout: 20_000,
		cacheTtlMs: MINUTE
	},
	{
		name: 'tv_stock_extended_hours',
		remote: 'stock_extended_hours',
		category: 'yahoo',
		description: 'Pre-market and after-hours price for a US stock — useful around earnings.',
		parameters: {
			type: 'object',
			properties: { symbol: { type: 'string' } },
			required: ['symbol']
		},
		timeout: 15_000,
		cacheTtlMs: 30_000
	},

	// === Options ============================================================
	{
		name: 'tv_stock_options_chain',
		remote: 'stock_options_chain',
		category: 'options',
		description: 'Full options chain for a US stock — strikes, IV, volume, OI for one expiration.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				expiry: { type: 'string', description: 'YYYY-MM-DD (optional — defaults to nearest)' }
			},
			required: ['symbol']
		},
		timeout: 25_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_stock_options_unusual_activity',
		remote: 'stock_options_unusual_activity',
		category: 'options',
		description:
			'Unusual options activity — strikes with V/OI > 1 (volume already exceeds open interest), flagging fresh institutional positioning. Returns call/put split + top contracts.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				top_n: { type: 'number', description: 'How many strikes to return (default 10)' },
				min_volume: { type: 'number', description: 'Filter out illiquid strikes (default 100)' },
				expiries: { type: 'number', description: 'How many soonest expirations to scan (default 4)' }
			},
			required: ['symbol']
		},
		timeout: 40_000,
		cacheTtlMs: 10 * MINUTE
	},

	// === EGX (Egyptian Exchange) ============================================
	{
		name: 'tv_egx_market_overview',
		remote: 'egx_market_overview',
		category: 'egx',
		description: 'EGX market summary — top movers, sector performance.',
		parameters: {
			type: 'object',
			properties: {
				timeframe: { type: 'string', enum: TIMEFRAMES, description: 'Default 1D' },
				limit: { type: 'number' }
			}
		},
		timeout: 25_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_sector_scan',
		remote: 'egx_sector_scan',
		category: 'egx',
		description: 'Scan EGX by sector — banks, real estate, telecom, etc.',
		parameters: {
			type: 'object',
			properties: {
				sector: { type: 'string', description: 'e.g. Banks, Real Estate' },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 25_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_sector_scanner',
		remote: 'egx_sector_scanner',
		category: 'egx',
		description: 'Multi-sector scan with detailed breakdown.',
		parameters: {
			type: 'object',
			properties: {
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 30_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_index_analysis',
		remote: 'egx_index_analysis',
		category: 'egx',
		description: 'Analyse EGX index (EGX30, EGX70, etc.) constituents.',
		parameters: {
			type: 'object',
			properties: {
				index: { type: 'string', description: 'e.g. EGX30, EGX70 (default EGX30)' },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 30_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_stock_screener',
		remote: 'egx_stock_screener',
		category: 'egx',
		description: 'Custom EGX screener with technical filters.',
		parameters: {
			type: 'object',
			properties: {
				min_volume: { type: 'number' },
				min_price: { type: 'number' },
				max_price: { type: 'number' },
				timeframe: { type: 'string', enum: TIMEFRAMES },
				limit: { type: 'number' }
			}
		},
		timeout: 30_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_trade_plan',
		remote: 'egx_trade_plan',
		category: 'egx',
		description: 'Generate a structured trade plan for an EGX symbol — entry, stop, targets.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				timeframe: { type: 'string', enum: TIMEFRAMES }
			},
			required: ['symbol']
		},
		timeout: 20_000,
		cacheTtlMs: 5 * MINUTE
	},
	{
		name: 'tv_egx_fibonacci_retracement',
		remote: 'egx_fibonacci_retracement',
		category: 'egx',
		description: 'Fibonacci retracement levels for an EGX symbol over a lookback period.',
		parameters: {
			type: 'object',
			properties: {
				symbol: { type: 'string' },
				lookback: { type: 'string', description: 'e.g. 52W, 12M, 6M (default 52W)' },
				timeframe: { type: 'string', enum: TIMEFRAMES }
			},
			required: ['symbol']
		},
		timeout: 20_000,
		cacheTtlMs: 10 * MINUTE
	}
];

// --- Generic render → ContentBlock[] ----------------------------------------

function renderResult(toolName: string, raw: unknown): { blocks: ContentBlock[]; summary: string } {
	if (raw === null || raw === undefined) {
		return { blocks: [{ type: 'text', content: `${toolName}: empty response` }], summary: 'empty response' };
	}

	if (typeof raw !== 'object') {
		const text = String(raw);
		return { blocks: [{ type: 'text', content: text }], summary: text };
	}

	// Tradingview tools return an error dict {error: "..."} on failure
	if ('error' in raw && typeof (raw as { error: unknown }).error === 'string') {
		const msg = (raw as { error: string }).error;
		return {
			blocks: [{ type: 'error', message: msg, tool: toolName }],
			summary: `Error from ${toolName}: ${msg}`
		};
	}

	if (Array.isArray(raw)) {
		return renderArray(toolName, raw as unknown[]);
	}

	return renderObject(toolName, raw as Record<string, unknown>);
}

function renderArray(toolName: string, items: unknown[]): { blocks: ContentBlock[]; summary: string } {
	if (items.length === 0) {
		return {
			blocks: [{ type: 'text', content: `${toolName}: no results` }],
			summary: 'no results'
		};
	}

	// Array of plain objects → table; otherwise text block
	if (items.every((it) => it !== null && typeof it === 'object' && !Array.isArray(it))) {
		const records = items as Record<string, unknown>[];
		const headers = Array.from(new Set(records.flatMap((r) => Object.keys(r)))).slice(0, 8);
		const rows = records.slice(0, 50).map((r) =>
			headers.map((h) => formatCell(r[h]))
		);
		return {
			blocks: [{ type: 'table', title: prettyTitle(toolName), headers, rows }],
			summary: `${toolName}: ${items.length} rows. First row: ${JSON.stringify(records[0]).slice(0, 300)}`
		};
	}

	const text = items.slice(0, 20).map((it) => `- ${stringifyShort(it)}`).join('\n');
	return {
		blocks: [{ type: 'text', content: text }],
		summary: `${toolName}: ${items.length} items`
	};
}

function renderObject(
	toolName: string,
	obj: Record<string, unknown>
): { blocks: ContentBlock[]; summary: string } {
	const blocks: ContentBlock[] = [];
	const scalars: { label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[] = [];

	for (const [key, value] of Object.entries(obj)) {
		if (value === null || value === undefined) continue;

		if (typeof value === 'object' && !Array.isArray(value)) {
			// Nested object — render as nested table of key/value
			const nested = value as Record<string, unknown>;
			const rows = Object.entries(nested)
				.filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
				.slice(0, 20)
				.map(([k, v]) => [prettyKey(k), formatCell(v)]);
			if (rows.length > 0) {
				blocks.push({
					type: 'table',
					title: prettyKey(key),
					headers: ['Field', 'Value'],
					rows
				});
			}
			continue;
		}

		if (Array.isArray(value)) {
			if (value.length === 0) continue;
			if (value.every((it) => it !== null && typeof it === 'object' && !Array.isArray(it))) {
				const records = value as Record<string, unknown>[];
				const headers = Array.from(new Set(records.flatMap((r) => Object.keys(r)))).slice(0, 6);
				const rows = records.slice(0, 25).map((r) => headers.map((h) => formatCell(r[h])));
				blocks.push({
					type: 'table',
					title: prettyKey(key),
					headers,
					rows
				});
			}
			continue;
		}

		// Scalar
		scalars.push({
			label: prettyKey(key),
			value: formatCell(value),
			direction: detectDirection(key, value)
		});
	}

	if (scalars.length > 0) {
		blocks.unshift({
			type: 'metric_card',
			title: prettyTitle(toolName),
			metrics: scalars.slice(0, 12)
		});
	}

	if (blocks.length === 0) {
		blocks.push({ type: 'text', content: '```json\n' + JSON.stringify(obj, null, 2).slice(0, 2000) + '\n```' });
	}

	const summary =
		scalars.length > 0
			? `${prettyTitle(toolName)}: ` + scalars.slice(0, 6).map((s) => `${s.label}=${s.value}`).join(', ')
			: `${prettyTitle(toolName)}: ${JSON.stringify(obj).slice(0, 300)}`;

	return { blocks, summary };
}

function formatCell(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'number') {
		if (Number.isInteger(v)) return v.toString();
		return Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4);
	}
	if (typeof v === 'boolean') return v ? 'true' : 'false';
	if (typeof v === 'object') return JSON.stringify(v).slice(0, 80);
	return String(v).slice(0, 200);
}

function stringifyShort(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
	return String(v).slice(0, 200);
}

function prettyKey(key: string): string {
	return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function prettyTitle(toolName: string): string {
	return prettyKey(toolName.replace(/^tv_/, ''));
}

function detectDirection(key: string, value: unknown): 'up' | 'down' | 'neutral' | undefined {
	if (typeof value !== 'number') return undefined;
	const k = key.toLowerCase();
	if (k.includes('change') || k.includes('return') || k.includes('pct') || k.includes('pnl')) {
		if (value > 0) return 'up';
		if (value < 0) return 'down';
		return 'neutral';
	}
	return undefined;
}

// --- Register every tool ----------------------------------------------------

for (const def of TV_TOOLS) {
	registerTool({
		name: def.name,
		description: def.description,
		parameters: def.parameters,
		timeout: def.timeout,
		execute: async (args): Promise<ToolResult> => {
			const cacheKey = toolCache.generateKey(def.name, args);
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			try {
				const raw = await callTradingviewTool(def.remote, args, {
					timeoutMs: def.timeout
				});
				const { blocks, summary } = renderResult(def.name, raw);
				const result: ToolResult = {
					success: true,
					contentBlocks: blocks,
					textSummary: summary,
					sources: [
						{
							name: 'TradingView MCP',
							accessedAt: Date.now()
						}
					]
				};
				toolCache.set(cacheKey, result, def.cacheTtlMs);
				return result;
			} catch (err: unknown) {
				const message =
					err instanceof TradingviewClientError
						? err.message
						: err instanceof Error
							? err.message
							: `${def.name} failed`;
				return {
					success: false,
					contentBlocks: [{ type: 'error', message, tool: def.name }],
					textSummary: `Error: ${message}`
				};
			}
		}
	});
}

export const TRADINGVIEW_TOOL_NAMES = TV_TOOLS.map((t) => t.name);
