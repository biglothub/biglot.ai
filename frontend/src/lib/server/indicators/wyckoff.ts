// Wyckoff Market Cycle Analysis — T-701
// Detects Accumulation/Distribution phases, key events, VSA signals

import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type WyckoffPhase = 'accumulation' | 'distribution' | 'markup' | 'markdown' | 'unknown';
export type WyckoffSubPhase = 'A' | 'B' | 'C' | 'D' | 'E';

export type WyckoffEventType =
	| 'PS'     // Preliminary Support
	| 'SC'     // Selling Climax
	| 'AR'     // Automatic Rally
	| 'ST'     // Secondary Test
	| 'Spring' // Spring / Shakeout (undercut support, reversal)
	| 'Test'   // Test of Spring
	| 'SOS'    // Sign of Strength
	| 'LPS'    // Last Point of Support
	| 'BU'     // Back-Up to edge of creek
	| 'PSY'    // Preliminary Supply
	| 'BC'     // Buying Climax
	| 'UTAD'   // Upthrust After Distribution
	| 'SOW'    // Sign of Weakness
	| 'LPSY';  // Last Point of Supply (resistance)

export interface WyckoffEvent {
	type: WyckoffEventType;
	index: number;
	timestamp: number;
	price: number;
	volumeRatio: number; // relative to rolling 20-bar avg
	description: string;
}

export type VSASignalType =
	| 'climax_volume'    // very high vol + narrow spread → absorption
	| 'effort_no_result' // high vol + narrow spread
	| 'no_demand'        // low vol + narrow spread up bar
	| 'no_supply'        // low vol + narrow spread down bar
	| 'stopping_volume'; // high vol + wide spread + bullish close

export interface VSASignal {
	index: number;
	timestamp: number;
	type: VSASignalType;
	description: string;
}

export interface TradingRange {
	support: number;
	resistance: number;
	midpoint: number;
	widthPct: number; // (resistance - support) / support * 100
}

