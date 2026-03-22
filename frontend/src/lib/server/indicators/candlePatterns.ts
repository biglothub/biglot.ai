// Candlestick Pattern Scanner — T-804
// Detects classic Japanese candlestick patterns on OHLCV data

import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type CandleSignal = 'bullish' | 'bearish' | 'neutral';

export type CandlePatternMatch = {
	pattern:    string;
	signal:     CandleSignal;
	confidence: number;   // 0–1
	index:      number;   // index of the primary candle (last in pattern)
	description: string;
};

// ─── Candle Primitives ────────────────────────────────────────────────────────

function body(c: OHLCV): number { return Math.abs(c.close - c.open); }
function range(c: OHLCV): number { return c.high - c.low; }
function upperShadow(c: OHLCV): number { return c.high - Math.max(c.open, c.close); }
function lowerShadow(c: OHLCV): number { return Math.min(c.open, c.close) - c.low; }
function isBullish(c: OHLCV): boolean { return c.close > c.open; }
function isBearish(c: OHLCV): boolean { return c.close < c.open; }
function midpoint(c: OHLCV): number { return (c.open + c.close) / 2; }

/** Body-to-range ratio — 0 means pure doji, 1 means no shadow */
function bodyRatio(c: OHLCV): number {
	const r = range(c);
	return r === 0 ? 0 : body(c) / r;
}

// ─── Single-candle patterns ───────────────────────────────────────────────────

/** Doji — open ≈ close (body < 10% of range) */
function isDoji(c: OHLCV): boolean {
	return bodyRatio(c) < 0.1 && range(c) > 0;
}

/** Marubozu — almost no shadows (body > 90% of range) */
function isMarubozu(c: OHLCV): boolean {
	return bodyRatio(c) > 0.9 && range(c) > 0;
}

/**
 * Hammer / Hanging Man — small body at top, long lower shadow (≥ 2× body),
 * minimal upper shadow (< body).
 */
function isHammerShape(c: OHLCV): boolean {
	const b = body(c);
	const r = range(c);
	if (r === 0 || b === 0) return false;
	const lower  = lowerShadow(c);
	const upper  = upperShadow(c);
	return lower >= 2 * b && upper < b && b / r < 0.4;
}

/**
 * Inverted Hammer / Shooting Star — small body at bottom, long upper shadow (≥ 2× body),
 * minimal lower shadow (< body).
 */
function isInvertedHammerShape(c: OHLCV): boolean {
	const b = body(c);
	const r = range(c);
	if (r === 0 || b === 0) return false;
	const upper  = upperShadow(c);
	const lower  = lowerShadow(c);
	return upper >= 2 * b && lower <= b && b / r < 0.4;
}

// ─── Pattern Detectors ────────────────────────────────────────────────────────

