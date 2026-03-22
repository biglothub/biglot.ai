// Tests for seasonality.data.ts — T-704
import { describe, it, expect, vi } from 'vitest';
import {
	computeMonthlyReturns,
	computeDOWReturns,
	aggregateMonthlyScores,
	buildSeasonalityData,
	MONTH_NAMES,
	DAY_NAMES,
} from './seasonality.data';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Build a series of daily timestamps + closes spanning n months. */
function buildSeries(months: number, startYear = 2020, startMonth = 1): { timestamps: number[]; closes: number[] } {
	const timestamps: number[] = [];
	const closes: number[] = [];
	let price = 1000;

	for (let m = 0; m < months; m++) {
		const year  = startYear + Math.floor((startMonth - 1 + m) / 12);
		const month = ((startMonth - 1 + m) % 12) + 1;
		const daysInMonth = new Date(year, month, 0).getDate();

		for (let d = 1; d <= daysInMonth; d += 1) {
			const ts = Date.UTC(year, month - 1, d) / 1000;
			price *= (1 + (Math.random() - 0.49) * 0.02); // slight upward drift
			timestamps.push(ts);
			closes.push(price);
		}
	}

	return { timestamps, closes };
}

// ─── computeMonthlyReturns ────────────────────────────────────────────────────

describe('computeMonthlyReturns', () => {
	it('returns empty for fewer than 2 data points', () => {
		expect(computeMonthlyReturns([], [])).toHaveLength(0);
		expect(computeMonthlyReturns([1000000], [100])).toHaveLength(0);
	});

	it('returns empty when arrays differ in length', () => {
		expect(computeMonthlyReturns([1000000, 1001000], [100])).toHaveLength(0);
	});

	it('computes one monthly return per calendar month', () => {
		const { timestamps, closes } = buildSeries(6);
		const results = computeMonthlyReturns(timestamps, closes);
		expect(results.length).toBe(6);
	});

	it('return has year, month, returnPct fields', () => {
		const { timestamps, closes } = buildSeries(3, 2022, 1);
		const results = computeMonthlyReturns(timestamps, closes);
		for (const r of results) {
			expect(typeof r.year).toBe('number');
			expect(r.month).toBeGreaterThanOrEqual(1);
			expect(r.month).toBeLessThanOrEqual(12);
			expect(typeof r.returnPct).toBe('number');
		}
	});

	it('results are sorted by date', () => {
		const { timestamps, closes } = buildSeries(12, 2021, 1);
		const results = computeMonthlyReturns(timestamps, closes);
		for (let i = 1; i < results.length; i++) {
			const prev = results[i - 1];
			const curr = results[i];
			expect(curr.year * 100 + curr.month).toBeGreaterThan(prev.year * 100 + prev.month);
		}
	});

	it('a month where close > open has positive return', () => {
		// Jan 2020: two data points, price goes up
		const timestamps = [
			Date.UTC(2020, 0, 1) / 1000,
			Date.UTC(2020, 0, 31) / 1000,
		];
		const closes = [100, 110];
		const results = computeMonthlyReturns(timestamps, closes);
		expect(results.length).toBe(1);
		expect(results[0].returnPct).toBeGreaterThan(0);
	});
});

// ─── computeDOWReturns ────────────────────────────────────────────────────────

describe('computeDOWReturns', () => {
	it('returns empty for fewer than 2 data points', () => {
		expect(computeDOWReturns([], [])).toHaveLength(0);
	});

	it('returns scores only for days that appear in data', () => {
		const { timestamps, closes } = buildSeries(3);
		const scores = computeDOWReturns(timestamps, closes);
		expect(scores.length).toBeGreaterThan(0);
		for (const s of scores) {
			expect(s.dayIndex).toBeGreaterThanOrEqual(0);
			expect(s.dayIndex).toBeLessThanOrEqual(6);
			expect(DAY_NAMES).toContain(s.dayName);
			expect(s.sampleCount).toBeGreaterThan(0);
		}
	});

	it('avgReturnPct is numeric', () => {
		const { timestamps, closes } = buildSeries(12);
		const scores = computeDOWReturns(timestamps, closes);
		for (const s of scores) {
			expect(typeof s.avgReturnPct).toBe('number');
			expect(isNaN(s.avgReturnPct)).toBe(false);
		}
	});
});

// ─── aggregateMonthlyScores ───────────────────────────────────────────────────

