// Tests for correlation matrix — T-304
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	pearsonCorrelation,
	toReturns,
	alignSeries,
	buildCorrelationMatrix,
	corrLabel,
} from './correlation';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Import tool to register it (crossAsset has the correlation matrix tool appended)
import '../tools/crossAsset.tool';

// ─── pearsonCorrelation ────────────────────────────────────────────────────────

describe('pearsonCorrelation', () => {
	it('returns 1 for perfectly correlated series', () => {
		const x = [1, 2, 3, 4, 5];
		expect(pearsonCorrelation(x, x)).toBeCloseTo(1);
	});

	it('returns -1 for perfectly negatively correlated series', () => {
		const x = [1, 2, 3, 4, 5];
		const y = [5, 4, 3, 2, 1];
		expect(pearsonCorrelation(x, y)).toBeCloseTo(-1);
	});

	it('returns 0 for uncorrelated series', () => {
		const x = [1, -1, 1, -1];
		const y = [1, 1, -1, -1];
		expect(pearsonCorrelation(x, y)).toBeCloseTo(0);
	});

	it('returns 0 for constant series (zero std dev)', () => {
		const x = [5, 5, 5, 5];
		const y = [1, 2, 3, 4];
		expect(pearsonCorrelation(x, y)).toBe(0);
	});

	it('returns 0 when fewer than 2 elements', () => {
		expect(pearsonCorrelation([], [])).toBe(0);
		expect(pearsonCorrelation([1], [1])).toBe(0);
	});

	it('clamps result to [-1, 1]', () => {
		const x = [0.1, 0.2, 0.3];
		const y = [0.1, 0.2, 0.3];
		const r = pearsonCorrelation(x, y);
		expect(r).toBeGreaterThanOrEqual(-1);
		expect(r).toBeLessThanOrEqual(1);
	});

	it('calculates partial correlation correctly', () => {
		const x = [1, 2, 3, 4];
		const y = [2, 4, 5, 4];
		const r = pearsonCorrelation(x, y);
		expect(r).toBeGreaterThan(0.5);
		expect(r).toBeLessThan(1);
	});
});

// ─── toReturns ────────────────────────────────────────────────────────────────

describe('toReturns', () => {
	it('returns empty array for single-element input', () => {
		expect(toReturns([100])).toEqual([]);
	});

	it('returns empty array for empty input', () => {
		expect(toReturns([])).toEqual([]);
	});

	it('calculates correct percentage returns', () => {
		const closes = [100, 110, 99];
		const returns = toReturns(closes);
		expect(returns).toHaveLength(2);
		expect(returns[0]).toBeCloseTo(0.1);
		expect(returns[1]).toBeCloseTo(-0.1);
	});

	it('handles zero previous close gracefully', () => {
		const closes = [0, 100, 110];
		const returns = toReturns(closes);
		expect(returns).toHaveLength(1);
		expect(returns[0]).toBeCloseTo(0.1);
	});

	it('returns n-1 elements for n-element input', () => {
		const closes = [10, 20, 30, 40, 50];
		expect(toReturns(closes)).toHaveLength(4);
	});
});

// ─── alignSeries ──────────────────────────────────────────────────────────────

describe('alignSeries', () => {
	it('trims to window and aligns equal-length series', () => {
		const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const b = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
		const [ra, rb] = alignSeries(a, b, 5);
		expect(ra).toHaveLength(5);
		expect(rb).toHaveLength(5);
		expect(ra).toEqual([6, 7, 8, 9, 10]);
	});

	it('aligns to shorter series when lengths differ', () => {
		const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		const b = [1, 2, 3];
		const [ra, rb] = alignSeries(a, b, 10);
		expect(ra).toHaveLength(3);
		expect(rb).toHaveLength(3);
	});

	it('aligns to min when window exceeds series', () => {
		const a = [1, 2, 3];
		const b = [4, 5];
		const [ra, rb] = alignSeries(a, b, 100);
		expect(ra).toHaveLength(2);
		expect(rb).toHaveLength(2);
	});
});

