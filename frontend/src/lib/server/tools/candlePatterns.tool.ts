// Candlestick Pattern Scanner Tool — T-804
// Tool: scan_candlestick_patterns

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { detectPatterns, summarisePatterns } from '../indicators/candlePatterns';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_candlestick_patterns',
	description:
		'Scans recent OHLCV candles for classic Japanese candlestick patterns: Doji, Hammer, Shooting Star, Hanging Man, Inverted Hammer, Bullish/Bearish Engulfing, Bullish/Bearish Harami, Piercing Line, Dark Cloud Cover, Morning Star, Evening Star, Three White Soldiers, Three Black Crows, Marubozu. Each pattern is classified as bullish/bearish/neutral with confidence score. Returns MetricCard (bull vs bear count, overall signal) + patterns TableBlock. Use when asked about candlestick patterns, price action signals, or reversal/continuation setups.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Asset symbol (e.g. BTCUSDT, AAPL, SPY). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 15m, 1h, 4h, 1d. Default: 1d',
			},
			limit: {
				type: 'number',
				description: 'Number of candles to scan (default: 50, min: 10, max: 200)',
			},
		},
		required: [],
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol   = typeof args.symbol   === 'string' && args.symbol   ? args.symbol.toUpperCase() : 'BTCUSDT';
		const interval = typeof args.interval === 'string' && args.interval ? args.interval             : '1d';
		const limit    = Math.min(200, Math.max(10, typeof args.limit === 'number' ? args.limit : 50));

		const cacheKey = toolCache.generateKey('scan_candlestick_patterns', { symbol, interval, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV ────────────────────────────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'scan_candlestick_patterns' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < 3) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol}. Need at least 3 candles.`, tool: 'scan_candlestick_patterns' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		// Only look at last 30 candles to focus on recent patterns
		const recentCandles = candles.slice(-30);
		const matches       = detectPatterns(recentCandles);
		const summary       = summarisePatterns(matches);

		// ── MetricCard ─────────────────────────────────────────────────────────
		const signalLabel = summary.overallSignal === 'bullish' ? 'BULLISH BIAS' :
		                    summary.overallSignal === 'bearish' ? 'BEARISH BIAS' :
		                    'NEUTRAL / MIXED';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Candlestick Patterns — ${symbol} (${interval})`,
			metrics: [
				{
					label:     'Overall Signal',
					value:     signalLabel,
					change:    `${matches.length} pattern${matches.length !== 1 ? 's' : ''} detected in last ${recentCandles.length} candles`,
					direction: summary.overallSignal === 'bullish' ? 'up' :
					           summary.overallSignal === 'bearish' ? 'down' : 'neutral',
				},
				{
					label:     'Bullish Patterns',
					value:     summary.bullishCount.toString(),
					change:    summary.bullishCount > 0 ? 'Reversal / continuation bullish signals' : 'No bullish signals',
					direction: 'up',
				},
				{
					label:     'Bearish Patterns',
					value:     summary.bearishCount.toString(),
					change:    summary.bearishCount > 0 ? 'Reversal / continuation bearish signals' : 'No bearish signals',
					direction: 'down',
				},
				{
					label:     'Neutral / Indecision',
					value:     summary.neutralCount.toString(),
					change:    'Doji or inside bars — wait for confirmation',
					direction: 'neutral',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		if (matches.length === 0) {
			const noPatterns: TableBlock = {
				type:    'table',
				title:   `Pattern Scan — ${symbol}`,
				headers: ['Result'],
				rows:    [['No significant candlestick patterns detected in the recent candles.']],
			};
			contentBlocks.push(noPatterns);
		} else {
			// Sort by most recent first, then by confidence
			const sorted = [...matches].sort((a, b) => b.index - a.index || b.confidence - a.confidence);

			const patternTable: TableBlock = {
				type:    'table',
				title:   `Detected Patterns — ${symbol} (${interval}, last ${recentCandles.length} candles)`,
				headers: ['Pattern', 'Signal', 'Confidence', 'Bars Ago', 'Description'],
				rows:    sorted.map(m => [
					m.pattern,
					m.signal.toUpperCase(),
					`${(m.confidence * 100).toFixed(0)}%`,
					`${recentCandles.length - 1 - m.index}`,
					m.description,
				]),
			};
			contentBlocks.push(patternTable);
		}

		const topPattern = matches
			.sort((a, b) => b.confidence - a.confidence)[0];

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} (${interval}): ${matches.length} pattern${matches.length !== 1 ? 's' : ''} detected — ${summary.bullishCount} bullish, ${summary.bearishCount} bearish, ${summary.neutralCount} neutral. Overall: ${signalLabel}.${topPattern ? ` Strongest: ${topPattern.pattern} (${(topPattern.confidence * 100).toFixed(0)}% confidence, ${recentCandles.length - 1 - topPattern.index} bars ago).` : ''}`,
			sources: [{ name: 'Candlestick Pattern Analysis', url: 'https://www.investopedia.com/articles/technical/112601.asp', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5 min cache
		return result;
	},
});
