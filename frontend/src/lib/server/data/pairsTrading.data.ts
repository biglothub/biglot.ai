// Pairs Trading & Spread Analysis — T-1003
// Pure functions: OLS hedge ratio, spread computation, z-score, half-life, cointegration score.

import { pearsonCorrelation, toReturns } from '../risk/correlation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpreadPoint {
	index: number;
	spread: number;
	zScore: number;
}

export interface PairsSnapshot {
	symbolA: string;
	symbolB: string;
	beta: number;                  // OLS hedge ratio (A = beta*B + intercept + spread)
	intercept: number;
	correlation30d: number;        // Pearson correlation on last 30 daily returns
	currentSpread: number;         // latest spread value
	currentZScore: number;         // z-score vs 20-day mean/std
	spreadMean: number;            // 20-day mean of spread
	spreadStd: number;             // 20-day std of spread
	halfLife: number;              // OU mean-reversion half-life in days (Inf if not reverting)
	adfStat: number;               // ADF t-statistic (more negative = more cointegrated)
	cointegrationScore: number;    // 0-100 based on ADF stat
	signal: 'long_spread' | 'short_spread' | 'neutral'; // trading signal
	history: SpreadPoint[];        // last 20 spread points with z-score
}

// ─── OLS regression ───────────────────────────────────────────────────────────

/**
 * Simple OLS: regress y on x.
 * Returns slope and intercept.
 */
export function olsRegress(x: number[], y: number[]): { slope: number; intercept: number } {
	const n = Math.min(x.length, y.length);
	if (n < 2) return { slope: 1, intercept: 0 };

	let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
	for (let i = 0; i < n; i++) {
		sumX  += x[i];
		sumY  += y[i];
		sumXX += x[i] * x[i];
		sumXY += x[i] * y[i];
	}
	const denom = n * sumXX - sumX * sumX;
	if (denom === 0) return { slope: 1, intercept: 0 };

	const slope     = (n * sumXY - sumX * sumY) / denom;
	const intercept = (sumY - slope * sumX) / n;
	return { slope, intercept };
}

/** Compute spread series: spreadᵢ = priceA[i] - beta × priceB[i] - intercept */
export function computeSpread(
	priceA: number[],
	priceB: number[],
	beta: number,
	intercept: number,
): number[] {
	const n = Math.min(priceA.length, priceB.length);
	return Array.from({ length: n }, (_, i) => priceA[i] - beta * priceB[i] - intercept);
}

// ─── Z-score ─────────────────────────────────────────────────────────────────

