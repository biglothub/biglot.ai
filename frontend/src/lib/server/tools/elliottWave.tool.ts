// Elliott Wave Counter Tool — T-702
// Tool: count_elliott_waves

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { analyzeElliottWaves } from '../indicators/elliottWave';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'count_elliott_waves',
	description:
		'Elliott Wave analysis — detects 5-wave impulse (1-2-3-4-5) or 3-wave correction (A-B-C) using pivot-based swing detection. Validates wave rules: Wave 2 cannot retrace 100%+ of Wave 1, Wave 3 is never shortest, Wave 4 cannot overlap Wave 1. Returns Fibonacci retracement/extension targets for the next wave. Use when user asks about Elliott Wave, wave count, impulsive/corrective moves, or Fibonacci wave targets.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair (e.g. BTCUSDT, ETHUSDT). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Timeframe: 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Candles to analyze (default: 100, min: 30, max: 300)',
			},
			pivot_lookback: {
				type: 'number',
				description: 'Pivot detection lookback bars (default: 5, higher = major swings only)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase() : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval             : '1d';
		const limit    = Math.min(300, Math.max(30, typeof args.limit === 'number' ? args.limit : 100));
		const lookback = Math.min(20, Math.max(3, typeof args.pivot_lookback === 'number' ? args.pivot_lookback : 5));

		const cacheKey = toolCache.generateKey('count_elliott_waves', { symbol, interval, limit, lookback });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const fetchResult = await fetchBinanceOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'count_elliott_waves' }],
				textSummary: `Error: could not fetch OHLCV for ${symbol}.`,
			};
		}

		const analysis = analyzeElliottWaves(fetchResult.ohlcv, lookback);

		// ── MetricCard ─────────────────────────────────────────────────────────
		const typeLabel = analysis.type === 'impulse'
			? `${analysis.direction === 'bullish' ? 'Bullish' : 'Bearish'} Impulse (1-2-3-4-5)`
			: analysis.type === 'corrective'
			? `${analysis.direction === 'bearish' ? 'Bearish' : 'Bullish'} Correction (A-B-C)`
			: 'No Pattern';

		const dir: 'up' | 'down' | 'neutral' =
			analysis.type === 'none' ? 'neutral' :
			analysis.direction === 'bullish' ? 'up' : 'down';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Elliott Wave — ${symbol} (${interval})`,
			metrics: [
				{
					label:     'Pattern',
					value:     typeLabel,
					change:    analysis.description,
					direction: dir,
				},
				{
					label:     'Validity',
					value:     analysis.isValid ? 'Valid' : `${analysis.violations.length} violation(s)`,
					change:    analysis.violations.length > 0 ? analysis.violations[0] : 'All rules satisfied',
					direction: analysis.isValid ? 'up' : 'down',
				},
				{
					label:     'Current Wave',
					value:     analysis.currentWave ?? 'Unknown',
					change:    analysis.waves.length > 0
						? `${analysis.waves.length} waves detected`
						: 'No waves found',
					direction: 'neutral',
				},
				{
					label:     'Waves Detected',
					value:     analysis.waves.length.toString(),
					change:    analysis.waves.length > 0
						? analysis.waves.map(w => w.label).join(' → ')
						: 'None',
					direction: 'neutral',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Waves Table ────────────────────────────────────────────────────────
		if (analysis.waves.length > 0) {
			const wavesTable: TableBlock = {
				type:    'table',
				title:   `Wave Details — ${symbol}`,
				headers: ['Wave', 'Start Price', 'End Price', 'Size %', 'Retracement %', 'Direction'],
				rows:    analysis.waves.map(w => {
					const sizePct  = (Math.abs(w.endPrice - w.startPrice) / w.startPrice * 100).toFixed(2);
					const retrace  = w.retracementPct !== null ? `${w.retracementPct.toFixed(1)}%` : '—';
					const waveDir  = w.endPrice > w.startPrice ? '▲ Up' : '▼ Down';
					return [w.label, w.startPrice.toFixed(4), w.endPrice.toFixed(4), `${sizePct}%`, retrace, waveDir];
				}),
			};
			contentBlocks.push(wavesTable);
		}

		// ── Fibonacci Targets Table ────────────────────────────────────────────
		if (analysis.fibTargets.length > 0) {
			const fibTable: TableBlock = {
				type:    'table',
				title:   analysis.type === 'impulse'
					? `Next Wave Retracement Targets — ${symbol}`
					: `Wave C Extension Targets — ${symbol}`,
				headers: ['Fib Level', 'Price'],
				rows:    analysis.fibTargets.slice(0, 6).map(t => [
					`${(t.ratio * 100).toFixed(1)}%`,
					t.price.toFixed(4),
				]),
			};
			contentBlocks.push(fibTable);
		}

		// ── Violations ─────────────────────────────────────────────────────────
		if (analysis.violations.length > 0 && analysis.violations[0] !== 'Insufficient pivot data') {
			const violTable: TableBlock = {
				type:    'table',
				title:   'Rule Violations',
				headers: ['#', 'Violation'],
				rows:    analysis.violations.map((v, i) => [`${i + 1}`, v]),
			};
			contentBlocks.push(violTable);
		}

		const result: ToolResult = {
			success:       analysis.type !== 'none',
			contentBlocks,
			textSummary:   `${symbol} (${interval}): ${analysis.description}. Current wave: ${analysis.currentWave ?? 'unknown'}. ${analysis.violations.length} rule violations. ${analysis.fibTargets.length} Fibonacci targets computed.`,
			sources: [
				{ name: 'Binance OHLCV', url: 'https://api.binance.com', accessedAt: Date.now() },
			],
		};

		if (analysis.type !== 'none') {
			toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		}
		return result;
	},
});
