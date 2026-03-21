// Strategy Optimizer tests — T-505
import { describe, it, expect, vi } from 'vitest';
import {
	scoreMetrics,
	computeRobustness,
	classifyOverfitRisk,
	buildSuggestion,
	applyParam,
	extractOptimizableParams,
	paramRange,
	runGridSearch,
	type OptimizableParam,
	type GridPoint,
	type OptimizationResult,
} from './optimizer';
import type { BacktestMetrics, BacktestResult } from '$lib/types/backtest';
import type { Strategy } from '$lib/types/strategy';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMetrics(overrides: Partial<BacktestMetrics> = {}): BacktestMetrics {
	return {
		totalReturn: 20,
		cagr: 15,
		maxDrawdown: 10,
		sharpe: 1.5,
		sortino: 2.0,
		winRate: 55,
		avgRMultiple: 1.2,
		profitFactor: 1.8,
		maxConsecutiveLosses: 3,
		totalTrades: 30,
		profitableTrades: 17,
		losingTrades: 13,
		avgWin: 2.5,
		avgLoss: -1.5,
		expectancy: 180,
		...overrides,
	};
}

function makeStrategy(overrides: Partial<Strategy> = {}): Strategy {
	return {
		id: 's1',
		biglotUserId: 'u1',
		name: 'Test',
		version: 1,
		isActive: true,
		timeframe: '4h',
		entry: {
			direction: 'long',
			groups: [{
				logic: 'AND',
				conditions: [{ indicator: 'rsi', operator: '<', threshold: 30 }],
			}],
		},
		exit: [
			{ type: 'stop_loss', value: 2, unit: 'pct' },
			{ type: 'take_profit', value: 6, unit: 'pct' },
		],
		positionSizing: { method: 'fixed_fractional', riskPerTrade: 1 },
		risk: { maxDrawdownPct: 20, maxOpenPositions: 3 },
		...overrides,
	};
}

function makeResult(metrics?: Partial<BacktestMetrics>): BacktestResult {
	return {
		strategy: makeStrategy(),
		symbol: 'BTCUSDT',
		startTime: 0,
		endTime: 100,
		initialCapital: 10000,
		finalCapital: 12000,
		trades: [],
		equity: [],
		metrics: makeMetrics(metrics),
	};
}

function makeOHLCV(n = 200): OHLCV[] {
	return Array.from({ length: n }, (_, i) => ({
		time: 1700000000 + i * 3600,
		open: 50000 + i * 10,
		high: 50500 + i * 10,
		low: 49500 + i * 10,
		close: 50200 + i * 10,
		volume: 100,
	}));
}

// ─── scoreMetrics ─────────────────────────────────────────────────────────────

describe('scoreMetrics', () => {
	it('returns 0 for fewer than 5 trades', () => {
		expect(scoreMetrics(makeMetrics({ totalTrades: 4 }))).toBe(0);
	});

	it('scores higher for higher Sharpe', () => {
		const low = scoreMetrics(makeMetrics({ sharpe: 0.5 }));
		const high = scoreMetrics(makeMetrics({ sharpe: 2.0 }));
		expect(high).toBeGreaterThan(low);
	});

	it('penalises high drawdown', () => {
		const lowDD = scoreMetrics(makeMetrics({ maxDrawdown: 5 }));
		const highDD = scoreMetrics(makeMetrics({ maxDrawdown: 50 }));
		expect(lowDD).toBeGreaterThan(highDD);
	});

	it('rewards higher win rate', () => {
		const low = scoreMetrics(makeMetrics({ winRate: 30 }));
		const high = scoreMetrics(makeMetrics({ winRate: 70 }));
		expect(high).toBeGreaterThan(low);
	});

	it('caps profit factor contribution at 5', () => {
		const pf5 = scoreMetrics(makeMetrics({ profitFactor: 5 }));
		const pf10 = scoreMetrics(makeMetrics({ profitFactor: 10 }));
		expect(pf5).toBeCloseTo(pf10, 5); // both capped at 5
	});
});

// ─── computeRobustness ────────────────────────────────────────────────────────

