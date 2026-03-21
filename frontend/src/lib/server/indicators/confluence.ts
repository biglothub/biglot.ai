// Confluence Detection - multi-indicator signal aggregation
// Pure functions: OHLCV[] → Signal[] + ConfluenceResult

import type { OHLCV } from '$lib/types/contentBlock';
import {
	sma,
	ema,
	rsi,
	macd,
	bollingerBands,
	atr,
	stochastic,
	superTrend,
	pivotPoints
} from './engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SignalDirection = 'bullish' | 'bearish';

export type SignalType =
	| 'ma_crossover'
	| 'rsi_divergence'
	| 'macd_cross'
	| 'bb_breakout'
	| 'bb_squeeze'
	| 'sr_touch'
	| 'supertrend_flip'
	| 'stoch_cross';

export interface Signal {
	type: SignalType;
	direction: SignalDirection;
	/** 1 = weak, 2 = moderate, 3 = strong */
	strength: number;
	description: string;
	price: number;
	time: number;
}

export interface ConfluenceResult {
	signals: Signal[];
	bullishScore: number;
	bearishScore: number;
	/** null when neither direction reaches MIN_CONFLUENCE_SCORE */
	dominantDirection: SignalDirection | null;
	/** max(bullishScore, bearishScore) */
	confluenceScore: number;
	currentPrice: number;
	/** Latest ATR value (0 if insufficient data) */
	atrValue: number;
}

/** Minimum total strength to declare a dominant direction */
const MIN_CONFLUENCE_SCORE = 4;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMap(pts: { time: number; value: number }[]): Map<number, number> {
	return new Map(pts.map((d) => [d.time, d.value]));
}

// ─── 1. MA Crossover ─────────────────────────────────────────────────────────

export function detectMACrossover(
	ohlcv: OHLCV[],
	fastPeriod = 20,
	slowPeriod = 50
): Signal | null {
	if (ohlcv.length < slowPeriod + 2) return null;

	const fastMA = ema(ohlcv, fastPeriod);
	const slowMA = ema(ohlcv, slowPeriod);
	if (fastMA.length < 2 || slowMA.length < 2) return null;

	const fastMap = buildMap(fastMA);
	const slowMap = buildMap(slowMA);

	const curr = ohlcv[ohlcv.length - 1];
	const prev = ohlcv[ohlcv.length - 2];

	const fCurr = fastMap.get(curr.time);
	const sCurr = slowMap.get(curr.time);
	const fPrev = fastMap.get(prev.time);
	const sPrev = slowMap.get(prev.time);

	if (fCurr === undefined || sCurr === undefined || fPrev === undefined || sPrev === undefined) {
		return null;
	}

	if (fPrev < sPrev && fCurr >= sCurr) {
		return {
			type: 'ma_crossover',
			direction: 'bullish',
			strength: 2,
			description: `EMA${fastPeriod} crossed above EMA${slowPeriod} (Golden Cross)`,
			price: curr.close,
			time: curr.time
		};
	}

	if (fPrev > sPrev && fCurr <= sCurr) {
		return {
			type: 'ma_crossover',
			direction: 'bearish',
			strength: 2,
			description: `EMA${fastPeriod} crossed below EMA${slowPeriod} (Death Cross)`,
			price: curr.close,
			time: curr.time
		};
	}

	return null;
}

// ─── 2. RSI Divergence ───────────────────────────────────────────────────────

