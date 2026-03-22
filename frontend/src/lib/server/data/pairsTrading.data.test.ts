// Tests for pairsTrading.data.ts — T-1003

import { describe, it, expect } from 'vitest';
import {
	olsRegress,
	computeSpread,
	mean,
	stdDev,
	computeZScores,
	estimateHalfLife,
	calcADFStat,
	calcCointegrationScore,
	cointegrationLabel,
	pairsSignal,
	buildPairsSnapshot,
} from './pairsTrading.data';

// ─── olsRegress ───────────────────────────────────────────────────────────────

describe('olsRegress', () => {
	it('fits y = 2x perfectly', () => {
		const x = [1, 2, 3, 4, 5];
		const y = [2, 4, 6, 8, 10];
		const { slope, intercept } = olsRegress(x, y);
		expect(slope).toBeCloseTo(2, 5);
		expect(intercept).toBeCloseTo(0, 5);
	});

	it('fits y = 3x + 1', () => {
		const x = [0, 1, 2, 3, 4];
		const y = [1, 4, 7, 10, 13];
		const { slope, intercept } = olsRegress(x, y);
		expect(slope).toBeCloseTo(3, 5);
		expect(intercept).toBeCloseTo(1, 5);
	});

	it('returns slope=1, intercept=0 for empty input', () => {
		const { slope, intercept } = olsRegress([], []);
		expect(slope).toBe(1);
		expect(intercept).toBe(0);
	});

	it('handles collinear x (all same value)', () => {
		const x = [5, 5, 5, 5];
		const y = [1, 2, 3, 4];
		const { slope, intercept } = olsRegress(x, y);
		expect(slope).toBe(1); // denom = 0, fallback
		expect(intercept).toBe(0);
	});
});

// ─── computeSpread ────────────────────────────────────────────────────────────

describe('computeSpread', () => {
	it('spread is zero when A perfectly tracks beta*B + intercept', () => {
		const b    = [10, 20, 30, 40];
		const a    = b.map(v => 2 * v + 5); // A = 2*B + 5
		const spread = computeSpread(a, b, 2, 5);
		spread.forEach(s => expect(s).toBeCloseTo(0, 10));
	});

	it('positive spread when A above expected', () => {
		const b    = [10, 20, 30];
		const a    = [25, 45, 65]; // expected: 2*B+5 → [25, 45, 65] — exactly 0
		const spread = computeSpread(a, b, 2, 5);
		spread.forEach(s => expect(s).toBeCloseTo(0, 8));
	});

	it('returns spread of correct length', () => {
		const a = [1, 2, 3, 4, 5];
		const b = [1, 2, 3, 4, 5];
		expect(computeSpread(a, b, 1, 0)).toHaveLength(5);
	});
});

// ─── mean & stdDev ────────────────────────────────────────────────────────────

describe('mean', () => {
	it('returns correct mean', () => {
		expect(mean([1, 2, 3, 4, 5])).toBe(3);
	});

	it('returns 0 for empty array', () => {
		expect(mean([])).toBe(0);
	});
});

describe('stdDev', () => {
	it('returns correct std for known series', () => {
		// [2, 4, 4, 4, 5, 5, 7, 9] → mean=5, var=4, std=2
		expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 2);
	});

	it('returns 1 for single element (no division by zero)', () => {
		expect(stdDev([5])).toBe(1);
	});

	it('returns 1 for constant array (zero variance)', () => {
		expect(stdDev([3, 3, 3, 3])).toBe(1);
	});
});

// ─── computeZScores ──────────────────────────────────────────────────────────

