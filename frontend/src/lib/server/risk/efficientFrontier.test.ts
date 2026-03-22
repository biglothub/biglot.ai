// Efficient Frontier Tests — T-1101

import { describe, it, expect } from 'vitest';
import {
	computeLogReturns,
	annualisedMean,
	computeCovMatrix,
	portfolioStats,
	randomWeights,
	equalWeights,
	createRNG,
	runEfficientFrontier,
	type PortfolioPoint,
} from './efficientFrontier';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a synthetic price series that grows at a constant daily rate. */
function growingSeries(start: number, dailyReturn: number, n: number): number[] {
	const prices: number[] = [start];
	for (let i = 1; i < n; i++) {
		prices.push(prices[i - 1] * (1 + dailyReturn));
	}
	return prices;
}

/** Build a flat (constant) price series. */
function flatSeries(price: number, n: number): number[] {
	return new Array(n).fill(price);
}

// ─── computeLogReturns ────────────────────────────────────────────────────────

describe('computeLogReturns', () => {
	it('returns empty for single price', () => {
		expect(computeLogReturns([100])).toEqual([]);
	});

	it('returns empty for empty input', () => {
		expect(computeLogReturns([])).toEqual([]);
	});

	it('returns correct length', () => {
		const prices = [100, 101, 102, 103];
		const returns = computeLogReturns(prices);
		expect(returns).toHaveLength(3);
	});

	it('computes correct log return for known values', () => {
		// ln(110/100) = ln(1.1) ≈ 0.09531
		const returns = computeLogReturns([100, 110]);
		expect(returns[0]).toBeCloseTo(Math.log(1.1), 8);
	});

	it('returns 0 for flat prices', () => {
		const returns = computeLogReturns([100, 100, 100]);
		expect(returns).toEqual([0, 0]);
	});

	it('handles zero price gracefully (returns 0)', () => {
		const returns = computeLogReturns([0, 100]);
		expect(returns[0]).toBe(0);
	});

	it('handles declining series', () => {
		const returns = computeLogReturns([100, 90]);
		expect(returns[0]).toBeCloseTo(Math.log(0.9), 8);
		expect(returns[0]).toBeLessThan(0);
	});
});

// ─── annualisedMean ───────────────────────────────────────────────────────────

describe('annualisedMean', () => {
	it('returns 0 for empty array', () => {
		expect(annualisedMean([])).toBe(0);
	});

	it('annualises by ×252', () => {
		// daily mean = 0.001  →  annual = 0.001 * 252 = 0.252
		const returns = new Array(100).fill(0.001);
		expect(annualisedMean(returns)).toBeCloseTo(0.252, 5);
	});

	it('handles negative returns', () => {
		const returns = new Array(10).fill(-0.002);
		expect(annualisedMean(returns)).toBeCloseTo(-0.504, 5);
	});
});

// ─── computeCovMatrix ─────────────────────────────────────────────────────────

describe('computeCovMatrix', () => {
	it('returns zeros for single observation', () => {
		const cov = computeCovMatrix([[0.01], [0.02]]);
		expect(cov[0][0]).toBe(0);
		expect(cov[1][1]).toBe(0);
	});

	it('is symmetric', () => {
		const r1 = [0.01, -0.02, 0.03, 0.01, -0.01];
		const r2 = [0.02, -0.01, 0.02, -0.01, 0.03];
		const cov = computeCovMatrix([r1, r2]);
		expect(cov[0][1]).toBeCloseTo(cov[1][0], 10);
	});

	it('diagonal entries are non-negative (variances)', () => {
		const r = [0.01, -0.02, 0.03, -0.01, 0.02];
		const cov = computeCovMatrix([r, r.map(x => x * 2)]);
		expect(cov[0][0]).toBeGreaterThanOrEqual(0);
		expect(cov[1][1]).toBeGreaterThanOrEqual(0);
	});

	it('perfectly correlated assets have cov[i][j] == cov[i][i]', () => {
		// If r2 = r1 exactly, covariance == variance of r1
		const r = [0.01, -0.02, 0.03, -0.01, 0.02];
		const cov = computeCovMatrix([r, r]);
		expect(cov[0][1]).toBeCloseTo(cov[0][0], 8);
	});

	it('annualises by ×252', () => {
		// Single asset with 2 observations
		const r = [0.01, 0.02]; // daily returns
		const cov = computeCovMatrix([r]);
		// var = ((0.01 - 0.015)^2 + (0.02 - 0.015)^2) / 1 * 252
		const expected = (Math.pow(0.01 - 0.015, 2) + Math.pow(0.02 - 0.015, 2)) / 1 * 252;
		expect(cov[0][0]).toBeCloseTo(expected, 8);
	});
});

