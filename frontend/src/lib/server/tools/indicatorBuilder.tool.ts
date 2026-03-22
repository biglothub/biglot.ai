// Indicator Builder Tool — T-1405
// Tool: build_indicator — NL description → composable indicator + PineScript v6 + signals on chart

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchOHLCV } from '../data/ohlcvProvider';
import {
	parseIndicatorDescription,
	computeSignals,
	buildChartSeries,
	generatePineScript,
} from '../data/indicatorBuilder.data';
import type { MetricCardBlock, ChartBlock } from '$lib/types/contentBlock';

const VALID_INTERVALS = new Set(['1m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']);

registerTool({
	name: 'build_indicator',
	description:
		'Custom Indicator Builder — translate a natural-language indicator description into a working indicator. Parses expressions like "EMA 20 crossover EMA 50", "RSI below 30", "MACD crossover Signal", "EMA 20 crossover EMA 50 + RSI below 30" (combine with +). Computes signals on recent OHLCV data and generates ready-to-use PineScript v6 code. Returns ChartBlock (indicator overlaid on price with signal markers), MetricCard (signal count, current state), and TextBlock (PineScript v6 code).',
	parameters: {
		type: 'object',
		properties: {
			description: {
				type: 'string',
				description:
					'Natural-language indicator description. Examples: "EMA 20 crossover EMA 50", "RSI below 30", "EMA 20 crossover EMA 50 + RSI below 30", "MACD crossover Signal", "Price above SMA 200 + RSI above 50".',
			},
			symbol: {
				type: 'string',
				description: 'Asset to test on (e.g. BTC, ETHUSDT, XAUUSD, EURUSD). Default: BTCUSDT',
			},
			interval: {
				type: 'string',
				enum: ['1h', '4h', '1d', '1w'],
				description: 'Timeframe for testing. Default: 4h',
			},
			signal_direction: {
				type: 'string',
				enum: ['buy', 'sell', 'both'],
				description:
					'Whether to generate buy signals, sell signals, or both. Default: auto-detected from operators (crossover→buy, crossunder→sell).',
			},
		},
		required: ['description'],
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const description = typeof args.description === 'string' ? args.description.trim() : '';
		const rawSymbol = typeof args.symbol === 'string' && args.symbol ? args.symbol.trim() : 'BTC';
		const rawInterval = typeof args.interval === 'string' ? args.interval : '4h';
		const interval = VALID_INTERVALS.has(rawInterval) ? rawInterval : '4h';
		const signalDir: 'buy' | 'sell' | 'both' =
			args.signal_direction === 'sell' ? 'sell' :
			args.signal_direction === 'both' ? 'both' : 'buy';

		if (!description) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: 'Please provide an indicator description (e.g. "EMA 20 crossover EMA 50").',
					tool: 'build_indicator',
				}],
				textSummary: 'Error: No indicator description provided.',
			};
		}

		const cacheKey = toolCache.generateKey('build_indicator', { description, rawSymbol, interval, signalDir });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Parse conditions from NL description
		const conditions = parseIndicatorDescription(description);

		if (conditions.length === 0) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message:
						`Could not parse indicator from: "${description}". ` +
						`Try formats like "EMA 20 crossover EMA 50", "RSI below 30", or "MACD crossover Signal".`,
					tool: 'build_indicator',
				}],
				textSummary: `Error: Could not parse indicator description "${description}".`,
			};
		}

		// Fetch OHLCV
		const providerResult = await fetchOHLCV(rawSymbol, interval, 300);
		if ('error' in providerResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: providerResult.error, tool: 'build_indicator' }],
				textSummary: `Error fetching data: ${providerResult.error}`,
			};
		}

		const { ohlcv, displayName } = providerResult;

		if (ohlcv.length < 2) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Insufficient data for ${displayName}`,
					tool: 'build_indicator',
				}],
				textSummary: `Error: Insufficient data for ${displayName}.`,
			};
		}

		// Compute signals
		const { signals, seriesMap, currentlyActive } = computeSignals(ohlcv, conditions, signalDir);

		// Display last 100 candles
		const displayData = ohlcv.slice(-100);
		const fromTime = displayData[0].time;

		// Build chart indicators
		const chartIndicators = buildChartSeries(seriesMap, conditions, fromTime);

		// Build signal markers for display window
		const markers = signals
			.filter((s) => s.time >= fromTime)
			.map((s) => {
				const bar = ohlcv[s.barIndex];
				return {
					time: s.time,
					price: bar ? (s.type === 'buy' ? bar.low * 0.999 : bar.high * 1.001) : 0,
					label: s.type === 'buy' ? 'B' : 'S',
					color: s.type === 'buy' ? '#22c55e' : '#ef4444',
					shape: (s.type === 'buy' ? 'arrow_up' : 'arrow_down') as 'arrow_up' | 'arrow_down',
				};
			});

		// Generate PineScript
		const pineScript = generatePineScript(description, conditions, signalDir);

		// Stats
		const signalsInWindow = signals.filter((s) => s.time >= fromTime).length;
		const lastSignal = signals.length > 0 ? signals[signals.length - 1] : null;
		const lastSignalDate = lastSignal
			? new Date(lastSignal.time * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
			: 'None';

		// Count signals per direction
		const buyCount = signals.filter((s) => s.type === 'buy').length;
		const sellCount = signals.filter((s) => s.type === 'sell').length;

		const metricCard: MetricCardBlock = {
			type: 'metric_card',
			title: `Custom Indicator`,
			metrics: [
				{
					label: 'Description',
					value: description.length > 35 ? description.substring(0, 32) + '...' : description,
					direction: 'neutral',
				},
				{
					label: 'Current State',
					value: currentlyActive ? 'Active' : 'Inactive',
					direction: currentlyActive ? 'up' : 'neutral',
				},
				{
					label: 'Signals (100 bars)',
					value: `${signalsInWindow}`,
					change: buyCount > 0 && sellCount > 0
						? `${buyCount} buy / ${sellCount} sell`
						: buyCount > 0 ? `${buyCount} buy` : sellCount > 0 ? `${sellCount} sell` : '',
					direction: signalsInWindow > 0 ? 'up' : 'neutral',
				},
				{
					label: 'Last Signal',
					value: lastSignalDate,
					direction: 'neutral',
				},
				{
					label: 'Conditions',
					value: `${conditions.length}`,
					direction: 'neutral',
				},
			],
		};

		const chartBlock: ChartBlock = {
			type: 'chart',
			chartType: 'candlestick',
			symbol: displayName,
			interval,
			data: displayData,
			indicators: chartIndicators.map((s) => ({
				name: s.name,
				data: s.data,
				color: s.color,
				overlay: s.overlay,
			})),
			markers,
		};

		const conditionSummary = conditions.map((c) => {
			const lLabel = c.left.kind === 'price' ? 'Price' :
				`${c.left.kind.toUpperCase().replace('_', ' ')}${c.left.period ? `(${c.left.period})` : ''}`;
			const opLabel = c.operator.replace('_', ' ');
			const rLabel = c.right.kind === 'value'
				? String(c.right.value)
				: `${c.right.kind.toUpperCase().replace('_', ' ')}${c.right.period ? `(${c.right.period})` : ''}`;
			return `${lLabel} ${opLabel} ${rLabel}`;
		}).join(' AND ');

		const pineBlock = {
			type: 'text' as const,
			content: [
				`**PineScript v6 Code** — paste into TradingView Pine Editor:`,
				'',
				'```pine',
				pineScript,
				'```',
			].join('\n'),
		};

		const result: ToolResult = {
			success: true,
			contentBlocks: [chartBlock, metricCard, pineBlock],
			textSummary:
				`Custom indicator built for ${displayName} (${interval}): "${description}". ` +
				`Parsed ${conditions.length} condition(s): ${conditionSummary}. ` +
				`Signals in last 100 bars: ${signalsInWindow} (${buyCount} buy, ${sellCount} sell). ` +
				`Current state: ${currentlyActive ? 'Active' : 'Inactive'}. ` +
				`PineScript v6 code generated.`,
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	},
});
