// Pattern Scan Tool — T-501
// Heuristic chart pattern detection
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { scanPatterns } from '../indicators/patterns';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';

registerTool({
	name: 'scan_chart_patterns',
	description:
		'Detect chart patterns in price data: Head & Shoulders, Double Top/Bottom, triangles (ascending/descending/symmetric), Bull/Bear flags. Returns ChartBlock with pattern annotations. Use when user asks about chart patterns, technical structure, or price formations.',
	parameters: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT, ETHUSDT)' },
			interval: {
				type: 'string',
				enum: ['1d', '4h', '1h', '15m'],
				description: 'Candle interval (default: 1d)'
			},
			limit: { type: 'number', description: 'Number of candles to analyse (default 100, max 200)' },
		},
		required: ['symbol']
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'scan_chart_patterns' }],
				textSummary: 'Error: symbol required.'
			};
		}

		const symbol = String(args.symbol).toUpperCase();
		const interval = ['1d', '4h', '1h', '15m'].includes(String(args.interval)) ? String(args.interval) : '1d';
		const limit = Math.min(200, typeof args.limit === 'number' && args.limit > 0 ? args.limit : 100);

		const cacheKey = toolCache.generateKey('scan_chart_patterns', { symbol, interval, limit });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const ohlcvResult = await fetchBinanceOHLCV(symbol, interval, limit);
		if ('error' in ohlcvResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Failed to fetch data for ${symbol}: ${ohlcvResult.error}`, tool: 'scan_chart_patterns' }],
				textSummary: `Error: ${ohlcvResult.error}`
			};
		}

		const { ohlcv } = ohlcvResult;
		const { patterns } = scanPatterns(ohlcv);

		const contentBlocks: ToolResult['contentBlocks'] = [];

		// Chart block with pattern annotations
		contentBlocks.push({
			type: 'chart',
			chartType: 'candlestick',
			symbol,
			interval,
			data: ohlcv,
			patterns,
		});

		if (patterns.length === 0) {
			contentBlocks.push({
				type: 'metric_card',
				title: `Pattern Scan — ${symbol} (${interval})`,
				metrics: [{ label: 'Patterns Found', value: '0', direction: 'neutral' }]
			});
		} else {
			// Summary table
			contentBlocks.push({
				type: 'table',
				title: `Detected Patterns — ${symbol} (${interval})`,
				headers: ['Pattern', 'Direction', 'Confidence', 'Candle Range'],
				rows: patterns.slice(0, 5).map(p => [
					p.label,
					p.direction.toUpperCase(),
					`${(p.confidence * 100).toFixed(0)}%`,
					`${p.startIndex}–${p.endIndex}`,
				])
			});
		}

		const patternSummary = patterns.length > 0
			? patterns.slice(0, 3).map(p => `${p.label} (${p.direction}, ${(p.confidence * 100).toFixed(0)}%)`).join('; ')
			: 'No patterns detected';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Pattern scan for ${symbol} ${interval}: ${patternSummary}.`
		};

		toolCache.set(cacheKey, result, 30 * 60_000); // 30 min cache
		return result;
	}
});