export interface WyckoffAnalysis {
	phase: WyckoffPhase;
	subPhase: WyckoffSubPhase;
	bias: number; // -100 to +100 (positive = bullish accumulation)
	events: WyckoffEvent[];
	vsaSignals: VSASignal[];
	tradingRange: TradingRange | null;
	description: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RANGE_LOOKBACK = 40;
const TREND_LOOKBACK = 60;
const HIGH_VOL_MULTIPLIER = 1.5;
const WIDE_SPREAD_MULTIPLIER = 1.4;
const RANGE_MIN_COVERAGE = 0.60; // ≥60% of closes inside inner 70% of range

// ─── Pure Helpers ─────────────────────────────────────────────────────────────

function rollingAvg(candles: OHLCV[], i: number, len: number, fn: (c: OHLCV) => number): number {
	const slice = candles.slice(Math.max(0, i - len), i);
	if (slice.length === 0) return 0;
	return slice.reduce((s, c) => s + fn(c), 0) / slice.length;
}

// ─── Prior Trend Detection ────────────────────────────────────────────────────

/**
 * Classify the prior trend by comparing the average close of the first third
 * vs the last third of the lookback window. >5% = up, <-5% = down.
 */
export function detectPriorTrend(
	candles: OHLCV[],
	period = TREND_LOOKBACK,
): 'up' | 'down' | 'sideways' {
	if (candles.length < period) return 'sideways';

	const window = candles.slice(-period);
	const third = Math.max(1, Math.floor(window.length / 3));
	const firstAvg = window.slice(0, third).reduce((s, c) => s + c.close, 0) / third;
	const lastAvg  = window.slice(-third).reduce((s, c) => s + c.close, 0) / third;

	const changePct = (lastAvg - firstAvg) / firstAvg * 100;
	if (changePct > 5)  return 'up';
	if (changePct < -5) return 'down';
	return 'sideways';
}

// ─── Trading Range Detection ──────────────────────────────────────────────────

// Max linear regression slope (% per bar) for a series to be considered ranging
const SLOPE_TREND_THRESHOLD = 0.4;

/**
 * Detect if the last `lookback` candles form a trading range.
 * Uses linear regression slope on closes: if the slope exceeds 0.4% per bar,
 * the market is trending, not ranging.
 */
export function detectTradingRange(
	candles: OHLCV[],
	lookback = RANGE_LOOKBACK,
): TradingRange | null {
	if (candles.length < lookback) return null;

	const window = candles.slice(-lookback);
	const closes = window.map(c => c.close);
	const n      = closes.length;

	// Linear regression slope
	const xMean = (n - 1) / 2;
	const yMean = closes.reduce((s, v) => s + v, 0) / n;
	let ssXY = 0, ssXX = 0;
	for (let i = 0; i < n; i++) {
		ssXY += (i - xMean) * (closes[i] - yMean);
		ssXX += (i - xMean) ** 2;
	}
	const slope    = ssXX > 0 ? ssXY / ssXX : 0;
	const slopePct = yMean > 0 ? Math.abs(slope) / yMean * 100 : 0;

	// Reject if trending
	if (slopePct > SLOPE_TREND_THRESHOLD) return null;

	// percentile-based support / resistance
	const sortedHighs = window.map(c => c.high).sort((a, b) => a - b);
	const sortedLows  = window.map(c => c.low ).sort((a, b) => a - b);
	const p95 = sortedHighs[Math.floor(sortedHighs.length * 0.95)];
	const p05 = sortedLows [Math.ceil (sortedLows.length  * 0.05)];

	const rangeSize = p95 - p05;
	if (rangeSize <= 0) return null;

	return {
		support:    p05,
		resistance: p95,
		midpoint:   (p05 + p95) / 2,
		widthPct:   (rangeSize / p05) * 100,
	};
}

// ─── Wyckoff Event Detection ──────────────────────────────────────────────────

/**
 * Identify key Wyckoff events within a trading range.
 * Each event type is emitted at most once (first occurrence).
 */
export function detectWyckoffEvents(
	candles: OHLCV[],
	range: TradingRange,
): WyckoffEvent[] {
	const events: WyckoffEvent[] = [];
	const { support, resistance, midpoint } = range;
	const rangeSize = resistance - support;
	const seenTypes = new Set<WyckoffEventType>();

	const nearSup  = (c: OHLCV) => c.low  <= support    + rangeSize * 0.15;
	const nearRes  = (c: OHLCV) => c.high >= resistance - rangeSize * 0.15;
	const bullClose = (c: OHLCV) => c.close > (c.high + c.low) / 2;
	const bearClose = (c: OHLCV) => c.close < (c.high + c.low) / 2;

	const push = (e: WyckoffEvent, once = true) => {
		if (once && seenTypes.has(e.type)) return;
		events.push(e);
		seenTypes.add(e.type);
	};

	for (let i = 10; i < candles.length; i++) {
		const c    = candles[i];
		const prev = candles[i - 1];
		const spread = c.high - c.low;
		const avgVol = rollingAvg(candles, i, 20, x => x.volume);
		const avgSpr = rollingAvg(candles, i, 20, x => x.high - x.low);

		if (avgVol === 0 || avgSpr === 0) continue;

		const volRatio    = c.volume / avgVol;
		const isHighVol   = volRatio >= HIGH_VOL_MULTIPLIER;
		const isWideSprd  = spread   >= avgSpr * WIDE_SPREAD_MULTIPLIER;

		// SC — Selling Climax: high vol, wide spread, bearish close near support
		if (isHighVol && isWideSprd && bearClose(c) && nearSup(c)) {
			push({ type: 'SC', index: i, timestamp: c.time, price: c.low, volumeRatio: volRatio,
				description: `Selling Climax at ${c.low.toFixed(4)} — ${(volRatio * 100).toFixed(0)}% avg vol, wide spread, near support` });
		}

		// BC — Buying Climax: high vol, wide spread, bullish close near resistance
		if (isHighVol && isWideSprd && bullClose(c) && nearRes(c)) {
			push({ type: 'BC', index: i, timestamp: c.time, price: c.high, volumeRatio: volRatio,
				description: `Buying Climax at ${c.high.toFixed(4)} — ${(volRatio * 100).toFixed(0)}% avg vol, wide spread, near resistance` });
		}

		// AR — Automatic Rally: strong bullish bar from support area (first one only)
		if (nearSup(prev) && bullClose(c) && c.close > prev.close * 1.003 && !nearRes(c)) {
			push({ type: 'AR', index: i, timestamp: c.time, price: c.close, volumeRatio: volRatio,
				description: `Automatic Rally to ${c.close.toFixed(4)} — bounce from support area` });
		}

		// ST — Secondary Test: high-low touches support zone (after AR, so after index 15)
		if (i > 15 && nearSup(c) && bearClose(c) && !seenTypes.has('Spring')) {
			push({ type: 'ST', index: i, timestamp: c.time, price: c.low, volumeRatio: volRatio,
				description: `Secondary Test at ${c.low.toFixed(4)} — retest of support zone` });
		}

		// Spring: close below support but candle closes back above it
		if (c.low < support * 0.99 && c.close >= support) {
			push({ type: 'Spring', index: i, timestamp: c.time, price: c.low, volumeRatio: volRatio,
				description: `Spring — undercut support (${support.toFixed(4)}) to ${c.low.toFixed(4)}, closed above` }, false);
		}

		// SOS — Sign of Strength: high vol, bullish cross above midpoint
		if (isHighVol && c.close > midpoint && prev.close <= midpoint && c.close > prev.close * 1.005) {
			push({ type: 'SOS', index: i, timestamp: c.time, price: c.close, volumeRatio: volRatio,
				description: `Sign of Strength — crossed above midpoint ${midpoint.toFixed(4)} with volume` }, false);
		}

		// SOW — Sign of Weakness: high vol, bearish cross below midpoint
		if (isHighVol && c.close < midpoint && prev.close >= midpoint && c.close < prev.close * 0.995) {
			push({ type: 'SOW', index: i, timestamp: c.time, price: c.close, volumeRatio: volRatio,
				description: `Sign of Weakness — broke below midpoint ${midpoint.toFixed(4)} with volume` }, false);
		}

		// UTAD — Upthrust After Distribution: spike above resistance, close back below
		if (c.high > resistance * 1.005 && c.close < resistance) {
			push({ type: 'UTAD', index: i, timestamp: c.time, price: c.high, volumeRatio: volRatio,
				description: `UTAD — overshot resistance (${resistance.toFixed(4)}) to ${c.high.toFixed(4)}, closed back below` }, false);
		}

		// PSY — Preliminary Supply: first high-vol bar near resistance (before BC)
		if (isHighVol && nearRes(c) && bullClose(c) && !seenTypes.has('BC')) {
			push({ type: 'PSY', index: i, timestamp: c.time, price: c.high, volumeRatio: volRatio,
				description: `Preliminary Supply at ${c.high.toFixed(4)} — early supply near resistance` });
		}

		// PS — Preliminary Support: first high-vol support bar (before SC)
		if (isHighVol && nearSup(c) && bullClose(c) && !seenTypes.has('SC')) {
			push({ type: 'PS', index: i, timestamp: c.time, price: c.low, volumeRatio: volRatio,
				description: `Preliminary Support at ${c.low.toFixed(4)} — first buying attempt` });
		}

		// LPS — Last Point of Support: higher low after SOS
		if (seenTypes.has('SOS') && nearSup(c) && bullClose(c) && c.low > support) {
			push({ type: 'LPS', index: i, timestamp: c.time, price: c.low, volumeRatio: volRatio,
				description: `Last Point of Support at ${c.low.toFixed(4)} — higher low after SOS` }, false);
		}

		// LPSY — Last Point of Supply: lower high near resistance after SOW
		if (seenTypes.has('SOW') && nearRes(c) && bearClose(c) && c.high < resistance) {
			push({ type: 'LPSY', index: i, timestamp: c.time, price: c.high, volumeRatio: volRatio,
				description: `LPSY at ${c.high.toFixed(4)} — lower high after SOW, supply overcoming demand` }, false);
		}
	}

	return events;
}

// ─── VSA Signal Detection ─────────────────────────────────────────────────────

/**
 * Volume Spread Analysis: classify each bar by effort (volume) vs result (spread).
 * Returns only notable signals (climax, no-demand, no-supply, effort-no-result, stopping).
 */
export function detectVSASignals(candles: OHLCV[]): VSASignal[] {
	const signals: VSASignal[] = [];
	if (candles.length < 10) return signals;

	for (let i = 5; i < candles.length; i++) {
		const c      = candles[i];
		const avgVol = rollingAvg(candles, i, 20, x => x.volume);
		const avgSpr = rollingAvg(candles, i, 20, x => x.high - x.low);
		if (avgVol === 0 || avgSpr === 0) continue;

		const spread     = c.high - c.low;
		const volRatio   = c.volume / avgVol;
		const spdRatio   = spread   / avgSpr;
		const bullClose  = c.close > (c.high + c.low) / 2;
		const bearClose  = c.close < (c.high + c.low) / 2;

		// Climax: ultra-high vol, narrow spread → absorption/reversal warning
		if (volRatio >= 2.0 && spdRatio < 0.7) {
			signals.push({ index: i, timestamp: c.time, type: 'climax_volume',
				description: `Climax volume (${(volRatio * 100).toFixed(0)}% avg) + narrow spread — possible absorption` });
		}
		// Effort no result: high vol + narrow spread (not as extreme as climax)
		else if (volRatio >= HIGH_VOL_MULTIPLIER && spdRatio < 0.8) {
			signals.push({ index: i, timestamp: c.time, type: 'effort_no_result',
				description: `Effort without result — ${(volRatio * 100).toFixed(0)}% vol, narrow spread` });
		}
		// No demand: low vol + narrow up bar
		else if (volRatio < 0.7 && spdRatio < 0.7 && bullClose) {
			signals.push({ index: i, timestamp: c.time, type: 'no_demand',
				description: `No demand — ${(volRatio * 100).toFixed(0)}% vol up bar, lack of buying interest` });
		}
		// No supply: low vol + narrow down bar
		else if (volRatio < 0.7 && spdRatio < 0.7 && bearClose) {
			signals.push({ index: i, timestamp: c.time, type: 'no_supply',
				description: `No supply — ${(volRatio * 100).toFixed(0)}% vol down bar, selling pressure absent` });
		}
		// Stopping volume: high vol, wide spread, bullish close (demand absorbing supply)
		else if (volRatio >= 1.8 && spdRatio >= 1.0 && bullClose) {
			signals.push({ index: i, timestamp: c.time, type: 'stopping_volume',
				description: `Stopping volume — ${(volRatio * 100).toFixed(0)}% vol, wide spread, bullish close` });
		}
	}

	return signals;
}

// ─── Phase Classification ─────────────────────────────────────────────────────

/**
 * Determine Wyckoff phase and sub-phase from context.
 */
export function classifyWyckoffPhase(
	priorTrend: 'up' | 'down' | 'sideways',
	range: TradingRange | null,
	events: WyckoffEvent[],
): { phase: WyckoffPhase; subPhase: WyckoffSubPhase } {
	// No trading range → active trend
	if (!range) {
		if (priorTrend === 'up')   return { phase: 'markup',   subPhase: 'E' };
		if (priorTrend === 'down') return { phase: 'markdown', subPhase: 'E' };
		return { phase: 'unknown', subPhase: 'A' };
	}

	const has = (t: WyckoffEventType) => events.some(e => e.type === t);

	// Accumulation indicators: prior downtrend, SC detected
	const accumulationSignals = (priorTrend === 'down' ? 2 : 0) + (has('SC') ? 2 : 0) + (has('Spring') ? 1 : 0);
	// Distribution indicators: prior uptrend, BC detected
	const distributionSignals = (priorTrend === 'up' ? 2 : 0) + (has('BC') ? 2 : 0) + (has('UTAD') ? 1 : 0);

	if (accumulationSignals >= distributionSignals) {
		// Accumulation: classify sub-phase by progression
		let subPhase: WyckoffSubPhase = 'A';
		if (has('SOS') || has('LPS')) subPhase = 'D';
		else if (has('Spring') || has('Test')) subPhase = 'C';
		else if (has('ST') || has('AR')) subPhase = 'B';
		return { phase: 'accumulation', subPhase };
	} else {
		// Distribution: classify sub-phase by progression
		let subPhase: WyckoffSubPhase = 'A';
		if (has('SOW') || has('LPSY')) subPhase = 'D';
		else if (has('UTAD')) subPhase = 'C';
		else if (has('ST') || has('AR')) subPhase = 'B';
		return { phase: 'distribution', subPhase };
	}
}

// ─── Bias Score ───────────────────────────────────────────────────────────────

/** Map sub-phase to base score for each phase family. */
const ACCUM_SCORES: Record<WyckoffSubPhase, number> = { A: -20, B: 10, C: 30, D: 60, E: 80 };
const DISTR_SCORES: Record<WyckoffSubPhase, number> = { A: 20, B: -10, C: -30, D: -60, E: -80 };

export function calcWyckoffBias(
	phase: WyckoffPhase,
	subPhase: WyckoffSubPhase,
	events: WyckoffEvent[],
): number {
	let score = 0;

	switch (phase) {
		case 'markup':        score = 75;  break;
		case 'markdown':      score = -75; break;
		case 'accumulation':  score = ACCUM_SCORES[subPhase]; break;
		case 'distribution':  score = DISTR_SCORES[subPhase]; break;
		default:              score = 0;
	}

	// Event-based fine-tuning
	const count = (t: WyckoffEventType) => events.filter(e => e.type === t).length;
	score += count('SOS') * 8;
	score += count('LPS') * 5;
	score += count('Spring') * 5;
	score -= count('SOW') * 8;
	score -= count('LPSY') * 5;
	score -= count('UTAD') * 5;

	return Math.max(-100, Math.min(100, Math.round(score)));
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export function analyzeWyckoff(candles: OHLCV[]): WyckoffAnalysis | null {
	if (candles.length < 60) return null;

	const priorTrend  = detectPriorTrend(candles);
	const tradingRange = detectTradingRange(candles);
	const events      = tradingRange ? detectWyckoffEvents(candles, tradingRange) : [];
	const vsaSignals  = detectVSASignals(candles);

	const { phase, subPhase } = classifyWyckoffPhase(priorTrend, tradingRange, events);
	const bias                = calcWyckoffBias(phase, subPhase, events);

	const phaseLabel: Record<WyckoffPhase, string> = {
		accumulation: 'Accumulation',
		distribution: 'Distribution',
		markup:       'Markup (Uptrend)',
		markdown:     'Markdown (Downtrend)',
		unknown:      'Unknown / Transition',
	};

	const description = tradingRange
		? `${phaseLabel[phase]} Phase ${subPhase} — ${events.length} key events in range ${tradingRange.support.toFixed(4)}–${tradingRange.resistance.toFixed(4)} (${tradingRange.widthPct.toFixed(1)}% wide)`
		: `${phaseLabel[phase]} — no clear trading range; prior trend: ${priorTrend}`;

	return { phase, subPhase, bias, events, vsaSignals, tradingRange, description };
}
