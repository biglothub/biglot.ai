// HeatmapBlock tests — T-903
// Type-correctness and data-transformation tests.
// Component rendering deferred to E2E (no Svelte test env configured).

import { describe, it, expect } from 'vitest';
import type { HeatmapBlock } from '$lib/types/contentBlock';

// ─── Mock data helpers ─────────────────────────────────────────────────────────

function makeHeatmap(overrides: Partial<HeatmapBlock> = {}): HeatmapBlock {
	return {
		type: 'heatmap',
		title: 'Test Heatmap',
		assets: ['BTC', 'ETH', 'SOL'],
		timeframes: ['1D', '1W', '1M'],
		data: [
			[5.0, -2.0, 10.0],
			[12.0, -8.0, 25.0],
			[40.0, 15.0, -5.0],
		],
		colorScale: 'redgreen',
		...overrides,
	};
}

// ─── HeatmapBlock type shape ───────────────────────────────────────────────────

describe('HeatmapBlock type', () => {
	it('accepts a valid redgreen heatmap', () => {
		const block: HeatmapBlock = makeHeatmap();
		expect(block.type).toBe('heatmap');
		expect(block.colorScale).toBe('redgreen');
	});

	it('accepts goldblue color scale', () => {
		const block: HeatmapBlock = makeHeatmap({ colorScale: 'goldblue' });
		expect(block.colorScale).toBe('goldblue');
	});

	it('assets length matches columns', () => {
		const block = makeHeatmap();
		expect(block.assets).toHaveLength(3);
		expect(block.data[0]).toHaveLength(block.assets.length);
	});

	it('timeframes length matches rows', () => {
		const block = makeHeatmap();
		expect(block.timeframes).toHaveLength(3);
		expect(block.data).toHaveLength(block.timeframes.length);
	});

	it('data values can be negative', () => {
		const block = makeHeatmap();
		const allValues = block.data.flat();
		expect(allValues.some(v => v < 0)).toBe(true);
	});

	it('data values can be positive', () => {
		const block = makeHeatmap();
		const allValues = block.data.flat();
		expect(allValues.some(v => v > 0)).toBe(true);
	});
});

// ─── Color scale logic (pure functions mirroring component) ───────────────────

/** maxAbs as computed by the component */
function calcMaxAbs(data: number[][]): number {
	const allValues = data.flat().filter(v => !isNaN(v));
	return Math.max(Math.abs(Math.min(...allValues, 0)), Math.abs(Math.max(...allValues, 0)), 0.01);
}

function cellBg(value: number, maxAbs: number, colorScale: 'redgreen' | 'goldblue'): string {
	const norm = Math.max(-1, Math.min(1, value / maxAbs));
	if (colorScale === 'goldblue') {
		return norm > 0
			? `rgba(245, 158, 11, ${norm * 0.7})`
			: `rgba(59, 130, 246, ${Math.abs(norm) * 0.7})`;
	}
	return norm > 0
		? `rgba(34, 197, 94, ${norm * 0.7})`
		: `rgba(239, 68, 68, ${Math.abs(norm) * 0.7})`;
}

describe('calcMaxAbs', () => {
	it('returns max absolute value from data', () => {
		const data = [[5, -10, 3]];
		expect(calcMaxAbs(data)).toBe(10);
	});

	it('returns at least 0.01 for all-zero data', () => {
		expect(calcMaxAbs([[0, 0]])).toBe(0.01);
	});

	it('handles all positive values', () => {
		expect(calcMaxAbs([[1, 2, 5]])).toBe(5);
	});

	it('handles single negative value', () => {
		expect(calcMaxAbs([[-7]])).toBe(7);
	});
});

describe('cellBg — redgreen scale', () => {
	it('returns green-ish for positive values', () => {
		const maxAbs = 10;
		const color = cellBg(5, maxAbs, 'redgreen');
		expect(color).toContain('34, 197, 94');
	});

	it('returns red-ish for negative values', () => {
		const maxAbs = 10;
		const color = cellBg(-5, maxAbs, 'redgreen');
		expect(color).toContain('239, 68, 68');
	});

	it('alpha is zero for zero value', () => {
		const color = cellBg(0, 10, 'redgreen');
		expect(color).toContain('0)');
	});

	it('alpha is 0.7 for max value', () => {
		const color = cellBg(10, 10, 'redgreen');
		expect(color).toContain('0.7');
	});
});

describe('cellBg — goldblue scale', () => {
	it('returns amber for positive values', () => {
		const color = cellBg(5, 10, 'goldblue');
		expect(color).toContain('245, 158, 11');
	});

	it('returns blue for negative values', () => {
		const color = cellBg(-5, 10, 'goldblue');
		expect(color).toContain('59, 130, 246');
	});
});

describe('norm clamping', () => {
	it('clamps values exceeding maxAbs to ±1', () => {
		// When value > maxAbs, norm should be clamped to 1
		// alpha = norm * 0.7 = 0.7
		const color = cellBg(100, 10, 'redgreen');
		expect(color).toContain('0.7');
	});

	it('clamps large negative values to -1', () => {
		const color = cellBg(-100, 10, 'redgreen');
		expect(color).toContain('0.7');
	});
});

// ─── HeatmapBlock shape variants ──────────────────────────────────────────────

describe('HeatmapBlock data variants', () => {
	it('handles 1×1 heatmap', () => {
		const block = makeHeatmap({
			assets: ['BTC'],
			timeframes: ['1D'],
			data: [[3.5]],
		});
		expect(block.data[0][0]).toBe(3.5);
	});

	it('handles large heatmap', () => {
		const n = 10;
		const block = makeHeatmap({
			assets: Array.from({ length: n }, (_, i) => `A${i}`),
			timeframes: Array.from({ length: n }, (_, i) => `T${i}`),
			data: Array.from({ length: n }, () => Array.from({ length: n }, () => Math.random() * 20 - 10)),
		});
		expect(block.data).toHaveLength(n);
		expect(block.data[0]).toHaveLength(n);
	});

	it('handles null-equivalent zeros in data', () => {
		const block = makeHeatmap({ data: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
		const maxAbs = calcMaxAbs(block.data);
		expect(maxAbs).toBe(0.01); // fallback minimum
	});
});
