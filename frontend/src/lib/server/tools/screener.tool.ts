// Technical Asset Screener Tool — T-901
// Tool: screen_assets

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	screenAssets,
	DEFAULT_WATCHLIST,
	fmtScreenerPrice,
	trendLabel,
	type ScreenerFilters,
} from '../data/screener.data';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'screen_assets',
	description:
		'Technical asset screener — batch-screens a watchlist of crypto symbols against configurable filters: RSI range (oversold/overbought), MA trend (above/below 50/200 SMA, golden/death cross), MACD signal (bullish/bearish), volume spike, ATR volatility. Each matching asset receives a score. Returns a ranked table of results + summary MetricCard. Use when asked to find oversold/overbought assets, trending coins, volume breakouts, or to screen the market for setups.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'array',
				items: { type: 'string' },
				description: 'List of symbols to screen (e.g. ["BTCUSDT","ETHUSDT"]). Defaults to top-20 crypto watchlist.',
			},
			rsi_min: {
				type: 'number',
				description: 'Minimum RSI (e.g. 30 to find oversold). RSI must be >= this value.',
			},
			rsi_max: {
				type: 'number',
				description: 'Maximum RSI (e.g. 70 to find overbought). RSI must be <= this value.',
			},
			trend: {
				type: 'string',
				enum: ['above_ma50', 'below_ma50', 'above_ma200', 'below_ma200', 'golden_cross', 'death_cross'],
				description: 'MA trend filter.',
			},
			macd_signal: {
				type: 'string',
				enum: ['bullish', 'bearish'],
				description: 'MACD crossover signal filter.',
			},
			volume_spike: {
				type: 'number',
				description: 'Volume spike multiplier — only include assets where current volume > N× 20-period avg (e.g. 2.0).',
			},
			atr_volatility: {
				type: 'string',
				enum: ['high', 'low'],
				description: 'ATR volatility filter — high: current ATR% > avg; low: current ATR% < avg.',
			},
			interval: {
				type: 'string',
				description: 'Candle interval for analysis: 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to fetch per symbol (default: 200, min: 50, max: 500).',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		// ── Parse args ──────────────────────────────────────────────────────────
		const rawSymbols = Array.isArray(args.symbols)
			? (args.symbols as unknown[]).filter(s => typeof s === 'string').map(s => (s as string).toUpperCase())
			: [];
		const symbols  = rawSymbols.length > 0 ? rawSymbols : DEFAULT_WATCHLIST;
		const interval = typeof args.interval === 'string' && args.interval ? args.interval : '1d';
		const limit    = Math.min(500, Math.max(50, typeof args.limit === 'number' ? args.limit : 200));

		const filters: ScreenerFilters = {};
		if (typeof args.rsi_min === 'number')     filters.rsiMin        = args.rsi_min;
		if (typeof args.rsi_max === 'number')     filters.rsiMax        = args.rsi_max;
		if (typeof args.trend   === 'string')     filters.trend         = args.trend as ScreenerFilters['trend'];
		if (typeof args.macd_signal === 'string') filters.macdSignal    = args.macd_signal as 'bullish' | 'bearish';
		if (typeof args.volume_spike === 'number') filters.volumeSpike  = args.volume_spike;
		if (typeof args.atr_volatility === 'string') filters.atrVolatility = args.atr_volatility as 'high' | 'low';

		const filterCount = Object.keys(filters).length;

		const cacheKey = toolCache.generateKey('screen_assets', { symbols: symbols.sort().join(','), interval, limit, ...filters });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV for all symbols in parallel ─────────────────────────────
		const fetchResults = await Promise.allSettled(
			symbols.map(async (symbol) => {
				const res = await fetchOHLCV(symbol, interval, limit);
				if ('error' in res) return null;
				return { symbol, candles: res.ohlcv };
			})
		);

		const assetData = fetchResults
			.map(r => (r.status === 'fulfilled' ? r.value : null))
			.filter((v): v is { symbol: string; candles: import('$lib/types/contentBlock').OHLCV[] } => v !== null);

		if (assetData.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Could not fetch data for any symbol.', tool: 'screen_assets' }],
				textSummary: 'Error: no OHLCV data available.',
			};
		}

		// ── Run screening ───────────────────────────────────────────────────────
		const results = screenAssets(assetData, filters);

		const matchingCount  = filterCount > 0 ? results.filter(r => r.score > 0).length : results.length;
		const topResult      = results[0];
		const topSignal      = topResult
			? `${topResult.symbol} (score: ${topResult.score})`
			: 'None';

		// ── MetricCard ──────────────────────────────────────────────────────────
		const filterSummary = filterCount === 0
			? 'No filters applied — showing all assets ranked by 24h change'
			: Object.entries(filters)
				.map(([k, v]) => `${k}=${String(v)}`)
				.join(', ');

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Technical Screener — ${symbols.length} symbols (${interval})`,
			metrics: [
				{
					label:     'Symbols Screened',
					value:     String(assetData.length),
					change:    `of ${symbols.length} requested`,
					direction: 'neutral',
				},
				{
					label:     'Matching Assets',
					value:     String(matchingCount),
					change:    filterCount > 0 ? `with ${filterCount} filter(s): ${filterSummary}` : filterSummary,
					direction: matchingCount > 0 ? 'up' : 'neutral',
				},
				{
					label:     'Top Signal',
					value:     topSignal,
					change:    topResult ? `RSI: ${topResult.rsi14.toFixed(1)} | ${trendLabel(topResult.trend)}` : '',
					direction: 'neutral',
				},
			],
		};

		// ── Results Table ───────────────────────────────────────────────────────
		const displayResults = filterCount > 0
			? results.filter(r => r.score > 0)
			: results;

		const tableRows = displayResults.map(r => [
			r.symbol.replace('USDT', ''),
			fmtScreenerPrice(r.price),
			`${r.change24h >= 0 ? '+' : ''}${r.change24h.toFixed(2)}%`,
			r.rsi14.toFixed(1),
			trendLabel(r.trend),
			r.macdSignal === 'bullish' ? '↑ Bull' : r.macdSignal === 'bearish' ? '↓ Bear' : '→',
			`${r.volumeRatio.toFixed(2)}×`,
			`${r.atrPct.toFixed(2)}%`,
			filterCount > 0 ? String(r.score) : r.matches.length > 0 ? r.matches.join(', ') : '—',
		]);

		const tableBlock: TableBlock = {
			type:    'table',
			title:   filterCount > 0
				? `Matching Assets (${displayResults.length} of ${results.length})`
				: `All Assets — Ranked by 24h Change`,
			headers: ['Symbol', 'Price', '24h %', 'RSI', 'Trend', 'MACD', 'Vol Ratio', 'ATR%', filterCount > 0 ? 'Score' : 'Signals'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		// ── Summary ─────────────────────────────────────────────────────────────
		const summaryParts: string[] = [
			`Screened ${assetData.length} symbols on ${interval} timeframe.`,
		];
		if (filterCount > 0) {
			summaryParts.push(`${matchingCount} of ${results.length} assets match: ${filterSummary}.`);
		}
		if (displayResults.length > 0) {
			const top3 = displayResults.slice(0, 3).map(r =>
				`${r.symbol} (RSI ${r.rsi14.toFixed(1)}, ${trendLabel(r.trend)}, vol ${r.volumeRatio.toFixed(1)}×)`
			).join('; ');
			summaryParts.push(`Top picks: ${top3}.`);
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: summaryParts.join(' '),
			sources: [{ name: 'Technical Screener', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
