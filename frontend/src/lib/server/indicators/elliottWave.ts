// Elliott Wave Counter — T-702
// Detects 5-wave impulse (1-2-3-4-5) and 3-wave correction (A-B-C)
// Uses pivot-based swing points with Fibonacci retracement/extension targets

import type { OHLCV } from '$lib/types/contentBlock';
import { findPivots, type Pivot } from './patterns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WaveLabel = '1' | '2' | '3' | '4' | '5' | 'A' | 'B' | 'C';
export type WaveSequenceType = 'impulse' | 'corrective' | 'none';

export interface Wave {
	label: WaveLabel;
	startIndex: number;
	endIndex:   number;
	startPrice: number;
	endPrice:   number;
	startTime:  number;
	endTime:    number;
	/** How much this wave retraces the previous wave (0–100%). null for Wave 1 / Wave A. */
	retracementPct: number | null;
}

export interface FibTarget {
	ratio: number;
	price: number;
	label: string;
}

export interface ElliottWaveResult {
	type:       WaveSequenceType;
	direction:  'bullish' | 'bearish'; // impulse direction
	waves:      Wave[];
	isValid:    boolean;
	violations: string[];
	fibTargets: FibTarget[]; // projected next wave levels
	currentWave: WaveLabel | null; // which wave are we likely in now
	description: string;
}

// ─── Fibonacci levels ─────────────────────────────────────────────────────────

export const FIB_RETRACEMENTS = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
export const FIB_EXTENSIONS   = [1.0, 1.272, 1.618, 2.0, 2.618];

// ─── Swing point extraction ───────────────────────────────────────────────────

/**
 * Convert raw pivots to alternating high/low swing sequence.
 * If consecutive pivots are the same type, keep the more extreme one.
 */
export function buildSwingSequence(pivots: Pivot[]): Pivot[] {
	if (pivots.length === 0) return [];

	const result: Pivot[] = [pivots[0]];
	for (let i = 1; i < pivots.length; i++) {
		const prev = result[result.length - 1];
		const curr = pivots[i];
		if (curr.type === prev.type) {
			// Same type: keep more extreme
			if (curr.type === 'high' && curr.price > prev.price) result[result.length - 1] = curr;
			if (curr.type === 'low'  && curr.price < prev.price) result[result.length - 1] = curr;
		} else {
			result.push(curr);
		}
	}
	return result;
}

// ─── Wave construction ────────────────────────────────────────────────────────

function makeWave(
	label: WaveLabel,
	from: Pivot,
	to: Pivot,
	prevWaveSize: number | null,
	candles: OHLCV[],
): Wave {
	const waveSize = Math.abs(to.price - from.price);
	const retracementPct = prevWaveSize !== null && prevWaveSize > 0
		? (waveSize / prevWaveSize) * 100
		: null;

	return {
		label,
		startIndex: from.index,
		endIndex:   to.index,
		startPrice: from.price,
		endPrice:   to.price,
		startTime:  candles[from.index]?.time ?? 0,
		endTime:    candles[to.index]?.time   ?? 0,
		retracementPct,
	};
}

// ─── Rule validation ──────────────────────────────────────────────────────────

/**
 * Validate Elliott Wave impulse rules:
 * 1. Wave 2 cannot retrace ≥100% of Wave 1
 * 2. Wave 3 cannot be the shortest impulse wave (vs Wave 1 and Wave 5)
 * 3. Wave 4 cannot overlap Wave 1's territory
 */
export function validateImpulseRules(waves: Wave[]): string[] {
	if (waves.length < 5) return ['Insufficient waves to validate'];
	const violations: string[] = [];

	const [w1, w2, w3, w4, w5] = waves;
	const size1 = Math.abs(w1.endPrice - w1.startPrice);
	const size3 = Math.abs(w3.endPrice - w3.startPrice);
	const size5 = Math.abs(w5.endPrice - w5.startPrice);

	// Rule 1: Wave 2 cannot retrace ≥100% of Wave 1
	const isUp = w1.endPrice > w1.startPrice;
	const w2RetracesAll = isUp
		? w2.endPrice <= w1.startPrice
		: w2.endPrice >= w1.startPrice;
	if (w2RetracesAll) violations.push('Wave 2 retraces 100%+ of Wave 1 (invalid)');

	// Rule 2: Wave 3 is never the shortest
	if (size3 < size1 && size3 < size5) {
		violations.push('Wave 3 is the shortest impulse wave (invalid)');
	}

	// Rule 3: Wave 4 cannot overlap Wave 1's price territory
	const w1Top    = Math.max(w1.startPrice, w1.endPrice);
	const w1Bottom = Math.min(w1.startPrice, w1.endPrice);
	const w4Bottom = Math.min(w4.startPrice, w4.endPrice);
	const w4Top    = Math.max(w4.startPrice, w4.endPrice);

	if (isUp && w4Bottom < w1Top) violations.push('Wave 4 overlaps Wave 1 territory (invalid)');
	if (!isUp && w4Top > w1Bottom) violations.push('Wave 4 overlaps Wave 1 territory (invalid)');

	return violations;
}

