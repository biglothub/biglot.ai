// Pairs Trading & Spread Analysis Tool — T-1003
// Tool: analyze_pairs

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	buildPairsSnapshot,
	cointegrationLabel,
} from '../data/pairsTrading.data';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'analyze_pairs',
	description:
		'Pairs Trading & Spread Analysis — given two symbols, computes: Pearson correlation (30d returns), OLS hedge ratio (beta), spread z-score vs 20-day mean/std, half-life of mean reversion (Ornstein-Uhlenbeck), and cointegration score via ADF test approximation. Trading signal: z-score > 2 → short spread (A expensive vs B), z-score < -2 → long spread (A cheap vs B). Returns MetricCard (correlation, z-score, half-life, signal) + spread history TableBlock (20 days with z-score) + cointegration summary. Use when asked about pairs trading, spread trading, cointegration, relative value, or statistical arbitrage.',
	parameters: {
		type: 'object',
		properties: {
			symbol_a: {
				type: 'string',
				description: 'First symbol (numerator of spread, e.g. BTCUSDT). Default: BTCUSDT',
			},
			symbol_b: {
				type: 'string',
				description: 'Second symbol (denominator of spread, e.g. ETHUSDT). Default: ETHUSDT',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to analyse (default: 90, min: 40, max: 365)',
			},
		},
		required: [],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		const symbolA  = typeof args.symbol_a === 'string' && args.symbol_a ? args.symbol_a.toUpperCase() : 'BTCUSDT';
		const symbolB  = typeof args.symbol_b === 'string' && args.symbol_b ? args.symbol_b.toUpperCase() : 'ETHUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval : '1d';
		const limit    = Math.min(365, Math.max(40, typeof args.limit === 'number' ? args.limit : 90));

		const cacheKey = toolCache.generateKey('analyze_pairs', { symbolA, symbolB, interval, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch both symbols in parallel ────────────────────────────────────
		const [resultA, resultB] = await Promise.all([
			fetchOHLCV(symbolA, interval, limit),
			fetchOHLCV(symbolB, interval, limit),
		]);

		if ('error' in resultA) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch ${symbolA}: ${resultA.error}`, tool: 'analyze_pairs' }],
				textSummary: `Error: no data for ${symbolA}.`,
			};
		}
		if ('error' in resultB) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch ${symbolB}: ${resultB.error}`, tool: 'analyze_pairs' }],
				textSummary: `Error: no data for ${symbolB}.`,
			};
		}

		if (resultA.ohlcv.length < 40 || resultB.ohlcv.length < 40) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data — need ≥40 candles (${symbolA}: ${resultA.ohlcv.length}, ${symbolB}: ${resultB.ohlcv.length}).`, tool: 'analyze_pairs' }],
				textSummary: `Error: insufficient data for pairs analysis.`,
			};
		}

		// ── Align series by trimming to common length ─────────────────────────
		const closesA = resultA.ohlcv.map(c => c.close);
		const closesB = resultB.ohlcv.map(c => c.close);
		const minLen  = Math.min(closesA.length, closesB.length);

		const snap = buildPairsSnapshot(
			symbolA, symbolB,
			closesA.slice(-minLen), closesB.slice(-minLen),
		);

		// ── MetricCard ────────────────────────────────────────────────────────
		const signalLabel  = snap.signal === 'long_spread'  ? `Long ${symbolA}, Short ${symbolB}` :
		                     snap.signal === 'short_spread' ? `Short ${symbolA}, Long ${symbolB}` :
		                     'Neutral — wait for entry';
		const signalDir    = snap.signal === 'long_spread' ? 'up' as const :
		                     snap.signal === 'short_spread' ? 'down' as const : 'neutral' as const;
		const halfLifeStr  = snap.halfLife >= 9999 ? 'Not mean-reverting' : `${snap.halfLife.toFixed(1)} ${interval === '1d' ? 'days' : 'bars'}`;

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Pairs Analysis — ${symbolA} / ${symbolB} (${interval})`,
			metrics: [
				{
					label:     'Correlation (30d)',
					value:     (snap.correlation30d * 100).toFixed(1) + '%',
					change:    snap.correlation30d >= 0.7 ? 'High — suitable pair' : snap.correlation30d >= 0.4 ? 'Moderate' : 'Low — risky pair',
					direction: snap.correlation30d >= 0.5 ? 'up' : 'down',
				},
				{
					label:     'Spread Z-Score',
					value:     snap.currentZScore.toFixed(2),
					change:    `vs 20-period mean ${snap.spreadMean.toFixed(2)} ± ${snap.spreadStd.toFixed(2)}`,
					direction: Math.abs(snap.currentZScore) > 2 ? (snap.currentZScore > 0 ? 'down' : 'up') : 'neutral',
				},
				{
					label:     'Half-Life',
					value:     halfLifeStr,
					change:    snap.halfLife < 20 ? 'Fast mean reversion' : snap.halfLife < 60 ? 'Moderate reversion' : 'Slow / no reversion',
					direction: snap.halfLife < 30 ? 'up' : 'neutral',
				},
				{
					label:     'Trading Signal',
					value:     signalLabel,
					change:    `Z-score: ${snap.currentZScore.toFixed(2)} | ADF: ${snap.adfStat.toFixed(2)} | Cointegration: ${snap.cointegrationScore}/100`,
					direction: signalDir,
				},
			],
		};

		// ── Spread history table ──────────────────────────────────────────────
		const historyRows = snap.history.map((pt, i) => {
			const zStr  = pt.zScore.toFixed(2);
			const flag  = Math.abs(pt.zScore) > 2 ? (pt.zScore > 0 ? ' ↑ SHORT' : ' ↓ LONG') : '';
			return [
				String(i + 1),
				pt.spread.toFixed(4),
				`${zStr}${flag}`,
			];
		});

		const historyTable: TableBlock = {
			type:    'table',
			title:   `Spread History — last ${snap.history.length} periods`,
			headers: ['Period', 'Spread', 'Z-Score'],
			rows:    historyRows,
		};

		// ── Cointegration summary table ───────────────────────────────────────
		const coIntLabel = cointegrationLabel(snap.cointegrationScore);
		const coTable: TableBlock = {
			type:    'table',
			title:   'Cointegration & Pair Statistics',
			headers: ['Metric', 'Value', 'Interpretation'],
			rows: [
				['Hedge Ratio (β)', snap.beta.toFixed(4), `Buy 1 ${symbolA}, Sell ${snap.beta.toFixed(3)} ${symbolB}`],
				['Intercept',       snap.intercept.toFixed(4), 'OLS spread intercept'],
				['ADF Statistic',   snap.adfStat.toFixed(3), snap.adfStat < -2.89 ? 'Stationary at 5%' : snap.adfStat < -3.51 ? 'Stationary at 1%' : 'Non-stationary'],
				['Cointegration',   `${snap.cointegrationScore}/100`, coIntLabel],
				['Half-Life',       halfLifeStr, 'Mean reversion speed'],
				['Current Z-Score', snap.currentZScore.toFixed(3), snap.signal !== 'neutral' ? signalLabel : 'Within neutral band ±2'],
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock, historyTable, coTable];

		// ── Text summary ──────────────────────────────────────────────────────
		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Pairs analysis ${symbolA}/${symbolB}: correlation ${(snap.correlation30d * 100).toFixed(1)}%, hedge ratio β=${snap.beta.toFixed(3)}, z-score ${snap.currentZScore.toFixed(2)}, half-life ${halfLifeStr}, cointegration ${snap.cointegrationScore}/100 (${coIntLabel}). Signal: ${signalLabel}.`,
			sources: [{ name: 'Pairs Trading Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 30 * 60_000); // 30 min cache
		return toolResult;
	},
});