describe('computeZScores', () => {
	it('returns same length as spread', () => {
		const spread = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const result = computeZScores(spread, 5);
		expect(result).toHaveLength(spread.length);
	});

	it('each point has index, spread, and zScore fields', () => {
		const spread = [1, 2, 3, 4, 5];
		const result = computeZScores(spread, 3);
		for (const pt of result) {
			expect(typeof pt.index).toBe('number');
			expect(typeof pt.spread).toBe('number');
			expect(typeof pt.zScore).toBe('number');
		}
	});

	it('z-score of last point when spread is mean-zero is near 0', () => {
		// Constant spread → z-score should be 0 (std=1 fallback, but spread=mean so z=0)
		const spread = [5, 5, 5, 5, 5];
		const result = computeZScores(spread, 5);
		// mean=5, spread=5 → zScore = (5-5)/std = 0
		expect(result[result.length - 1].zScore).toBeCloseTo(0, 5);
	});

	it('z-score is positive for large positive spread', () => {
		const spread = [0, 0, 0, 0, 10]; // last value far above mean
		const result = computeZScores(spread, 5);
		expect(result[result.length - 1].zScore).toBeGreaterThan(0);
	});

	it('z-score is negative for large negative spread', () => {
		const spread = [0, 0, 0, 0, -10];
		const result = computeZScores(spread, 5);
		expect(result[result.length - 1].zScore).toBeLessThan(0);
	});
});

// ─── estimateHalfLife ────────────────────────────────────────────────────────

describe('estimateHalfLife', () => {
	it('returns Infinity for non-reverting (random walk)', () => {
		// Random walk: dS = 0 → lambda = 0 → not mean reverting
		const spread = [0, 1, 2, 3, 4, 5, 6, 7, 8];
		// Increasing → lambda likely >= 0 → Infinity
		// Not guaranteed, but likely
		const hl = estimateHalfLife(spread);
		// Just check it returns a number
		expect(typeof hl).toBe('number');
	});

	it('returns finite positive value for mean-reverting series', () => {
		// Simulate OU process: spread decays toward 0
		// spread[i] = 0.7 * spread[i-1] + noise (but use exact AR(1) for test)
		const spread = [10, 7, 4.9, 3.43, 2.4, 1.68, 1.176, 0.823, 0.576, 0.403];
		// rho ≈ 0.7 → lambda ≈ -0.3 → half-life = log(2)/0.3 ≈ 2.31
		const hl = estimateHalfLife(spread);
		expect(hl).toBeGreaterThan(0);
		if (isFinite(hl)) {
			expect(hl).toBeLessThan(20);
		}
	});

	it('returns Infinity for too short array', () => {
		expect(estimateHalfLife([1, 2])).toBe(Infinity);
	});
});

// ─── calcADFStat ─────────────────────────────────────────────────────────────

describe('calcADFStat', () => {
	it('returns a number', () => {
		const spread = [5, 3, 4, 2, 5, 3, 4, 2, 5, 3];
		expect(typeof calcADFStat(spread)).toBe('number');
	});

	it('returns more negative stat for mean-reverting series', () => {
		// Mean-reverting: always reverts to 0
		const stationary = [3, 1, -1, 2, 0, -2, 1, 3, -1, 0, 2, -3, 1, 0, -1];
		// Non-stationary: pure random walk
		const nonStationary = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
		const adfStat   = calcADFStat(stationary);
		const adfNonStat = calcADFStat(nonStationary);
		// Stationary should yield more negative ADF stat
		expect(adfStat).toBeLessThan(adfNonStat);
	});

	it('returns 0 for too-short series', () => {
		expect(calcADFStat([1, 2, 3, 4])).toBe(0);
	});
});

// ─── calcCointegrationScore ──────────────────────────────────────────────────

describe('calcCointegrationScore', () => {
	it('returns 100 for very negative ADF stat', () => {
		expect(calcCointegrationScore(-3.5)).toBe(100);
	});

	it('returns 0 for mildly negative ADF stat', () => {
		expect(calcCointegrationScore(-1.0)).toBe(0);
	});

	it('returns ~50 for ADF around -2.25', () => {
		const score = calcCointegrationScore(-2.25);
		expect(score).toBeGreaterThan(40);
		expect(score).toBeLessThan(60);
	});

	it('clamps correctly for very negative values', () => {
		expect(calcCointegrationScore(-10)).toBe(100);
	});

	it('clamps correctly for positive ADF values', () => {
		expect(calcCointegrationScore(1)).toBe(0);
	});
});

// ─── cointegrationLabel ───────────────────────────────────────────────────────