/**
 * Validate ABC corrective rules:
 * 1. Wave B cannot retrace ≥100% of Wave A
 * 2. Wave C should move beyond Wave A's end
 */
export function validateCorrectiveRules(waves: Wave[]): string[] {
	if (waves.length < 3) return ['Insufficient waves to validate'];
	const violations: string[] = [];

	const [wA, wB, wC] = waves;
	const isDown = wA.endPrice < wA.startPrice;

	// Rule 1: Wave B cannot fully retrace Wave A
	const bRetracesAll = isDown
		? wB.endPrice >= wA.startPrice
		: wB.endPrice <= wA.startPrice;
	if (bRetracesAll) violations.push('Wave B retraces 100%+ of Wave A (invalid)');

	// Guideline: C should extend past A
	const cExtendsPastA = isDown
		? wC.endPrice < wA.endPrice
		: wC.endPrice > wA.endPrice;
	if (!cExtendsPastA) violations.push('Wave C does not extend past Wave A end (weak signal)');

	return violations;
}

// ─── Fibonacci target calculation ─────────────────────────────────────────────

/**
 * Compute Fibonacci retracement levels from a swing move.
 */
export function fibRetracementTargets(high: number, low: number): FibTarget[] {
	const range = high - low;
	return FIB_RETRACEMENTS.map(r => ({
		ratio: r,
		price: high - range * r,
		label: `${(r * 100).toFixed(1)}% retracement (${(high - range * r).toFixed(4)})`,
	}));
}

/**
 * Compute Fibonacci extension levels from a reference range.
 * base: starting point, end: end of reference wave, origin: low/high of prior correction.
 */
export function fibExtensionTargets(origin: number, refStart: number, refEnd: number): FibTarget[] {
	const range = Math.abs(refEnd - refStart);
	const isUp  = refEnd > refStart;
	return FIB_EXTENSIONS.map(r => ({
		ratio: r,
		price: isUp ? origin + range * r : origin - range * r,
		label: `${(r * 100).toFixed(1)}% ext (${(isUp ? origin + range * r : origin - range * r).toFixed(4)})`,
	}));
}

// ─── Main detection ───────────────────────────────────────────────────────────

/**
 * Attempt to detect a 5-wave impulse from a swing sequence.
 * swings must start at the wave-1 origin.
 */
function tryImpulse(swings: Pivot[], candles: OHLCV[]): ElliottWaveResult | null {
	if (swings.length < 6) return null;

	// Need 6 swing points: w0 (origin), w1 end, w2 end, w3 end, w4 end, w5 end
	const [p0, p1, p2, p3, p4, p5] = swings.slice(-6);

	// Direction: W1 must move from p0 to p1
	const isUp = p1.price > p0.price;

	// Alternation check: impulse must alternate high-low-high-low...
	const upSequence   = [true, false, true, false, true];  // p0→p1 up, p1→p2 down...
	const downSequence = [false, true, false, true, false];

	const moves = [
		p1.price > p0.price,
		p2.price > p1.price,
		p3.price > p2.price,
		p4.price > p3.price,
		p5.price > p4.price,
	];
	const expected = isUp ? upSequence : downSequence;
	for (let i = 0; i < 5; i++) {
		if (moves[i] !== expected[i]) return null;
	}

	// Build waves
	const pivotPairs: [Pivot, Pivot][] = [[p0, p1], [p1, p2], [p2, p3], [p3, p4], [p4, p5]];
	const labels: WaveLabel[] = ['1', '2', '3', '4', '5'];

	const waves: Wave[] = pivotPairs.map(([from, to], i) => {
		const prevSize = i === 0 ? null : Math.abs(pivotPairs[i - 1][1].price - pivotPairs[i - 1][0].price);
		return makeWave(labels[i], from, to, prevSize, candles);
	});

	const violations = validateImpulseRules(waves);

	// Fibonacci targets for next expected move
	// After Wave 5 completes, expect ABC correction targeting 38.2-61.8% of Wave 1-5
	const w1Start = p0.price;
	const w5End   = p5.price;
	const fibTargets = fibRetracementTargets(
		isUp ? w5End : w1Start,
		isUp ? w1Start : w5End,
	);

	return {
		type:        'impulse',
		direction:   isUp ? 'bullish' : 'bearish',
		waves,
		isValid:     violations.length === 0,
		violations,
		fibTargets,
		currentWave: '5',
		description: `5-wave ${isUp ? 'bullish' : 'bearish'} impulse detected${violations.length > 0 ? ` (${violations.length} violations)` : ''}`,
	};
}

