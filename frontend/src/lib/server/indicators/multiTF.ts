// Multi-Timeframe Analysis — T-502
// Trend alignment, key levels, and confluence zones across timeframes

import type { OHLCV } from '$lib/types/contentBlock';
import { ema, rsi, atr, macd } from './engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrendDirection = 'bullish' | 'bearish' | 'neutral';

export type TimeframeBias = {
	timeframe: string;
	trend: TrendDirection;
	rsi: number | null;
	macdSignal: 'bullish' | 'bearish' | 'neutral';
	ema20: number | null;
	ema50: number | null;
	keyLevels: { price: number; type: 'support' | 'resistance' }[];
	score: number;  // -2 to +2 (bearish to bullish)
};

export type MTFAnalysis = {
	symbol: string;
	timeframes: TimeframeBias[];
	overallAlignment: TrendDirection;
	confluenceScore: number;  // 0–1, how aligned are all TFs
	bullishTFs: string[];
	bearishTFs: string[];
	keyConfluenceZones: { price: number; type: 'support' | 'resistance'; count: number }[];
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Determine trend direction from price relative to EMAs and EMA slope.
 */
export function detectTrend(ohlcv: OHLCV[], shortPeriod = 20, longPeriod = 50): TrendDirection {
	if (ohlcv.length < longPeriod + 5) return 'neutral';

	const ema20 = ema(ohlcv, shortPeriod);
	const ema50 = ema(ohlcv, longPeriod);

	if (ema20.length === 0 || ema50.length === 0) return 'neutral';

	const lastPrice = ohlcv[ohlcv.length - 1].close;
	const lastEma20 = ema20[ema20.length - 1].value;
	const lastEma50 = ema50[ema50.length - 1].value;

	// Slope of EMA20 (last 5 points)
	const slice = ema20.slice(-5);
	const slope = slice.length >= 2 ? slice[slice.length - 1].value - slice[0].value : 0;

	const priceAboveEma20 = lastPrice > lastEma20;
	const priceAboveEma50 = lastPrice > lastEma50;
	const ema20AboveEma50 = lastEma20 > lastEma50;

	if (priceAboveEma20 && priceAboveEma50 && ema20AboveEma50 && slope > 0) return 'bullish';
	if (!priceAboveEma20 && !priceAboveEma50 && !ema20AboveEma50 && slope < 0) return 'bearish';
	return 'neutral';
}

/**
 * Classify MACD as bullish/bearish/neutral.
 */
export function classifyMACD(ohlcv: OHLCV[]): 'bullish' | 'bearish' | 'neutral' {
	if (ohlcv.length < 30) return 'neutral';
	const result = macd(ohlcv);
	if (result.macd.length < 2 || result.signal.length < 2) return 'neutral';

	const lastMACD = result.macd[result.macd.length - 1].value;
	const lastSignal = result.signal[result.signal.length - 1].value;
	const prevMACD = result.macd[result.macd.length - 2].value;
	const prevSignal = result.signal[result.signal.length - 2].value;

	// Bullish: MACD above signal or crossing above
	if (lastMACD > lastSignal) return 'bullish';
	if (lastMACD < lastSignal) return 'bearish';
	return 'neutral';
}

/**
 * Compute a bias score for a timeframe: -2 (strong bear) to +2 (strong bull).
 */
export function calcBiasScore(
	trend: TrendDirection,
	rsiValue: number | null,
	macdSignal: 'bullish' | 'bearish' | 'neutral'
): number {
	let score = 0;

	if (trend === 'bullish') score += 1;
	else if (trend === 'bearish') score -= 1;

	if (rsiValue !== null) {
		if (rsiValue > 60) score += 0.5;
		else if (rsiValue < 40) score -= 0.5;
	}

	if (macdSignal === 'bullish') score += 0.5;
	else if (macdSignal === 'bearish') score -= 0.5;

	return Math.max(-2, Math.min(2, score));
}

/**
 * Find key support/resistance levels using recent swing highs and lows.
 * Returns up to `count` levels.
 */
export function findKeyLevels(
	ohlcv: OHLCV[],
	count = 3,
	lookback = 5
): { price: number; type: 'support' | 'resistance' }[] {
	const levels: { price: number; type: 'support' | 'resistance' }[] = [];
	const n = ohlcv.length;

	for (let i = lookback; i < n - lookback; i++) {
		const c = ohlcv[i].close;
		let isHigh = true, isLow = true;
		for (let j = i - lookback; j <= i + lookback; j++) {
			if (j === i) continue;
			if (ohlcv[j].close >= c) isHigh = false;
			if (ohlcv[j].close <= c) isLow = false;
		}
		if (isHigh) levels.push({ price: c, type: 'resistance' });
		if (isLow) levels.push({ price: c, type: 'support' });
	}

	// Sort by recency (nearest to end)
	return levels.slice(-count * 2).slice(0, count);
}

/**
 * Analyse a single timeframe's OHLCV data.
 */
export function analyseTimeframe(timeframe: string, ohlcv: OHLCV[]): TimeframeBias {
	if (ohlcv.length < 30) {
		return {
			timeframe,
			trend: 'neutral',
			rsi: null,
			macdSignal: 'neutral',
			ema20: null,
			ema50: null,
			keyLevels: [],
			score: 0,
		};
	}

	const trend = detectTrend(ohlcv);
	const rsiData = rsi(ohlcv);
	const rsiValue = rsiData.length > 0 ? rsiData[rsiData.length - 1].value : null;
	const macdSignal = classifyMACD(ohlcv);

	const ema20Data = ema(ohlcv, 20);
	const ema50Data = ema(ohlcv, 50);
	const ema20Value = ema20Data.length > 0 ? ema20Data[ema20Data.length - 1].value : null;
	const ema50Value = ema50Data.length > 0 ? ema50Data[ema50Data.length - 1].value : null;

	const keyLevels = findKeyLevels(ohlcv, 3);
	const score = calcBiasScore(trend, rsiValue, macdSignal);

	return {
		timeframe,
		trend,
		rsi: rsiValue,
		macdSignal,
		ema20: ema20Value,
		ema50: ema50Value,
		keyLevels,
		score,
	};
}

/**
 * Find confluence zones: key levels that appear within a price range across multiple TFs.
 * Returns levels sorted by confluence count.
 */
export function findConfluenceZones(
	biases: TimeframeBias[],
	tolerancePct = 0.5
): { price: number; type: 'support' | 'resistance'; count: number }[] {
	const allLevels = biases.flatMap(b => b.keyLevels);
	const used = new Set<number>();
	const zones: { price: number; type: 'support' | 'resistance'; count: number }[] = [];

	for (let i = 0; i < allLevels.length; i++) {
		if (used.has(i)) continue;
		const base = allLevels[i];
		let count = 1;
		used.add(i);

		for (let j = i + 1; j < allLevels.length; j++) {
			if (used.has(j)) continue;
			const other = allLevels[j];
			const pctDist = Math.abs(base.price - other.price) / base.price * 100;
			if (pctDist <= tolerancePct && base.type === other.type) {
				count++;
				used.add(j);
			}
		}

		if (count >= 2) {
			zones.push({ price: base.price, type: base.type, count });
		}
	}

	return zones.sort((a, b) => b.count - a.count);
}

/**
 * Build the full multi-timeframe analysis.
 */
export function buildMTFAnalysis(
	symbol: string,
	ohlcvByTF: Map<string, OHLCV[]>
): MTFAnalysis {
	const timeframes = [...ohlcvByTF.entries()].map(([tf, ohlcv]) =>
		analyseTimeframe(tf, ohlcv)
	);

	const bullishTFs = timeframes.filter(t => t.trend === 'bullish').map(t => t.timeframe);
	const bearishTFs = timeframes.filter(t => t.trend === 'bearish').map(t => t.timeframe);

	// Confluence: proportion of TFs agreeing on direction
	const totalTFs = timeframes.length;
	const maxAgreement = Math.max(bullishTFs.length, bearishTFs.length, 1);
	const confluenceScore = totalTFs > 0 ? maxAgreement / totalTFs : 0;

	const overallScore = timeframes.reduce((s, t) => s + t.score, 0);
	const overallAlignment: TrendDirection =
		overallScore > 0.5 ? 'bullish' :
		overallScore < -0.5 ? 'bearish' :
		'neutral';

	const keyConfluenceZones = findConfluenceZones(timeframes);

	return {
		symbol,
		timeframes,
		overallAlignment,
		confluenceScore,
		bullishTFs,
		bearishTFs,
		keyConfluenceZones,
	};
}
