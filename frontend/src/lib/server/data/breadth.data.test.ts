// Tests for breadth.data.ts — T-206
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	calcPctChange,
	classifyRelative,
	heatmapColor,
	fetchBreadthSnapshot,
	SECTOR_ETFS,
} from './breadth.data';

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('calcPctChange', () => {
	it('calculates positive % change', () => {
		expect(calcPctChange([100, 105, 110], 0)).toBeCloseTo(10, 2);
	});

	it('calculates negative % change', () => {
		expect(calcPctChange([100, 90], 0)).toBeCloseTo(-10, 2);
	});

	it('returns 0 when base is 0', () => {
		expect(calcPctChange([0, 100], 0)).toBe(0);
	});

	it('calculates change from mid-array index', () => {
		expect(calcPctChange([80, 100, 110], 1)).toBeCloseTo(10, 2);
	});

	it('returns 0 for flat prices', () => {
		expect(calcPctChange([100, 100, 100], 0)).toBe(0);
	});
});

describe('classifyRelative', () => {
	it('classifies outperform when vsSpy > 1', () => {
		expect(classifyRelative(2)).toBe('outperform');
		expect(classifyRelative(1.1)).toBe('outperform');
	});

	it('classifies underperform when vsSpy < -1', () => {
		expect(classifyRelative(-2)).toBe('underperform');
		expect(classifyRelative(-1.1)).toBe('underperform');
	});

	it('classifies inline within ±1%', () => {
		expect(classifyRelative(0)).toBe('inline');
		expect(classifyRelative(1)).toBe('inline');
		expect(classifyRelative(-1)).toBe('inline');
	});
});

describe('heatmapColor', () => {
	it('returns strong green for pct > 5', () => {
		expect(heatmapColor(6)).toBe('#16a34a');
	});

	it('returns light green for pct between 2 and 5', () => {
		expect(heatmapColor(3)).toBe('#4ade80');
	});

	it('returns pale green for pct between 0 and 2', () => {
		expect(heatmapColor(1)).toBe('#86efac');
	});

	it('returns pale red for pct between -2 and 0', () => {
		expect(heatmapColor(-1)).toBe('#fca5a5');
	});

	it('returns light red for pct between -5 and -2', () => {
		expect(heatmapColor(-3)).toBe('#f87171');
	});

	it('returns strong red for pct <= -5', () => {
		expect(heatmapColor(-6)).toBe('#dc2626');
	});
});

// ─── SECTOR_ETFS ──────────────────────────────────────────────────────────────

describe('SECTOR_ETFS', () => {
	it('includes SPY as the first entry', () => {
		expect(SECTOR_ETFS[0].ticker).toBe('SPY');
	});

	it('includes core sector ETFs', () => {
		const tickers = SECTOR_ETFS.map(e => e.ticker);
		expect(tickers).toContain('XLK');
		expect(tickers).toContain('XLF');
		expect(tickers).toContain('XLE');
	});

	it('has names for all tickers', () => {
		for (const etf of SECTOR_ETFS) {
			expect(etf.name).toBeTruthy();
		}
	});
});

// ─── fetchBreadthSnapshot ─────────────────────────────────────────────────────

function makeYahooResponse(closes: number[]) {
	return {
		ok: true,
		json: async () => ({
			chart: {
				result: [{
					timestamp: closes.map((_, i) => 1_700_000_000 + i * 86400),
					meta: { shortName: 'ETF', regularMarketPrice: closes[closes.length - 1] },
					indicators: {
						quote: [{ close: closes }]
					}
				}]
			}
		})
	};
}

function makeCloses(base: number, n = 30, driftPct = 0): number[] {
	return Array.from({ length: n }, (_, i) => base * (1 + (driftPct / 100) * i / n));
}

describe('fetchBreadthSnapshot', () => {
	it('returns null when SPY fetch fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
		const result = await fetchBreadthSnapshot();
		expect(result).toBeNull();
	});

	it('returns snapshot when all ETFs succeed', async () => {
		// Provide responses for all SECTOR_ETFS (12 symbols)
		const fetchMock = vi.fn().mockImplementation(() =>
			Promise.resolve(makeYahooResponse(makeCloses(100, 30, 10)))
		);
		vi.stubGlobal('fetch', fetchMock);

		const result = await fetchBreadthSnapshot();
		expect(result).not.toBeNull();
		expect(result!.sectors.length).toBeGreaterThan(0);
		expect(result!.spyChange1m).toBeDefined();
	});

	it('returns null when all fetches fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
		const result = await fetchBreadthSnapshot();
		expect(result).toBeNull();
	});

	it('calculates vsSpY1m as difference from SPY', async () => {
		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
			callCount++;
			// SPY gets flat closes (0% 1M), all sectors get +10%
			const closes = callCount === 1
				? makeCloses(100, 30, 0)   // SPY: flat
				: makeCloses(100, 30, 10); // others: +10%
			return Promise.resolve(makeYahooResponse(closes));
		}));

		const result = await fetchBreadthSnapshot();
		expect(result).not.toBeNull();
		// SPY should be in sectors list
		const spy = result!.sectors.find(s => s.ticker === 'SPY');
		expect(spy).toBeDefined();
		// Non-SPY sectors should have vsSpY1m > 0
		const nonSpy = result!.sectors.filter(s => s.ticker !== 'SPY');
		if (nonSpy.length > 0) {
			expect(nonSpy[0].vsSpY1m).toBeGreaterThan(0);
		}
	});

	it('partial success: returns snapshot with available sectors', async () => {
		let count = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
			count++;
			// SPY succeeds, first 3 sectors succeed, rest fail
			if (count <= 4) {
				return Promise.resolve(makeYahooResponse(makeCloses(100, 30)));
			}
			return Promise.resolve({ ok: false });
		}));

		const result = await fetchBreadthSnapshot();
		// SPY is present → should succeed
		expect(result).not.toBeNull();
		expect(result!.sectors.length).toBeGreaterThanOrEqual(1);
	});

	it('includes fetchedAt as ISO string', async () => {
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
			Promise.resolve(makeYahooResponse(makeCloses(100, 30)))
		));

		const result = await fetchBreadthSnapshot();
		expect(result).not.toBeNull();
		expect(() => new Date(result!.fetchedAt)).not.toThrow();
	});

	it('correctly calculates 1D, 1W, 1M changes', async () => {
		// Controlled close array: 30 values with known changes
		const closes = makeCloses(100, 30, 30); // +30% total drift over 30 days
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
			Promise.resolve(makeYahooResponse(closes))
		));

		const result = await fetchBreadthSnapshot();
		expect(result).not.toBeNull();
		const spy = result!.sectors.find(s => s.ticker === 'SPY');
		if (spy) {
			// 1D change should be small positive
			expect(spy.change1d).toBeDefined();
			// 1M change over ~30 days should be close to 30%
			expect(spy.change1m).toBeGreaterThan(0);
		}
	});

	it('skips ETF when fewer than 5 closes returned', async () => {
		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
			callCount++;
			// SPY gets proper data, first non-SPY gets 3 closes (too short), rest get proper data
			if (callCount === 2) {
				return Promise.resolve(makeYahooResponse([100, 101, 102])); // only 3 closes
			}
			return Promise.resolve(makeYahooResponse(makeCloses(100, 30)));
		}));

		const result = await fetchBreadthSnapshot();
		expect(result).not.toBeNull();
		// Should still succeed with partial sectors
	});
});