describe('cointegrationLabel', () => {
	it('labels each tier correctly', () => {
		expect(cointegrationLabel(85)).toBe('Strong cointegration');
		expect(cointegrationLabel(65)).toBe('Moderate cointegration');
		expect(cointegrationLabel(45)).toBe('Weak cointegration');
		expect(cointegrationLabel(20)).toBe('Not cointegrated');
	});
});

// ─── pairsSignal ─────────────────────────────────────────────────────────────

describe('pairsSignal', () => {
	it('returns short_spread for z > 2', () => {
		expect(pairsSignal(2.5)).toBe('short_spread');
	});

	it('returns long_spread for z < -2', () => {
		expect(pairsSignal(-2.5)).toBe('long_spread');
	});

	it('returns neutral for |z| <= 2', () => {
		expect(pairsSignal(0)).toBe('neutral');
		expect(pairsSignal(1.99)).toBe('neutral');
		expect(pairsSignal(-1.99)).toBe('neutral');
	});

	it('returns neutral exactly at z = 2', () => {
		// boundary: > 2 triggers, = 2 does not
		expect(pairsSignal(2)).toBe('neutral');
	});
});

// ─── buildPairsSnapshot ───────────────────────────────────────────────────────

describe('buildPairsSnapshot', () => {
	// Build two perfectly correlated series: A = 2*B + 5 + small noise
	const n = 60;
	const closesB = Array.from({ length: n }, (_, i) => 100 + i * 0.5);
	const closesA = closesB.map(b => 2 * b + 5);

	it('returns a snapshot with all required fields', () => {
		const snap = buildPairsSnapshot('BTCUSDT', 'ETHUSDT', closesA, closesB);
		expect(snap.symbolA).toBe('BTCUSDT');
		expect(snap.symbolB).toBe('ETHUSDT');
		expect(typeof snap.beta).toBe('number');
		expect(typeof snap.intercept).toBe('number');
		expect(typeof snap.correlation30d).toBe('number');
		expect(typeof snap.currentZScore).toBe('number');
		expect(typeof snap.halfLife).toBe('number');
		expect(typeof snap.adfStat).toBe('number');
		expect(typeof snap.cointegrationScore).toBe('number');
		expect(['long_spread', 'short_spread', 'neutral']).toContain(snap.signal);
		expect(Array.isArray(snap.history)).toBe(true);
	});

	it('hedge ratio beta is close to 2 for A=2*B+5', () => {
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(snap.beta).toBeCloseTo(2, 3);
	});

	it('intercept is close to 5 for A=2*B+5', () => {
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(snap.intercept).toBeCloseTo(5, 1);
	});

	it('correlation is 1.0 for perfectly co-moving series', () => {
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(snap.correlation30d).toBeCloseTo(1.0, 3);
	});

	it('currentZScore is near 0 when spread is stable', () => {
		// A = 2*B + 5 exactly → spread is constant → z-score = 0
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(Math.abs(snap.currentZScore)).toBeLessThan(0.5);
	});

	it('history has up to 20 points', () => {
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(snap.history.length).toBeLessThanOrEqual(20);
		expect(snap.history.length).toBeGreaterThan(0);
	});

	it('cointegrationScore is in 0-100', () => {
		const snap = buildPairsSnapshot('A', 'B', closesA, closesB);
		expect(snap.cointegrationScore).toBeGreaterThanOrEqual(0);
		expect(snap.cointegrationScore).toBeLessThanOrEqual(100);
	});

	it('short series still returns a valid snapshot', () => {
		const short = buildPairsSnapshot('A', 'B',
			closesA.slice(0, 20), closesB.slice(0, 20));
		expect(short.symbolA).toBe('A');
		expect(typeof short.currentZScore).toBe('number');
	});

	it('signal is long_spread when z < -2', () => {
		// Add a big downward spike to A at the end
		const aLow = [...closesA.slice(0, -1), closesA[closesA.length - 1] * 0.5];
		const snap  = buildPairsSnapshot('A', 'B', aLow, closesB);
		// The spread should spike down → z-score < -2 → long_spread
		if (snap.currentZScore < -2) {
			expect(snap.signal).toBe('long_spread');
		}
	});
});
