// Chart Pattern Recognition — T-501
// Heuristic detection: H&S, double top/bottom, triangles, flags, wedges

import type { OHLCV, PatternAnnotation, PatternType } from '$lib/types/contentBlock';

// ─── Pivot detection ──────────────────────────────────────────────────────────

export type Pivot = {
	index: number;
	price: number;
	type: 'high' | 'low';
};

/**
 * Find local pivot highs and lows using a lookback window.
 * A pivot high at index i requires it to be the highest close within [i-lookback, i+lookback].
 */
export function findPivots(ohlcv: OHLCV[], lookback = 5): Pivot[] {
	const pivots: Pivot[] = [];
	const n = ohlcv.length;

	for (let i = lookback; i < n - lookback; i++) {
		const c = ohlcv[i].close;
		let isHigh = true, isLow = true;

		for (let j = i - lookback; j <= i + lookback; j++) {
			if (j === i) continue;
			if (ohlcv[j].close >= c) isHigh = false;
			if (ohlcv[j].close <= c) isLow = false;
		}

		if (isHigh) pivots.push({ index: i, price: c, type: 'high' });
		if (isLow) pivots.push({ index: i, price: c, type: 'low' });
	}

	return pivots;
}

// ─── Pattern helpers ──────────────────────────────────────────────────────────

/** Percentage difference between two prices (absolute). */
export function pctDiff(a: number, b: number): number {
	return Math.abs(a - b) / ((a + b) / 2) * 100;
}

/** Linear regression slope over a set of (index, price) pairs. */
export function linearSlope(points: { index: number; price: number }[]): number {
	const n = points.length;
	if (n < 2) return 0;
	const meanX = points.reduce((s, p) => s + p.index, 0) / n;
	const meanY = points.reduce((s, p) => s + p.price, 0) / n;
	const num = points.reduce((s, p) => s + (p.index - meanX) * (p.price - meanY), 0);
	const den = points.reduce((s, p) => s + (p.index - meanX) ** 2, 0);
	return den === 0 ? 0 : num / den;
}

// ─── Individual pattern detectors ────────────────────────────────────────────

/**
 * Detect double top: two highs at similar levels (~2% tolerance) with a valley.
 */
export function detectDoubleTop(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	tolerancePct = 3
): PatternAnnotation[] {
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');
	const results: PatternAnnotation[] = [];

	for (let i = 0; i < highs.length - 1; i++) {
		const h1 = highs[i];
		const h2 = highs[i + 1];

		// Must be separated by at least 5 candles
		if (h2.index - h1.index < 5) continue;

		// Prices within tolerancePct
		if (pctDiff(h1.price, h2.price) > tolerancePct) continue;

		// Find a valley (low) between the two highs
		const valleysBetween = lows.filter(l => l.index > h1.index && l.index < h2.index);
		if (valleysBetween.length === 0) continue;

		const valley = valleysBetween.reduce((best, l) => l.price < best.price ? l : best);

		// Valley must be meaningfully below the highs (at least 3%)
		const avgHigh = (h1.price + h2.price) / 2;
		if ((avgHigh - valley.price) / avgHigh * 100 < 3) continue;

		const confidence = Math.max(0, 1 - pctDiff(h1.price, h2.price) / tolerancePct);

		results.push({
			patternType: 'double_top',
			label: 'Double Top',
			startIndex: h1.index,
			endIndex: h2.index,
			keyPoints: [
				{ index: h1.index, price: h1.price, label: 'Top 1' },
				{ index: valley.index, price: valley.price, label: 'Valley' },
				{ index: h2.index, price: h2.price, label: 'Top 2' },
			],
			direction: 'bearish',
			confidence,
		});
	}

	return results;
}

/**
 * Detect double bottom: two lows at similar levels with a peak between.
 */
export function detectDoubleBottom(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	tolerancePct = 3
): PatternAnnotation[] {
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');
	const results: PatternAnnotation[] = [];

	for (let i = 0; i < lows.length - 1; i++) {
		const l1 = lows[i];
		const l2 = lows[i + 1];

		if (l2.index - l1.index < 5) continue;
		if (pctDiff(l1.price, l2.price) > tolerancePct) continue;

		const peaksBetween = highs.filter(h => h.index > l1.index && h.index < l2.index);
		if (peaksBetween.length === 0) continue;

		const peak = peaksBetween.reduce((best, h) => h.price > best.price ? h : best);

		const avgLow = (l1.price + l2.price) / 2;
		if ((peak.price - avgLow) / avgLow * 100 < 3) continue;

		const confidence = Math.max(0, 1 - pctDiff(l1.price, l2.price) / tolerancePct);

		results.push({
			patternType: 'double_bottom',
			label: 'Double Bottom',
			startIndex: l1.index,
			endIndex: l2.index,
			keyPoints: [
				{ index: l1.index, price: l1.price, label: 'Bottom 1' },
				{ index: peak.index, price: peak.price, label: 'Peak' },
				{ index: l2.index, price: l2.price, label: 'Bottom 2' },
			],
			direction: 'bullish',
			confidence,
		});
	}

	return results;
}

