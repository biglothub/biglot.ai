// Wyckoff Market Cycle Analysis Tool — T-701
// Tool: analyze_wyckoff

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { analyzeWyckoff } from '../indicators/wyckoff';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, GaugeBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Gauge thresholds ─────────────────────────────────────────────────────────

const GAUGE_THRESHOLDS: GaugeBlock['thresholds'] = [
	{ value: 20,  color: '#ef4444', label: 'Strong Distribution' },
	{ value: 40,  color: '#f97316', label: 'Weak Distribution'   },
	{ value: 60,  color: '#eab308', label: 'Neutral / Ranging'   },
	{ value: 80,  color: '#84cc16', label: 'Weak Accumulation'   },
	{ value: 100, color: '#22c55e', label: 'Strong Accumulation' },
];

// Convert -100..+100 bias to 0..100 gauge value
function biasToGauge(bias: number): number {
	return Math.round((bias + 100) / 2);
}

function biasLabel(bias: number): string {
	if (bias >= 60)  return 'Strong Accumulation / Markup';
	if (bias >= 25)  return 'Accumulation Building';
	if (bias >= -24) return 'Neutral / Ranging';
	if (bias >= -59) return 'Distribution Building';
	return 'Strong Distribution / Markdown';
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'analyze_wyckoff',
	description:
		'Wyckoff market cycle analysis — detects Accumulation (A–E), Distribution (A–E), Markup, or Markdown phases. Identifies key events: SC, BC, AR, ST, Spring, SOS, SOW, UTAD, LPS, LPSY. Volume Spread Analysis (VSA) classifies effort vs result. Returns a bias gauge (-100 bullish to +100 bearish mapped to 0–100), phase summary, key events table, and VSA signals. Use when the user asks about market cycle, Wyckoff, accumulation/distribution, or whether smart money is buying/selling.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair (e.g. BTCUSDT, ETHUSDT). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Timeframe: 1h, 4h, 1d, 1w. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Candles to analyze (default: 100, min: 60, max: 300)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase()   : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval                : '1d';
		const limit    = Math.min(300, Math.max(60, typeof args.limit === 'number' ? args.limit : 100));

		const cacheKey = toolCache.generateKey('analyze_wyckoff', { symbol, interval, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Fetch OHLCV
		const fetchResult = await fetchBinanceOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'analyze_wyckoff' }],
				textSummary: `Error: could not fetch OHLCV for ${symbol}.`,
			};
		}

		const analysis = analyzeWyckoff(fetchResult.ohlcv);
		if (!analysis) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data — need ≥60 candles, got ${fetchResult.ohlcv.length}.`, tool: 'analyze_wyckoff' }],
				textSummary: `Insufficient data for Wyckoff analysis of ${symbol}.`,
			};
		}

		const { phase, subPhase, bias, events, vsaSignals, tradingRange } = analysis;
		const gaugeValue = biasToGauge(bias);
		const label      = biasLabel(bias);

		// ── Gauge ──────────────────────────────────────────────────────────────
		const gaugeBlock: GaugeBlock = {
			type:       'gauge',
			title:      `Wyckoff Analysis — ${symbol} (${interval})`,
			value:      gaugeValue,
			label:      `${label} | Phase: ${phase.charAt(0).toUpperCase() + phase.slice(1)} ${subPhase}`,
			thresholds: GAUGE_THRESHOLDS,
		};

		// ── MetricCard ─────────────────────────────────────────────────────────
		const phaseDir: 'up' | 'down' | 'neutral' =
			phase === 'accumulation' || phase === 'markup' ? 'up' :
			phase === 'distribution' || phase === 'markdown' ? 'down' : 'neutral';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Wyckoff Summary — ${symbol}`,
			metrics: [
				{
					label:     'Phase',
					value:     `${phase.charAt(0).toUpperCase() + phase.slice(1)} ${subPhase}`,
					change:    analysis.description,
					direction: phaseDir,
				},
				{
					label:     'Bias Score',
					value:     `${bias > 0 ? '+' : ''}${bias}`,
					change:    label,
					direction: bias > 0 ? 'up' : bias < 0 ? 'down' : 'neutral',
				},
				{
					label:     'Trading Range',
					value:     tradingRange
						? `${tradingRange.support.toFixed(4)} – ${tradingRange.resistance.toFixed(4)}`
						: 'No range detected',
					change:    tradingRange
						? `Width: ${tradingRange.widthPct.toFixed(1)}%  Mid: ${tradingRange.midpoint.toFixed(4)}`
						: 'Market is trending',
					direction: 'neutral',
				},
				{
					label:     'Key Events',
					value:     events.length.toString(),
					change:    events.length > 0
						? events.slice(-3).map(e => e.type).join(', ')
						: 'None detected',
					direction: 'neutral',
				},
				{
					label:     'VSA Signals',
					value:     vsaSignals.length.toString(),
					change:    vsaSignals.length > 0
						? vsaSignals.slice(-2).map(s => s.type.replace('_', ' ')).join(', ')
						: 'None notable',
					direction: 'neutral',
				},
			],
		};

		// ── Key Events Table ───────────────────────────────────────────────────
		const contentBlocks: ContentBlock[] = [gaugeBlock, metricBlock];

		if (events.length > 0) {
			const eventsTable: TableBlock = {
				type:    'table',
				title:   `Key Wyckoff Events — ${symbol}`,
				headers: ['Event', 'Price', 'Vol Ratio', 'Bar #', 'Description'],
				rows:    events.slice(-12).map(e => [
					e.type,
					e.price.toFixed(4),
					`${(e.volumeRatio * 100).toFixed(0)}%`,
					`#${e.index + 1}`,
					e.description,
				]),
			};
			contentBlocks.push(eventsTable);
		}

		// ── VSA Table (top 8 most recent) ──────────────────────────────────────
		if (vsaSignals.length > 0) {
			const vsaTable: TableBlock = {
				type:    'table',
				title:   `VSA Signals — ${symbol}`,
				headers: ['Signal', 'Bar #', 'Description'],
				rows:    vsaSignals.slice(-8).map(s => [
					s.type.replace(/_/g, ' '),
					`#${s.index + 1}`,
					s.description,
				]),
			};
			contentBlocks.push(vsaTable);
		}

		const result: ToolResult = {
			success:       true,
			contentBlocks,
			textSummary:   `${symbol} (${interval}): ${analysis.description}. Bias: ${bias > 0 ? '+' : ''}${bias} (${label}). ${events.length} Wyckoff events, ${vsaSignals.length} VSA signals.`,
			sources: [
				{ name: 'Binance OHLCV', url: 'https://api.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min
		return result;
	},
});
