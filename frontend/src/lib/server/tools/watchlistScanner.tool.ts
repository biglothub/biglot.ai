// Watchlist Scanner Tool — T-901
// Tool: scan_watchlist

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildWatchlistScan, fmtPrice, fmtChange, signalLabel, regimeEmoji, smaPositionLabel } from '../data/watchlistScanner.data';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'SPY', 'QQQ', 'GLD'];
const MAX_SYMBOLS = 20;

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_watchlist',
	description:
		'Watchlist scanner — scans multiple symbols in parallel and returns a summary table with price, 24h change, RSI(14), market regime, signal direction + confluence score, and SMA50/200 position for each asset. Returns MetricCard (bull/bear count, avg RSI, market sentiment) + full scan TableBlock sorted by confluence score. Use when asked to scan the market, check watchlist, get overall market sentiment, or compare multiple assets at a glance. Default symbols: BTC, ETH, SOL, BNB, XRP, SPY, QQQ, GLD.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'array',
				items: { type: 'string' },
				description: 'List of symbols to scan (e.g. ["BTCUSDT", "ETHUSDT", "SPY"]). Max 20. Default: BTC, ETH, SOL, BNB, XRP, SPY, QQQ, GLD.',
			},
			interval: {
				type: 'string',
				description: 'Candle interval for analysis: 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Candles per symbol (default: 200, min: 50, max: 500)',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		// ── Parse args ─────────────────────────────────────────────────────────
		const rawSymbols = Array.isArray(args.symbols) ? args.symbols : [];
		const symbols: string[] = rawSymbols.length > 0
			? rawSymbols
				.filter((s): s is string => typeof s === 'string' && s.length > 0)
				.map(s => s.toUpperCase())
				.slice(0, MAX_SYMBOLS)
			: DEFAULT_SYMBOLS;

		const interval = typeof args.interval === 'string' && args.interval ? args.interval : '1d';
		const limit    = Math.min(500, Math.max(50, typeof args.limit === 'number' ? args.limit : 200));

		const cacheKey = toolCache.generateKey('scan_watchlist', { symbols: symbols.join(','), interval, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV for all symbols in parallel ────────────────────────────
		const fetches = await Promise.allSettled(
			symbols.map(async (sym) => {
				const result = await fetchOHLCV(sym, interval, limit);
				if ('error' in result) {
					return { symbol: sym, ohlcv: null, error: result.error };
				}
				return { symbol: sym, ohlcv: result.ohlcv };
			})
		);

		const symbolData = fetches.map((settled, i) => {
			if (settled.status === 'rejected') {
				return { symbol: symbols[i], ohlcv: null, error: String(settled.reason) };
			}
			return settled.value;
		});

		const scan = buildWatchlistScan(symbolData);

		// ── MetricCard — overall summary ───────────────────────────────────────
		const totalValid = scan.bullCount + scan.bearCount + scan.neutralCount;
		const sentimentLabel =
			scan.bullCount > scan.bearCount + scan.neutralCount ? 'Risk-On 🟢' :
			scan.bearCount > scan.bullCount + scan.neutralCount ? 'Risk-Off 🔴' :
			'Mixed/Neutral ⚪';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Watchlist Scanner — ${symbols.length} symbols (${interval})`,
			metrics: [
				{
					label:     'Market Sentiment',
					value:     sentimentLabel,
					change:    `${scan.bullCount} bull · ${scan.bearCount} bear · ${scan.neutralCount} neutral`,
					direction: scan.bullCount > scan.bearCount ? 'up' : scan.bearCount > scan.bullCount ? 'down' : 'neutral',
				},
				{
					label:     'Average RSI',
					value:     scan.avgRSI.toFixed(1),
					change:    scan.avgRSI > 70 ? 'Overbought zone' : scan.avgRSI < 30 ? 'Oversold zone' : 'Neutral zone',
					direction: scan.avgRSI > 60 ? 'up' : scan.avgRSI < 40 ? 'down' : 'neutral',
				},
				{
					label:     'Bullish Signals',
					value:     `${scan.bullCount} / ${totalValid}`,
					change:    `${totalValid > 0 ? ((scan.bullCount / totalValid) * 100).toFixed(0) : 0}% of scanned`,
					direction: 'up',
				},
				{
					label:     'Bearish Signals',
					value:     `${scan.bearCount} / ${totalValid}`,
					change:    `${totalValid > 0 ? ((scan.bearCount / totalValid) * 100).toFixed(0) : 0}% of scanned`,
					direction: 'down',
				},
				{
					label:     'Symbols Scanned',
					value:     `${totalValid} / ${symbols.length}`,
					change:    `${symbols.length - totalValid} failed`,
					direction: 'neutral',
				},
			],
		};

		// ── Table — full scan results ──────────────────────────────────────────
		const tableRows = scan.results.map(r => {
			if (r.error) {
				return [r.symbol, 'Error', '—', '—', '—', '—', '—', '—'];
			}
			return [
				r.symbol,
				fmtPrice(r.price),
				fmtChange(r.change24h),
				r.rsiValue.toFixed(1),
				regimeEmoji(r.regime),
				signalLabel(r.signalDirection, r.confluenceScore),
				r.confluenceScore.toFixed(0),
				smaPositionLabel(r.aboveSMA50, r.aboveSMA200),
			];
		});

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Watchlist Scan Results — sorted by confluence`,
			headers: ['Symbol', 'Price', '24h %', 'RSI', 'Regime', 'Signal', 'Score', 'SMA 50/200'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		// Top 3 signals for text summary
		const topBull = scan.results.filter(r => !r.error && r.signalDirection === 'bullish').slice(0, 3).map(r => r.symbol).join(', ');
		const topBear = scan.results.filter(r => !r.error && r.signalDirection === 'bearish').slice(0, 3).map(r => r.symbol).join(', ');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Watchlist scan (${interval}): ${scan.bullCount} bullish, ${scan.bearCount} bearish, ${scan.neutralCount} neutral out of ${totalValid} symbols. Avg RSI: ${scan.avgRSI.toFixed(1)}. Sentiment: ${sentimentLabel}.${topBull ? ` Bullish: ${topBull}.` : ''}${topBear ? ` Bearish: ${topBear}.` : ''}`,
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