/**
 * Detect Head & Shoulders: left shoulder, head (higher), right shoulder with neckline.
 */
export function detectHeadAndShoulders(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	tolerancePct = 5
): PatternAnnotation[] {
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');
	const results: PatternAnnotation[] = [];

	// Need at least 3 highs
	for (let i = 0; i < highs.length - 2; i++) {
		const ls = highs[i];    // left shoulder
		const head = highs[i + 1];
		const rs = highs[i + 2]; // right shoulder

		// Head must be higher than both shoulders
		if (head.price <= ls.price || head.price <= rs.price) continue;

		// Shoulders should be at similar levels (within tolerance)
		if (pctDiff(ls.price, rs.price) > tolerancePct) continue;

		// Must be in order
		if (!(ls.index < head.index && head.index < rs.index)) continue;

		// Find neckline lows between shoulders
		const leftValley = lows.filter(l => l.index > ls.index && l.index < head.index)
			.reduce((best, l) => l.price < best.price ? l : best, { price: Infinity, index: ls.index });
		const rightValley = lows.filter(l => l.index > head.index && l.index < rs.index)
			.reduce((best, l) => l.price < best.price ? l : best, { price: Infinity, index: head.index });

		if (!isFinite(leftValley.price) || !isFinite(rightValley.price)) continue;

		const confidence = Math.max(0.3, 1 - pctDiff(ls.price, rs.price) / tolerancePct);

		results.push({
			patternType: 'head_and_shoulders',
			label: 'Head & Shoulders',
			startIndex: ls.index,
			endIndex: rs.index,
			keyPoints: [
				{ index: ls.index, price: ls.price, label: 'Left Shoulder' },
				{ index: leftValley.index, price: leftValley.price, label: 'Neckline L' },
				{ index: head.index, price: head.price, label: 'Head' },
				{ index: rightValley.index, price: rightValley.price, label: 'Neckline R' },
				{ index: rs.index, price: rs.price, label: 'Right Shoulder' },
			],
			direction: 'bearish',
			confidence,
		});
	}

	return results;
}

/**
 * Detect Inverse Head & Shoulders (bullish reversal).
 */
export function detectInverseHeadAndShoulders(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	tolerancePct = 5
): PatternAnnotation[] {
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');
	const results: PatternAnnotation[] = [];

	for (let i = 0; i < lows.length - 2; i++) {
		const ls = lows[i];
		const head = lows[i + 1];
		const rs = lows[i + 2];

		// Head must be lower than both shoulders
		if (head.price >= ls.price || head.price >= rs.price) continue;
		if (pctDiff(ls.price, rs.price) > tolerancePct) continue;
		if (!(ls.index < head.index && head.index < rs.index)) continue;

		const leftPeak = highs.filter(h => h.index > ls.index && h.index < head.index)
			.reduce((best, h) => h.price > best.price ? h : best, { price: -Infinity, index: ls.index });
		const rightPeak = highs.filter(h => h.index > head.index && h.index < rs.index)
			.reduce((best, h) => h.price > best.price ? h : best, { price: -Infinity, index: head.index });

		if (!isFinite(leftPeak.price) || !isFinite(rightPeak.price)) continue;

		const confidence = Math.max(0.3, 1 - pctDiff(ls.price, rs.price) / tolerancePct);

		results.push({
			patternType: 'inverse_head_and_shoulders',
			label: 'Inverse H&S',
			startIndex: ls.index,
			endIndex: rs.index,
			keyPoints: [
				{ index: ls.index, price: ls.price, label: 'Left Shoulder' },
				{ index: head.index, price: head.price, label: 'Head' },
				{ index: rs.index, price: rs.price, label: 'Right Shoulder' },
			],
			direction: 'bullish',
			confidence,
		});
	}

	return results;
}

/**
 * Detect triangle patterns using slope of highs and lows.
 */