/** Rolling mean of an array */
export function mean(arr: number[]): number {
	if (arr.length === 0) return 0;
	return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Rolling population std dev */
export function stdDev(arr: number[], m?: number): number {
	if (arr.length < 2) return 1;
	const mu  = m ?? mean(arr);
	const variance = arr.reduce((s, v) => s + (v - mu) ** 2, 0) / arr.length;
	return Math.sqrt(variance) || 1;
}

/** Compute z-score of each point in the last `window` entries of spread */
export function computeZScores(spread: number[], window = 20): SpreadPoint[] {
	const n   = spread.length;
	const out: SpreadPoint[] = [];

	for (let i = 0; i < n; i++) {
		const start = Math.max(0, i - window + 1);
		const slice = spread.slice(start, i + 1);
		const m     = mean(slice);
		const s     = stdDev(slice, m);
		out.push({ index: i, spread: spread[i], zScore: (spread[i] - m) / s });
	}

	return out;
}

// ─── Half-life (OU mean reversion) ───────────────────────────────────────────

/**
 * Estimate half-life of mean reversion via OLS on ΔS = λS_{t-1} + ε.
 * Returns half-life in periods (days if daily data).
 * Returns Infinity when λ ≥ 0 (no mean reversion).
 */
export function estimateHalfLife(spread: number[]): number {
	if (spread.length < 3) return Infinity;

	const dS  = spread.slice(1).map((s, i) => s - spread[i]);   // ΔS
	const lag = spread.slice(0, -1);                               // S_{t-1}

	const { slope: lambda } = olsRegress(lag, dS);
	if (lambda >= 0) return Infinity;

	return -Math.LN2 / lambda;
}

// ─── ADF approximation ────────────────────────────────────────────────────────

/**
 * Simplified ADF test: OLS t-statistic of λ in ΔS = λS_{t-1} + ε.
 * More negative = stronger evidence of stationarity (cointegration).
 * Approximate critical values: −2.89 (5%), −3.51 (1%).
 */
export function calcADFStat(spread: number[]): number {
	if (spread.length < 5) return 0;

	const dS  = spread.slice(1).map((s, i) => s - spread[i]);
	const lag = spread.slice(0, -1);
	const n   = dS.length;

	const { slope: lambda, intercept } = olsRegress(lag, dS);

	// Residuals
	const residuals = dS.map((d, i) => d - (lambda * lag[i] + intercept));
	const sse = residuals.reduce((s, r) => s + r * r, 0);
	if (sse === 0) return 0;
	const mse = sse / Math.max(1, n - 2);

	const lagMean = mean(lag);
	const sxx     = lag.reduce((s, x) => s + (x - lagMean) ** 2, 0);
	if (sxx === 0) return 0;

	const se = Math.sqrt(mse / sxx);
	return se === 0 ? 0 : lambda / se;
}

/** Map ADF t-stat to cointegration score 0–100. */
export function calcCointegrationScore(adfStat: number): number {
	// Critical range: -1.0 (not cointegrated) to -3.5 (strong cointegration)
	const clamped = Math.max(-3.5, Math.min(-1.0, adfStat));
	return Math.round((-clamped - 1.0) / (3.5 - 1.0) * 100);
}

/** Label for cointegration score */
export function cointegrationLabel(score: number): string {
	if (score >= 80) return 'Strong cointegration';
	if (score >= 60) return 'Moderate cointegration';
	if (score >= 40) return 'Weak cointegration';
	return 'Not cointegrated';
}

// ─── Signal ───────────────────────────────────────────────────────────────────

export function pairsSignal(zScore: number): PairsSnapshot['signal'] {
	if (zScore >  2) return 'short_spread'; // spread above mean → expect to revert down
	if (zScore < -2) return 'long_spread';  // spread below mean → expect to revert up
	return 'neutral';
}

// ─── Main analysis ────────────────────────────────────────────────────────────

/**
 * Compute full pairs analysis given two aligned price series.
 * `closesA` and `closesB` should be the same length (daily closes).
 */
export function buildPairsSnapshot(
	symbolA: string,
	symbolB: string,
	closesA: number[],
	closesB: number[],
	zWindow = 20,
	corrWindow = 30,
): PairsSnapshot {
	const n = Math.min(closesA.length, closesB.length);
	const a = closesA.slice(-n);
	const b = closesB.slice(-n);

	// ── OLS hedge ratio ───────────────────────────────────────────────────────
	const { slope: beta, intercept } = olsRegress(b, a); // regress A on B

	// ── Spread ────────────────────────────────────────────────────────────────
	const spread    = computeSpread(a, b, beta, intercept);
	const zPoints   = computeZScores(spread, zWindow);
	const last20    = zPoints.slice(-20);
	const lastPoint = zPoints[zPoints.length - 1];

	const spreadSlice = spread.slice(-zWindow);
	const spreadMean  = mean(spreadSlice);
	const spreadStd   = stdDev(spreadSlice, spreadMean);

	// ── 30-day return correlation ─────────────────────────────────────────────
	const retA = toReturns(a.slice(-corrWindow - 1));
	const retB = toReturns(b.slice(-corrWindow - 1));
	const minLen = Math.min(retA.length, retB.length);
	const correlation30d = pearsonCorrelation(retA.slice(-minLen), retB.slice(-minLen));

	// ── Half-life & ADF ───────────────────────────────────────────────────────
	const halfLife          = estimateHalfLife(spread);
	const adfStat           = calcADFStat(spread);
	const cointegrationScore = calcCointegrationScore(adfStat);

	// ── Signal ────────────────────────────────────────────────────────────────
	const currentZScore  = lastPoint?.zScore ?? 0;
	const currentSpread  = lastPoint?.spread ?? 0;
	const signal         = pairsSignal(currentZScore);

	return {
		symbolA,
		symbolB,
		beta,
		intercept,
		correlation30d,
		currentSpread,
		currentZScore,
		spreadMean,
		spreadStd,
		halfLife:           isFinite(halfLife) ? Math.round(halfLife * 10) / 10 : 9999,
		adfStat:            Math.round(adfStat * 100) / 100,
		cointegrationScore,
		signal,
		history:            last20,
	};
}