export function detectPatterns(candles: OHLCV[]): CandlePatternMatch[] {
	const results: CandlePatternMatch[] = [];
	const n = candles.length;
	if (n < 3) return results;

	for (let i = 2; i < n; i++) {
		const c0 = candles[i - 2];  // oldest
		const c1 = candles[i - 1];  // middle
		const c  = candles[i];       // current (primary)

		// ── 1-candle patterns ─────────────────────────────────────────────────

		// Doji
		if (isDoji(c)) {
			results.push({
				pattern:     'Doji',
				signal:      'neutral',
				confidence:  0.6,
				index:       i,
				description: 'Indecision — open and close nearly equal. Watch for directional follow-through.',
			});
		}

		// Bullish Marubozu (strong bullish body, no shadows)
		if (isMarubozu(c) && isBullish(c)) {
			results.push({
				pattern:     'Bullish Marubozu',
				signal:      'bullish',
				confidence:  0.75,
				index:       i,
				description: 'Strong bullish candle with no shadows — buyers in full control.',
			});
		}

		// Bearish Marubozu
		if (isMarubozu(c) && isBearish(c)) {
			results.push({
				pattern:     'Bearish Marubozu',
				signal:      'bearish',
				confidence:  0.75,
				index:       i,
				description: 'Strong bearish candle with no shadows — sellers in full control.',
			});
		}

		// Hammer (in downtrend context: prev candle bearish or at lower price)
		if (isHammerShape(c) && isBullish(c) && c1.close < candles[Math.max(0, i - 5)].close) {
			results.push({
				pattern:     'Hammer',
				signal:      'bullish',
				confidence:  0.70,
				index:       i,
				description: 'Bullish reversal signal — sellers pushed price down but buyers recovered.',
			});
		}

		// Hanging Man (in uptrend: prev candle bullish or at higher price)
		if (isHammerShape(c) && isBearish(c)) {
			results.push({
				pattern:     'Hanging Man',
				signal:      'bearish',
				confidence:  0.65,
				index:       i,
				description: 'Bearish warning at uptrend top — selling pressure emerging.',
			});
		}

		// Inverted Hammer (at bottom of downtrend)
		if (isInvertedHammerShape(c) && isBullish(c) && c1.close < candles[Math.max(0, i - 5)].close) {
			results.push({
				pattern:     'Inverted Hammer',
				signal:      'bullish',
				confidence:  0.60,
				index:       i,
				description: 'Potential bullish reversal — buyers tried to push price up, needs confirmation.',
			});
		}

		// Shooting Star (at top of uptrend)
		if (isInvertedHammerShape(c) && isBearish(c)) {
			results.push({
				pattern:     'Shooting Star',
				signal:      'bearish',
				confidence:  0.70,
				index:       i,
				description: 'Bearish reversal — price rallied but rejected by sellers.',
			});
		}

		// ── 2-candle patterns ─────────────────────────────────────────────────

		// Bullish Engulfing
		if (
			isBearish(c1) &&
			isBullish(c) &&
			c.open < c1.close &&
			c.close > c1.open &&
			body(c) > body(c1)
		) {
			results.push({
				pattern:     'Bullish Engulfing',
				signal:      'bullish',
				confidence:  0.80,
				index:       i,
				description: 'Strong bullish reversal — buyers completely overwhelmed prior sellers.',
			});
		}

		// Bearish Engulfing
		if (
			isBullish(c1) &&
			isBearish(c) &&
			c.open > c1.close &&
			c.close < c1.open &&
			body(c) > body(c1)
		) {
			results.push({
				pattern:     'Bearish Engulfing',
				signal:      'bearish',
				confidence:  0.80,
				index:       i,
				description: 'Strong bearish reversal — sellers completely overwhelmed prior buyers.',
			});
		}

		// Bullish Harami (inside bar)
		if (
			isBearish(c1) &&
			isBullish(c) &&
			c.open > c1.close &&
			c.close < c1.open &&
			body(c) < body(c1) * 0.5
		) {
			results.push({
				pattern:     'Bullish Harami',
				signal:      'bullish',
				confidence:  0.60,
				index:       i,
				description: 'Inside bar after bearish candle — selling momentum slowing.',
			});
		}

		// Bearish Harami
		if (
			isBullish(c1) &&
			isBearish(c) &&
			c.open < c1.close &&
			c.close > c1.open &&
			body(c) < body(c1) * 0.5
		) {
			results.push({
				pattern:     'Bearish Harami',
				signal:      'bearish',
				confidence:  0.60,
				index:       i,
				description: 'Inside bar after bullish candle — buying momentum slowing.',
			});
		}

		// Piercing Line (bullish reversal after downtrend)
		if (
			isBearish(c1) &&
			isBullish(c) &&
			c.open < c1.low &&
			c.close > midpoint(c1) &&
			c.close < c1.open
		) {
			results.push({
				pattern:     'Piercing Line',
				signal:      'bullish',
				confidence:  0.70,
				index:       i,
				description: 'Bullish reversal — current candle recoups more than half of prior decline.',
			});
		}

		// Dark Cloud Cover (bearish reversal after uptrend)
		if (
			isBullish(c1) &&
			isBearish(c) &&
			c.open > c1.high &&
			c.close < midpoint(c1) &&
			c.close > c1.open
		) {
			results.push({
				pattern:     'Dark Cloud Cover',
				signal:      'bearish',
				confidence:  0.70,
				index:       i,
				description: 'Bearish reversal — current candle gives back more than half of prior advance.',
			});
		}

		// ── 3-candle patterns ─────────────────────────────────────────────────

		// Morning Star (bullish reversal)
		if (
			isBearish(c0) &&
			body(c1) < body(c0) * 0.5 &&  // small middle candle (star)
			isBullish(c) &&
			c.close > midpoint(c0) &&
			body(c0) > 0 && body(c) > 0
		) {
			results.push({
				pattern:     'Morning Star',
				signal:      'bullish',
				confidence:  0.85,
				index:       i,
				description: 'Strong bullish reversal — three-candle pattern showing exhaustion of sellers.',
			});
		}

		// Evening Star (bearish reversal)
		if (
			isBullish(c0) &&
			body(c1) < body(c0) * 0.5 &&  // small middle candle (star)
			isBearish(c) &&
			c.close < midpoint(c0) &&
			body(c0) > 0 && body(c) > 0
		) {
			results.push({
				pattern:     'Evening Star',
				signal:      'bearish',
				confidence:  0.85,
				index:       i,
				description: 'Strong bearish reversal — three-candle pattern showing exhaustion of buyers.',
			});
		}

		// Three White Soldiers (continuation bullish)
		if (
			i >= 3 &&
			isBullish(candles[i - 2]) &&
			isBullish(c1) &&
			isBullish(c) &&
			c1.open > candles[i - 2].open && c1.open < candles[i - 2].close &&
			c.open  > c1.open             && c.open  < c1.close &&
			bodyRatio(candles[i - 2]) > 0.5 &&
			bodyRatio(c1) > 0.5 &&
			bodyRatio(c) > 0.5
		) {
			results.push({
				pattern:     'Three White Soldiers',
				signal:      'bullish',
				confidence:  0.85,
				index:       i,
				description: 'Strong bullish continuation — three consecutive long bullish candles.',
			});
		}

		// Three Black Crows (continuation bearish)
		if (
			i >= 3 &&
			isBearish(candles[i - 2]) &&
			isBearish(c1) &&
			isBearish(c) &&
			c1.open < candles[i - 2].open && c1.open > candles[i - 2].close &&
			c.open  < c1.open             && c.open  > c1.close &&
			bodyRatio(candles[i - 2]) > 0.5 &&
			bodyRatio(c1) > 0.5 &&
			bodyRatio(c) > 0.5
		) {
			results.push({
				pattern:     'Three Black Crows',
				signal:      'bearish',
				confidence:  0.85,
				index:       i,
				description: 'Strong bearish continuation — three consecutive long bearish candles.',
			});
		}
	}

	return results;
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export type PatternSummary = {
	bullishCount: number;
	bearishCount: number;
	neutralCount: number;
	overallSignal: CandleSignal;
	overallScore: number;   // -100 to +100 (bull positive)
};

export function summarisePatterns(matches: CandlePatternMatch[]): PatternSummary {
	let bull = 0, bear = 0, neutral = 0;
	let score = 0;

	for (const m of matches) {
		if (m.signal === 'bullish') {
			bull++;
			score += m.confidence * 100;
		} else if (m.signal === 'bearish') {
			bear++;
			score -= m.confidence * 100;
		} else {
			neutral++;
		}
	}

	const total = bull + bear + neutral;
	const normScore = total > 0 ? score / total : 0;

	const overallSignal: CandleSignal =
		normScore >  15 ? 'bullish' :
		normScore < -15 ? 'bearish' :
		'neutral';

	return {
		bullishCount:  bull,
		bearishCount:  bear,
		neutralCount:  neutral,
		overallSignal,
		overallScore:  Math.max(-100, Math.min(100, normScore)),
	};
}
