// Divergence Scanner — T-1002
// Detects regular and hidden divergences between price pivots and oscillators (RSI, MACD, OBV).
// Regular:  price new extreme but oscillator fails     → potential reversal
// Hidden:   oscillator new extreme but price fails     → potential continuation

import type { OHLCV } from '$lib/types/contentBlock';
import { findPivots, type Pivot } from './patterns';
import { rsi, macd, obv } from './engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DivergenceType =
	| 'regular_bullish'
	| 'regular_bearish'
	| 'hidden_bullish'
	| 'hidden_bearish';

export interface DivergenceSignal {
	type: DivergenceType;
	oscillator: string;           // 'RSI' | 'MACD' | 'OBV'
	direction: 'bullish' | 'bearish';
	classification: 'regular' | 'hidden';
	pivotIndex1: number;          // older pivot candle index (in ohlcv array)
	pivotIndex2: number;          // newer pivot candle index
	price1: number;               // price at older pivot
	price2: number;               // price at newer pivot
	osc1: number;                 // oscillator at older pivot
	osc2: number;                 // oscillator at newer pivot
	strength: number;             // 0–1 (higher = stronger divergence)
	candlesAgo: number;           // how many candles ago was the newer pivot
}

export interface DivergenceScanResult {
	signals: DivergenceSignal[];
	currentPrice: number;
	bullCount: number;
	bearCount: number;
	strongestBull: DivergenceSignal | null;
	strongestBear: DivergenceSignal | null;
}

// ─── Oscillator helpers ───────────────────────────────────────────────────────

/** Build a candle-index → oscillator value map from an indicator result array. */
function buildOscMap(
	ohlcv: OHLCV[],
	values: Array<{ time: number; value: number }>,
): Map<number, number> {
	const timeToIdx = new Map<number, number>(ohlcv.map((c, i) => [c.time, i]));
	const out = new Map<number, number>();
	for (const v of values) {
		const idx = timeToIdx.get(v.time);
		if (idx !== undefined && isFinite(v.value)) out.set(idx, v.value);
	}
	return out;
}

/** Oscillator range (max - min) across a set of values. Used for strength normalization. */
function oscRange(map: Map<number, number>): number {
	if (map.size === 0) return 1;
	let min = Infinity, max = -Infinity;
	for (const v of map.values()) { if (v < min) min = v; if (v > max) max = v; }
	return max - min || 1;
}

// ─── Divergence strength ──────────────────────────────────────────────────────

/**
 * Compute divergence strength 0–1.
 * Based on the magnitude of price divergence vs oscillator divergence:
 * both moves should be significant for a strong signal.
 */
export function calcStrength(
	price1: number, price2: number,
	osc1: number, osc2: number,
	range: number,
): number {
	if (price1 === 0 || range === 0) return 0;
	const pricePct = Math.abs(price2 - price1) / price1;           // 0.02 = 2%
	const oscNorm  = Math.abs(osc2 - osc1) / range;               // 0–1
	// Both components capped at 0.5; combined strength 0–1
	return Math.min(1, Math.sqrt(pricePct * 10) * 0.5 + oscNorm * 0.5);
}

// ─── Core detector ────────────────────────────────────────────────────────────

/**
 * Detect divergences between consecutive price pivots and oscillator values.
 * Scans recent pivot pairs from newest to oldest; stops when `maxPairs` of each
 * direction (bullish/bearish) are found.
 */