export function detectRSIDivergence(
	ohlcv: OHLCV[],
	period = 14,
	lookback = 20
): Signal | null {
	if (ohlcv.length < period + lookback) return null;

	const rsiValues = rsi(ohlcv, period);
	if (rsiValues.length < lookback) return null;

	const recentOHLCV = ohlcv.slice(-lookback);
	const recentRSI = rsiValues.slice(-lookback);
	if (recentRSI.length < 2) return null;

	const startClose = recentOHLCV[0].close;
	const endClose = recentOHLCV[recentOHLCV.length - 1].close;
	const startRSI = recentRSI[0].value;
	const endRSI = recentRSI[recentRSI.length - 1].value;

	const priceChangePct = (endClose - startClose) / startClose;
	const rsiChange = endRSI - startRSI;

	// Bearish divergence: price rises meaningfully but RSI falls
	if (priceChangePct > 0.02 && rsiChange < -5) {
		return {
			type: 'rsi_divergence',
			direction: 'bearish',
			strength: 2,
			description: `Bearish RSI divergence: price +${(priceChangePct * 100).toFixed(1)}% but RSI fell ${Math.abs(rsiChange).toFixed(0)} pts`,
			price: endClose,
			time: recentOHLCV[recentOHLCV.length - 1].time
		};
	}

	// Bullish divergence: price falls meaningfully but RSI rises
	if (priceChangePct < -0.02 && rsiChange > 5) {
		return {
			type: 'rsi_divergence',
			direction: 'bullish',
			strength: 2,
			description: `Bullish RSI divergence: price ${(priceChangePct * 100).toFixed(1)}% but RSI rose ${rsiChange.toFixed(0)} pts`,
			price: endClose,
			time: recentOHLCV[recentOHLCV.length - 1].time
		};
	}

	return null;
}

// ─── 3. MACD Signal Cross ────────────────────────────────────────────────────

export function detectMACDCross(ohlcv: OHLCV[]): Signal | null {
	const result = macd(ohlcv);
	if (result.macd.length < 2 || result.signal.length < 2) return null;

	const n = result.macd.length;
	const signalMap = buildMap(result.signal);

	const mCurr = result.macd[n - 1];
	const mPrev = result.macd[n - 2];
	const sCurr = signalMap.get(mCurr.time);
	const sPrev = signalMap.get(mPrev.time);

	if (sCurr === undefined || sPrev === undefined) return null;

	const curr = ohlcv[ohlcv.length - 1];

	if (mPrev.value < sPrev && mCurr.value >= sCurr) {
		return {
			type: 'macd_cross',
			direction: 'bullish',
			strength: 2,
			description: `MACD crossed above signal line (MACD: ${mCurr.value.toFixed(4)})`,
			price: curr.close,
			time: curr.time
		};
	}

	if (mPrev.value > sPrev && mCurr.value <= sCurr) {
		return {
			type: 'macd_cross',
			direction: 'bearish',
			strength: 2,
			description: `MACD crossed below signal line (MACD: ${mCurr.value.toFixed(4)})`,
			price: curr.close,
			time: curr.time
		};
	}

	return null;
}

// ─── 4. Bollinger Band Breakout / Squeeze ────────────────────────────────────

export function detectBollingerSignal(ohlcv: OHLCV[], period = 20): Signal | null {
	const bb = bollingerBands(ohlcv, period);
	if (bb.upper.length < 5) return null;

	const upperMap = buildMap(bb.upper);
	const lowerMap = buildMap(bb.lower);
	const middleMap = buildMap(bb.middle);

	const curr = ohlcv[ohlcv.length - 1];
	const upper = upperMap.get(curr.time);
	const lower = lowerMap.get(curr.time);
	const middle = middleMap.get(curr.time);

	if (upper === undefined || lower === undefined || middle === undefined) return null;

	// Breakout takes priority over squeeze
	if (curr.close > upper) {
		return {
			type: 'bb_breakout',
			direction: 'bullish',
			strength: 2,
			description: `Price broke above Bollinger upper band (${upper.toFixed(2)})`,
			price: curr.close,
			time: curr.time
		};
	}

	if (curr.close < lower) {
		return {
			type: 'bb_breakout',
			direction: 'bearish',
			strength: 2,
			description: `Price broke below Bollinger lower band (${lower.toFixed(2)})`,
			price: curr.close,
			time: curr.time
		};
	}

	// Squeeze: current bandwidth < 50% of recent 20-bar average bandwidth
	if (bb.upper.length >= 20) {
		const tail = bb.upper.slice(-20);
		const tailLower = bb.lower.slice(-20);
		const tailMiddle = bb.middle.slice(-20);

		const avgBandwidth =
			tail.reduce((sum, u, i) => sum + (u.value - tailLower[i].value) / tailMiddle[i].value, 0) /
			tail.length;

		const currentBandwidth = (upper - lower) / middle;

		if (currentBandwidth < avgBandwidth * 0.5) {
			const dir: SignalDirection = curr.close >= middle ? 'bullish' : 'bearish';
			return {
				type: 'bb_squeeze',
				direction: dir,
				strength: 1,
				description: `Bollinger Band squeeze (BW: ${(currentBandwidth * 100).toFixed(1)}% vs avg ${(avgBandwidth * 100).toFixed(1)}%)`,
				price: curr.close,
				time: curr.time
			};
		}
	}

	return null;
}