/**
 * Attempt to detect a 3-wave ABC correction from a swing sequence.
 */
function tryCorrection(swings: Pivot[], candles: OHLCV[]): ElliottWaveResult | null {
	if (swings.length < 4) return null;

	const [p0, p1, p2, p3] = swings.slice(-4);

	// Wave A direction
	const isDown = p1.price < p0.price;

	// Check alternation: A down, B up, C down (or reverse)
	const moves = [
		p1.price > p0.price,
		p2.price > p1.price,
		p3.price > p2.price,
	];
	const downABC = [false, true, false];
	const upABC   = [true, false, true];
	const expected = isDown ? downABC : upABC;

	for (let i = 0; i < 3; i++) {
		if (moves[i] !== expected[i]) return null;
	}

	const pivotPairs: [Pivot, Pivot][] = [[p0, p1], [p1, p2], [p2, p3]];
	const labels: WaveLabel[] = ['A', 'B', 'C'];

	const waves: Wave[] = pivotPairs.map(([from, to], i) => {
		const prevSize = i === 0 ? null : Math.abs(pivotPairs[i - 1][1].price - pivotPairs[i - 1][0].price);
		return makeWave(labels[i], from, to, prevSize, candles);
	});

	const violations = validateCorrectiveRules(waves);

	// After C: expect new impulse. Fib extensions of Wave A from Wave B end
	const wASize = Math.abs(p1.price - p0.price);
	const fibTargets = fibExtensionTargets(p2.price, p0.price, p1.price);

	return {
		type:        'corrective',
		direction:   isDown ? 'bearish' : 'bullish',
		waves,
		isValid:     violations.length === 0,
		violations,
		fibTargets,
		currentWave: 'C',
		description: `3-wave ${isDown ? 'bearish' : 'bullish'} correction (A-B-C)${violations.length > 0 ? ` (${violations.length} violations)` : ''}`,
	};
}

/**
 * Determine which wave we are currently in (incomplete sequence).
 * Uses the most recent swings to infer position within a developing wave.
 */
export function detectCurrentWave(
	swings: Pivot[],
	direction: 'bullish' | 'bearish',
): WaveLabel | null {
	const n = swings.length;
	if (n < 2) return null;

	// Count swings since last major low (bullish) or high (bearish)
	const mod = n % 2;
	// Rough heuristic: n swings since origin → wave number
	const waveNum = Math.min(n, 5);
	const labels: WaveLabel[] = ['1', '2', '3', '4', '5'];
	return labels[waveNum - 1] ?? '5';
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyze candles for Elliott Wave patterns using pivot-based detection.
 * Tries both 5-wave impulse and 3-wave ABC correction on the most recent swings.
 * Returns the best match (impulse preferred over correction if both valid).
 */
export function analyzeElliottWaves(
	candles: OHLCV[],
	pivotLookback = 5,
): ElliottWaveResult {
	const none: ElliottWaveResult = {
		type:        'none',
		direction:   'bullish',
		waves:       [],
		isValid:     false,
		violations:  ['Insufficient pivot data'],
		fibTargets:  [],
		currentWave: null,
		description: 'No clear Elliott Wave pattern detected',
	};

	if (candles.length < 30) return none;

	const rawPivots = findPivots(candles, pivotLookback);
	if (rawPivots.length < 4) return none;

	const swings = buildSwingSequence(rawPivots);
	if (swings.length < 4) return none;

	// Try impulse first (requires 6+ points), then correction (4+ points)
	const impulse    = swings.length >= 6 ? tryImpulse(swings, candles)   : null;
	const correction = tryCorrection(swings, candles);

	// Prefer valid impulse over anything else
	if (impulse   && impulse.isValid)    return impulse;
	if (correction && correction.isValid) return correction;

	// Return impulse with violations if it was found
	if (impulse)    return impulse;
	if (correction) return correction;

	return none;
}
