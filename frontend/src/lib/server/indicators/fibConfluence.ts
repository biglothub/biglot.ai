// Fibonacci Confluence Zone Scanner — T-903
// Detects price zones where multiple Fibonacci levels from different swings cluster

import type { OHLCV } from '$lib/types/contentBlock';
import { findPivots, type Pivot } from './patterns';

// ─── Constants ────────────────────────────────────────────────────────────────

export const FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786] as const;
export const FIB_EXTENSIONS   = [1.272, 1.618] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FibLevel {
	price: number;
	ratio: number;       // e.g. 0.382
	label: string;       // e.g. "38.2% Ret"
	swingHigh: number;
	swingLow: number;
	swingIndex: number;  // index of the swing in the pivot array
	levelType: 'retracement' | 'extension';
}

export interface ConfluenceZone {
	price: number;           // cluster centroid (mean of levels)
	priceMin: number;        // lowest level in cluster
	priceMax: number;        // highest level in cluster
	strength: number;        // number of Fib levels in this zone
	levels: FibLevel[];      // contributing levels
	zoneType: 'support' | 'resistance' | 'pivot';
	distancePct: number;     // % distance from current price (signed: negative = below)
}

export interface FibConfluenceResult {
	zones: ConfluenceZone[];
	currentPrice: number;
	nearestSupport: ConfluenceZone | null;
	nearestResistance: ConfluenceZone | null;
	totalLevels: number;
	swingCount: number;
}

// ─── Level computation ────────────────────────────────────────────────────────

/**
 * Compute all Fibonacci retracement and extension levels for a single swing.
 * A "swing" is defined by a high and low pivot pair.
 */
export function computeSwingFibLevels(
	swingHigh: number,
	swingLow: number,
	swingIndex: number,
): FibLevel[] {
	if (swingHigh <= swingLow) return [];
	const range   = swingHigh - swingLow;
	const levels: FibLevel[] = [];

	// Retracements: measured from swingHigh downward
	for (const ratio of FIB_RETRACEMENTS) {
		levels.push({
			price:      swingHigh - range * ratio,
			ratio,
			label:      `${(ratio * 100).toFixed(1)}% Ret`,
			swingHigh,
			swingLow,
			swingIndex,
			levelType: 'retracement',
		});
	}

	// Extensions above swingHigh (upside targets from swingLow)
	for (const ratio of FIB_EXTENSIONS) {
		levels.push({
			price:      swingLow + range * ratio,
			ratio,
			label:      `${(ratio * 100).toFixed(1)}% Ext↑`,
			swingHigh,
			swingLow,
			swingIndex,
			levelType: 'extension',
		});
	}

	// Extensions below swingLow (downside targets from swingHigh)
	for (const ratio of FIB_EXTENSIONS) {
		levels.push({
			price:      swingHigh - range * ratio,
			ratio,
			label:      `${(ratio * 100).toFixed(1)}% Ext↓`,
			swingHigh,
			swingLow,
			swingIndex,
			levelType: 'extension',
		});
	}

	return levels;
}

// ─── Clustering ───────────────────────────────────────────────────────────────

/**
 * Group Fibonacci levels into confluence zones.
 * Two levels are in the same zone if they are within `clusterPct` of each other.
 * Greedy single-pass clustering: levels are sorted by price, then merged when
 * adjacent levels fall within the threshold.
 */
export function clusterFibLevels(
	levels: FibLevel[],
	clusterPct = 0.5,
): Array<FibLevel[]> {
	if (levels.length === 0) return [];

	const sorted = [...levels].sort((a, b) => a.price - b.price);
	const clusters: Array<FibLevel[]> = [[sorted[0]]];

	for (let i = 1; i < sorted.length; i++) {
		const current = sorted[i];
		const lastCluster = clusters[clusters.length - 1];
		const clusterMid  = lastCluster.reduce((s, l) => s + l.price, 0) / lastCluster.length;

		const distPct = Math.abs(current.price - clusterMid) / clusterMid * 100;
		if (distPct <= clusterPct) {
			lastCluster.push(current);
		} else {
			clusters.push([current]);
		}
	}

	return clusters;
}

// ─── Zone building ────────────────────────────────────────────────────────────

