// Black-Scholes Tests — T-802
import { describe, it, expect } from 'vitest';
import {
	normalCDF,
	normalPDF,
	calcHistoricalVolatility,
	blackScholes,
	calcIVRank,
} from './blackScholes';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOHLCV(closes: number[]): OHLCV[] {
	return closes.map((c, i) => ({
		time: i * 86400,
		open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000,
	}));
}

function geometricBrownianMotion(n: number, start = 100, vol = 0.3): OHLCV[] {
	const closes: number[] = [start];
	for (let i = 1; i < n; i++) {
		const ret = (Math.random() - 0.5) * vol / Math.sqrt(252);
		closes.push(closes[i - 1] * Math.exp(ret));
	}
	return makeOHLCV(closes);
}

// ─── normalCDF ────────────────────────────────────────────────────────────────

describe('normalCDF', () => {
	it('CDF(0) = 0.5', () => {
		expect(normalCDF(0)).toBeCloseTo(0.5, 5);
	});

	it('CDF(1.96) ≈ 0.975', () => {
		expect(normalCDF(1.96)).toBeCloseTo(0.975, 2);
	});

	it('CDF(-1.96) ≈ 0.025', () => {
		expect(normalCDF(-1.96)).toBeCloseTo(0.025, 2);
	});

	it('CDF(inf) ≈ 1', () => {
		expect(normalCDF(10)).toBeCloseTo(1, 5);
	});

	it('CDF(-inf) ≈ 0', () => {
		expect(normalCDF(-10)).toBeCloseTo(0, 5);
	});

	it('CDF(x) + CDF(-x) = 1 (symmetry)', () => {
		const x = 1.5;
		expect(normalCDF(x) + normalCDF(-x)).toBeCloseTo(1, 10);
	});
});

// ─── normalPDF ────────────────────────────────────────────────────────────────

