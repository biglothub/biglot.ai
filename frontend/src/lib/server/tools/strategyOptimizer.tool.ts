// Strategy Optimizer Tool — T-505
// Grid-searches strategy parameters and classifies overfit risk
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	runGridSearch,
	extractOptimizableParams,
	type OptimizableParam,
} from '../backtest/optimizer';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import { validateStrategy } from '../strategy.server';
import type { Strategy } from '$lib/types/strategy';

registerTool({
	name: 'optimize_strategy',
	description:
		'Grid-search optimize a trading strategy\'s parameters (entry thresholds, stop-loss, take-profit). Returns ranked parameter combinations with robustness scores and overfit risk assessment. Use when user asks to optimize, tune, or find best parameters for a strategy.',
	parameters: {
		type: 'object',
		properties: {
			strategy: {
				type: 'object',
				description: 'Full strategy JSON object (same format as strategy definition schema)',
			},
			symbol: {
				type: 'string',
				description: 'Trading symbol to backtest on, e.g. BTCUSDT',
			},
			timeframe: {
				type: 'string',
				description: 'Candle timeframe (default: strategy timeframe or 1d)',
			},
			initial_capital: {
				type: 'number',
				description: 'Starting capital in USD (default: 10000)',
			},
			max_runs: {
				type: 'number',
				description: 'Max parameter combinations to test (default: 50, max: 200)',
			},
		},
		required: ['strategy', 'symbol'],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const strategy = args.strategy as Strategy | undefined;
		const symbol = typeof args.symbol === 'string' ? args.symbol.toUpperCase().trim() : '';

		if (!strategy || typeof strategy !== 'object') {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'strategy (object) is required.', tool: 'optimize_strategy' }],
				textSummary: 'Error: strategy object is required.',
			};
		}
		if (!symbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'optimize_strategy' }],
				textSummary: 'Error: symbol required.',
			};
		}

		const validation = validateStrategy(strategy);
		if (!validation.valid) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Invalid strategy: ${validation.errors.join('; ')}`,
					tool: 'optimize_strategy',
				}],
				textSummary: `Invalid strategy: ${validation.errors[0]}`,
			};
		}

		const timeframe = typeof args.timeframe === 'string' ? args.timeframe : (strategy.timeframe ?? '1d');
		const initialCapital = typeof args.initial_capital === 'number' && args.initial_capital > 0
			? args.initial_capital
			: 10_000;
		const maxRuns = typeof args.max_runs === 'number'
			? Math.min(200, Math.max(1, args.max_runs))
			: 50;

		const cacheKey = toolCache.generateKey('optimize_strategy', { strategy, symbol, timeframe, initialCapital, maxRuns });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Fetch OHLCV data
		let ohlcv;
		try {
			const ohlcvResult = await fetchBinanceOHLCV(symbol, timeframe, 500);
			if ('error' in ohlcvResult) throw new Error(ohlcvResult.error);
			ohlcv = ohlcvResult.ohlcv;
		} catch (e) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Failed to fetch price data for ${symbol}: ${e instanceof Error ? e.message : 'unknown'}`,
					tool: 'optimize_strategy',
				}],
				textSummary: `Error: Could not fetch OHLCV for ${symbol}.`,
			};
		}

		if (ohlcv.length < 50) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Insufficient data for ${symbol}: need at least 50 candles.`,
					tool: 'optimize_strategy',
				}],
				textSummary: `Error: Not enough data for ${symbol}.`,
			};
		}

		const params: OptimizableParam[] = extractOptimizableParams(strategy);
		const optimResult = runGridSearch({ strategy, ohlcv, symbol, params, maxPoints: maxRuns });

		const riskColor = optimResult.overfitRisk === 'low' ? '#22c55e'
			: optimResult.overfitRisk === 'medium' ? '#eab308'
			: '#ef4444';

		// Metrics card for best result
		const best = optimResult.topResults[0];
		const metricsBlock: ToolResult['contentBlocks'][number] = {
			type: 'metric_card',
			title: `Optimizer — ${strategy.name} on ${symbol}`,
			metrics: [
				{ label: 'Total Runs', value: String(optimResult.grid.length), direction: 'neutral' },
				{ label: 'Overfit Risk', value: optimResult.overfitRisk.toUpperCase(), direction: optimResult.overfitRisk === 'low' ? 'up' : 'down' },
				{ label: 'Robustness', value: `${(optimResult.robustnessScore * 100).toFixed(0)}%`, direction: optimResult.robustnessScore >= 0.7 ? 'up' : 'down' },
				...(best ? [
					{ label: 'Best Score', value: best.score.toFixed(3), direction: 'up' as const },
					{ label: 'Best Win Rate', value: `${best.metrics.winRate.toFixed(1)}%`, direction: 'up' as const },
					{ label: 'Best Sharpe', value: best.metrics.sharpe.toFixed(2), direction: 'neutral' as const },
				] : []),
			],
		};

		// Table of top 5 results
		const topRows = optimResult.topResults.map(r => {
			const paramSummary = Object.entries(r.params)
				.map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`)
				.join(', ') || '(baseline)';
			return [
				paramSummary,
				r.score.toFixed(3),
				`${r.metrics.winRate.toFixed(1)}%`,
				r.metrics.sharpe.toFixed(2),
				`${r.metrics.maxDrawdown.toFixed(1)}%`,
				String(r.tradeCount),
			];
		});

		const contentBlocks: ToolResult['contentBlocks'] = [metricsBlock];

		if (topRows.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Top Parameter Combinations',
				headers: ['Parameters', 'Score', 'Win Rate', 'Sharpe', 'Max DD', 'Trades'],
				rows: topRows,
			});
		}

		if (optimResult.overfitRisk !== 'low') {
			contentBlocks.push({
				type: 'table',
				title: 'Warnings',
				headers: ['Warning'],
				rows: [
					[`Overfit risk: ${optimResult.overfitRisk.toUpperCase()} — validate on fresh data before live use.`],
					...optimResult.grid.length < 10 ? [['Too few parameter combinations tested — expand the parameter grid for reliable analysis.']] : [],
				],
			});
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: optimResult.suggestion,
		};

		toolCache.set(cacheKey, result, 300_000); // 5 min cache
		return result;
	},
});