// ─── buildCorrelationMatrix ───────────────────────────────────────────────────

describe('buildCorrelationMatrix', () => {
	function makeSeries(start: number, slope: number, n: number): number[] {
		return Array.from({ length: n }, (_, i) => start + i * slope);
	}

	it('builds 2x2 matrix with known correlations', () => {
		const n = 50;
		const seriesMap = new Map([
			['A', makeSeries(100, 1, n)],
			['B', makeSeries(200, 1, n)],
		]);
		const { labels, matrix } = buildCorrelationMatrix(['A', 'B'], seriesMap, 30);

		expect(labels).toEqual(['A', 'B']);
		expect(matrix[0][0]).toBe(1);
		expect(matrix[1][1]).toBe(1);
		expect(matrix[0][1]).toBeCloseTo(1);
		expect(matrix[1][0]).toBeCloseTo(1);
	});

	it('produces symmetric matrix', () => {
		const n = 40;
		const seriesMap = new Map([
			['X', makeSeries(100, 2, n)],
			['Y', makeSeries(50, -1, n)],
			['Z', makeSeries(1000, 5, n)],
		]);
		const { labels, matrix } = buildCorrelationMatrix(['X', 'Y', 'Z'], seriesMap, 30);

		for (let i = 0; i < labels.length; i++) {
			for (let j = 0; j < labels.length; j++) {
				expect(matrix[i][j]).toBeCloseTo(matrix[j][i], 10);
			}
		}
	});

	it('filters out assets with insufficient data', () => {
		const seriesMap = new Map([
			['GOOD', makeSeries(100, 1, 50)],
			['SHORT', [100, 101]],
		]);
		const { labels } = buildCorrelationMatrix(['GOOD', 'SHORT'], seriesMap, 30, 5);
		expect(labels).not.toContain('SHORT');
		expect(labels).toContain('GOOD');
	});

	it('returns empty labels when no assets pass filter', () => {
		const seriesMap = new Map([['A', [100, 101]]]);
		const { labels, matrix } = buildCorrelationMatrix(['A'], seriesMap, 30, 5);
		expect(labels).toHaveLength(0);
		expect(matrix).toHaveLength(0);
	});

	it('handles missing label in seriesMap', () => {
		const seriesMap = new Map([['A', makeSeries(100, 1, 50)]]);
		const { labels } = buildCorrelationMatrix(['A', 'B'], seriesMap, 30);
		expect(labels).not.toContain('B');
	});
});

// ─── corrLabel ────────────────────────────────────────────────────────────────

describe('corrLabel', () => {
	it('labels strong positive correlation', () => {
		const label = corrLabel(0.9);
		expect(label).toContain('Strong');
		expect(label).toContain('+');
	});

	it('labels strong negative correlation', () => {
		const label = corrLabel(-0.85);
		expect(label).toContain('Strong');
		expect(label).toContain('−');
	});

	it('labels moderate correlation', () => {
		expect(corrLabel(0.6)).toContain('Moderate');
		expect(corrLabel(-0.55)).toContain('Moderate');
	});

	it('labels weak correlation', () => {
		expect(corrLabel(0.25)).toContain('Weak');
		expect(corrLabel(-0.3)).toContain('Weak');
	});

	it('labels near-zero as None', () => {
		expect(corrLabel(0.1)).toBe('None');
		expect(corrLabel(-0.05)).toBe('None');
		expect(corrLabel(0)).toBe('None');
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('get_correlation_matrix tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('get_correlation_matrix')).toBeDefined();
	});

	it('returns error when symbols missing', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_correlation_matrix')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});

	it('returns error when only one symbol provided', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_correlation_matrix')!;
		const result = await tool.execute({ symbols: 'BTC' });
		expect(result.success).toBe(false);
	});
});