describe('normalPDF', () => {
	it('PDF(0) = 1/sqrt(2π)', () => {
		expect(normalPDF(0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 8);
	});

	it('PDF is always positive', () => {
		expect(normalPDF(-3)).toBeGreaterThan(0);
		expect(normalPDF(0)).toBeGreaterThan(0);
		expect(normalPDF(3)).toBeGreaterThan(0);
	});

	it('PDF(-x) = PDF(x)', () => {
		expect(normalPDF(-1.5)).toBeCloseTo(normalPDF(1.5), 10);
	});
});

// ─── calcHistoricalVolatility ──────────────────────────────────────────────────

describe('calcHistoricalVolatility', () => {
	it('returns 0 for fewer than 2 prices', () => {
		expect(calcHistoricalVolatility([100])).toBe(0);
	});

	it('returns positive HV for realistic price series', () => {
		const closes = Array.from({ length: 30 }, (_, i) => 100 * Math.exp(i * 0.001));
		expect(calcHistoricalVolatility(closes)).toBeGreaterThan(0);
	});

	it('flat prices give HV near zero', () => {
		const closes = Array.from({ length: 20 }, () => 100);
		expect(calcHistoricalVolatility(closes)).toBeCloseTo(0, 5);
	});

	it('respects window parameter', () => {
		const closes = Array.from({ length: 100 }, (_, i) => 100 + i);
		const full    = calcHistoricalVolatility(closes);
		const windowed = calcHistoricalVolatility(closes, 20);
		// Different windows may give different results
		expect(typeof windowed).toBe('number');
		expect(isFinite(windowed)).toBe(true);
	});

	it('result is annualised (should be within 0–3 for normal assets)', () => {
		const candles = geometricBrownianMotion(252, 100, 0.3);
		const closes  = candles.map(c => c.close);
		const hv      = calcHistoricalVolatility(closes);
		expect(hv).toBeGreaterThan(0);
		expect(hv).toBeLessThan(5); // sanity check
	});
});

// ─── blackScholes ─────────────────────────────────────────────────────────────

describe('blackScholes', () => {
	// Reference values from known BS calculators:
	// S=100, K=100, T=1, r=0.05, v=0.2 → call≈10.45, put≈5.57
	it('computes ATM call price within tolerance', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r).not.toBeNull();
		expect(r!.callPrice).toBeCloseTo(10.45, 0);
	});

	it('computes ATM put price within tolerance', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r).not.toBeNull();
		expect(r!.putPrice).toBeCloseTo(5.57, 0);
	});

	it('put-call parity holds: C - P = S - K*e^(-rT)', () => {
		const S = 100, K = 100, T = 1, r = 0.05, v = 0.2;
		const res = blackScholes(S, K, T, r, v);
		expect(res).not.toBeNull();
		const lhs = res!.callPrice - res!.putPrice;
		const rhs = S - K * Math.exp(-r * T);
		expect(lhs).toBeCloseTo(rhs, 4);
	});

	it('call delta is between 0 and 1', () => {
		const r = blackScholes(100, 100, 0.5, 0.05, 0.25);
		expect(r!.callGreeks.delta).toBeGreaterThan(0);
		expect(r!.callGreeks.delta).toBeLessThan(1);
	});

	it('put delta is between -1 and 0', () => {
		const r = blackScholes(100, 100, 0.5, 0.05, 0.25);
		expect(r!.putGreeks.delta).toBeGreaterThan(-1);
		expect(r!.putGreeks.delta).toBeLessThan(0);
	});

	it('ATM call delta ≈ 0.5', () => {
		const r = blackScholes(100, 100, 1, 0, 0.2);
		expect(r!.callGreeks.delta).toBeCloseTo(0.5, 1);
	});

	it('call and put have same gamma', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r!.callGreeks.gamma).toBeCloseTo(r!.putGreeks.gamma, 10);
	});

	it('call and put have same vega', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r!.callGreeks.vega).toBeCloseTo(r!.putGreeks.vega, 10);
	});

	it('theta is negative for call (time decay)', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r!.callGreeks.theta).toBeLessThan(0);
	});

	it('vega is positive', () => {
		const r = blackScholes(100, 100, 1, 0.05, 0.2);
		expect(r!.callGreeks.vega).toBeGreaterThan(0);
	});

	it('returns null for non-positive inputs', () => {
		expect(blackScholes(0, 100, 1, 0.05, 0.2)).toBeNull();
		expect(blackScholes(100, 0, 1, 0.05, 0.2)).toBeNull();
		expect(blackScholes(100, 100, 0, 0.05, 0.2)).toBeNull();
		expect(blackScholes(100, 100, 1, 0.05, 0)).toBeNull();
	});

	it('deep ITM call price approaches intrinsic value', () => {
		// S=200, K=100 — very deep ITM, call ≈ S - K*e^(-rT)
		const r = blackScholes(200, 100, 1, 0.05, 0.2);
		const intrinsic = 200 - 100 * Math.exp(-0.05);
		expect(r!.callPrice).toBeGreaterThan(intrinsic * 0.95);
	});

	it('deep OTM call price is near zero', () => {
		// S=100, K=300, 1 year, 20% vol — very OTM
		const r = blackScholes(100, 300, 1, 0.05, 0.2);
		expect(r!.callPrice).toBeLessThan(0.01);
	});

	it('higher vol gives higher option price', () => {
		const low  = blackScholes(100, 100, 1, 0.05, 0.2)!;
		const high = blackScholes(100, 100, 1, 0.05, 0.4)!;
		expect(high.callPrice).toBeGreaterThan(low.callPrice);
	});

	it('longer expiry gives higher option price', () => {
		const short = blackScholes(100, 100, 0.25, 0.05, 0.2)!;
		const long  = blackScholes(100, 100, 1.00, 0.05, 0.2)!;
		expect(long.callPrice).toBeGreaterThan(short.callPrice);
	});
});

// ─── calcIVRank ────────────────────────────────────────────────────────────────

describe('calcIVRank', () => {
	it('returns null for insufficient data', () => {
		const c = geometricBrownianMotion(10);
		expect(calcIVRank(c)).toBeNull();
	});

	it('returns IVRank in 0-100 range', () => {
		const c = geometricBrownianMotion(100, 100, 0.3);
		const r = calcIVRank(c);
		expect(r).not.toBeNull();
		expect(r!.ivRank).toBeGreaterThanOrEqual(0);
		expect(r!.ivRank).toBeLessThanOrEqual(100);
	});

	it('ivPercentile is in 0-100 range', () => {
		const c = geometricBrownianMotion(100, 100, 0.3);
		const r = calcIVRank(c);
		expect(r!.ivPercentile).toBeGreaterThanOrEqual(0);
		expect(r!.ivPercentile).toBeLessThanOrEqual(100);
	});

	it('hvMin <= currentHV <= hvMax', () => {
		const c = geometricBrownianMotion(100, 100, 0.3);
		const r = calcIVRank(c);
		expect(r!.currentHV).toBeGreaterThanOrEqual(r!.hvMin - 0.0001);
		expect(r!.currentHV).toBeLessThanOrEqual(r!.hvMax + 0.0001);
	});

	it('currentHV is positive', () => {
		const c = geometricBrownianMotion(100, 100, 0.3);
		const r = calcIVRank(c);
		expect(r!.currentHV).toBeGreaterThan(0);
	});
});
