// Tests for intermarket.data.ts — T-703
import { describe, it, expect, vi } from 'vitest';
import {
	pctChange,
	computeRiskScore,
	riskLabel,
	detectDivergences,
	buildIntermarketSnapshot,
	INTERMARKET_ASSETS,
} from './intermarket.data';

// ─── pctChange ────────────────────────────────────────────────────────────────

describe('pctChange', () => {
	it('returns 0 for empty array', () => {
		expect(pctChange([], 20)).toBe(0);
	});

	it('returns 0 for single element', () => {
		expect(pctChange([100], 20)).toBe(0);
	});

	it('computes correct 20-day return', () => {
		const closes = Array.from({ length: 25 }, (_, i) => 100 + i); // 100..124
		// lookback=20: index = 25-1-20=4, closes[4]=104, closes[24]=124
		const result = pctChange(closes, 20);
		expect(result).toBeCloseTo((124 - 104) / 104 * 100, 2);
	});

	it('handles lookback beyond array length (uses index 0)', () => {
		expect(pctChange([100, 110], 50)).toBeCloseTo(10, 2);
	});

	it('returns 0 if base is zero', () => {
		expect(pctChange([0, 100], 1)).toBe(0);
	});
});

// ─── computeRiskScore ─────────────────────────────────────────────────────────

describe('computeRiskScore', () => {
	it('returns 0 for all-zero returns', () => {
		const r = { SPY: 0, QQQ: 0, 'TLT': 0, GLD: 0, USO: 0, 'BTC-USD': 0 };
		expect(computeRiskScore(r)).toBe(0);
	});

	it('returns positive score when equities are up and bonds down', () => {
		const r = { SPY: 5, QQQ: 6, 'TLT': -3, GLD: -1, USO: 2, 'BTC-USD': 10 };
		expect(computeRiskScore(r)).toBeGreaterThan(0);
	});

	it('returns negative score for risk-off scenario', () => {
		// Equities down, bonds up, BTC down, gold up
		const r = { SPY: -8, QQQ: -10, 'TLT': 5, GLD: 6, USO: -5, 'BTC-USD': -15 };
		expect(computeRiskScore(r)).toBeLessThan(0);
	});

	it('gold rising with equities falling adds negative signal', () => {
		const base = computeRiskScore({ SPY: -2, QQQ: 0, 'TLT': 0, GLD: 0,  USO: 0, 'BTC-USD': 0 });
		const gldUp = computeRiskScore({ SPY: -2, QQQ: 0, 'TLT': 0, GLD: 3,  USO: 0, 'BTC-USD': 0 });
		expect(gldUp).toBeLessThan(base);
	});

	it('is clamped to -100..+100', () => {
		const extreme = computeRiskScore({ SPY: 100, QQQ: 100, 'TLT': -100, GLD: -100, USO: 100, 'BTC-USD': 100 });
		expect(extreme).toBeLessThanOrEqual(100);

		const extremeOff = computeRiskScore({ SPY: -100, QQQ: -100, 'TLT': 100, GLD: 100, USO: -100, 'BTC-USD': -100 });
		expect(extremeOff).toBeGreaterThanOrEqual(-100);
	});

	it('handles missing symbols gracefully (defaults to 0)', () => {
		expect(() => computeRiskScore({})).not.toThrow();
	});
});

// ─── riskLabel ────────────────────────────────────────────────────────────────

describe('riskLabel', () => {
	it.each([
		[75,   'Strong Risk-On'],
		[30,   'Moderate Risk-On'],
		[0,    'Neutral'],
		[-30,  'Moderate Risk-Off'],
		[-75,  'Strong Risk-Off'],
	])('score %i → %s', (score, expected) => {
		expect(riskLabel(score)).toBe(expected);
	});
});

// ─── detectDivergences ────────────────────────────────────────────────────────

