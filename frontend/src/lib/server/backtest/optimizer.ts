// Strategy Optimizer — T-505
// Grid search over strategy parameters + robustness scoring.
// The tool returns findings for the LLM to interpret.

import { runBacktest } from './engine';
import type { BacktestMetrics, BacktestResult } from '$lib/types/backtest';
import type { Strategy, IndicatorCondition, StopLossExit, TakeProfitExit } from '$lib/types/strategy';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OptimizableParam = {
	/** Human-readable label, e.g. "RSI threshold" */
	label: string;
	/** Minimum value to test */
	min: number;
	/** Maximum value to test */
	max: number;
	/** Increment between values */
	step: number;
	/**
	 * Type of parameter:
	 * - 'entry_threshold': IndicatorCondition threshold in entry conditions
	 * - 'stop_loss': stop-loss exit value
	 * - 'take_profit': take-profit exit value
	 */
	type: 'entry_threshold' | 'stop_loss' | 'take_profit';
	/** Zero-based index into the relevant conditions or exits array */
	index?: number;
};

export type GridPoint = {
	params: Record<string, number>;
	metrics: BacktestMetrics;
	tradeCount: number;
	score: number;
};

export type OverfitRisk = 'low' | 'medium' | 'high';

export type OptimizationResult = {
	strategy: Strategy;
	symbol: string;
	bestParams: Record<string, number>;
	grid: GridPoint[];
	robustnessScore: number;  // 0–1; higher = more stable
	overfitRisk: OverfitRisk;
	topResults: GridPoint[];  // top 5 by score
	suggestion: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Composite score: prioritises Sharpe, rewards high win rate and positive
 * profit factor, penalises large drawdown and too few trades.
 */
export function scoreMetrics(metrics: BacktestMetrics): number {
	if (metrics.totalTrades < 5) return 0; // too few trades — unreliable
	const sharpePart = Math.max(0, metrics.sharpe) * 0.4;
	const winPart = (metrics.winRate / 100) * 0.2;
	const pfPart = Math.min(metrics.profitFactor, 5) / 5 * 0.2;
	const ddPenalty = Math.min(metrics.maxDrawdown / 100, 1) * 0.2;
	return sharpePart + winPart + pfPart - ddPenalty;
}

/**
 * Robustness score (0–1): measures how consistently good the scores are
 * within ±2 steps of the best parameter set. High score → stable region.
 */
export function computeRobustness(grid: GridPoint[], bestScore: number): number {
	if (bestScore <= 0) return 0;
	if (grid.length <= 1) return 1;
	const near = grid.filter(p => Math.abs(p.score - bestScore) <= bestScore * 0.3);
	if (near.length === 0) return 0;
	const avgNear = near.reduce((s, p) => s + p.score, 0) / near.length;
	return bestScore > 0 ? Math.min(1, avgNear / bestScore) : 0;
}

/**
 * Classify overfit risk from the backtest result and robustness score.
 * High risk: few trades, high Sharpe but low robustness.
 */
export function classifyOverfitRisk(result: BacktestResult, robustness: number): OverfitRisk {
	const { metrics } = result;
	if (metrics.totalTrades < 10 && metrics.sharpe > 2) return 'high';
	if (robustness < 0.4) return 'high';
	if (robustness < 0.7 || metrics.totalTrades < 20) return 'medium';
	return 'low';
}

/**
 * Build a suggestion string based on the optimization outcome.
 */
export function buildSuggestion(result: OptimizationResult): string {
	const { overfitRisk, robustnessScore, topResults } = result;
	const best = topResults[0];
	if (!best) return 'Insufficient data to make a recommendation.';

	const riskLabel = overfitRisk === 'low' ? 'Low' : overfitRisk === 'medium' ? 'Moderate' : 'High';
	const paramSummary = Object.entries(best.params)
		.map(([k, v]) => `${k}=${v.toFixed(2)}`)
		.join(', ');

	return [
		`Best parameters: ${paramSummary} (score ${best.score.toFixed(3)}).`,
		`Robustness: ${(robustnessScore * 100).toFixed(0)}% — ${riskLabel} overfit risk.`,
		overfitRisk === 'high'
			? 'Warning: performance is sensitive to parameter choice — likely overfit. Consider more data or simpler conditions.'
			: overfitRisk === 'medium'
				? 'Performance varies near the optimum. Validate on fresh data before live use.'
				: 'Strategy shows stable performance across parameter variations.',
	].join(' ');
}

// ─── Strategy mutation helpers ────────────────────────────────────────────────

/**
 * Apply a single parameter value to a deep-cloned strategy.
 * Supports entry threshold, stop-loss, and take-profit mutations.
 */
export function applyParam(strategy: Strategy, param: OptimizableParam, value: number): Strategy {
	// Deep-clone to avoid mutation
	const s: Strategy = JSON.parse(JSON.stringify(strategy));
	const idx = param.index ?? 0;

	if (param.type === 'entry_threshold') {
		const allConditions: IndicatorCondition[] = [];
		for (const group of s.entry?.groups ?? []) {
			for (const cond of group.conditions) {
				allConditions.push(cond);
			}
		}
		if (allConditions[idx]) {
			allConditions[idx].threshold = value;
		}
	} else if (param.type === 'stop_loss') {
		const sl = s.exit?.find(e => e.type === 'stop_loss') as StopLossExit | undefined;
		if (sl) sl.value = value;
	} else if (param.type === 'take_profit') {
		const tp = s.exit?.find(e => e.type === 'take_profit') as TakeProfitExit | undefined;
		if (tp) tp.value = value;
	}

	return s;
}

/**
 * Extract default optimizable parameters from a strategy.
 * Returns params for the first numeric entry threshold, stop-loss, and take-profit.
 */
export function extractOptimizableParams(strategy: Strategy): OptimizableParam[] {
	const params: OptimizableParam[] = [];

	// Entry conditions
	let condIdx = 0;
	for (const group of strategy.entry?.groups ?? []) {
		for (const cond of group.conditions) {
			if (typeof cond.threshold === 'number' && condIdx === 0) {
				const base = cond.threshold;
				params.push({
					label: `${cond.indicator} threshold`,
					type: 'entry_threshold',
					index: condIdx,
					min: Math.max(1, base * 0.5),
					max: base * 1.5,
					step: Math.max(1, Math.round(base * 0.1)),
				});
			}
			condIdx++;
		}
	}

	// Stop-loss
	const sl = strategy.exit?.find(e => e.type === 'stop_loss') as StopLossExit | undefined;
	if (sl) {
		const base = sl.value;
		params.push({
			label: 'stop loss',
			type: 'stop_loss',
			min: Math.max(0.5, base * 0.5),
			max: base * 2,
			step: Math.max(0.5, base * 0.25),
		});
	}

	// Take-profit
	const tp = strategy.exit?.find(e => e.type === 'take_profit') as TakeProfitExit | undefined;
	if (tp) {
		const base = tp.value;
		params.push({
			label: 'take profit',
			type: 'take_profit',
			min: Math.max(1, base * 0.5),
			max: base * 2,
			step: Math.max(0.5, base * 0.25),
		});
	}

	return params;
}

/**
 * Generate all values in [min, max] at `step` intervals (inclusive of both ends).
 */
export function paramRange(param: OptimizableParam): number[] {
	const values: number[] = [];
	for (let v = param.min; v <= param.max + param.step * 0.01; v += param.step) {
		values.push(Math.round(v * 100) / 100);
	}
	return values;
}

// ─── Grid search ──────────────────────────────────────────────────────────────

export type GridSearchConfig = {
	strategy: Strategy;
	ohlcv: OHLCV[];
	symbol: string;
	/** Parameters to vary. Defaults to extractOptimizableParams(strategy). */
	params?: OptimizableParam[];
	/** Cap the grid to avoid combinatorial explosion (default 200). */
	maxPoints?: number;
};

/**
 * Run a grid search over the given parameters.
 * For multi-param grids, one parameter is varied at a time while others stay at baseline.
 * Full cartesian product is only used when the total is ≤ maxPoints.
 */
export function runGridSearch(config: GridSearchConfig): OptimizationResult {
	const { strategy, ohlcv, symbol } = config;
	const params = config.params ?? extractOptimizableParams(strategy);
	const maxPoints = config.maxPoints ?? 200;

	if (params.length === 0 || ohlcv.length < 50) {
		const baseline = runBacktest({ strategy, ohlcv, symbol });
		const score = scoreMetrics(baseline.metrics);
		const gridPoint: GridPoint = { params: {}, metrics: baseline.metrics, tradeCount: baseline.metrics.totalTrades, score };
		return {
			strategy,
			symbol,
			bestParams: {},
			grid: [gridPoint],
			robustnessScore: 1,
			overfitRisk: classifyOverfitRisk(baseline, 1),
			topResults: [gridPoint],
			suggestion: buildSuggestion({ strategy, symbol, bestParams: {}, grid: [gridPoint], robustnessScore: 1, overfitRisk: 'low', topResults: [gridPoint], suggestion: '' }),
		};
	}

	// Build grid: vary one param at a time (axis-aligned search)
	const allPoints: GridPoint[] = [];
	const baselineStrategy = strategy;

	for (const param of params) {
		const range = paramRange(param);
		if (allPoints.length + range.length > maxPoints) break;

		for (const value of range) {
			const mutated = applyParam(baselineStrategy, param, value);
			try {
				const result = runBacktest({ strategy: mutated, ohlcv, symbol });
				const score = scoreMetrics(result.metrics);
				allPoints.push({
					params: { [param.label]: value },
					metrics: result.metrics,
					tradeCount: result.metrics.totalTrades,
					score,
				});
			} catch {
				// Skip invalid parameter combinations
			}
		}
	}

	if (allPoints.length === 0) {
		const baseline = runBacktest({ strategy, ohlcv, symbol });
		const score = scoreMetrics(baseline.metrics);
		const gp: GridPoint = { params: {}, metrics: baseline.metrics, tradeCount: baseline.metrics.totalTrades, score };
		return { strategy, symbol, bestParams: {}, grid: [gp], robustnessScore: 0, overfitRisk: 'high', topResults: [gp], suggestion: 'No valid parameter combinations found.' };
	}

	const sorted = [...allPoints].sort((a, b) => b.score - a.score);
	const best = sorted[0];
	const robustnessScore = computeRobustness(allPoints, best.score);

	// Run the best params to get the full result for overfit classification
	let bestResult: BacktestResult;
	try {
		const bestParam = params[0];
		const bestValue = best.params[bestParam.label];
		const bestStrategy = applyParam(strategy, bestParam, bestValue);
		bestResult = runBacktest({ strategy: bestStrategy, ohlcv, symbol });
	} catch {
		bestResult = runBacktest({ strategy, ohlcv, symbol });
	}

	const overfitRisk = classifyOverfitRisk(bestResult, robustnessScore);
	const topResults = sorted.slice(0, 5);

	const partial: OptimizationResult = {
		strategy,
		symbol,
		bestParams: best.params,
		grid: allPoints,
		robustnessScore,
		overfitRisk,
		topResults,
		suggestion: '',
	};
	partial.suggestion = buildSuggestion(partial);
	return partial;
}
