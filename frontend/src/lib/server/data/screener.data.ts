// Technical Asset Screener — T-901
// Pure functions for multi-asset technical screening

import type { OHLCV } from '$lib/types/contentBlock';
import { rsi, sma, macd, atr } from '../indicators/engine';

// ─── Default watchlist ────────────────────────────────────────────────────────

export const DEFAULT_WATCHLIST: string[] = [
	'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
	'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
	'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'LTCUSDT', 'NEARUSDT',
	'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT', 'APTUSDT',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrendFilter =
	| 'above_ma50'
	| 'below_ma50'
	| 'above_ma200'
	| 'below_ma200'
	| 'golden_cross'
	| 'death_cross';

export interface ScreenerFilters {
	rsiMin?: number;         // RSI >= rsiMin
	rsiMax?: number;         // RSI <= rsiMax
	trend?: TrendFilter;
	macdSignal?: 'bullish' | 'bearish';  // MACD line vs signal line
	volumeSpike?: number;    // current volume > volumeSpike × 20-period avg
	atrVolatility?: 'high' | 'low';      // ATR% relative to 20-period avg
}

export interface AssetScreenResult {
	symbol: string;
	price: number;
	change24h: number;    // % change vs previous close
	rsi14: number;
	trend: string;
	macdSignal: 'bullish' | 'bearish' | 'neutral';
	volumeRatio: number;  // current vol / 20-period avg vol
	atrPct: number;       // ATR(14) / price × 100
	score: number;        // number of matching filter criteria
	matches: string[];    // names of matching criteria
}

// ─── Core screening function ──────────────────────────────────────────────────

/**
 * Screen a single asset against filters.
 * Returns null if candles are insufficient (< 50).
 */
export function screenAsset(
	symbol: string,
	candles: OHLCV[],
	filters: ScreenerFilters,
): AssetScreenResult | null {
	if (candles.length < 50) return null;

	const last    = candles[candles.length - 1];
	const prev    = candles[candles.length - 2];
	const price   = last.close;
	const change24h = prev ? ((price - prev.close) / prev.close) * 100 : 0;

	// ── RSI ──────────────────────────────────────────────────────────────────
	const rsiSeries = rsi(candles, 14);
	const rsiRaw    = rsiSeries.length > 0 ? rsiSeries[rsiSeries.length - 1]?.value : undefined;
	const lastRSI   = (rsiRaw === undefined || isNaN(rsiRaw)) ? 50 : rsiRaw;

	// ── SMA 50 / 200 ─────────────────────────────────────────────────────────
	const sma50Series  = sma(candles, 50);
	const sma200Series = candles.length >= 200 ? sma(candles, 200) : [];
	const lastSMA50    = sma50Series.length  > 0 ? sma50Series[sma50Series.length - 1]?.value   : undefined;
	const lastSMA200   = sma200Series.length > 0 ? sma200Series[sma200Series.length - 1]?.value : undefined;
	const prevSMA50    = sma50Series.length  > 1 ? sma50Series[sma50Series.length - 2]?.value   : undefined;
	const prevSMA200   = sma200Series.length > 1 ? sma200Series[sma200Series.length - 2]?.value : undefined;

	// ── Trend label ───────────────────────────────────────────────────────────
	let trend: string;
	if (lastSMA50 !== undefined && lastSMA200 !== undefined) {
		if (price > lastSMA50 && price > lastSMA200)       trend = 'strong_uptrend';
		else if (price > lastSMA50 && price < lastSMA200)  trend = 'recovering';
		else if (price < lastSMA50 && price > lastSMA200)  trend = 'weakening';
		else                                               trend = 'downtrend';
	} else if (lastSMA50 !== undefined) {
		trend = price > lastSMA50 ? 'above_ma50' : 'below_ma50';
	} else {
		trend = 'neutral';
	}

	// ── MACD ─────────────────────────────────────────────────────────────────
	const macdResult = macd(candles, 12, 26, 9);
	let macdSignal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
	if (macdResult.macd.length > 0 && macdResult.signal.length > 0) {
		const lastMACD   = macdResult.macd[macdResult.macd.length - 1]?.value   ?? 0;
		const lastSignal = macdResult.signal[macdResult.signal.length - 1]?.value ?? 0;
		macdSignal = lastMACD > lastSignal ? 'bullish' : 'bearish';
	}

	// ── Volume ratio ──────────────────────────────────────────────────────────
	const recent20Vols = candles.slice(-21, -1).map(c => c.volume);
	const avgVol20     = recent20Vols.length > 0
		? recent20Vols.reduce((s, v) => s + v, 0) / recent20Vols.length
		: 1;
	const volumeRatio  = avgVol20 > 0 ? last.volume / avgVol20 : 1;

	// ── ATR% ──────────────────────────────────────────────────────────────────
	const atrSeries  = atr(candles, 14);
	const lastATR    = atrSeries.length > 0 ? (atrSeries[atrSeries.length - 1]?.value ?? 0) : 0;
	const atrPct     = price > 0 ? (lastATR / price) * 100 : 0;

	const recent20ATR = atrSeries.slice(-20);
	const avgATRPct   = recent20ATR.length > 0
		? recent20ATR.reduce((s, a) => s + (a.value / price) * 100, 0) / recent20ATR.length
		: atrPct;

	// ── Score matches ─────────────────────────────────────────────────────────
	const matches: string[] = [];

	if (filters.rsiMin !== undefined && lastRSI >= filters.rsiMin) {
		matches.push(`RSI≥${filters.rsiMin}`);
	}
	if (filters.rsiMax !== undefined && lastRSI <= filters.rsiMax) {
		matches.push(`RSI≤${filters.rsiMax}`);
	}

	if (filters.trend !== undefined) {
		const trendMatch = checkTrend(filters.trend, price, lastSMA50, lastSMA200, prevSMA50, prevSMA200);
		if (trendMatch) matches.push(filters.trend);
	}

	if (filters.macdSignal !== undefined && macdSignal === filters.macdSignal) {
		matches.push(`MACD_${filters.macdSignal}`);
	}

	if (filters.volumeSpike !== undefined && volumeRatio >= filters.volumeSpike) {
		matches.push(`vol>${filters.volumeSpike}x`);
	}

	if (filters.atrVolatility === 'high' && atrPct > avgATRPct) {
		matches.push('high_volatility');
	}
	if (filters.atrVolatility === 'low' && atrPct < avgATRPct) {
		matches.push('low_volatility');
	}

	return {
		symbol,
		price,
		change24h,
		rsi14: lastRSI,
		trend,
		macdSignal,
		volumeRatio,
		atrPct,
		score: matches.length,
		matches,
	};
}

function checkTrend(
	filter: TrendFilter,
	price: number,
	sma50: number | undefined,
	sma200: number | undefined,
	prevSMA50: number | undefined,
	prevSMA200: number | undefined,
): boolean {
	switch (filter) {
		case 'above_ma50':    return sma50 !== undefined && price > sma50;
		case 'below_ma50':    return sma50 !== undefined && price < sma50;
		case 'above_ma200':   return sma200 !== undefined && price > sma200;
		case 'below_ma200':   return sma200 !== undefined && price < sma200;
		case 'golden_cross':
			return sma50 !== undefined && sma200 !== undefined
				&& prevSMA50 !== undefined && prevSMA200 !== undefined
				&& sma50 > sma200 && prevSMA50 <= prevSMA200;
		case 'death_cross':
			return sma50 !== undefined && sma200 !== undefined
				&& prevSMA50 !== undefined && prevSMA200 !== undefined
				&& sma50 < sma200 && prevSMA50 >= prevSMA200;
	}
}

// ─── Batch screening ──────────────────────────────────────────────────────────

/**
 * Screen multiple assets. Returns all results sorted by score desc, then change24h desc.
 * Assets with insufficient data are omitted.
 */
export function screenAssets(
	data: Array<{ symbol: string; candles: OHLCV[] }>,
	filters: ScreenerFilters,
): AssetScreenResult[] {
	const results: AssetScreenResult[] = [];
	for (const { symbol, candles } of data) {
		const r = screenAsset(symbol, candles, filters);
		if (r) results.push(r);
	}
	return results.sort((a, b) => b.score - a.score || b.change24h - a.change24h);
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtScreenerPrice(price: number): string {
	if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (price >= 1)    return price.toFixed(4);
	return price.toFixed(6);
}

export function trendLabel(trend: string): string {
	const labels: Record<string, string> = {
		strong_uptrend: '↑↑ Strong Uptrend',
		recovering:     '↑ Recovering',
		weakening:      '↓ Weakening',
		downtrend:      '↓↓ Downtrend',
		above_ma50:     '↑ Above MA50',
		below_ma50:     '↓ Below MA50',
		neutral:        '→ Neutral',
	};
	return labels[trend] ?? trend;
}