// ─── 5. Support / Resistance Touch (Pivot Points) ────────────────────────────

export function detectSRTouch(ohlcv: OHLCV[], tolerancePct = 0.005): Signal | null {
	const pivots = pivotPoints(ohlcv);
	if (pivots.pivot.length === 0) return null;

	const curr = ohlcv[ohlcv.length - 1];
	const price = curr.close;

	function near(level: number | undefined): boolean {
		if (level === undefined) return false;
		return Math.abs(price - level) / level < tolerancePct;
	}

	const latestPivot = pivots.pivot[pivots.pivot.length - 1]?.value;
	const latestS1 = pivots.s1[pivots.s1.length - 1]?.value;
	const latestS2 = pivots.s2[pivots.s2.length - 1]?.value;
	const latestR1 = pivots.r1[pivots.r1.length - 1]?.value;
	const latestR2 = pivots.r2[pivots.r2.length - 1]?.value;

	if (near(latestS2)) {
		return {
			type: 'sr_touch',
			direction: 'bullish',
			strength: 3,
			description: `Price at S2 support (${latestS2!.toFixed(2)})`,
			price,
			time: curr.time
		};
	}
	if (near(latestS1)) {
		return {
			type: 'sr_touch',
			direction: 'bullish',
			strength: 2,
			description: `Price at S1 support (${latestS1!.toFixed(2)})`,
			price,
			time: curr.time
		};
	}
	if (near(latestR2)) {
		return {
			type: 'sr_touch',
			direction: 'bearish',
			strength: 3,
			description: `Price at R2 resistance (${latestR2!.toFixed(2)})`,
			price,
			time: curr.time
		};
	}
	if (near(latestR1)) {
		return {
			type: 'sr_touch',
			direction: 'bearish',
			strength: 2,
			description: `Price at R1 resistance (${latestR1!.toFixed(2)})`,
			price,
			time: curr.time
		};
	}
	if (near(latestPivot)) {
		const dir: SignalDirection = price >= latestPivot! ? 'bullish' : 'bearish';
		return {
			type: 'sr_touch',
			direction: dir,
			strength: 1,
			description: `Price at pivot point (${latestPivot!.toFixed(2)})`,
			price,
			time: curr.time
		};
	}

	return null;
}

// ─── 6. SuperTrend Flip ───────────────────────────────────────────────────────

export function detectSuperTrendFlip(ohlcv: OHLCV[]): Signal | null {
	const st = superTrend(ohlcv);
	if (st.direction.length < 2) return null;

	const n = st.direction.length;
	const prevDir = st.direction[n - 2].value;
	const currDir = st.direction[n - 1].value;

	const curr = ohlcv[ohlcv.length - 1];

	if (prevDir === -1 && currDir === 1) {
		return {
			type: 'supertrend_flip',
			direction: 'bullish',
			strength: 3,
			description: `SuperTrend flipped bullish (price: ${curr.close.toFixed(2)})`,
			price: curr.close,
			time: curr.time
		};
	}

	if (prevDir === 1 && currDir === -1) {
		return {
			type: 'supertrend_flip',
			direction: 'bearish',
			strength: 3,
			description: `SuperTrend flipped bearish (price: ${curr.close.toFixed(2)})`,
			price: curr.close,
			time: curr.time
		};
	}

	return null;
}

// ─── 7. Stochastic Cross (in extreme zones) ──────────────────────────────────

