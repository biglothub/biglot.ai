// Anomaly Detector Data — T-1202
// Pure functions: detect statistical anomalies in OHLCV + liquidation data

import type { OHLCV } from '$lib/types/contentBlock';
import { atr } from '../indicators/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnomalyType =
	| 'volume_spike'
	| 'price_gap'
	| 'volatility_expansion'
	| 'liquidation_cascade'
	| 'correlation_break';

export type Anomaly = {
	symbol: string;
	type: AnomalyType;
	severity: number;      // 1–10
	description: string;
	currentValue: string;
	threshold: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two equal-length arrays.
 */
export function pearsonCorr(x: number[], y: number[]): number {
	const n = Math.min(x.length, y.length);
	if (n < 5) return 0;
	let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
	for (let i = 0; i < n; i++) {
		sx += x[i]; sy += y[i];
		sxy += x[i] * y[i];
		sx2 += x[i] * x[i];
		sy2 += y[i] * y[i];
	}
	const num = n * sxy - sx * sy;
	const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
	return den === 0 ? 0 : num / den;
}

/**
 * Compute daily log returns from an OHLCV array.
 */
function dailyReturns(ohlcv: OHLCV[]): number[] {
	const returns: number[] = [];
	for (let i = 1; i < ohlcv.length; i++) {
		const prev = ohlcv[i - 1].close;
		if (prev > 0) returns.push((ohlcv[i].close - prev) / prev);
	}
	return returns;
}

// ─── Detectors ────────────────────────────────────────────────────────────────

/**
 * Volume spike: current bar volume > 3x 20-day average.
 * Requires at least 22 candles.
 */
export function detectVolumeSpike(symbol: string, ohlcv: OHLCV[]): Anomaly | null {
	if (ohlcv.length < 22) return null;

	const current = ohlcv[ohlcv.length - 1];
	const prior21 = ohlcv.slice(-22, -1);
	const avgVol = prior21.reduce((s, c) => s + c.volume, 0) / prior21.length;
	if (avgVol <= 0) return null;

	const ratio = current.volume / avgVol;
	if (ratio < 3) return null;

	// Severity: 3x → 6, 5x → 10 (capped)
	const severity = Math.min(10, Math.round(ratio * 2));

	return {
		symbol,
		type: 'volume_spike',
		severity,
		description: `Volume ${ratio.toFixed(1)}x above 20-day average`,
		currentValue: `${ratio.toFixed(1)}x avg`,
		threshold: '>3x avg',
	};
}

/**
 * Price gap: |open - prevClose| > 2 ATR(14).
 * Requires at least 20 candles.
 */
export function detectPriceGap(symbol: string, ohlcv: OHLCV[]): Anomaly | null {
	if (ohlcv.length < 20) return null;

	const current = ohlcv[ohlcv.length - 1];
	const prev = ohlcv[ohlcv.length - 2];
	const gap = Math.abs(current.open - prev.close);

	const atrPts = atr(ohlcv, 14);
	if (atrPts.length === 0) return null;

	const atrVal = atrPts[atrPts.length - 1].value;
	if (atrVal <= 0) return null;

	const gapATRs = gap / atrVal;
	if (gapATRs < 2) return null;

	const dir = current.open > prev.close ? 'up' : 'down';
	const gapPct = prev.close > 0 ? ((gap / prev.close) * 100).toFixed(2) : '?';

	// Severity: 2 ATR → 5, 4 ATR → 10
	const severity = Math.min(10, Math.round(gapATRs * 2.5));

	return {
		symbol,
		type: 'price_gap',
		severity,
		description: `Gap ${dir} of ${gapATRs.toFixed(1)} ATR (${gapPct}%)`,
		currentValue: `${gapATRs.toFixed(1)} ATR`,
		threshold: '>2 ATR',
	};
}

/**
 * Volatility expansion: current ATR(14) > 1.5x 20-bar average ATR.
 * Requires at least 35 candles (14 for ATR + 21 prior ATR values for SMA).
 */
export function detectVolatilityExpansion(symbol: string, ohlcv: OHLCV[]): Anomaly | null {
	if (ohlcv.length < 35) return null;

	const atrPts = atr(ohlcv, 14);
	// Need at least 21 points: 1 current + 20 for average
	if (atrPts.length < 21) return null;

	const currentATR = atrPts[atrPts.length - 1].value;
	const prior20 = atrPts.slice(-21, -1).map((p) => p.value);
	const avgATR = prior20.reduce((s, v) => s + v, 0) / prior20.length;

	if (avgATR <= 0) return null;

	const ratio = currentATR / avgATR;
	if (ratio < 1.5) return null;

	// Severity: 1.5x → 5, 2x → 10
	const severity = Math.min(10, Math.round((ratio - 1) * 10));

	return {
		symbol,
		type: 'volatility_expansion',
		severity,
		description: `ATR ${ratio.toFixed(2)}x above 20-bar average`,
		currentValue: `${ratio.toFixed(2)}x avg ATR`,
		threshold: '>1.5x avg',
	};
}

/**
 * Liquidation cascade: total liquidations (long + short) exceeds $5M.
 */
export function detectLiquidationCascade(
	symbol: string,
	longLiqUSD: number,
	shortLiqUSD: number,
): Anomaly | null {
	const totalLiq = longLiqUSD + shortLiqUSD;
	const THRESHOLD_USD = 5_000_000;
	if (totalLiq < THRESHOLD_USD) return null;

	const dominant = longLiqUSD > shortLiqUSD ? 'long' : 'short';
	const domLiq = Math.max(longLiqUSD, shortLiqUSD);

	const fmt = (v: number) =>
		v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B`
		: v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M`
		: `$${(v / 1e3).toFixed(0)}K`;

	// Severity: $5M → 3, $20M → 5, $100M → 8, $500M → 10
	const severity = Math.min(10, Math.max(1, Math.round(Math.log10(totalLiq / 1_000_000) * 3.5)));

	return {
		symbol,
		type: 'liquidation_cascade',
		severity,
		description: `${fmt(totalLiq)} liquidated (${dominant} dominant: ${fmt(domLiq)})`,
		currentValue: fmt(totalLiq),
		threshold: '>$5M',
	};
}

/**
 * Correlation break: asset's 7-day return correlation vs BTC
 * drops by >0.5 from the 30-day baseline.
 * Only fires if 30-day baseline correlation was ≥0.5 (i.e., asset was correlated).
 * Skipped for BTC itself.
 */
export function detectCorrelationBreak(
	symbol: string,
	symbolOhlcv: OHLCV[],
	btcOhlcv: OHLCV[],
): Anomaly | null {
	// Skip BTC vs BTC
	if (symbol.toUpperCase().startsWith('BTC')) return null;
	if (symbolOhlcv.length < 32 || btcOhlcv.length < 32) return null;

	const symRets = dailyReturns(symbolOhlcv.slice(-31));
	const btcRets = dailyReturns(btcOhlcv.slice(-31));

	const n = Math.min(symRets.length, btcRets.length);
	if (n < 14) return null;

	const corr30d = pearsonCorr(symRets.slice(-n), btcRets.slice(-n));
	const corr7d = pearsonCorr(
		symRets.slice(-Math.min(7, n)),
		btcRets.slice(-Math.min(7, n)),
	);

	const corrShift = Math.abs(corr30d - corr7d);

	// Only flag if was correlated and now diverging significantly
	if (corr30d < 0.5 || corrShift < 0.5) return null;

	// Severity: shift 0.5 → 4, shift 0.8 → 6, shift 1.0 → 8
	const severity = Math.min(10, Math.max(1, Math.round(corrShift * 8)));

	return {
		symbol,
		type: 'correlation_break',
		severity,
		description: `BTC correlation broke: 30d=${corr30d.toFixed(2)} → 7d=${corr7d.toFixed(2)} (Δ${corrShift.toFixed(2)})`,
		currentValue: `7d corr: ${corr7d.toFixed(2)}`,
		threshold: `30d corr: ${corr30d.toFixed(2)}`,
	};
}