// ─── portfolioStats ───────────────────────────────────────────────────────────

describe('portfolioStats', () => {
	it('single-asset portfolio: return = asset mean', () => {
		const means = [0.12];
		const cov   = [[0.04]]; // variance = 0.04 → std = 0.2
		const stats = portfolioStats([1], means, cov, 0.05);
		expect(stats.returns).toBeCloseTo(0.12, 8);
		expect(stats.risk).toBeCloseTo(0.2, 8);
		expect(stats.sharpe).toBeCloseTo((0.12 - 0.05) / 0.2, 6);
	});

	it('equal-weight two-asset portfolio', () => {
		const means = [0.10, 0.20];
		// No covariance for simplicity: assets uncorrelated
		const cov = [[0.01, 0], [0, 0.04]];
		const w   = [0.5, 0.5];
		const stats = portfolioStats(w, means, cov, 0.0);
		// Expected return = 0.5*0.10 + 0.5*0.20 = 0.15
		expect(stats.returns).toBeCloseTo(0.15, 8);
		// Variance = 0.25*0.01 + 0.25*0.04 = 0.0025 + 0.01 = 0.0125 → std = sqrt(0.0125)
		expect(stats.risk).toBeCloseTo(Math.sqrt(0.0125), 8);
	});

	it('returns Sharpe = 0 when risk = 0', () => {
		const stats = portfolioStats([1], [0.10], [[0]], 0.05);
		expect(stats.sharpe).toBe(0);
		expect(stats.risk).toBe(0);
	});

	it('sharpe is correct with rfr', () => {
		const means = [0.15];
		const cov   = [[0.0225]]; // std = 0.15
		const stats = portfolioStats([1], means, cov, 0.05);
		expect(stats.sharpe).toBeCloseTo((0.15 - 0.05) / 0.15, 6);
	});
});

// ─── equalWeights ─────────────────────────────────────────────────────────────

describe('equalWeights', () => {
	it('sums to 1', () => {
		const w = equalWeights(5);
		const sum = w.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 10);
	});

	it('each weight = 1/n', () => {
		const w = equalWeights(4);
		w.forEach(wi => expect(wi).toBeCloseTo(0.25, 10));
	});

	it('handles n=1', () => {
		expect(equalWeights(1)).toEqual([1]);
	});
});

// ─── randomWeights ────────────────────────────────────────────────────────────

describe('randomWeights', () => {
	it('sums to 1', () => {
		const rng = createRNG(42);
		for (let i = 0; i < 20; i++) {
			const w   = randomWeights(5, rng);
			const sum = w.reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 8);
		}
	});

	it('all weights are non-negative', () => {
		const rng = createRNG(7);
		for (let i = 0; i < 20; i++) {
			const w = randomWeights(4, rng);
			w.forEach(wi => expect(wi).toBeGreaterThanOrEqual(0));
		}
	});

	it('single asset always returns [1]', () => {
		const rng = createRNG(1);
		const w   = randomWeights(1, rng);
		expect(w).toHaveLength(1);
		expect(w[0]).toBeCloseTo(1, 8);
	});
});

// ─── runEfficientFrontier ─────────────────────────────────────────────────────