export function detectStochasticCross(ohlcv: OHLCV[]): Signal | null {
	const stoch = stochastic(ohlcv);
	if (stoch.k.length < 2 || stoch.d.length < 2) return null;

	const n = stoch.k.length;
	const dMap = buildMap(stoch.d);

	const kCurr = stoch.k[n - 1];
	const kPrev = stoch.k[n - 2];
	const dCurr = dMap.get(kCurr.time);
	const dPrev = dMap.get(kPrev.time);

	if (dCurr === undefined || dPrev === undefined) return null;

	const curr = ohlcv[ohlcv.length - 1];

	// Bullish cross in oversold zone (<30)
	if (kPrev.value < dPrev && kCurr.value >= dCurr && kCurr.value < 30) {
		return {
			type: 'stoch_cross',
			direction: 'bullish',
			strength: 2,
			description: `Stochastic bullish cross in oversold zone (K: ${kCurr.value.toFixed(0)})`,
			price: curr.close,
			time: curr.time
		};
	}

	// Bearish cross in overbought zone (>70)
	if (kPrev.value > dPrev && kCurr.value <= dCurr && kCurr.value > 70) {
		return {
			type: 'stoch_cross',
			direction: 'bearish',
			strength: 2,
			description: `Stochastic bearish cross in overbought zone (K: ${kCurr.value.toFixed(0)})`,
			price: curr.close,
			time: curr.time
		};
	}

	return null;
}

// ─── 8. SMA Trend Filter (simple trend alignment) ────────────────────────────

export function detectTrendAlignment(ohlcv: OHLCV[]): Signal | null {
	if (ohlcv.length < 201) return null;

	const sma50 = sma(ohlcv, 50);
	const sma200 = sma(ohlcv, 200);
	if (sma50.length === 0 || sma200.length === 0) return null;

	const curr = ohlcv[ohlcv.length - 1];
	const s50Map = buildMap(sma50);
	const s200Map = buildMap(sma200);

	const s50 = s50Map.get(curr.time);
	const s200 = s200Map.get(curr.time);
	if (s50 === undefined || s200 === undefined) return null;

	// Price above both MAs — bullish trend
	if (curr.close > s50 && s50 > s200) {
		return {
			type: 'ma_crossover',
			direction: 'bullish',
			strength: 1,
			description: `Price above SMA50 (${s50.toFixed(2)}) and SMA200 (${s200.toFixed(2)}) — bullish trend`,
			price: curr.close,
			time: curr.time
		};
	}

	// Price below both MAs — bearish trend
	if (curr.close < s50 && s50 < s200) {
		return {
			type: 'ma_crossover',
			direction: 'bearish',
			strength: 1,
			description: `Price below SMA50 (${s50.toFixed(2)}) and SMA200 (${s200.toFixed(2)}) — bearish trend`,
			price: curr.close,
			time: curr.time
		};
	}

	return null;
}

// ─── Main: Run All Detectors ──────────────────────────────────────────────────

export function detectConfluence(ohlcv: OHLCV[]): ConfluenceResult {
	if (ohlcv.length === 0) {
		return {
			signals: [],
			bullishScore: 0,
			bearishScore: 0,
			dominantDirection: null,
			confluenceScore: 0,
			currentPrice: 0,
			atrValue: 0
		};
	}

	const atrData = atr(ohlcv, 14);
	const atrValue = atrData.length > 0 ? atrData[atrData.length - 1].value : 0;
	const currentPrice = ohlcv[ohlcv.length - 1].close;

	const detectors: (() => Signal | null)[] = [
		() => detectMACrossover(ohlcv, 20, 50),
		() => detectMACrossover(ohlcv, 9, 21),
		() => detectTrendAlignment(ohlcv),
		() => detectRSIDivergence(ohlcv),
		() => detectMACDCross(ohlcv),
		() => detectBollingerSignal(ohlcv),
		() => detectSRTouch(ohlcv),
		() => detectSuperTrendFlip(ohlcv),
		() => detectStochasticCross(ohlcv)
	];

	const signals: Signal[] = [];
	for (const detect of detectors) {
		const signal = detect();
		if (signal !== null) signals.push(signal);
	}

	let bullishScore = 0;
	let bearishScore = 0;
	for (const signal of signals) {
		if (signal.direction === 'bullish') bullishScore += signal.strength;
		else bearishScore += signal.strength;
	}

	const confluenceScore = Math.max(bullishScore, bearishScore);
	let dominantDirection: SignalDirection | null = null;

	if (bullishScore > bearishScore && bullishScore >= MIN_CONFLUENCE_SCORE) {
		dominantDirection = 'bullish';
	} else if (bearishScore > bullishScore && bearishScore >= MIN_CONFLUENCE_SCORE) {
		dominantDirection = 'bearish';
	}

	return {
		signals,
		bullishScore,
		bearishScore,
		dominantDirection,
		confluenceScore,
		currentPrice,
		atrValue
	};
}
