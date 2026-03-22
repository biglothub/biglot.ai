// Fibonacci Confluence Zone Scanner Tool — T-903
// Tool: scan_fibonacci_confluence

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { findFibConfluenceZones, fmtFibPrice } from '../indicators/fibConfluence';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_fibonacci_confluence',
	description:
		'Fibonacci Confluence Zone Scanner — detects price zones where multiple Fibonacci retracement (23.6%, 38.2%, 50%, 61.8%, 78.6%) and extension (127.2%, 161.8%) levels from different swing highs/lows cluster together. Zones with multiple overlapping Fibonacci levels are the strongest support/resistance. Returns MetricCard (current price, nearest support/resistance) + ranked zones table. Use when asked about Fibonacci levels, key Fib zones, confluence support/resistance, or Fib targets.',
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
				description: 'Number of candles to analyse (default: 200, min: 30, max: 500)',
			},
			lookback: {
				type: 'number',
				description: 'Pivot detection lookback window (default: 5)',
			},
			cluster_pct: {
				type: 'number',
				description: 'Clustering threshold % — levels within this % are merged into a zone (default: 0.5)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol    = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase()  : 'BTCUSDT';
		const interval  = typeof args.interval === 'string' && args.interval ? args.interval              : '1d';
		const limit     = Math.min(500, Math.max(30, typeof args.limit    === 'number' ? args.limit    : 200));
		const lookback  = Math.min(20,  Math.max(3,  typeof args.lookback === 'number' ? args.lookback : 5));
		const clusterPct = Math.min(5,  Math.max(0.1, typeof args.cluster_pct === 'number' ? args.cluster_pct : 0.5));

		const cacheKey = toolCache.generateKey('scan_fibonacci_confluence', { symbol, interval, limit, lookback, clusterPct });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV ─────────────────────────────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'scan_fibonacci_confluence' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < 30) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol} (need ≥30 candles, got ${candles.length}).`, tool: 'scan_fibonacci_confluence' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		// ── Compute Fib confluence ───────────────────────────────────────────────
		const result = findFibConfluenceZones(candles, { lookback, clusterPct, minStrength: 2, maxSwings: 5 });

		if (result.zones.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'error',
					message: `No Fibonacci confluence zones found for ${symbol} on ${interval} (${candles.length} candles). Try a larger lookback or more candles.`,
					tool: 'scan_fibonacci_confluence',
				}],
				textSummary: `No Fibonacci confluence zones detected for ${symbol}.`,
			};
		}

		const price     = result.currentPrice;
		const nearest   = result.nearestSupport ?? result.zones[0];
		const resistance = result.nearestResistance ?? result.zones[0];

		// ── MetricCard ─────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Fibonacci Confluence Zones — ${symbol} (${interval})`,
			metrics: [
				{
					label:     'Current Price',
					value:     fmtFibPrice(price),
					change:    `${result.zones.length} zones from ${result.swingCount} swings (${result.totalLevels} levels)`,
					direction: 'neutral',
				},
				...(result.nearestSupport ? [{
					label:     'Nearest Support Zone',
					value:     fmtFibPrice(result.nearestSupport.price),
					change:    `${result.nearestSupport.distancePct.toFixed(2)}% below | strength: ${result.nearestSupport.strength}`,
					direction: 'down' as const,
				}] : []),
				...(result.nearestResistance ? [{
					label:     'Nearest Resistance Zone',
					value:     fmtFibPrice(result.nearestResistance.price),
					change:    `+${result.nearestResistance.distancePct.toFixed(2)}% above | strength: ${result.nearestResistance.strength}`,
					direction: 'up' as const,
				}] : []),
				{
					label:     'Strongest Zone',
					value:     fmtFibPrice(result.zones[0].price),
					change:    `${result.zones[0].strength} levels | ${result.zones[0].zoneType}`,
					direction: result.zones[0].zoneType === 'resistance' ? 'up' : 'down',
				},
			],
		};

		// ── Confluence zones table ────────────────────────────────────────────
		const topZones = result.zones.slice(0, 15);
		const tableRows = topZones.map(z => {
			const levelDesc = z.levels.slice(0, 3).map(l => l.label).join(', ')
				+ (z.levels.length > 3 ? ` +${z.levels.length - 3}` : '');
			return [
				fmtFibPrice(z.price),
				`${z.priceMin !== z.priceMax ? `${fmtFibPrice(z.priceMin)}–${fmtFibPrice(z.priceMax)}` : fmtFibPrice(z.price)}`,
				String(z.strength),
				z.zoneType.charAt(0).toUpperCase() + z.zoneType.slice(1),
				`${z.distancePct >= 0 ? '+' : ''}${z.distancePct.toFixed(2)}%`,
				levelDesc,
			];
		});

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Top Fibonacci Confluence Zones — ${symbol}`,
			headers: ['Zone Price', 'Range', 'Strength', 'Type', 'Distance', 'Fib Levels'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		// ── Text summary ─────────────────────────────────────────────────────
		const supportText    = result.nearestSupport
			? `nearest support at ${fmtFibPrice(result.nearestSupport.price)} (${result.nearestSupport.distancePct.toFixed(1)}%, strength ${result.nearestSupport.strength})`
			: 'no support zones';
		const resistanceText = result.nearestResistance
			? `nearest resistance at ${fmtFibPrice(result.nearestResistance.price)} (+${result.nearestResistance.distancePct.toFixed(1)}%, strength ${result.nearestResistance.strength})`
			: 'no resistance zones';

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} Fibonacci confluence: ${result.zones.length} zones found from ${result.swingCount} swings. Current price: ${fmtFibPrice(price)}. ${supportText}. ${resistanceText}. Strongest zone: ${fmtFibPrice(result.zones[0].price)} (${result.zones[0].strength} levels).`,
			sources: [{ name: 'Fibonacci Confluence Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 15 * 60_000); // 15 min cache
		return toolResult;
	},
});
