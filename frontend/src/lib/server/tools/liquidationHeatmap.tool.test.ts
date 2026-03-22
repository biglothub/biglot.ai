// Liquidation Heatmap Tool Tests — T-1206
// Tests for pure functions in liquidationHeatmap.data.ts

import { describe, it, expect } from 'vitest';
import {
	LEVERAGE_TIERS,
	LEVERAGE_DISTRIBUTION,
	buildLiquidationClusters,
	buildPriceBuckets,
	gaussianWeight,
	buildHeatmapData,
	findMagneticLevels,
} from '../data/liquidationHeatmap.data';

// ─── LEVERAGE_DISTRIBUTION ─────────────────────────────────────────────────────

describe('LEVERAGE_DISTRIBUTION', () => {
	it('covers all leverage tiers', () => {
		for (const tier of LEVERAGE_TIERS) {
			expect(LEVERAGE_DISTRIBUTION[tier]).toBeGreaterThan(0);
		}
	});

	it('sums to 1.0', () => {
		const total = LEVERAGE_TIERS.reduce((sum, t) => sum + LEVERAGE_DISTRIBUTION[t], 0);
		expect(total).toBeCloseTo(1.0, 10);
	});

	it('higher leverage tiers have smaller share (more risk-aware)', () => {
		expect(LEVERAGE_DISTRIBUTION[5]).toBeGreaterThan(LEVERAGE_DISTRIBUTION[100]);
	});
});

// ─── buildLiquidationClusters ─────────────────────────────────────────────────

describe('buildLiquidationClusters', () => {
	const currentPrice = 100_000;
	const openInterestUSD = 10_000_000;
	const longPct = 0.6;
	const shortPct = 0.4;

	const clusters = buildLiquidationClusters(currentPrice, openInterestUSD, longPct, shortPct);

	it('generates 2 clusters per leverage tier (long + short)', () => {
		expect(clusters).toHaveLength(LEVERAGE_TIERS.length * 2);
	});

	it('long clusters are below current price', () => {
		const longs = clusters.filter(c => c.side === 'long');
		for (const c of longs) {
			expect(c.priceLevel).toBeLessThan(currentPrice);
			expect(c.distancePct).toBeLessThan(0);
		}
	});

	it('short clusters are above current price', () => {
		const shorts = clusters.filter(c => c.side === 'short');
		for (const c of shorts) {
			expect(c.priceLevel).toBeGreaterThan(currentPrice);
			expect(c.distancePct).toBeGreaterThan(0);
		}
	});

	it('long liq price = currentPrice * (1 - 1/leverage)', () => {
		const tier5 = clusters.find(c => c.leverageTier === 5 && c.side === 'long')!;
		expect(tier5.priceLevel).toBeCloseTo(currentPrice * (1 - 1 / 5), 2);
	});

	it('short liq price = currentPrice * (1 + 1/leverage)', () => {
		const tier5 = clusters.find(c => c.leverageTier === 5 && c.side === 'short')!;
		expect(tier5.priceLevel).toBeCloseTo(currentPrice * (1 + 1 / 5), 2);
	});

	it('100x long liq is closest to current price from below', () => {
		const tier100 = clusters.find(c => c.leverageTier === 100 && c.side === 'long')!;
		expect(tier100.priceLevel).toBeCloseTo(currentPrice * 0.99, 1);
		expect(tier100.distancePct).toBeCloseTo(-1, 1);
	});

	it('100x short liq is closest to current price from above', () => {
		const tier100 = clusters.find(c => c.leverageTier === 100 && c.side === 'short')!;
		expect(tier100.priceLevel).toBeCloseTo(currentPrice * 1.01, 1);
		expect(tier100.distancePct).toBeCloseTo(1, 1);
	});

	it('volume for longs scales with longPct × OI × leverage weight', () => {
		const tier5 = clusters.find(c => c.leverageTier === 5 && c.side === 'long')!;
		const expected = openInterestUSD * longPct * LEVERAGE_DISTRIBUTION[5];
		expect(tier5.estimatedVolumeUSD).toBeCloseTo(expected, 2);
	});

	it('volume for shorts scales with shortPct × OI × leverage weight', () => {
		const tier10 = clusters.find(c => c.leverageTier === 10 && c.side === 'short')!;
		const expected = openInterestUSD * shortPct * LEVERAGE_DISTRIBUTION[10];
		expect(tier10.estimatedVolumeUSD).toBeCloseTo(expected, 2);
	});

	it('total estimated volume equals openInterestUSD', () => {
		const total = clusters.reduce((sum, c) => sum + c.estimatedVolumeUSD, 0);
		expect(total).toBeCloseTo(openInterestUSD, 0);
	});

	it('handles zero open interest gracefully', () => {
		const zeroClusters = buildLiquidationClusters(100_000, 0, 0.5, 0.5);
		for (const c of zeroClusters) {
			expect(c.estimatedVolumeUSD).toBe(0);
		}
	});

	it('assigns correct leverageTier to each cluster', () => {
		for (const tier of LEVERAGE_TIERS) {
			const longCluster = clusters.find(c => c.leverageTier === tier && c.side === 'long');
			const shortCluster = clusters.find(c => c.leverageTier === tier && c.side === 'short');
			expect(longCluster).toBeDefined();
			expect(shortCluster).toBeDefined();
		}
	});
});