describe('runEfficientFrontier', () => {
	/** 100-day price series for two assets growing at different daily rates */
	const prices1 = growingSeries(100, 0.001, 100);   // ~+27% annualised
	const prices2 = growingSeries(50,  0.0005, 100);  // ~+13% annualised

	it('returns correct asset count', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		expect(res.assets).toEqual(['A', 'B']);
	});

	it('maxSharpe weights sum to ~1', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		const sum = res.maxSharpe.weights.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 6);
	});

	it('minVariance weights sum to ~1', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		const sum = res.minVariance.weights.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 6);
	});

	it('equalWeight weights are 0.5 each for 2 assets', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		res.equalWeight.weights.forEach(w => expect(w).toBeCloseTo(0.5, 8));
	});

	it('minVariance has lower risk than maxSharpe (generally)', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		// Min-variance should have risk ≤ max-Sharpe risk
		expect(res.minVariance.risk).toBeLessThanOrEqual(res.maxSharpe.risk + 1e-6);
	});

	it('maxSharpe has higher or equal Sharpe than minVariance', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		expect(res.maxSharpe.sharpe).toBeGreaterThanOrEqual(res.minVariance.sharpe - 1e-6);
	});

	it('frontier is sorted by risk ascending', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		for (let i = 1; i < res.frontier.length; i++) {
			expect(res.frontier[i].risk).toBeGreaterThanOrEqual(res.frontier[i - 1].risk - 1e-10);
		}
	});

	it('frontier has ≤50 points', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		expect(res.frontier.length).toBeLessThanOrEqual(50);
	});

	it('handles single asset', () => {
		const res = runEfficientFrontier(['BTC'], [prices1], 0.05, 100);
		expect(res.assets).toEqual(['BTC']);
		expect(res.maxSharpe.weights).toEqual([1]);
		expect(res.minVariance.weights).toEqual([1]);
		expect(res.equalWeight.weights).toEqual([1]);
	});

	it('handles flat price series (zero variance)', () => {
		const flat = flatSeries(100, 100);
		const res  = runEfficientFrontier(['FLAT'], [flat], 0.05, 100);
		expect(res.minVariance.risk).toBe(0);
		expect(res.maxSharpe.sharpe).toBe(0); // risk=0 → Sharpe=0
	});

	it('respects numPortfolios parameter', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 300);
		expect(res.numPortfolios).toBe(300);
	});

	it('throws for empty assets', () => {
		expect(() => runEfficientFrontier([], [], 0.05, 100)).toThrow();
	});

	it('three-asset portfolio — weights all non-negative', () => {
		const prices3 = growingSeries(200, 0.0008, 100);
		const res = runEfficientFrontier(['A', 'B', 'C'], [prices1, prices2, prices3], 0.05, 500);
		[res.maxSharpe, res.minVariance].forEach((p: PortfolioPoint) => {
			p.weights.forEach(w => expect(w).toBeGreaterThanOrEqual(0));
		});
	});

	it('five-asset portfolio completes without error', () => {
		const series = [
			growingSeries(100, 0.0010, 90),
			growingSeries(100, 0.0005, 90),
			growingSeries(100, 0.0008, 90),
			growingSeries(100, 0.0003, 90),
			growingSeries(100, 0.0012, 90),
		];
		const res = runEfficientFrontier(
			['A', 'B', 'C', 'D', 'E'],
			series,
			0.05,
			500,
		);
		expect(res.assets).toHaveLength(5);
		expect(res.maxSharpe.sharpe).toBeGreaterThanOrEqual(0);
	});

	it('max-Sharpe portfolio has higher Sharpe than equal-weight', () => {
		const fastA = growingSeries(100, 0.003, 100);
		const slowB = growingSeries(100, 0.0001, 100);
		const res   = runEfficientFrontier(['A', 'B'], [fastA, slowB], 0.0, 500);
		// Max-Sharpe should be at least as good as equal-weight
		expect(res.maxSharpe.sharpe).toBeGreaterThanOrEqual(res.equalWeight.sharpe - 1e-6);
	});

	it('riskFreeRate affects Sharpe calculation', () => {
		const res0  = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.0,  500);
		const res5  = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		// Same portfolio stats, different Sharpe due to different rfr
		expect(res0.riskFreeRate).toBe(0.0);
		expect(res5.riskFreeRate).toBe(0.05);
		// Sharpe should be lower (or equal) with higher rfr for same returns
		expect(res5.maxSharpe.sharpe).toBeLessThanOrEqual(res0.maxSharpe.sharpe + 1e-6);
	});

	it('series with different lengths are aligned to shortest', () => {
		const longSeries  = growingSeries(100, 0.001, 120);
		const shortSeries = growingSeries(100, 0.001, 80);
		// Should not throw — aligned to 79 observations
		const res = runEfficientFrontier(['A', 'B'], [longSeries, shortSeries], 0.05, 200);
		expect(res.assets).toHaveLength(2);
	});

	it('frontier points all have non-negative risk', () => {
		const res = runEfficientFrontier(['A', 'B'], [prices1, prices2], 0.05, 500);
		res.frontier.forEach(pt => expect(pt.risk).toBeGreaterThanOrEqual(0));
	});
});
