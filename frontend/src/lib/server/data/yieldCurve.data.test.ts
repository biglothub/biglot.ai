// Yield Curve Tests — T-803
import { describe, it, expect, vi } from 'vitest';
import {
	classifyCurve,
	classificationLabel,
	buildYieldCurveSnapshot,
	type YieldFetcher,
} from './yieldCurve.data';

// ─── classifyCurve ────────────────────────────────────────────────────────────

describe('classifyCurve', () => {
	it('normal when 2Y < 10Y by > 25bps', () => {
		expect(classifyCurve(4.5, 4.0, null, null)).toBe('normal'); // 3m, 2y, 10y: 3m<2y<10y
	});

	it('inverted when 3M > 10Y', () => {
		// 5.5% 3m, 4.0% 10y
		expect(classifyCurve(5.5, 4.5, 4.0, 3.8)).toBe('inverted');
	});

	it('inverted when 2Y > 10Y', () => {
		expect(classifyCurve(null, 5.0, 4.5, null)).toBe('inverted');
	});

	it('flat when 2Y and 10Y within 25bps', () => {
		expect(classifyCurve(null, 4.5, 4.6, null)).toBe('flat');
	});

	it('normal when 2Y < 10Y by > 25bps with no 3M data', () => {
		expect(classifyCurve(null, 4.0, 5.0, null)).toBe('normal');
	});

	it('normal with all nulls (fallback)', () => {
		expect(classifyCurve(null, null, null, null)).toBe('normal');
	});
});

// ─── classificationLabel ──────────────────────────────────────────────────────

describe('classificationLabel', () => {
	it('returns inverted label', () => {
		expect(classificationLabel('inverted')).toContain('INVERTED');
	});

	it('returns flat label', () => {
		expect(classificationLabel('flat')).toContain('FLAT');
	});

	it('returns normal label', () => {
		expect(classificationLabel('normal')).toContain('NORMAL');
	});

	it('returns humped label', () => {
		expect(classificationLabel('humped')).toContain('HUMPED');
	});
});

// ─── buildYieldCurveSnapshot ──────────────────────────────────────────────────

function makeFetcher(yields: Record<string, { current: number; prev: number } | null>): YieldFetcher {
	return async (symbol: string) => yields[symbol] ?? null;
}

const MOCK_NORMAL: Record<string, { current: number; prev: number }> = {
	'^IRX':   { current: 5.10, prev: 5.08 },
	'^UST2Y': { current: 4.50, prev: 4.48 },
	'^FVX':   { current: 4.20, prev: 4.18 },
	'^TNX':   { current: 4.00, prev: 3.98 },  // intentionally lower than 2Y → inverted
	'^TYX':   { current: 4.30, prev: 4.28 },
};

// Normal curve: 3M < 2Y < 5Y < 10Y < 30Y
const MOCK_STEEP: Record<string, { current: number; prev: number }> = {
	'^IRX':   { current: 3.00, prev: 2.98 },
	'^UST2Y': { current: 3.50, prev: 3.48 },
	'^FVX':   { current: 4.00, prev: 3.98 },
	'^TNX':   { current: 4.50, prev: 4.48 },
	'^TYX':   { current: 5.00, prev: 4.98 },
};

describe('buildYieldCurveSnapshot', () => {
	it('returns yields for all tickers that succeed', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		expect(snap.yields.length).toBe(5);
	});

	it('maps maturity names correctly', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		const maturities = snap.yields.map(y => y.maturity);
		expect(maturities).toContain('3M');
		expect(maturities).toContain('2Y');
		expect(maturities).toContain('10Y');
		expect(maturities).toContain('30Y');
	});

	it('computes day change in bps', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		const tenY = snap.yields.find(y => y.maturity === '10Y')!;
		expect(tenY.change).toBeCloseTo((4.50 - 4.48) * 100, 2); // 2bps
	});

	it('classifies steep curve as normal', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		expect(snap.classification).toBe('normal');
	});

	it('classifies inverted when 2Y > 10Y', async () => {
		// MOCK_NORMAL has 3M=5.1 > 10Y=4.0 → inverted
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_NORMAL));
		expect(snap.classification).toBe('inverted');
	});

	it('includes 2s10s spread', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		const s = snap.spreads.find(s => s.name.includes('2s10s'));
		expect(s).toBeDefined();
		// 10Y(4.5) - 2Y(3.5) = 1.0% = 100 bps
		expect(s!.spread).toBeCloseTo(100, 0);
	});

	it('includes 3m10y spread', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		const s = snap.spreads.find(s => s.name.includes('3m10y'));
		expect(s).toBeDefined();
		// 10Y(4.5) - 3M(3.0) = 1.5% = 150 bps
		expect(s!.spread).toBeCloseTo(150, 0);
	});

	it('includes 5s30s spread', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		const s = snap.spreads.find(s => s.name.includes('5s30s'));
		expect(s).toBeDefined();
		// 30Y(5.0) - 5Y(4.0) = 1.0% = 100 bps
		expect(s!.spread).toBeCloseTo(100, 0);
	});

	it('handles missing tickers gracefully', async () => {
		const partial: Record<string, { current: number; prev: number } | null> = {
			'^IRX': { current: 5.0, prev: 4.9 },
			'^UST2Y': null,
			'^FVX': null,
			'^TNX': { current: 4.5, prev: 4.4 },
			'^TYX': null,
		};
		const snap = await buildYieldCurveSnapshot(makeFetcher(partial));
		expect(snap.yields.length).toBe(2);
	});

	it('handles all failures gracefully', async () => {
		const fetcher: YieldFetcher = async () => null;
		const snap = await buildYieldCurveSnapshot(fetcher);
		expect(snap.yields.length).toBe(0);
		expect(snap.spreads.length).toBe(0);
	});

	it('classificationLabel is a non-empty string', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		expect(snap.classificationLabel.length).toBeGreaterThan(0);
	});

	it('fetchedAt is a recent timestamp', async () => {
		const before = Date.now();
		const snap   = await buildYieldCurveSnapshot(makeFetcher(MOCK_STEEP));
		expect(snap.fetchedAt).toBeGreaterThanOrEqual(before);
		expect(snap.fetchedAt).toBeLessThanOrEqual(Date.now());
	});

	it('inverted 2s10s spread has negative value', async () => {
		// 2Y(4.5) > 10Y(4.0) → spread = (4.0 - 4.5) * 100 = -50 bps
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_NORMAL));
		const s = snap.spreads.find(s => s.name.includes('2s10s'));
		expect(s!.spread).toBeLessThan(0);
	});

	it('spread signal mentions INVERTED for inverted spread', async () => {
		const snap = await buildYieldCurveSnapshot(makeFetcher(MOCK_NORMAL));
		const s = snap.spreads.find(s => s.name.includes('2s10s'));
		expect(s!.signal.toUpperCase()).toContain('INVERTED');
	});
});