// ─── buildPriceBuckets ────────────────────────────────────────────────────────

describe('buildPriceBuckets', () => {
	const currentPrice = 50_000;

	it('returns the specified number of buckets', () => {
		expect(buildPriceBuckets(currentPrice, 15)).toHaveLength(15);
		expect(buildPriceBuckets(currentPrice, 10)).toHaveLength(10);
	});

	it('first bucket is ~22% below current price', () => {
		const buckets = buildPriceBuckets(currentPrice, 15);
		expect(buckets[0]).toBeCloseTo(currentPrice * 0.78, 0);
	});

	it('last bucket is ~22% above current price', () => {
		const buckets = buildPriceBuckets(currentPrice, 15);
		expect(buckets[14]).toBeCloseTo(currentPrice * 1.22, 0);
	});

	it('buckets are sorted low to high', () => {
		const buckets = buildPriceBuckets(currentPrice, 15);
		for (let i = 1; i < buckets.length; i++) {
			expect(buckets[i]).toBeGreaterThan(buckets[i - 1]);
		}
	});

	it('middle bucket is approximately at current price', () => {
		const buckets = buildPriceBuckets(currentPrice, 15);
		const mid = buckets[7]; // index 7 of 15 (middle)
		expect(mid).toBeCloseTo(currentPrice, -2); // within 1% tolerance
	});

	it('covers 5x leverage liquidation range (±20%)', () => {
		const buckets = buildPriceBuckets(currentPrice, 15);
		const minBucket = buckets[0];
		const maxBucket = buckets[buckets.length - 1];
		// 5x long liq at -20%, short at +20%
		expect(minBucket).toBeLessThan(currentPrice * 0.80);
		expect(maxBucket).toBeGreaterThan(currentPrice * 1.20);
	});
});

// ─── gaussianWeight ───────────────────────────────────────────────────────────

describe('gaussianWeight', () => {
	it('returns 1 when distance is 0', () => {
		expect(gaussianWeight(0, 100)).toBeCloseTo(1, 10);
	});

	it('returns less than 1 for non-zero distance', () => {
		expect(gaussianWeight(50, 100)).toBeLessThan(1);
		expect(gaussianWeight(50, 100)).toBeGreaterThan(0);
	});

	it('decays as distance increases', () => {
		const w1 = gaussianWeight(100, 100);
		const w2 = gaussianWeight(200, 100);
		expect(w1).toBeGreaterThan(w2);
	});

	it('returns near 0 for very large distances', () => {
		expect(gaussianWeight(1_000_000, 1)).toBeCloseTo(0, 10);
	});

	it('is symmetric around 0', () => {
		expect(gaussianWeight(50, 100)).toBeCloseTo(gaussianWeight(-50, 100), 10);
	});
});

// ─── buildHeatmapData ─────────────────────────────────────────────────────────

