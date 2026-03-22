// Tests for monteCarlo.ts — T-904

import { describe, it, expect } from 'vitest';
import {
	percentile,
	sampleWithReplacement,
	createRNG,
	simulatePath,
	getHorizonCheckpoints,
	runMonteCarlo,
} from './monteCarlo';

// ─── percentile ───────────────────────────────────────────────────────────────

describe('percentile', () => {
	it('returns 0 for empty array', () => {
		expect(percentile([], 50)).toBe(0);
	});

	it('returns the only element for single-element array', () => {
		expect(percentile([42], 50)).toBe(42);
	});

	it('returns the median of sorted array', () => {
		expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
	});

	it('returns min for p=0', () => {
		expect(percentile([10, 20, 30], 0)).toBe(10);
	});

	it('returns max for p=100', () => {
		expect(percentile([10, 20, 30], 100)).toBe(30);
	});

	it('handles even-length array', () => {
		const sorted = [1, 2, 3, 4];
		const p50 = percentile(sorted, 50);
		expect([2, 3]).toContain(p50); // either median element is valid
	});
});

// ─── createRNG ────────────────────────────────────────────────────────────────

describe('createRNG', () => {
	it('returns values in [0, 1)', () => {
		const rng = createRNG(1);
		for (let i = 0; i < 100; i++) {
			const v = rng();
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('produces deterministic sequence for same seed', () => {
		const rng1 = createRNG(42);
		const rng2 = createRNG(42);
		const seq1 = Array.from({ length: 20 }, () => rng1());
		const seq2 = Array.from({ length: 20 }, () => rng2());
		expect(seq1).toEqual(seq2);
	});

	it('produces different sequences for different seeds', () => {
		const rng1 = createRNG(1);
		const rng2 = createRNG(2);
		const v1 = rng1();
		const v2 = rng2();
		expect(v1).not.toBe(v2);
	});
});

// ─── sampleWithReplacement ────────────────────────────────────────────────────

describe('sampleWithReplacement', () => {
	it('returns array of requested length', () => {
		const rng  = createRNG(1);
		const arr  = [1, 2, 3, 4, 5];
		const sample = sampleWithReplacement(arr, 10, rng);
		expect(sample).toHaveLength(10);
	});

	it('all sampled values come from the original array', () => {
		const rng  = createRNG(1);
		const arr  = [10, 20, 30];
		const sample = sampleWithReplacement(arr, 100, rng);
		for (const v of sample) {
			expect(arr).toContain(v);
		}
	});

	it('allows repeated values (with replacement)', () => {
		const rng    = createRNG(5);
		const arr    = [42];  // only one value → must always be 42
		const sample = sampleWithReplacement(arr, 5, rng);
		expect(sample).toEqual([42, 42, 42, 42, 42]);
	});
});

// ─── simulatePath ─────────────────────────────────────────────────────────────

describe('simulatePath', () => {
	const baseConfig = {
		paths:          100,
		horizon:        20,
		initialCapital: 10_000,
		targetReturn:   0.20,
		ruinThreshold:  0.30,
	};

	it('equity starts at initialCapital', () => {
		const rng    = createRNG(1);
		const result = simulatePath([100, -50, 200], baseConfig, rng);
		expect(result.equityAtSteps[0]).toBe(10_000);
	});

	it('equityAtSteps has horizon+1 entries', () => {
		const rng    = createRNG(1);
		const result = simulatePath([100, -50, 200], { ...baseConfig, horizon: 10 }, rng);
		expect(result.equityAtSteps).toHaveLength(11); // initial + 10 steps
	});

	it('hitTarget=true for all-positive returns that exceed target', () => {
		const rng     = createRNG(1);
		const returns = Array(20).fill(200); // gains every trade
		const result  = simulatePath(returns, baseConfig, rng);
		expect(result.hitTarget).toBe(true);
	});

	it('hitRuin=true for catastrophic losses', () => {
		const rng     = createRNG(1);
		const returns = Array(20).fill(-500); // large losses
		const result  = simulatePath(returns, baseConfig, rng);
		expect(result.hitRuin).toBe(true);
	});

	it('maxDrawdown is 0 when equity only rises', () => {
		const rng     = createRNG(1);
		const returns = Array(20).fill(100); // always profitable
		const result  = simulatePath(returns, baseConfig, rng);
		expect(result.maxDrawdown).toBe(0);
	});

	it('equity floored at 0', () => {
		const rng     = createRNG(1);
		const returns = Array(20).fill(-10_000); // wipe out equity
		const result  = simulatePath(returns, baseConfig, rng);
		expect(result.finalEquity).toBeGreaterThanOrEqual(0);
	});
});

// ─── getHorizonCheckpoints ────────────────────────────────────────────────────

describe('getHorizonCheckpoints', () => {
	it('includes only checkpoints <= horizon', () => {
		const checkpoints = getHorizonCheckpoints(50);
		for (const cp of checkpoints) {
			expect(cp).toBeLessThanOrEqual(50);
		}
	});

	it('includes horizon itself if not already a candidate', () => {
		const checkpoints = getHorizonCheckpoints(75);
		expect(checkpoints).toContain(75);
	});

	it('includes standard checkpoint 100 for horizon=200', () => {
		const checkpoints = getHorizonCheckpoints(200);
		expect(checkpoints).toContain(100);
	});

	it('returns at least one checkpoint', () => {
		expect(getHorizonCheckpoints(5).length).toBeGreaterThanOrEqual(1);
	});
});

// ─── runMonteCarlo ────────────────────────────────────────────────────────────

describe('runMonteCarlo', () => {
	it('throws for fewer than 5 historical returns', () => {
		expect(() => runMonteCarlo([100, -50, 200], {})).toThrow();
	});

	it('returns correct paths count', () => {
		const returns = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? 100 : -50);
		const result  = runMonteCarlo(returns, { paths: 200, horizon: 30 });
		expect(result.paths).toBe(200);
	});

	it('returnsUsed equals historicalReturns.length', () => {
		const returns = Array.from({ length: 25 }, () => 50);
		const result  = runMonteCarlo(returns, { paths: 100, horizon: 20 });
		expect(result.returnsUsed).toBe(25);
	});

	it('targetProbability=100 when all returns are profitable', () => {
		const returns = Array(30).fill(1000); // always win
		const result  = runMonteCarlo(returns, {
			paths: 200, horizon: 10, initialCapital: 10_000,
			targetReturn: 0.01, // easy 1% target
			ruinThreshold: 0.99, // hard to ruin
		});
		expect(result.targetProbability).toBeCloseTo(100, 0);
	});

	it('ruinProbability=100 when all returns are catastrophic losses', () => {
		const returns = Array(30).fill(-5000);
		const result  = runMonteCarlo(returns, {
			paths: 200, horizon: 10, initialCapital: 10_000,
			targetReturn: 0.99,
			ruinThreshold: 0.01, // ruin at just 1% drawdown → always triggered
		});
		expect(result.ruinProbability).toBeCloseTo(100, 0);
	});

	it('medianReturn is positive for consistently profitable returns', () => {
		const returns = Array(30).fill(200);
		const result  = runMonteCarlo(returns, { paths: 100, horizon: 20, initialCapital: 10_000 });
		expect(result.medianReturn).toBeGreaterThan(0);
		expect(result.medianFinalValue).toBeGreaterThan(10_000);
	});

	it('produces horizonOutcomes at expected checkpoints', () => {
		const returns = Array.from({ length: 20 }, () => 100);
		const result  = runMonteCarlo(returns, { paths: 100, horizon: 50 });
		expect(result.horizonOutcomes.length).toBeGreaterThan(0);
		for (const h of result.horizonOutcomes) {
			expect(h.p5).toBeLessThanOrEqual(h.p50);
			expect(h.p50).toBeLessThanOrEqual(h.p95);
		}
	});

	it('p5 <= p25 <= p50 <= p75 <= p95 for all horizon outcomes', () => {
		const returns = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -200 : 150));
		const result  = runMonteCarlo(returns, { paths: 500, horizon: 30 });
		for (const h of result.horizonOutcomes) {
			expect(h.p5).toBeLessThanOrEqual(h.p25 + 0.01);
			expect(h.p25).toBeLessThanOrEqual(h.p50 + 0.01);
			expect(h.p50).toBeLessThanOrEqual(h.p75 + 0.01);
			expect(h.p75).toBeLessThanOrEqual(h.p95 + 0.01);
		}
	});

	it('deterministic results with same seed (createRNG used internally)', () => {
		const returns = Array.from({ length: 20 }, (_, i) => i % 2 === 0 ? 100 : -60);
		const r1 = runMonteCarlo(returns, { paths: 100, horizon: 20 });
		const r2 = runMonteCarlo(returns, { paths: 100, horizon: 20 });
		// Same seed=12345 → same result
		expect(r1.medianFinalValue).toBe(r2.medianFinalValue);
	});

	it('expectedMaxDrawdown is between 0 and 100', () => {
		const returns = Array.from({ length: 20 }, (_, i) => i % 3 === 0 ? -300 : 200);
		const result  = runMonteCarlo(returns, { paths: 200, horizon: 20 });
		expect(result.expectedMaxDrawdown).toBeGreaterThanOrEqual(0);
		expect(result.expectedMaxDrawdown).toBeLessThanOrEqual(100);
	});
});