describe('aggregateMonthlyScores', () => {
	it('returns 12 scores even for empty input', () => {
		const scores = aggregateMonthlyScores([]);
		expect(scores).toHaveLength(12);
	});

	it('months with no data have zero score and zero avgReturn', () => {
		const scores = aggregateMonthlyScores([]);
		for (const s of scores) {
			expect(s.avgReturnPct).toBe(0);
			expect(s.score).toBe(0);
		}
	});

	it('correct month names', () => {
		const scores = aggregateMonthlyScores([]);
		scores.forEach((s, i) => {
			expect(s.monthName).toBe(MONTH_NAMES[i]);
			expect(s.month).toBe(i + 1);
		});
	});

	it('winRate is between 0 and 100', () => {
		const { timestamps, closes } = buildSeries(60, 2019, 1);
		const monthly = computeMonthlyReturns(timestamps, closes);
		const scores  = aggregateMonthlyScores(monthly);
		for (const s of scores) {
			expect(s.winRate).toBeGreaterThanOrEqual(0);
			expect(s.winRate).toBeLessThanOrEqual(100);
		}
	});

	it('score is in -100..+100', () => {
		const { timestamps, closes } = buildSeries(60, 2019, 1);
		const monthly = computeMonthlyReturns(timestamps, closes);
		const scores  = aggregateMonthlyScores(monthly);
		for (const s of scores) {
			expect(s.score).toBeGreaterThanOrEqual(-100);
			expect(s.score).toBeLessThanOrEqual(100);
		}
	});

	it('month with all-positive returns has positive score', () => {
		const allPositive = Array.from({ length: 5 }, (_, i) => ({
			year: 2019 + i, month: 4, returnPct: 5 + i,
		}));
		const scores = aggregateMonthlyScores(allPositive);
		const apr = scores.find(s => s.month === 4)!;
		expect(apr.score).toBeGreaterThan(0);
		expect(apr.winRate).toBe(100);
	});

	it('month with all-negative returns has negative score', () => {
		const allNeg = Array.from({ length: 5 }, (_, i) => ({
			year: 2019 + i, month: 9, returnPct: -3 - i,
		}));
		const scores = aggregateMonthlyScores(allNeg);
		const sep = scores.find(s => s.month === 9)!;
		expect(sep.score).toBeLessThan(0);
		expect(sep.winRate).toBe(0);
	});

	it('median is computed correctly for even count', () => {
		const data = [
			{ year: 2020, month: 1, returnPct: 2 },
			{ year: 2021, month: 1, returnPct: 4 },
			{ year: 2022, month: 1, returnPct: 6 },
			{ year: 2023, month: 1, returnPct: 8 },
		];
		const scores = aggregateMonthlyScores(data);
		const jan = scores.find(s => s.month === 1)!;
		expect(jan.medianReturn).toBeCloseTo(5, 5); // (4+6)/2
	});
});

// ─── buildSeasonalityData ─────────────────────────────────────────────────────

describe('buildSeasonalityData', () => {
	it('returns correct shape for valid data', async () => {
		const { timestamps, closes } = buildSeries(60, 2019, 1);
		const mockFetcher = vi.fn().mockResolvedValue({ timestamps, closes });
		const result = await buildSeasonalityData('BTC-USD', 5, mockFetcher);

		expect(result.symbol).toBe('BTC-USD');
		expect(result.monthlyScores).toHaveLength(12);
		expect(result.dowScores.length).toBeGreaterThan(0);
		expect(result.bestMonths).toHaveLength(3);
		expect(result.worstMonths).toHaveLength(3);
		expect(result.currentMonth).toBeGreaterThanOrEqual(1);
		expect(result.currentMonth).toBeLessThanOrEqual(12);
	});

	it('bestMonths are distinct from worstMonths', async () => {
		const { timestamps, closes } = buildSeries(60, 2019, 1);
		const mockFetcher = vi.fn().mockResolvedValue({ timestamps, closes });
		const result = await buildSeasonalityData('BTC-USD', 5, mockFetcher);

		const bestSet  = new Set(result.bestMonths);
		const worstSet = new Set(result.worstMonths);
		const overlap  = [...bestSet].filter(m => worstSet.has(m));
		expect(overlap).toHaveLength(0);
	});

	it('handles empty fetcher result gracefully', async () => {
		const mockFetcher = vi.fn().mockResolvedValue({ timestamps: [], closes: [] });
		const result = await buildSeasonalityData('UNKNOWN', 5, mockFetcher);
		expect(result.monthlyScores).toHaveLength(12);
		expect(result.dowScores).toHaveLength(0);
	});

	it('currentMonthScore matches currentMonth', async () => {
		const { timestamps, closes } = buildSeries(60, 2019, 1);
		const mockFetcher = vi.fn().mockResolvedValue({ timestamps, closes });
		const result = await buildSeasonalityData('SPY', 5, mockFetcher);

		if (result.currentMonthScore) {
			expect(result.currentMonthScore.month).toBe(result.currentMonth);
		}
	});
});
