// Black-Scholes Options Pricing — T-802
// Computes option prices and Greeks using the Black-Scholes model

import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type OptionGreeks = {
	delta: number;
	gamma: number;
	theta: number;   // per calendar day
	vega:  number;   // per 1% move in IV
	rho:   number;   // per 1% move in rate
};

export type OptionPrice = {
	call:    number;
	put:     number;
	callPremium: number; // call / underlying (%)
	putPremium:  number;
};

export type BSResult = {
	callPrice:  number;
	putPrice:   number;
	callGreeks: OptionGreeks;
	putGreeks:  OptionGreeks;
	impliedVol: number;   // annualised HV used (0–1)
	d1:         number;
	d2:         number;
};

export type IVRankResult = {
	currentHV:  number;   // current annualised HV (0–1)
	hvMin:      number;   // min HV over lookback period
	hvMax:      number;   // max HV over lookback period
	ivRank:     number;   // 0–100 (where currentHV sits in range)
	ivPercentile: number; // % of days currentHV was below (0–100)
};

// ─── Normal distribution helpers ─────────────────────────────────────────────

/**
 * Cumulative distribution function for the standard normal distribution.
 * Abramowitz & Stegun approximation — max error 7.5e-8.
 */
export function normalCDF(x: number): number {
	const a1 =  0.254829592;
	const a2 = -0.284496736;
	const a3 =  1.421413741;
	const a4 = -1.453152027;
	const a5 =  1.061405429;
	const p  =  0.3275911;

	const sign = x < 0 ? -1 : 1;
	const z = Math.abs(x) / Math.SQRT2;   // x/sqrt(2) — normalises for erf
	const t = 1 / (1 + p * z);
	const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
	const erf = 1 - poly * Math.exp(-z * z);
	return 0.5 * (1 + sign * erf);
}

/** Standard normal PDF */
export function normalPDF(x: number): number {
	return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ─── Historical Volatility ────────────────────────────────────────────────────

/**
 * Compute annualised historical volatility from close prices (log-return std dev).
 * @param closes  array of closing prices (chronological)
 * @param window  lookback window for returns (default: all)
 * @returns annualised HV (e.g. 0.60 = 60%)
 */
export function calcHistoricalVolatility(closes: number[], window?: number): number {
	if (closes.length < 2) return 0;

	const slice = window ? closes.slice(-window - 1) : closes;
	const returns: number[] = [];
	for (let i = 1; i < slice.length; i++) {
		if (slice[i - 1] > 0 && slice[i] > 0) {
			returns.push(Math.log(slice[i] / slice[i - 1]));
		}
	}

	if (returns.length < 1) return 0;

	const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
	const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1 || 1);
	return Math.sqrt(variance * 252); // annualise by trading days
}

// ─── Black-Scholes Pricer ─────────────────────────────────────────────────────

/**
 * Compute Black-Scholes call/put prices and Greeks.
 *
 * @param S   current underlying price
 * @param K   strike price
 * @param T   time to expiry in years (e.g. 30/365)
 * @param r   risk-free rate annualised (e.g. 0.05 for 5%)
 * @param v   implied/historical volatility annualised (e.g. 0.60 for 60%)
 * @returns   BSResult with prices and Greeks
 */
export function blackScholes(S: number, K: number, T: number, r: number, v: number): BSResult | null {
	if (S <= 0 || K <= 0 || T <= 0 || v <= 0) return null;

	const sqrtT = Math.sqrt(T);
	const d1 = (Math.log(S / K) + (r + 0.5 * v * v) * T) / (v * sqrtT);
	const d2 = d1 - v * sqrtT;

	const Nd1  = normalCDF(d1);
	const Nd2  = normalCDF(d2);
	const Nnd1 = normalCDF(-d1);
	const Nnd2 = normalCDF(-d2);
	const nd1  = normalPDF(d1);

	const discount = Math.exp(-r * T);

	const callPrice = S * Nd1  - K * discount * Nd2;
	const putPrice  = K * discount * Nnd2 - S * Nnd1;

	// ── Call Greeks ────────────────────────────────────────────────────────────
	const gamma = nd1 / (S * v * sqrtT);

	const callGreeks: OptionGreeks = {
		delta: Nd1,
		gamma,
		theta: (-(S * nd1 * v) / (2 * sqrtT) - r * K * discount * Nd2) / 365,
		vega:  S * nd1 * sqrtT / 100,   // per 1% vol move
		rho:   K * T * discount * Nd2 / 100,  // per 1% rate move
	};

	// ── Put Greeks ─────────────────────────────────────────────────────────────
	const putGreeks: OptionGreeks = {
		delta: Nd1 - 1,
		gamma,
		theta: (-(S * nd1 * v) / (2 * sqrtT) + r * K * discount * Nnd2) / 365,
		vega:  callGreeks.vega,   // same for calls and puts
		rho:   -K * T * discount * Nnd2 / 100,
	};

	return { callPrice, putPrice, callGreeks, putGreeks, impliedVol: v, d1, d2 };
}

// ─── IV Rank ──────────────────────────────────────────────────────────────────

/**
 * Compute IV Rank and IV Percentile from OHLCV history.
 *
 * Uses rolling 21-day HV windows over the full history, then ranks
 * where the current HV sits.
 *
 * @param candles    full OHLCV history (at least 30 candles)
 * @param hvWindow   rolling HV window in days (default: 21)
 * @returns IVRankResult or null if insufficient data
 */
export function calcIVRank(candles: OHLCV[], hvWindow = 21): IVRankResult | null {
	if (candles.length < hvWindow + 5) return null;

	const closes = candles.map(c => c.close);
	const currentHV = calcHistoricalVolatility(closes, hvWindow);

	// Compute rolling HVs over the full history
	const hvSeries: number[] = [];
	for (let i = hvWindow; i <= closes.length; i++) {
		hvSeries.push(calcHistoricalVolatility(closes.slice(0, i), hvWindow));
	}

	if (hvSeries.length === 0) return null;

	const hvMin = Math.min(...hvSeries);
	const hvMax = Math.max(...hvSeries);

	const ivRank = hvMax > hvMin
		? ((currentHV - hvMin) / (hvMax - hvMin)) * 100
		: 50;

	const ivPercentile = (hvSeries.filter(h => h < currentHV).length / hvSeries.length) * 100;

	return {
		currentHV,
		hvMin,
		hvMax,
		ivRank: Math.max(0, Math.min(100, ivRank)),
		ivPercentile: Math.max(0, Math.min(100, ivPercentile)),
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtGreek(v: number, decimals = 4): string {
	return v.toFixed(decimals);
}

export function fmtPct(v: number): string {
	return `${(v * 100).toFixed(2)}%`;
}