export function buildConfluenceZone(
	cluster: FibLevel[],
	currentPrice: number,
): ConfluenceZone {
	const prices   = cluster.map(l => l.price);
	const centroid = prices.reduce((s, p) => s + p, 0) / prices.length;
	const priceMin = Math.min(...prices);
	const priceMax = Math.max(...prices);

	const distancePct = ((centroid - currentPrice) / currentPrice) * 100;
	const zoneType: 'support' | 'resistance' | 'pivot' =
		distancePct < -0.1 ? 'support' :
		distancePct >  0.1 ? 'resistance' :
		'pivot';

	return {
		price:       centroid,
		priceMin,
		priceMax,
		strength:    cluster.length,
		levels:      cluster,
		zoneType,
		distancePct,
	};
}

// ─── Main analysis ────────────────────────────────────────────────────────────

/**
 * Find all Fibonacci confluence zones from OHLCV data.
 *
 * Steps:
 * 1. Detect pivots
 * 2. Extract swing highs/lows (consecutive high→low or low→high pivot pairs)
 * 3. Compute Fib levels for each swing
 * 4. Cluster levels within clusterPct
 * 5. Sort zones by strength
 */
export function findFibConfluenceZones(
	ohlcv: OHLCV[],
	options: {
		lookback?: number;    // pivot lookback window (default 5)
		clusterPct?: number;  // clustering threshold in % (default 0.5)
		minStrength?: number; // min levels in a zone to include (default 2)
		maxSwings?: number;   // max number of swings to analyse (default 5)
	} = {},
): FibConfluenceResult {
	const {
		lookback    = 5,
		clusterPct  = 0.5,
		minStrength = 2,
		maxSwings   = 5,
	} = options;

	const currentPrice = ohlcv[ohlcv.length - 1].close;

	if (ohlcv.length < lookback * 2 + 1) {
		return { zones: [], currentPrice, nearestSupport: null, nearestResistance: null, totalLevels: 0, swingCount: 0 };
	}

	// ── Detect pivots ─────────────────────────────────────────────────────────
	const pivots = findPivots(ohlcv, lookback);
	if (pivots.length < 2) {
		return { zones: [], currentPrice, nearestSupport: null, nearestResistance: null, totalLevels: 0, swingCount: 0 };
	}

	// ── Extract swings (consecutive high/low pivot pairs) ─────────────────────
	const swings = extractSwings(pivots, maxSwings);

	// ── Compute Fib levels for each swing ─────────────────────────────────────
	const allLevels: FibLevel[] = [];
	for (const { high, low, index } of swings) {
		const levels = computeSwingFibLevels(high, low, index);
		allLevels.push(...levels);
	}

	if (allLevels.length === 0) {
		return { zones: [], currentPrice, nearestSupport: null, nearestResistance: null, totalLevels: 0, swingCount: swings.length };
	}

	// ── Cluster levels ────────────────────────────────────────────────────────
	const clusters = clusterFibLevels(allLevels, clusterPct);

	// ── Build zones (filter by minStrength) ───────────────────────────────────
	const zones: ConfluenceZone[] = clusters
		.filter(c => c.length >= minStrength)
		.map(c => buildConfluenceZone(c, currentPrice))
		.sort((a, b) => b.strength - a.strength || Math.abs(a.distancePct) - Math.abs(b.distancePct));

	// ── Find nearest support / resistance ─────────────────────────────────────
	const supports    = zones.filter(z => z.zoneType === 'support').sort((a, b) => b.price - a.price);
	const resistances = zones.filter(z => z.zoneType === 'resistance').sort((a, b) => a.price - b.price);

	return {
		zones,
		currentPrice,
		nearestSupport:    supports[0] ?? null,
		nearestResistance: resistances[0] ?? null,
		totalLevels:       allLevels.length,
		swingCount:        swings.length,
	};
}

// ─── Swing extraction ─────────────────────────────────────────────────────────

function extractSwings(
	pivots: Pivot[],
	maxSwings: number,
): Array<{ high: number; low: number; index: number }> {
	// Use a rolling window over recent pivots to identify high/low pairs
	const swings: Array<{ high: number; low: number; index: number }> = [];

	// Group consecutive pivots in pairs: take every high-low or low-high pair
	const recent = pivots.slice(-maxSwings * 2 - 2);

	for (let i = 0; i < recent.length - 1 && swings.length < maxSwings; i++) {
		const a = recent[i];
		const b = recent[i + 1];

		const high = Math.max(a.price, b.price);
		const low  = Math.min(a.price, b.price);

		if (high > low) {
			swings.push({ high, low, index: i });
		}
	}

	return swings;
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtFibPrice(price: number): string {
	if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (price >= 1)    return price.toFixed(4);
	return price.toFixed(6);
}