export function detectOscDivergences(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	oscMap: Map<number, number>,
	oscName: string,
	maxPairs = 3,
): DivergenceSignal[] {
	const signals: DivergenceSignal[] = [];
	const range = oscRange(oscMap);
	const n = ohlcv.length;

	const highs = pivots.filter(p => p.type === 'high');
	const lows  = pivots.filter(p => p.type === 'low');

	let bullFound = 0;
	let bearFound = 0;

	// ── Bearish divergences from high pivots ──────────────────────────────────
	for (let i = highs.length - 1; i >= 1 && bearFound < maxPairs; i--) {
		const p1 = highs[i - 1]; // older
		const p2 = highs[i];     // newer

		const osc1 = oscMap.get(p1.index);
		const osc2 = oscMap.get(p2.index);
		if (osc1 === undefined || osc2 === undefined) continue;

		const priceHigher = p2.price > p1.price;
		const priceLower  = p2.price < p1.price;
		const oscHigher   = osc2 > osc1;
		const oscLower    = osc2 < osc1;

		let type: DivergenceType | null = null;
		if (priceHigher && oscLower)  type = 'regular_bearish'; // price HH, osc LH
		if (priceLower  && oscHigher) type = 'hidden_bearish';  // price LH, osc HH

		if (!type) continue;

		signals.push({
			type,
			oscillator:      oscName,
			direction:       'bearish',
			classification:  type.startsWith('regular') ? 'regular' : 'hidden',
			pivotIndex1:     p1.index,
			pivotIndex2:     p2.index,
			price1:          p1.price,
			price2:          p2.price,
			osc1,
			osc2,
			strength:        calcStrength(p1.price, p2.price, osc1, osc2, range),
			candlesAgo:      n - 1 - p2.index,
		});
		bearFound++;
	}

	// ── Bullish divergences from low pivots ───────────────────────────────────
	for (let i = lows.length - 1; i >= 1 && bullFound < maxPairs; i--) {
		const p1 = lows[i - 1]; // older
		const p2 = lows[i];     // newer

		const osc1 = oscMap.get(p1.index);
		const osc2 = oscMap.get(p2.index);
		if (osc1 === undefined || osc2 === undefined) continue;

		const priceLower  = p2.price < p1.price;
		const priceHigher = p2.price > p1.price;
		const oscHigher   = osc2 > osc1;
		const oscLower    = osc2 < osc1;

		let type: DivergenceType | null = null;
		if (priceLower  && oscHigher) type = 'regular_bullish'; // price LL, osc HL
		if (priceHigher && oscLower)  type = 'hidden_bullish';  // price HL, osc LL

		if (!type) continue;

		signals.push({
			type,
			oscillator:      oscName,
			direction:       'bullish',
			classification:  type.startsWith('regular') ? 'regular' : 'hidden',
			pivotIndex1:     p1.index,
			pivotIndex2:     p2.index,
			price1:          p1.price,
			price2:          p2.price,
			osc1,
			osc2,
			strength:        calcStrength(p1.price, p2.price, osc1, osc2, range),
			candlesAgo:      n - 1 - p2.index,
		});
		bullFound++;
	}

	return signals;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

/**
 * Scan OHLCV data for divergences across RSI, MACD histogram, and OBV.
 *
 * Uses the last `window` candles for oscillator computation and the last
 * `pivotWindow` of those for pivot detection.
 */
export function scanDivergences(
	ohlcv: OHLCV[],
	options: {
		lookback?: number;   // pivot detection lookback (default 5)
		maxPairs?: number;   // max divergence pairs per oscillator (default 3)
		window?: number;     // candles to use (default 100, min 50)
	} = {},
): DivergenceScanResult {
	const { lookback = 5, maxPairs = 3, window: win = 100 } = options;
	const currentPrice = ohlcv[ohlcv.length - 1].close;

	const minCandles = Math.max(50, lookback * 2 + 30);
	if (ohlcv.length < minCandles) {
		return { signals: [], currentPrice, bullCount: 0, bearCount: 0, strongestBull: null, strongestBear: null };
	}

	// Use last `win` candles (need full array for indicator warm-up)
	const slice = ohlcv.slice(-Math.max(win, 50));

	// ── Compute oscillators ───────────────────────────────────────────────────
	const rsiVals  = rsi(slice, 14);
	const macdVals = macd(slice, 12, 26, 9);
	const obvVals  = obv(slice);

	const rsiMap  = buildOscMap(slice, rsiVals);
	const macdMap = buildOscMap(slice, macdVals.histogram);
	const obvMap  = buildOscMap(slice, obvVals);

	// ── Detect pivots ─────────────────────────────────────────────────────────
	const pivots = findPivots(slice, lookback);

	if (pivots.length < 2) {
		return { signals: [], currentPrice, bullCount: 0, bearCount: 0, strongestBull: null, strongestBear: null };
	}

	// ── Scan each oscillator ──────────────────────────────────────────────────
	const allSignals: DivergenceSignal[] = [
		...detectOscDivergences(slice, pivots, rsiMap,  'RSI',  maxPairs),
		...detectOscDivergences(slice, pivots, macdMap, 'MACD', maxPairs),
		...detectOscDivergences(slice, pivots, obvMap,  'OBV',  maxPairs),
	];

	// Sort by strength desc
	allSignals.sort((a, b) => b.strength - a.strength);

	const bullSignals = allSignals.filter(s => s.direction === 'bullish');
	const bearSignals = allSignals.filter(s => s.direction === 'bearish');

	return {
		signals:       allSignals,
		currentPrice,
		bullCount:     bullSignals.length,
		bearCount:     bearSignals.length,
		strongestBull: bullSignals[0] ?? null,
		strongestBear: bearSignals[0] ?? null,
	};
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function divTypeLabel(type: DivergenceType): string {
	switch (type) {
		case 'regular_bullish': return 'Regular Bullish';
		case 'regular_bearish': return 'Regular Bearish';
		case 'hidden_bullish':  return 'Hidden Bullish';
		case 'hidden_bearish':  return 'Hidden Bearish';
	}
}