describe('computeRobustness', () => {
	it('returns 1 for a single-point grid', () => {
		const grid: GridPoint[] = [{ params: {}, metrics: makeMetrics(), tradeCount: 30, score: 0.5 }];
		expect(computeRobustness(grid, 0.5)).toBe(1);
	});

	it('returns higher score when nearby points are close in score', () => {
		const grid: GridPoint[] = [
			{ params: {}, metrics: makeMetrics(), tradeCount: 30, score: 0.5 },
			{ params: {}, metrics: makeMetrics(), tradeCount: 30, score: 0.48 },
			{ params: {}, metrics: makeMetrics(), tradeCount: 30, score: 0.1 },
		];
		const r = computeRobustness(grid, 0.5);
		expect(r).toBeGreaterThan(0);
		expect(r).toBeLessThanOrEqual(1);
	});

	it('returns 0 when best score is 0', () => {
		const grid: GridPoint[] = [
			{ params: {}, metrics: makeMetrics(), tradeCount: 30, score: 0 },
		];
		expect(computeRobustness(grid, 0)).toBe(0);
	});
});

// ─── classifyOverfitRisk ─────────────────────────────────────────────────────

describe('classifyOverfitRisk', () => {
	it('classifies high risk for few trades + high Sharpe', () => {
		const result = makeResult({ totalTrades: 5, sharpe: 3 });
		expect(classifyOverfitRisk(result, 0.8)).toBe('high');
	});

	it('classifies high risk for low robustness', () => {
		const result = makeResult({ totalTrades: 50, sharpe: 1 });
		expect(classifyOverfitRisk(result, 0.2)).toBe('high');
	});

	it('classifies medium risk for moderate conditions', () => {
		const result = makeResult({ totalTrades: 15, sharpe: 1.5 });
		expect(classifyOverfitRisk(result, 0.6)).toBe('medium');
	});

	it('classifies low risk for good conditions', () => {
		const result = makeResult({ totalTrades: 50, sharpe: 1.5 });
		expect(classifyOverfitRisk(result, 0.8)).toBe('low');
	});
});

// ─── buildSuggestion ─────────────────────────────────────────────────────────

describe('buildSuggestion', () => {
	function makeOptResult(overrides: Partial<OptimizationResult> = {}): OptimizationResult {
		const gp: GridPoint = { params: { 'rsi threshold': 30 }, metrics: makeMetrics(), tradeCount: 30, score: 0.5 };
		return {
			strategy: makeStrategy(),
			symbol: 'BTCUSDT',
			bestParams: { 'rsi threshold': 30 },
			grid: [gp],
			robustnessScore: 0.8,
			overfitRisk: 'low',
			topResults: [gp],
			suggestion: '',
			...overrides,
		};
	}

	it('includes best param values', () => {
		const s = buildSuggestion(makeOptResult());
		expect(s).toContain('rsi threshold');
	});

	it('mentions high overfit risk', () => {
		const s = buildSuggestion(makeOptResult({ overfitRisk: 'high' }));
		expect(s).toContain('Warning');
	});

	it('returns fallback for empty topResults', () => {
		const s = buildSuggestion(makeOptResult({ topResults: [] }));
		expect(s).toContain('Insufficient');
	});
});

// ─── applyParam ──────────────────────────────────────────────────────────────

describe('applyParam', () => {
	it('mutates entry threshold', () => {
		const strategy = makeStrategy();
		const param: OptimizableParam = { label: 'rsi', type: 'entry_threshold', index: 0, min: 20, max: 40, step: 5 };
		const result = applyParam(strategy, param, 25);
		expect(result.entry?.groups[0].conditions[0].threshold).toBe(25);
	});

	it('does not mutate original strategy', () => {
		const strategy = makeStrategy();
		const original = strategy.entry!.groups[0].conditions[0].threshold;
		const param: OptimizableParam = { label: 'rsi', type: 'entry_threshold', index: 0, min: 20, max: 40, step: 5 };
		applyParam(strategy, param, 25);
		expect(strategy.entry?.groups[0].conditions[0].threshold).toBe(original);
	});

	it('mutates stop-loss value', () => {
		const strategy = makeStrategy();
		const param: OptimizableParam = { label: 'stop loss', type: 'stop_loss', min: 1, max: 4, step: 0.5 };
		const result = applyParam(strategy, param, 3);
		const sl = result.exit!.find(e => e.type === 'stop_loss') as { value: number };
		expect(sl.value).toBe(3);
	});

	it('mutates take-profit value', () => {
		const strategy = makeStrategy();
		const param: OptimizableParam = { label: 'take profit', type: 'take_profit', min: 4, max: 12, step: 1 };
		const result = applyParam(strategy, param, 9);
		const tp = result.exit!.find(e => e.type === 'take_profit') as { value: number };
		expect(tp.value).toBe(9);
	});
});

