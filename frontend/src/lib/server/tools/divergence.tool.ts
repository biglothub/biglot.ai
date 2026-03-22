// Divergence Scanner Tool — T-1002
// Tool: scan_divergences

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { scanDivergences, divTypeLabel } from '../indicators/divergence';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_divergences',
	description:
		'Divergence Scanner — detects regular and hidden divergences between price swing pivots and oscillators (RSI, MACD histogram, OBV). Regular divergence: price makes new high/low but oscillator fails → potential reversal. Hidden divergence: oscillator makes new extreme but price fails → potential continuation. Up to 3 divergence pairs per oscillator. Returns MetricCard (bull/bear count, strongest signal) + TableBlock (type, oscillator, price swing, signal strength, candles ago). Use when asked about divergences, RSI divergence, MACD divergence, bullish/bearish divergence.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Asset symbol (e.g. BTCUSDT, ETHUSDT). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 1h, 4h, 1d. Default: 4h',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to analyse (default: 100, min: 50, max: 300)',
			},
			lookback: {
				type: 'number',
				description: 'Pivot detection lookback window (default: 5, min: 3, max: 15)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase() : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval              : '4h';
		const limit    = Math.min(300, Math.max(50, typeof args.limit    === 'number' ? args.limit    : 100));
		const lookback = Math.min(15,  Math.max(3,  typeof args.lookback === 'number' ? args.lookback : 5));

		const cacheKey = toolCache.generateKey('scan_divergences', { symbol, interval, limit, lookback });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV ───────────────────────────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'scan_divergences' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < 50) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol} (need ≥50 candles, got ${candles.length}).`, tool: 'scan_divergences' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		// ── Scan divergences ──────────────────────────────────────────────────
		const result = scanDivergences(candles, { lookback, window: limit });

		if (result.signals.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'error',
					message: `No divergences detected for ${symbol} on ${interval}. The price and oscillators are moving in alignment — no divergence signals currently active.`,
					tool: 'scan_divergences',
				}],
				textSummary: `No divergences detected for ${symbol} on ${interval}.`,
			};
		}

		const { bullCount, bearCount, strongestBull, strongestBear } = result;
		const overallBias = bullCount > bearCount ? 'bullish' : bullCount < bearCount ? 'bearish' : 'mixed';

		// ── MetricCard ────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Divergence Scan — ${symbol} (${interval})`,
			metrics: [
				{
					label:     'Total Divergences',
					value:     String(result.signals.length),
					change:    `${bullCount} bullish, ${bearCount} bearish`,
					direction: overallBias === 'bullish' ? 'up' : overallBias === 'bearish' ? 'down' : 'neutral',
				},
				...(strongestBull ? [{
					label:     'Strongest Bullish',
					value:     divTypeLabel(strongestBull.type),
					change:    `${strongestBull.oscillator} | strength: ${(strongestBull.strength * 100).toFixed(0)}% | ${strongestBull.candlesAgo} bars ago`,
					direction: 'up' as const,
				}] : []),
				...(strongestBear ? [{
					label:     'Strongest Bearish',
					value:     divTypeLabel(strongestBear.type),
					change:    `${strongestBear.oscillator} | strength: ${(strongestBear.strength * 100).toFixed(0)}% | ${strongestBear.candlesAgo} bars ago`,
					direction: 'down' as const,
				}] : []),
				{
					label:     'Overall Signal',
					value:     overallBias.charAt(0).toUpperCase() + overallBias.slice(1),
					change:    `${result.signals.filter(s => s.classification === 'regular').length} regular, ${result.signals.filter(s => s.classification === 'hidden').length} hidden`,
					direction: overallBias === 'bullish' ? 'up' : overallBias === 'bearish' ? 'down' : 'neutral',
				},
			],
		};

		// ── Signals table ─────────────────────────────────────────────────────
		function fmtPrice(p: number): string {
			return p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : p.toPrecision(5);
		}

		const tableRows = result.signals.slice(0, 15).map(s => [
			divTypeLabel(s.type),
			s.oscillator,
			`${fmtPrice(s.price1)} → ${fmtPrice(s.price2)}`,
			`${s.osc1.toFixed(2)} → ${s.osc2.toFixed(2)}`,
			`${(s.strength * 100).toFixed(0)}%`,
			`${s.candlesAgo} bars ago`,
		]);

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Divergence Signals — ${symbol}`,
			headers: ['Type', 'Oscillator', 'Price Swing', 'Osc Swing', 'Strength', 'When'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		// ── Text summary ──────────────────────────────────────────────────────
		const topStr = result.signals.slice(0, 3)
			.map(s => `${divTypeLabel(s.type)} on ${s.oscillator} (${(s.strength * 100).toFixed(0)}%, ${s.candlesAgo} bars ago)`)
			.join('; ');

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} divergence scan: ${result.signals.length} signals found — ${bullCount} bullish, ${bearCount} bearish. Overall bias: ${overallBias}. Top signals: ${topStr}.`,
			sources: [{ name: 'Divergence Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 10 * 60_000); // 10 min cache
		return toolResult;
	},
});
