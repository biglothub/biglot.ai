// Harmonic Pattern Scanner Tool — T-1001
// Tool: scan_harmonic_patterns

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { scanHarmonicPatterns, fmtHarmonicPrice } from '../indicators/harmonicPatterns';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_harmonic_patterns',
	description:
		'Harmonic Pattern Scanner — detects XABCD harmonic patterns (Gartley, Butterfly, Bat, Crab, Cypher) and ABCD patterns using pivot-based Fibonacci ratio validation (±5% tolerance per ratio). Each detected pattern includes: pattern name, bullish/bearish direction, Potential Reversal Zone (PRZ) price range computed from CD leg projections, confidence score 0–100, and whether D leg is still completing. Returns MetricCard (pattern count, strongest pattern name, PRZ range, direction) + TableBlock (pattern, direction, PRZ low/high, score, completing). Use when asked about harmonic patterns, Gartley, Bat, Butterfly, Crab, Cypher, ABCD, or PRZ levels.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Asset symbol (e.g. BTCUSDT, ETHUSDT). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to fetch (default: 200, min: 50, max: 500)',
			},
			lookback: {
				type: 'number',
				description: 'Pivot detection lookback window (default: 5, min: 3, max: 20)',
			},
			min_score: {
				type: 'number',
				description: 'Minimum pattern confidence score 0–100 (default: 60)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase()  : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval               : '1d';
		const limit    = Math.min(500, Math.max(50,  typeof args.limit    === 'number' ? args.limit    : 200));
		const lookback = Math.min(20,  Math.max(3,   typeof args.lookback === 'number' ? args.lookback : 5));
		const minScore = Math.min(100, Math.max(0,   typeof args.min_score === 'number' ? args.min_score : 60));

		const cacheKey = toolCache.generateKey('scan_harmonic_patterns', { symbol, interval, limit, lookback, minScore });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV ───────────────────────────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'scan_harmonic_patterns' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < 50) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol} (need ≥50 candles, got ${candles.length}).`, tool: 'scan_harmonic_patterns' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		// ── Scan for harmonic patterns ────────────────────────────────────────
		const result = scanHarmonicPatterns(candles, { lookback, minScore });

		if (result.patterns.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'error',
					message: `No harmonic patterns detected for ${symbol} on ${interval} (score ≥ ${minScore}). Try reducing min_score or using a different interval.`,
					tool: 'scan_harmonic_patterns',
				}],
				textSummary: `No harmonic patterns detected for ${symbol} with score ≥ ${minScore}.`,
			};
		}

		const strongest = result.strongestPattern!;
		const bullCount = result.patterns.filter(p => p.direction === 'bullish').length;
		const bearCount = result.patterns.filter(p => p.direction === 'bearish').length;

		// ── MetricCard ────────────────────────────────────────────────────────
		const overallBias = bullCount > bearCount ? 'bullish' : bullCount < bearCount ? 'bearish' : 'mixed';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Harmonic Patterns — ${symbol} (${interval})`,
			metrics: [
				{
					label:     'Patterns Detected',
					value:     String(result.patterns.length),
					change:    `${bullCount} bullish, ${bearCount} bearish`,
					direction: overallBias === 'bullish' ? 'up' : overallBias === 'bearish' ? 'down' : 'neutral',
				},
				{
					label:     'Strongest Pattern',
					value:     strongest.name,
					change:    `${strongest.direction} | score: ${strongest.score}/100`,
					direction: strongest.direction === 'bullish' ? 'up' : 'down',
				},
				{
					label:     'PRZ Range',
					value:     `${fmtHarmonicPrice(strongest.przLow)}–${fmtHarmonicPrice(strongest.przHigh)}`,
					change:    `${strongest.completing ? 'Completing (D forming)' : 'Completed'}`,
					direction: strongest.direction === 'bullish' ? 'up' : 'down',
				},
				{
					label:     'Current Price',
					value:     fmtHarmonicPrice(result.currentPrice),
					change:    `${((result.currentPrice - strongest.prz) / strongest.prz * 100).toFixed(2)}% from strongest PRZ`,
					direction: result.currentPrice < strongest.prz ? 'down' : 'up',
				},
			],
		};

		// ── Patterns table ────────────────────────────────────────────────────
		const tableRows = result.patterns.slice(0, 15).map(p => {
			const ratioStr = Object.entries(p.ratios)
				.slice(0, 2)
				.map(([k, v]) => `${k}=${v.toFixed(3)}`)
				.join(', ');

			return [
				p.name,
				p.direction === 'bullish' ? 'Bullish ▲' : 'Bearish ▼',
				fmtHarmonicPrice(p.przLow),
				fmtHarmonicPrice(p.przHigh),
				`${p.score}/100`,
				p.completing ? 'Forming' : 'Complete',
				ratioStr,
			];
		});

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Harmonic Patterns — ${symbol}`,
			headers: ['Pattern', 'Direction', 'PRZ Low', 'PRZ High', 'Score', 'Status', 'Key Ratios'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		// ── Text summary ──────────────────────────────────────────────────────
		const topStr = result.patterns
			.slice(0, 3)
			.map(p => `${p.name} ${p.direction} (PRZ: ${fmtHarmonicPrice(p.przLow)}–${fmtHarmonicPrice(p.przHigh)}, score: ${p.score})`)
			.join('; ');

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} harmonic patterns: ${result.patterns.length} detected (${bullCount} bull, ${bearCount} bear). Strongest: ${strongest.name} ${strongest.direction} PRZ ${fmtHarmonicPrice(strongest.przLow)}–${fmtHarmonicPrice(strongest.przHigh)}, score ${strongest.score}/100${strongest.completing ? ' (forming)' : ''}. Top patterns: ${topStr}.`,
			sources: [{ name: 'Harmonic Pattern Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 15 * 60_000); // 15 min cache
		return toolResult;
	},
});