export function detectTriangles(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	minPivots = 4
): PatternAnnotation[] {
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');

	if (highs.length < 2 || lows.length < 2) return [];

	// Use last N pivots for recent pattern
	const recentHighs = highs.slice(-Math.ceil(minPivots / 2));
	const recentLows = lows.filter(l => l.index >= recentHighs[0].index);

	if (recentHighs.length < 2 || recentLows.length < 2) return [];

	const highSlope = linearSlope(recentHighs);
	const lowSlope = linearSlope(recentLows);

	const startIndex = Math.min(recentHighs[0].index, recentLows[0].index);
	const endIndex = Math.max(recentHighs[recentHighs.length - 1].index, recentLows[recentLows.length - 1].index);

	const FLAT_THRESHOLD = 0.05; // near-zero slope

	let patternType: PatternType | null = null;
	let label = '';
	let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';

	if (Math.abs(highSlope) <= FLAT_THRESHOLD && lowSlope > FLAT_THRESHOLD) {
		patternType = 'ascending_triangle';
		label = 'Ascending Triangle';
		direction = 'bullish';
	} else if (highSlope < -FLAT_THRESHOLD && Math.abs(lowSlope) <= FLAT_THRESHOLD) {
		patternType = 'descending_triangle';
		label = 'Descending Triangle';
		direction = 'bearish';
	} else if (highSlope < -FLAT_THRESHOLD && lowSlope > FLAT_THRESHOLD) {
		patternType = 'symmetric_triangle';
		label = 'Symmetric Triangle';
		direction = 'neutral';
	}

	if (!patternType) return [];

	return [{
		patternType,
		label,
		startIndex,
		endIndex,
		keyPoints: [
			...recentHighs.map(h => ({ index: h.index, price: h.price, label: 'Resistance' })),
			...recentLows.map(l => ({ index: l.index, price: l.price, label: 'Support' })),
		].sort((a, b) => a.index - b.index),
		direction,
		confidence: 0.6,
	}];
}

/**
 * Detect bull/bear flags: sharp move followed by narrow consolidation.
 */
export function detectFlags(ohlcv: OHLCV[]): PatternAnnotation[] {
	const n = ohlcv.length;
	if (n < 20) return [];

	const results: PatternAnnotation[] = [];

	// Look at the last portion for flag patterns
	const poleLen = Math.floor(n * 0.2);
	const flagLen = Math.floor(n * 0.15);

	if (poleLen < 5 || flagLen < 5) return [];

	const poleEnd = n - flagLen - 1;
	const poleStart = poleEnd - poleLen;

	if (poleStart < 0) return [];

	const poleMove = (ohlcv[poleEnd].close - ohlcv[poleStart].close) / ohlcv[poleStart].close * 100;
	const flagData = ohlcv.slice(poleEnd);
	const flagHigh = Math.max(...flagData.map(c => c.close));
	const flagLow = Math.min(...flagData.map(c => c.close));
	const flagRange = (flagHigh - flagLow) / flagLow * 100;
	const flagMove = (ohlcv[n - 1].close - ohlcv[poleEnd].close) / ohlcv[poleEnd].close * 100;

	// Bull flag: strong up pole (>5%), narrow flag (<40% of pole move), slight downward drift
	if (poleMove > 5 && flagRange < Math.abs(poleMove) * 0.4 && flagMove < 0 && flagMove > -poleMove * 0.5) {
		results.push({
			patternType: 'bull_flag',
			label: 'Bull Flag',
			startIndex: poleStart,
			endIndex: n - 1,
			keyPoints: [
				{ index: poleStart, price: ohlcv[poleStart].close, label: 'Pole Start' },
				{ index: poleEnd, price: ohlcv[poleEnd].close, label: 'Pole End' },
				{ index: n - 1, price: ohlcv[n - 1].close, label: 'Flag End' },
			],
			direction: 'bullish',
			confidence: Math.min(1, poleMove / 20),
		});
	}

	// Bear flag: strong down pole (<-5%), narrow flag, slight upward drift
	if (poleMove < -5 && flagRange < Math.abs(poleMove) * 0.4 && flagMove > 0 && flagMove < Math.abs(poleMove) * 0.5) {
		results.push({
			patternType: 'bear_flag',
			label: 'Bear Flag',
			startIndex: poleStart,
			endIndex: n - 1,
			keyPoints: [
				{ index: poleStart, price: ohlcv[poleStart].close, label: 'Pole Start' },
				{ index: poleEnd, price: ohlcv[poleEnd].close, label: 'Pole End' },
				{ index: n - 1, price: ohlcv[n - 1].close, label: 'Flag End' },
			],
			direction: 'bearish',
			confidence: Math.min(1, Math.abs(poleMove) / 20),
		});
	}

	return results;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

export type PatternScanResult = {
	patterns: PatternAnnotation[];
	pivots: Pivot[];
};

/**
 * Run all pattern detectors on a set of OHLCV data.
 * Returns detected patterns sorted by confidence descending.
 */
export function scanPatterns(ohlcv: OHLCV[], lookback = 5): PatternScanResult {
	if (ohlcv.length < 20) return { patterns: [], pivots: [] };

	const pivots = findPivots(ohlcv, lookback);

	const patterns: PatternAnnotation[] = [
		...detectDoubleTop(ohlcv, pivots),
		...detectDoubleBottom(ohlcv, pivots),
		...detectHeadAndShoulders(ohlcv, pivots),
		...detectInverseHeadAndShoulders(ohlcv, pivots),
		...detectTriangles(ohlcv, pivots),
		...detectFlags(ohlcv),
	];

	// Sort by confidence descending, then deduplicate overlapping patterns of same type
	patterns.sort((a, b) => b.confidence - a.confidence);

	return { patterns, pivots };
}