describe('detectDivergences', () => {
	it('returns empty array for empty labels', () => {
		expect(detectDivergences([], [])).toHaveLength(0);
	});

	it('returns divergences for known pairs when labels are present', () => {
		const labels = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC'];
		const n = labels.length;
		// Identity matrix (all corr = 0 off-diagonal)
		const matrix: number[][] = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
		);
		const divs = detectDivergences(labels, matrix);
		expect(divs.length).toBeGreaterThan(0);
		// Should include SPY vs TLT
		expect(divs.some(d => d.pair === 'SPY vs TLT')).toBe(true);
	});

	it('positive SPY-TLT correlation reports unusual signal', () => {
		const labels = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC'];
		const n = labels.length;
		const matrix: number[][] = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
		);
		// Set SPY-TLT correlation high positive
		const spyIdx = 0; const tltIdx = 2;
		matrix[spyIdx][tltIdx] = 0.7;
		matrix[tltIdx][spyIdx] = 0.7;

		const divs = detectDivergences(labels, matrix);
		const spyTlt = divs.find(d => d.pair === 'SPY vs TLT');
		expect(spyTlt?.interpretation).toMatch(/unusual/i);
	});

	it('negative SPY-TLT correlation reports normal/risk-on', () => {
		const labels = ['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC'];
		const n = labels.length;
		const matrix: number[][] = Array.from({ length: n }, (_, i) =>
			Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
		);
		const spyIdx = 0; const tltIdx = 2;
		matrix[spyIdx][tltIdx] = -0.6;
		matrix[tltIdx][spyIdx] = -0.6;

		const divs = detectDivergences(labels, matrix);
		const spyTlt = divs.find(d => d.pair === 'SPY vs TLT');
		expect(spyTlt?.interpretation).toMatch(/risk-on/i);
	});
});

// ─── buildIntermarketSnapshot ─────────────────────────────────────────────────

describe('buildIntermarketSnapshot', () => {
	/** Mock fetcher: returns a flat uptrend for all symbols */
	function makeMockFetcher(overrides: Record<string, number[]> = {}) {
		return vi.fn(async (symbol: string, days: number): Promise<number[]> => {
			if (overrides[symbol]) return overrides[symbol];
			const start = 100;
			return Array.from({ length: days }, (_, i) => start + i * 0.1);
		});
	}

	it('returns snapshot with correct structure', async () => {
		const fetcher = makeMockFetcher();
		const snap = await buildIntermarketSnapshot(30, fetcher);
		expect(snap).toMatchObject({
			assets:            expect.any(Array),
			correlationMatrix: expect.any(Array),
			labels:            expect.any(Array),
			riskScore:         expect.any(Number),
			riskLabel:         expect.any(String),
			divergences:       expect.any(Array),
			fetchedAt:         expect.any(Number),
		});
	});

	it('correlation matrix is n×n', async () => {
		const fetcher = makeMockFetcher();
		const snap = await buildIntermarketSnapshot(30, fetcher);
		const n = snap.assets.length;
		expect(snap.correlationMatrix).toHaveLength(n);
		for (const row of snap.correlationMatrix) {
			expect(row).toHaveLength(n);
		}
	});

	it('diagonal of correlation matrix is 1', async () => {
		const fetcher = makeMockFetcher();
		const snap = await buildIntermarketSnapshot(30, fetcher);
		snap.correlationMatrix.forEach((row, i) => {
			expect(row[i]).toBeCloseTo(1, 5);
		});
	});

	it('riskScore is in -100..+100 range', async () => {
		const fetcher = makeMockFetcher();
		const snap = await buildIntermarketSnapshot(30, fetcher);
		expect(snap.riskScore).toBeGreaterThanOrEqual(-100);
		expect(snap.riskScore).toBeLessThanOrEqual(100);
	});

	it('filters out assets with empty closes', async () => {
		const fetcher = vi.fn(async (symbol: string): Promise<number[]> => {
			// Only SPY returns data
			return symbol === 'SPY' ? [100, 101, 102, 103, 104] : [];
		});
		const snap = await buildIntermarketSnapshot(30, fetcher);
		// Only SPY has data (length >= 5), so 1 asset
		expect(snap.assets.length).toBe(1);
	});

	it('labels match asset labels', async () => {
		const fetcher = makeMockFetcher();
		const snap = await buildIntermarketSnapshot(30, fetcher);
		expect(snap.labels).toEqual(snap.assets.map(a => a.label));
	});

	it('change20d is computed', async () => {
		const closes = Array.from({ length: 35 }, (_, i) => 100 + i); // +1 per day
		const fetcher = vi.fn(async (_s: string, days: number): Promise<number[]> => closes.slice(-days));
		const snap = await buildIntermarketSnapshot(30, fetcher);
		for (const a of snap.assets) {
			// Should have non-zero 20d change since trend is up
			expect(typeof a.change20d).toBe('number');
		}
	});

	it('INTERMARKET_ASSETS has 6 entries', () => {
		expect(INTERMARKET_ASSETS).toHaveLength(6);
	});

	it('each asset definition has required fields', () => {
		for (const a of INTERMARKET_ASSETS) {
			expect(a.symbol).toBeTruthy();
			expect(a.label).toBeTruthy();
			expect(['equity', 'bonds', 'commodity', 'crypto']).toContain(a.category);
		}
	});
});