// ─── extractOptimizableParams ────────────────────────────────────────────────

describe('extractOptimizableParams', () => {
	it('extracts entry threshold param', () => {
		const params = extractOptimizableParams(makeStrategy());
		const entryParam = params.find(p => p.type === 'entry_threshold');
		expect(entryParam).toBeDefined();
		expect(entryParam!.label).toContain('rsi');
	});

	it('extracts stop-loss param', () => {
		const params = extractOptimizableParams(makeStrategy());
		expect(params.some(p => p.type === 'stop_loss')).toBe(true);
	});

	it('extracts take-profit param', () => {
		const params = extractOptimizableParams(makeStrategy());
		expect(params.some(p => p.type === 'take_profit')).toBe(true);
	});

	it('returns empty array for strategy with no conditions', () => {
		const strategy = makeStrategy({ entry: { direction: 'long', groups: [] }, exit: [] });
		const params = extractOptimizableParams(strategy);
		expect(params).toHaveLength(0);
	});
});

// ─── paramRange ──────────────────────────────────────────────────────────────

describe('paramRange', () => {
	it('generates values from min to max inclusive', () => {
		const param: OptimizableParam = { label: 'x', type: 'stop_loss', min: 1, max: 3, step: 1 };
		expect(paramRange(param)).toEqual([1, 2, 3]);
	});

	it('handles fractional steps', () => {
		const param: OptimizableParam = { label: 'x', type: 'stop_loss', min: 1, max: 2, step: 0.5 };
		expect(paramRange(param)).toEqual([1, 1.5, 2]);
	});

	it('returns single-element array when min equals max', () => {
		const param: OptimizableParam = { label: 'x', type: 'stop_loss', min: 2, max: 2, step: 1 };
		expect(paramRange(param)).toHaveLength(1);
	});
});

// ─── runGridSearch ───────────────────────────────────────────────────────────

describe('runGridSearch', () => {
	it('returns a result with bestParams and grid', () => {
		const strategy = makeStrategy();
		const ohlcv = makeOHLCV(200);
		const params: OptimizableParam[] = [
			{ label: 'stop loss', type: 'stop_loss', min: 1, max: 3, step: 1 },
		];
		const result = runGridSearch({ strategy, ohlcv, symbol: 'BTCUSDT', params });
		expect(result.grid.length).toBeGreaterThan(0);
		expect(typeof result.robustnessScore).toBe('number');
		expect(['low', 'medium', 'high']).toContain(result.overfitRisk);
	});

	it('returns baseline result when params array is empty', () => {
		const strategy = makeStrategy();
		const ohlcv = makeOHLCV(200);
		const result = runGridSearch({ strategy, ohlcv, symbol: 'BTCUSDT', params: [] });
		expect(result.grid).toHaveLength(1);
		expect(result.robustnessScore).toBe(1);
	});

	it('returns high overfit risk when ohlcv has fewer than 50 candles', () => {
		const strategy = makeStrategy();
		const ohlcv = makeOHLCV(10);
		const result = runGridSearch({ strategy, ohlcv, symbol: 'BTCUSDT', params: [] });
		// Should still return a result
		expect(result).toBeDefined();
		expect(result.grid).toHaveLength(1);
	});

	it('includes a suggestion string', () => {
		const strategy = makeStrategy();
		const ohlcv = makeOHLCV(200);
		const result = runGridSearch({ strategy, ohlcv, symbol: 'BTCUSDT', params: [] });
		expect(typeof result.suggestion).toBe('string');
		expect(result.suggestion.length).toBeGreaterThan(0);
	});

	it('topResults are sorted by score descending', () => {
		const strategy = makeStrategy();
		const ohlcv = makeOHLCV(200);
		const params: OptimizableParam[] = [
			{ label: 'stop loss', type: 'stop_loss', min: 1, max: 4, step: 1 },
		];
		const result = runGridSearch({ strategy, ohlcv, symbol: 'BTCUSDT', params });
		for (let i = 1; i < result.topResults.length; i++) {
			expect(result.topResults[i - 1].score).toBeGreaterThanOrEqual(result.topResults[i].score);
		}
	});
});
