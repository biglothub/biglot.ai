// Market Regime Detection — T-604
// Classifies market conditions: trending_up, trending_down, ranging, high_volatility
// Uses ADX (trend strength), ATR/price ratio (volatility), RSI, +DI/-DI direction

import { adx, atr, rsi } from './engine';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MarketRegime = 'trending_up' | 'trending_down' | 'ranging' | 'high_volatility';

export type RegimeInput = {
	adxValue:  number;  // 0–100, current ADX
	plusDI:    number;  // current +DI
	minusDI:   number;  // current -DI
	atrRatio:  number;  // ATR / close * 100 (% of price)
	rsiValue:  number;  // 0–100 RSI
};

export type RegimeAnalysis = {
	regime:      MarketRegime;
	confidence:  number;  // 0–100
	adxValue:    number;
	plusDI:      number;
	minusDI:     number;
	atrRatio:    number;  // % of price
	rsiValue:    number;
	description: string;
	gaugeValue:  number;  // 0–100: 0 = dead ranging, 100 = extreme trend/vol
};

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const ADX_TREND_THRESHOLD    = 25;  // ADX ≥ 25 → trending
export const ATR_HIGH_VOL_THRESHOLD = 3.0; // ATR > 3% of price → high volatility

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Classify the market regime from indicator values.
 * High volatility overrides trend/range when ATR is extreme.
 */
export function classifyRegime(input: RegimeInput): MarketRegime {
	if (input.atrRatio > ATR_HIGH_VOL_THRESHOLD) return 'high_volatility';
	if (input.adxValue >= ADX_TREND_THRESHOLD) {
		return input.plusDI >= input.minusDI ? 'trending_up' : 'trending_down';
	}
	return 'ranging';
}

/**
 * Compute a 0–100 confidence score for the detected regime.
 */
export function calcRegimeConfidence(input: RegimeInput, regime: MarketRegime): number {
	switch (regime) {
		case 'trending_up':
		case 'trending_down': {
			// ADX excess above threshold (0 at 25, 1 at 50+)
			const adxFactor  = Math.min((input.adxValue - ADX_TREND_THRESHOLD) / 25, 1);
			// DI separation (0 at zero, 1 at 40+ gap)
			const diFactor   = Math.min(Math.abs(input.plusDI - input.minusDI) / 40, 1);
			return Math.round(Math.min((adxFactor * 0.6 + diFactor * 0.4) * 100, 100));
		}
		case 'ranging': {
			// How far below ADX threshold (0 at 25, 1 at 5 or below)
			const adxFactor = Math.min((ADX_TREND_THRESHOLD - input.adxValue) / 20, 1);
			return Math.round(Math.min(adxFactor * 100, 100));
		}
		case 'high_volatility': {
			// How far above vol threshold (starts at 30 base confidence)
			const volFactor = Math.min((input.atrRatio - ATR_HIGH_VOL_THRESHOLD) / 3, 1);
			return Math.round(Math.min((0.3 + volFactor * 0.7) * 100, 100));
		}
	}
}

/**
 * Map ADX to a 0–100 gauge value representing overall "trend/momentum intensity".
 * ADX 0 → 0, ADX 50+ → 100.
 */
export function calcGaugeValue(input: RegimeInput): number {
	return Math.min(100, Math.round(input.adxValue * 2));
}

/**
 * Full regime label suitable for UI display.
 */
export function regimeLabel(regime: MarketRegime): string {
	switch (regime) {
		case 'trending_up':    return 'Trending Up';
		case 'trending_down':  return 'Trending Down';
		case 'ranging':        return 'Ranging';
		case 'high_volatility': return 'High Volatility';
	}
}

// ─── Main analysis ────────────────────────────────────────────────────────────

/**
 * Analyse OHLCV data and return a full regime analysis.
 * Returns null if there is insufficient data (< 40 candles).
 */
export function analyzeRegime(ohlcv: OHLCV[]): RegimeAnalysis | null {
	if (ohlcv.length < 40) return null;

	const adxResult = adx(ohlcv, 14);
	const atrResult = atr(ohlcv, 14);
	const rsiResult = rsi(ohlcv, 14);

	if (!adxResult.adx.length || !atrResult.length || !rsiResult.length) return null;

	const latestADX     = adxResult.adx[adxResult.adx.length - 1].value;
	const latestPlusDI  = adxResult.plusDI.length > 0
		? adxResult.plusDI[adxResult.plusDI.length - 1].value
		: 0;
	const latestMinusDI = adxResult.minusDI.length > 0
		? adxResult.minusDI[adxResult.minusDI.length - 1].value
		: 0;

	const latestATR    = atrResult[atrResult.length - 1].value;
	const currentPrice = ohlcv[ohlcv.length - 1].close;
	const atrRatio     = currentPrice > 0 ? (latestATR / currentPrice) * 100 : 0;
	const latestRSI    = rsiResult[rsiResult.length - 1].value;

	const input: RegimeInput = {
		adxValue:  latestADX,
		plusDI:    latestPlusDI,
		minusDI:   latestMinusDI,
		atrRatio,
		rsiValue:  latestRSI,
	};

	const regime     = classifyRegime(input);
	const confidence = calcRegimeConfidence(input, regime);
	const gaugeValue = calcGaugeValue(input);

	const descriptions: Record<MarketRegime, string> = {
		trending_up: [
			`Uptrend confirmed. ADX ${latestADX.toFixed(1)} (≥${ADX_TREND_THRESHOLD} = trending).`,
			`+DI ${latestPlusDI.toFixed(1)} > −DI ${latestMinusDI.toFixed(1)} — bullish directional pressure.`,
			`RSI ${latestRSI.toFixed(0)}.`,
		].join(' '),
		trending_down: [
			`Downtrend confirmed. ADX ${latestADX.toFixed(1)} (≥${ADX_TREND_THRESHOLD} = trending).`,
			`−DI ${latestMinusDI.toFixed(1)} > +DI ${latestPlusDI.toFixed(1)} — bearish directional pressure.`,
			`RSI ${latestRSI.toFixed(0)}.`,
		].join(' '),
		ranging: [
			`Ranging/consolidating. ADX ${latestADX.toFixed(1)} (<${ADX_TREND_THRESHOLD} = weak trend).`,
			`Price likely sideways — mean-reversion strategies favoured.`,
			`RSI ${latestRSI.toFixed(0)}.`,
		].join(' '),
		high_volatility: [
			`High volatility. ATR is ${atrRatio.toFixed(2)}% of price (>${ATR_HIGH_VOL_THRESHOLD}% threshold).`,
			`ADX ${latestADX.toFixed(1)}, RSI ${latestRSI.toFixed(0)}. Expect large swings — widen stops.`,
		].join(' '),
	};

	return {
		regime,
		confidence,
		adxValue:  latestADX,
		plusDI:    latestPlusDI,
		minusDI:   latestMinusDI,
		atrRatio,
		rsiValue:  latestRSI,
		description: descriptions[regime],
		gaugeValue,
	};
}