describe('buildHeatmapData', () => {
	const currentPrice = 100_000;
	const clusters = buildLiquidationClusters(currentPrice, 10_000_000, 0.55, 0.45);
	const priceBuckets = buildPriceBuckets(currentPrice, 15);
	const heatmapData = buildHeatmapData(clusters, priceBuckets);

	it('returns correct dimensions [numBuckets][numTiers]', () => {
		expect(heatmapData).toHaveLength(15);
		for (const row of heatmapData) {
			expect(row).toHaveLength(LEVERAGE_TIERS.length);
		}
	});

	it('values are in range ±100', () => {
		for (const row of heatmapData) {
			for (const v of row) {
				expect(Math.abs(v)).toBeLessThanOrEqual(100);
			}
		}
	});

	it('maximum absolute value equals 100 (normalized)', () => {
		const maxAbs = Math.max(...heatmapData.flat().map(Math.abs));
		expect(maxAbs).toBeCloseTo(100, 1);
	});

	it('lower buckets (below current price) have negative values at peak liq levels', () => {
		// The first bucket is ~22% below current — in long liq zone
		const firstRow = heatmapData[0];
		// At 5x leverage liq is exactly at -20%, so first bucket should have negative values
		expect(firstRow.some(v => v < 0)).toBe(true);
	});

	it('upper buckets (above current price) have positive values at peak liq levels', () => {
		// The last bucket is ~22% above current — in short liq zone
		const lastRow = heatmapData[heatmapData.length - 1];
		expect(lastRow.some(v => v > 0)).toBe(true);
	});

	it('returns zeros when no clusters provided', () => {
		const emptyData = buildHeatmapData([], priceBuckets);
		for (const row of emptyData) {
			for (const v of row) {
				expect(v).toBe(0);
			}
		}
	});

	it('handles single-bucket degenerate case', () => {
		const singleBucket = [currentPrice];
		const data = buildHeatmapData(clusters, singleBucket);
		expect(data).toHaveLength(1);
		expect(data[0]).toHaveLength(LEVERAGE_TIERS.length);
	});
});

// ─── findMagneticLevels ───────────────────────────────────────────────────────

describe('findMagneticLevels', () => {
	const currentPrice = 100_000;
	const clusters = buildLiquidationClusters(currentPrice, 10_000_000, 0.5, 0.5);
	const priceBuckets = buildPriceBuckets(currentPrice, 15);

	it('returns the requested number of levels', () => {
		expect(findMagneticLevels(clusters, priceBuckets, 3)).toHaveLength(3);
		expect(findMagneticLevels(clusters, priceBuckets, 1)).toHaveLength(1);
	});

	it('returns fewer levels when fewer buckets available', () => {
		const smallBuckets = [currentPrice * 0.9, currentPrice, currentPrice * 1.1];
		const levels = findMagneticLevels(clusters, smallBuckets, 5);
		expect(levels).toHaveLength(3); // only 3 buckets
	});

	it('sorted by totalVolumeUSD descending', () => {
		const levels = findMagneticLevels(clusters, priceBuckets, 5);
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i - 1].totalVolumeUSD).toBeGreaterThanOrEqual(levels[i].totalVolumeUSD);
		}
	});

	it('top magnetic levels are near liquidation cluster prices', () => {
		const levels = findMagneticLevels(clusters, priceBuckets, 3);
		const top = levels[0];
		// Nearest clusters are 100x: ±1% from current — or 5x: ±20%
		// The highest-volume bucket should be near one of the cluster liquidation prices
		const clusterPrices = clusters.map(c => c.priceLevel);
		const nearestDist = Math.min(...clusterPrices.map(p => Math.abs(p - top.price)));
		// Should be within 5% of a cluster liquidation price given bucket granularity
		expect(nearestDist / currentPrice).toBeLessThan(0.05);
	});

	it('returns empty array when no buckets', () => {
		expect(findMagneticLevels(clusters, [], 3)).toHaveLength(0);
	});

	it('all levels have positive totalVolumeUSD', () => {
		const levels = findMagneticLevels(clusters, priceBuckets, 3);
		for (const l of levels) {
			expect(l.totalVolumeUSD).toBeGreaterThan(0);
		}
	});
});

// ─── Heatmap structure: reversed ordering ─────────────────────────────────────

describe('heatmap row ordering for display', () => {
	it('reversing priceBuckets gives high → low order', () => {
		const buckets = buildPriceBuckets(100_000, 15);
		const reversed = [...buckets].reverse();
		for (let i = 1; i < reversed.length; i++) {
			expect(reversed[i]).toBeLessThan(reversed[i - 1]);
		}
	});

	it('reversing heatmapData alongside buckets preserves alignment', () => {
		const currentPrice = 100_000;
		const clusters = buildLiquidationClusters(currentPrice, 5_000_000, 0.5, 0.5);
		const buckets = buildPriceBuckets(currentPrice, 5);
		const data = buildHeatmapData(clusters, buckets);

		const revBuckets = [...buckets].reverse();
		const revData = [...data].reverse();

		// Each reversed row should correspond to its reversed bucket
		for (let i = 0; i < revBuckets.length; i++) {
			const origIdx = buckets.indexOf(revBuckets[i]);
			expect(revData[i]).toEqual(data[origIdx]);
		}
	});
});
