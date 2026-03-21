// Technical Indicator Engine
// Pure functions: OHLCV[] → IndicatorDataPoint[] (or multi-series variants)

import type { OHLCV, IndicatorDataPoint } from '$lib/types/contentBlock';

export type { OHLCV, IndicatorDataPoint };

// ─── Multi-series result types ────────────────────────────────────────────────

export interface MACDResult {
	macd: IndicatorDataPoint[];
	signal: IndicatorDataPoint[];
	histogram: IndicatorDataPoint[];
}

export interface BollingerResult {
	upper: IndicatorDataPoint[];
	middle: IndicatorDataPoint[];
	lower: IndicatorDataPoint[];
}

export interface StochasticResult {
	k: IndicatorDataPoint[];
	d: IndicatorDataPoint[];
}

export interface ADXResult {
	adx: IndicatorDataPoint[];
	plusDI: IndicatorDataPoint[];
	minusDI: IndicatorDataPoint[];
}

export interface IchimokuResult {
	tenkan: IndicatorDataPoint[];
	kijun: IndicatorDataPoint[];
	senkouA: IndicatorDataPoint[];
	senkouB: IndicatorDataPoint[];
	chikou: IndicatorDataPoint[];
}

export interface DonchianResult {
	upper: IndicatorDataPoint[];
	middle: IndicatorDataPoint[];
	lower: IndicatorDataPoint[];
}

export interface KeltnerResult {
	upper: IndicatorDataPoint[];
	middle: IndicatorDataPoint[];
	lower: IndicatorDataPoint[];
}

export interface SuperTrendResult {
	supertrend: IndicatorDataPoint[];
	direction: IndicatorDataPoint[]; // 1 = bullish, -1 = bearish
}

export interface PivotPointResult {
	pivot: IndicatorDataPoint[];
	r1: IndicatorDataPoint[];
	r2: IndicatorDataPoint[];
	r3: IndicatorDataPoint[];
	s1: IndicatorDataPoint[];
	s2: IndicatorDataPoint[];
	s3: IndicatorDataPoint[];
}

export interface FibonacciLevel {
	level: number;
	price: number;
	label: string;
}

export interface FibonacciResult {
	high: number;
	low: number;
	levels: FibonacciLevel[];
	isUptrend: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDP(time: number, value: number): IndicatorDataPoint {
	return { time, value };
}

// ─── 1. SMA ───────────────────────────────────────────────────────────────────

export function sma(ohlcv: OHLCV[], period: number): IndicatorDataPoint[] {
	if (ohlcv.length === 0 || period <= 0) return [];
	const result: IndicatorDataPoint[] = [];
	for (let i = 0; i < ohlcv.length; i++) {
		if (i < period - 1) continue;
		let sum = 0;
		for (let j = i - period + 1; j <= i; j++) sum += ohlcv[j].close;
		result.push(toDP(ohlcv[i].time, sum / period));
	}
	return result;
}

// ─── 2. EMA ───────────────────────────────────────────────────────────────────

export function ema(ohlcv: OHLCV[], period: number): IndicatorDataPoint[] {
	if (ohlcv.length === 0 || period <= 0) return [];
	const multiplier = 2 / (period + 1);
	const result: IndicatorDataPoint[] = [];
	let prev: number | null = null;

	for (let i = 0; i < ohlcv.length; i++) {
		if (i < period - 1) continue;
		if (i === period - 1) {
			let sum = 0;
			for (let j = 0; j < period; j++) sum += ohlcv[j].close;
			prev = sum / period;
			result.push(toDP(ohlcv[i].time, prev));
		} else {
			prev = (ohlcv[i].close - prev!) * multiplier + prev!;
			result.push(toDP(ohlcv[i].time, prev));
		}
	}
	return result;
}

// ─── EMA on raw number array (internal helper) ────────────────────────────────

function emaRaw(values: number[], period: number): number[] {
	if (values.length === 0 || period <= 0) return [];
	const multiplier = 2 / (period + 1);
	const result: number[] = new Array(values.length).fill(NaN);

	if (values.length < period) return result;

	let sum = 0;
	for (let i = 0; i < period; i++) sum += values[i];
	result[period - 1] = sum / period;

	for (let i = period; i < values.length; i++) {
		result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
	}
	return result;
}

// ─── 3. RSI ───────────────────────────────────────────────────────────────────

export function rsi(ohlcv: OHLCV[], period = 14): IndicatorDataPoint[] {
	if (ohlcv.length < period + 1) return [];
	const closes = ohlcv.map((c) => c.close);
	const result: IndicatorDataPoint[] = [];

	let avgGain = 0;
	let avgLoss = 0;

	for (let i = 1; i <= period; i++) {
		const diff = closes[i] - closes[i - 1];
		if (diff > 0) avgGain += diff;
		else avgLoss += Math.abs(diff);
	}
	avgGain /= period;
	avgLoss /= period;

	const firstRSI = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
	result.push(toDP(ohlcv[period].time, firstRSI));

	for (let i = period + 1; i < closes.length; i++) {
		const diff = closes[i] - closes[i - 1];
		const gain = diff > 0 ? diff : 0;
		const loss = diff < 0 ? Math.abs(diff) : 0;
		avgGain = (avgGain * (period - 1) + gain) / period;
		avgLoss = (avgLoss * (period - 1) + loss) / period;
		const rsiVal = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
		result.push(toDP(ohlcv[i].time, rsiVal));
	}

	return result;
}

// ─── 4. MACD ──────────────────────────────────────────────────────────────────

export function macd(
	ohlcv: OHLCV[],
	fastPeriod = 12,
	slowPeriod = 26,
	signalPeriod = 9
): MACDResult {
	if (ohlcv.length === 0) return { macd: [], signal: [], histogram: [] };

	const closes = ohlcv.map((c) => c.close);
	const emaFast = emaRaw(closes, fastPeriod);
	const emaSlow = emaRaw(closes, slowPeriod);

	const macdLine: number[] = closes.map((_, i) => {
		if (isNaN(emaFast[i]) || isNaN(emaSlow[i])) return NaN;
		return emaFast[i] - emaSlow[i];
	});

	// Compute signal EMA on valid MACD values only
	const validIndices: number[] = [];
	const validMacd: number[] = [];
	for (let i = 0; i < macdLine.length; i++) {
		if (!isNaN(macdLine[i])) {
			validIndices.push(i);
			validMacd.push(macdLine[i]);
		}
	}

	const signalRaw = emaRaw(validMacd, signalPeriod);
	const signalLine: number[] = new Array(ohlcv.length).fill(NaN);
	for (let k = 0; k < validIndices.length; k++) {
		signalLine[validIndices[k]] = signalRaw[k];
	}

	const macdDPs: IndicatorDataPoint[] = [];
	const signalDPs: IndicatorDataPoint[] = [];
	const histDPs: IndicatorDataPoint[] = [];

	for (let i = 0; i < ohlcv.length; i++) {
		if (!isNaN(macdLine[i])) macdDPs.push(toDP(ohlcv[i].time, macdLine[i]));
		if (!isNaN(signalLine[i])) signalDPs.push(toDP(ohlcv[i].time, signalLine[i]));
		if (!isNaN(macdLine[i]) && !isNaN(signalLine[i])) {
			histDPs.push(toDP(ohlcv[i].time, macdLine[i] - signalLine[i]));
		}
	}

	return { macd: macdDPs, signal: signalDPs, histogram: histDPs };
}

// ─── 5. Bollinger Bands ───────────────────────────────────────────────────────

export function bollingerBands(
	ohlcv: OHLCV[],
	period = 20,
	stdDevMultiplier = 2
): BollingerResult {
	if (ohlcv.length === 0) return { upper: [], middle: [], lower: [] };

	const upper: IndicatorDataPoint[] = [];
	const middle: IndicatorDataPoint[] = [];
	const lower: IndicatorDataPoint[] = [];

	for (let i = period - 1; i < ohlcv.length; i++) {
		let sum = 0;
		for (let j = i - period + 1; j <= i; j++) sum += ohlcv[j].close;
		const avg = sum / period;

		let sumSq = 0;
		for (let j = i - period + 1; j <= i; j++) {
			sumSq += (ohlcv[j].close - avg) ** 2;
		}
		const std = Math.sqrt(sumSq / period);
		const t = ohlcv[i].time;

		upper.push(toDP(t, avg + stdDevMultiplier * std));
		middle.push(toDP(t, avg));
		lower.push(toDP(t, avg - stdDevMultiplier * std));
	}

	return { upper, middle, lower };
}

// ─── 6. ATR ───────────────────────────────────────────────────────────────────

export function atr(ohlcv: OHLCV[], period = 14): IndicatorDataPoint[] {
	if (ohlcv.length < 2) return [];

	const trValues: number[] = [];
	for (let i = 1; i < ohlcv.length; i++) {
		const { high, low, close: prevClose } = { ...ohlcv[i], close: ohlcv[i - 1].close };
		const tr = Math.max(
			ohlcv[i].high - ohlcv[i].low,
			Math.abs(ohlcv[i].high - prevClose),
			Math.abs(ohlcv[i].low - prevClose)
		);
		trValues.push(tr);
	}

	if (trValues.length < period) return [];

	const result: IndicatorDataPoint[] = [];
	let atrVal = trValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
	result.push(toDP(ohlcv[period].time, atrVal));

	for (let i = period; i < trValues.length; i++) {
		atrVal = (atrVal * (period - 1) + trValues[i]) / period;
		result.push(toDP(ohlcv[i + 1].time, atrVal));
	}

	return result;
}

// ─── 7. Stochastic Oscillator ─────────────────────────────────────────────────

export function stochastic(ohlcv: OHLCV[], kPeriod = 14, dPeriod = 3): StochasticResult {
	if (ohlcv.length < kPeriod) return { k: [], d: [] };

	const kValues: number[] = [];
	const kTimes: number[] = [];

	for (let i = kPeriod - 1; i < ohlcv.length; i++) {
		let highest = -Infinity;
		let lowest = Infinity;
		for (let j = i - kPeriod + 1; j <= i; j++) {
			highest = Math.max(highest, ohlcv[j].high);
			lowest = Math.min(lowest, ohlcv[j].low);
		}
		const k = highest === lowest ? 100 : ((ohlcv[i].close - lowest) / (highest - lowest)) * 100;
		kValues.push(k);
		kTimes.push(ohlcv[i].time);
	}

	const dRaw = emaRaw(kValues, dPeriod);

	const k: IndicatorDataPoint[] = kValues.map((v, i) => toDP(kTimes[i], v));
	const d: IndicatorDataPoint[] = dRaw
		.map((v, i) => (isNaN(v) ? null : toDP(kTimes[i], v)))
		.filter((v): v is IndicatorDataPoint => v !== null);

	return { k, d };
}

// ─── 8. ADX ───────────────────────────────────────────────────────────────────

export function adx(ohlcv: OHLCV[], period = 14): ADXResult {
	if (ohlcv.length < period + 1) return { adx: [], plusDI: [], minusDI: [] };

	const trValues: number[] = [];
	const plusDMValues: number[] = [];
	const minusDMValues: number[] = [];

	for (let i = 1; i < ohlcv.length; i++) {
		const tr = Math.max(
			ohlcv[i].high - ohlcv[i].low,
			Math.abs(ohlcv[i].high - ohlcv[i - 1].close),
			Math.abs(ohlcv[i].low - ohlcv[i - 1].close)
		);
		trValues.push(tr);

		const upMove = ohlcv[i].high - ohlcv[i - 1].high;
		const downMove = ohlcv[i - 1].low - ohlcv[i].low;
		plusDMValues.push(upMove > downMove && upMove > 0 ? upMove : 0);
		minusDMValues.push(downMove > upMove && downMove > 0 ? downMove : 0);
	}

	// Wilder smoothing
	let smoothTR = trValues.slice(0, period).reduce((a, b) => a + b, 0);
	let smoothPlusDM = plusDMValues.slice(0, period).reduce((a, b) => a + b, 0);
	let smoothMinusDM = minusDMValues.slice(0, period).reduce((a, b) => a + b, 0);

	const adxArr: IndicatorDataPoint[] = [];
	const plusDIArr: IndicatorDataPoint[] = [];
	const minusDIArr: IndicatorDataPoint[] = [];
	const dxValues: number[] = [];

	for (let i = period; i < ohlcv.length; i++) {
		const idx = i - 1; // index in TR/DM arrays
		if (i > period) {
			smoothTR = smoothTR - smoothTR / period + trValues[idx];
			smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDMValues[idx];
			smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDMValues[idx];
		}

		const plusDI = smoothTR === 0 ? 0 : (100 * smoothPlusDM) / smoothTR;
		const minusDI = smoothTR === 0 ? 0 : (100 * smoothMinusDM) / smoothTR;
		const dx = plusDI + minusDI === 0 ? 0 : (100 * Math.abs(plusDI - minusDI)) / (plusDI + minusDI);

		dxValues.push(dx);
		plusDIArr.push(toDP(ohlcv[i].time, plusDI));
		minusDIArr.push(toDP(ohlcv[i].time, minusDI));
	}

	// ADX = EMA of DX with Wilder smoothing (same as period-simple average then smooth)
	if (dxValues.length < period) return { adx: [], plusDI: plusDIArr, minusDI: minusDIArr };

	let adxVal = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
	const startOffset = period; // index in ohlcv array
	adxArr.push(toDP(ohlcv[startOffset + period - 1].time, adxVal));

	for (let i = period; i < dxValues.length; i++) {
		adxVal = (adxVal * (period - 1) + dxValues[i]) / period;
		adxArr.push(toDP(ohlcv[startOffset + i].time, adxVal));
	}

	return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
}

// ─── 9. OBV ───────────────────────────────────────────────────────────────────

export function obv(ohlcv: OHLCV[]): IndicatorDataPoint[] {
	if (ohlcv.length === 0) return [];
	const result: IndicatorDataPoint[] = [];
	let obvVal = 0;

	for (let i = 0; i < ohlcv.length; i++) {
		if (i === 0) {
			obvVal = ohlcv[0].volume;
		} else {
			if (ohlcv[i].close > ohlcv[i - 1].close) obvVal += ohlcv[i].volume;
			else if (ohlcv[i].close < ohlcv[i - 1].close) obvVal -= ohlcv[i].volume;
			// equal close: no change
		}
		result.push(toDP(ohlcv[i].time, obvVal));
	}
	return result;
}

// ─── 10. VWAP ─────────────────────────────────────────────────────────────────

export function vwap(ohlcv: OHLCV[]): IndicatorDataPoint[] {
	if (ohlcv.length === 0) return [];
	const result: IndicatorDataPoint[] = [];
	let cumulativeTPV = 0;
	let cumulativeVolume = 0;

	for (const bar of ohlcv) {
		const typicalPrice = (bar.high + bar.low + bar.close) / 3;
		cumulativeTPV += typicalPrice * bar.volume;
		cumulativeVolume += bar.volume;
		const vwapVal = cumulativeVolume === 0 ? typicalPrice : cumulativeTPV / cumulativeVolume;
		result.push(toDP(bar.time, vwapVal));
	}
	return result;
}

// ─── 11. Ichimoku Cloud ───────────────────────────────────────────────────────

export function ichimoku(
	ohlcv: OHLCV[],
	tenkanPeriod = 9,
	kijunPeriod = 26,
	senkouBPeriod = 52,
	displacement = 26
): IchimokuResult {
	if (ohlcv.length === 0) return { tenkan: [], kijun: [], senkouA: [], senkouB: [], chikou: [] };

	function midpoint(bars: OHLCV[], from: number, len: number): number {
		let high = -Infinity;
		let low = Infinity;
		for (let i = from; i < from + len; i++) {
			high = Math.max(high, bars[i].high);
			low = Math.min(low, bars[i].low);
		}
		return (high + low) / 2;
	}

	const tenkan: IndicatorDataPoint[] = [];
	const kijun: IndicatorDataPoint[] = [];
	const senkouA: IndicatorDataPoint[] = [];
	const senkouB: IndicatorDataPoint[] = [];
	const chikou: IndicatorDataPoint[] = [];

	for (let i = 0; i < ohlcv.length; i++) {
		if (i >= tenkanPeriod - 1) {
			tenkan.push(toDP(ohlcv[i].time, midpoint(ohlcv, i - tenkanPeriod + 1, tenkanPeriod)));
		}
		if (i >= kijunPeriod - 1) {
			kijun.push(toDP(ohlcv[i].time, midpoint(ohlcv, i - kijunPeriod + 1, kijunPeriod)));
		}
		// Senkou A = avg of tenkan + kijun, plotted displacement candles ahead
		if (i >= kijunPeriod - 1) {
			const t = tenkan[tenkan.length - 1]?.value ?? 0;
			const k = kijun[kijun.length - 1]?.value ?? 0;
			const futureIdx = i + displacement;
			const futureTime =
				futureIdx < ohlcv.length
					? ohlcv[futureIdx].time
					: ohlcv[ohlcv.length - 1].time + (futureIdx - ohlcv.length + 1) * (ohlcv[1]?.time - ohlcv[0]?.time || 86400);
			senkouA.push(toDP(futureTime, (t + k) / 2));
		}
		// Senkou B = midpoint of senkouBPeriod, plotted displacement candles ahead
		if (i >= senkouBPeriod - 1) {
			const mid = midpoint(ohlcv, i - senkouBPeriod + 1, senkouBPeriod);
			const futureIdx = i + displacement;
			const futureTime =
				futureIdx < ohlcv.length
					? ohlcv[futureIdx].time
					: ohlcv[ohlcv.length - 1].time + (futureIdx - ohlcv.length + 1) * (ohlcv[1]?.time - ohlcv[0]?.time || 86400);
			senkouB.push(toDP(futureTime, mid));
		}
		// Chikou = close plotted displacement candles back
		const backIdx = i - displacement;
		if (backIdx >= 0) {
			chikou.push(toDP(ohlcv[backIdx].time, ohlcv[i].close));
		}
	}

	return { tenkan, kijun, senkouA, senkouB, chikou };
}

// ─── 12. Fibonacci Retracement ────────────────────────────────────────────────

export function fibonacci(ohlcv: OHLCV[], lookback = 100): FibonacciResult {
	const slice = ohlcv.slice(-lookback);
	if (slice.length === 0) return { high: 0, low: 0, levels: [], isUptrend: true };

	let high = -Infinity;
	let low = Infinity;
	let highIdx = 0;
	let lowIdx = 0;

	for (let i = 0; i < slice.length; i++) {
		if (slice[i].high > high) { high = slice[i].high; highIdx = i; }
		if (slice[i].low < low) { low = slice[i].low; lowIdx = i; }
	}

	const isUptrend = highIdx > lowIdx;
	const range = high - low;

	const fibRatios = [
		{ ratio: 0, label: '0%' },
		{ ratio: 0.236, label: '23.6%' },
		{ ratio: 0.382, label: '38.2%' },
		{ ratio: 0.5, label: '50%' },
		{ ratio: 0.618, label: '61.8%' },
		{ ratio: 0.786, label: '78.6%' },
		{ ratio: 1, label: '100%' }
	];

	const levels: FibonacciLevel[] = fibRatios.map(({ ratio, label }) => ({
		level: ratio,
		price: isUptrend ? high - range * ratio : low + range * ratio,
		label
	}));

	return { high, low, levels, isUptrend };
}

// ─── 13. Pivot Points ─────────────────────────────────────────────────────────

export function pivotPoints(ohlcv: OHLCV[]): PivotPointResult {
	if (ohlcv.length < 2) {
		return { pivot: [], r1: [], r2: [], r3: [], s1: [], s2: [], s3: [] };
	}

	const result: PivotPointResult = { pivot: [], r1: [], r2: [], r3: [], s1: [], s2: [], s3: [] };

	// Use each bar's data to compute next-bar pivot points
	for (let i = 0; i < ohlcv.length - 1; i++) {
		const { high, low, close } = ohlcv[i];
		const t = ohlcv[i + 1].time;
		const p = (high + low + close) / 3;
		result.pivot.push(toDP(t, p));
		result.r1.push(toDP(t, 2 * p - low));
		result.r2.push(toDP(t, p + (high - low)));
		result.r3.push(toDP(t, high + 2 * (p - low)));
		result.s1.push(toDP(t, 2 * p - high));
		result.s2.push(toDP(t, p - (high - low)));
		result.s3.push(toDP(t, low - 2 * (high - p)));
	}

	return result;
}

// ─── 14. Williams %R ──────────────────────────────────────────────────────────

export function williamsR(ohlcv: OHLCV[], period = 14): IndicatorDataPoint[] {
	if (ohlcv.length < period) return [];
	const result: IndicatorDataPoint[] = [];

	for (let i = period - 1; i < ohlcv.length; i++) {
		let highest = -Infinity;
		let lowest = Infinity;
		for (let j = i - period + 1; j <= i; j++) {
			highest = Math.max(highest, ohlcv[j].high);
			lowest = Math.min(lowest, ohlcv[j].low);
		}
		const wr = highest === lowest ? -100 : ((highest - ohlcv[i].close) / (highest - lowest)) * -100;
		result.push(toDP(ohlcv[i].time, wr));
	}
	return result;
}

// ─── 15. CCI ──────────────────────────────────────────────────────────────────

export function cci(ohlcv: OHLCV[], period = 20): IndicatorDataPoint[] {
	if (ohlcv.length < period) return [];
	const result: IndicatorDataPoint[] = [];

	for (let i = period - 1; i < ohlcv.length; i++) {
		const typicalPrices: number[] = [];
		for (let j = i - period + 1; j <= i; j++) {
			typicalPrices.push((ohlcv[j].high + ohlcv[j].low + ohlcv[j].close) / 3);
		}
		const mean = typicalPrices.reduce((a, b) => a + b, 0) / period;
		const meanDeviation = typicalPrices.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
		const cciVal = meanDeviation === 0 ? 0 : (typicalPrices[period - 1] - mean) / (0.015 * meanDeviation);
		result.push(toDP(ohlcv[i].time, cciVal));
	}
	return result;
}

// ─── 16. MFI ──────────────────────────────────────────────────────────────────

export function mfi(ohlcv: OHLCV[], period = 14): IndicatorDataPoint[] {
	if (ohlcv.length < period + 1) return [];
	const result: IndicatorDataPoint[] = [];

	for (let i = period; i < ohlcv.length; i++) {
		let posFlow = 0;
		let negFlow = 0;

		for (let j = i - period + 1; j <= i; j++) {
			const typicalCur = (ohlcv[j].high + ohlcv[j].low + ohlcv[j].close) / 3;
			const typicalPrev = (ohlcv[j - 1].high + ohlcv[j - 1].low + ohlcv[j - 1].close) / 3;
			const rawFlow = typicalCur * ohlcv[j].volume;
			if (typicalCur > typicalPrev) posFlow += rawFlow;
			else if (typicalCur < typicalPrev) negFlow += rawFlow;
		}

		const mfiVal = negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
		result.push(toDP(ohlcv[i].time, mfiVal));
	}
	return result;
}

// ─── 17. Parabolic SAR ────────────────────────────────────────────────────────

export function parabolicSAR(
	ohlcv: OHLCV[],
	step = 0.02,
	maxStep = 0.2
): IndicatorDataPoint[] {
	if (ohlcv.length < 2) return [];

	const result: IndicatorDataPoint[] = [];
	let isLong = ohlcv[1].close > ohlcv[0].close;
	let sar = isLong ? ohlcv[0].low : ohlcv[0].high;
	let ep = isLong ? ohlcv[0].high : ohlcv[0].low;
	let af = step;

	for (let i = 1; i < ohlcv.length; i++) {
		const { high, low, time } = ohlcv[i];

		// Calculate new SAR
		let newSAR = sar + af * (ep - sar);

		if (isLong) {
			newSAR = Math.min(newSAR, ohlcv[i - 1].low, i >= 2 ? ohlcv[i - 2].low : ohlcv[i - 1].low);
			if (low < newSAR) {
				// Reverse to short
				isLong = false;
				newSAR = ep;
				ep = low;
				af = step;
			} else {
				if (high > ep) {
					ep = high;
					af = Math.min(af + step, maxStep);
				}
			}
		} else {
			newSAR = Math.max(newSAR, ohlcv[i - 1].high, i >= 2 ? ohlcv[i - 2].high : ohlcv[i - 1].high);
			if (high > newSAR) {
				// Reverse to long
				isLong = true;
				newSAR = ep;
				ep = high;
				af = step;
			} else {
				if (low < ep) {
					ep = low;
					af = Math.min(af + step, maxStep);
				}
			}
		}

		sar = newSAR;
		result.push(toDP(time, sar));
	}

	return result;
}

// ─── 18. Donchian Channel ─────────────────────────────────────────────────────

export function donchianChannel(ohlcv: OHLCV[], period = 20): DonchianResult {
	if (ohlcv.length < period) return { upper: [], middle: [], lower: [] };

	const upper: IndicatorDataPoint[] = [];
	const middle: IndicatorDataPoint[] = [];
	const lower: IndicatorDataPoint[] = [];

	for (let i = period - 1; i < ohlcv.length; i++) {
		let highest = -Infinity;
		let lowest = Infinity;
		for (let j = i - period + 1; j <= i; j++) {
			highest = Math.max(highest, ohlcv[j].high);
			lowest = Math.min(lowest, ohlcv[j].low);
		}
		const t = ohlcv[i].time;
		upper.push(toDP(t, highest));
		lower.push(toDP(t, lowest));
		middle.push(toDP(t, (highest + lowest) / 2));
	}

	return { upper, middle, lower };
}

// ─── 19. Keltner Channel ──────────────────────────────────────────────────────

export function keltnerChannel(
	ohlcv: OHLCV[],
	period = 20,
	multiplier = 2
): KeltnerResult {
	if (ohlcv.length < period) return { upper: [], middle: [], lower: [] };

	const emaLine = ema(ohlcv, period);
	const atrLine = atr(ohlcv, period);

	// Align by time
	const emaMap = new Map(emaLine.map((d) => [d.time, d.value]));
	const atrMap = new Map(atrLine.map((d) => [d.time, d.value]));

	const upper: IndicatorDataPoint[] = [];
	const middle: IndicatorDataPoint[] = [];
	const lower: IndicatorDataPoint[] = [];

	for (const bar of ohlcv) {
		const e = emaMap.get(bar.time);
		const a = atrMap.get(bar.time);
		if (e !== undefined && a !== undefined) {
			upper.push(toDP(bar.time, e + multiplier * a));
			middle.push(toDP(bar.time, e));
			lower.push(toDP(bar.time, e - multiplier * a));
		}
	}

	return { upper, middle, lower };
}

// ─── 20. SuperTrend ───────────────────────────────────────────────────────────

export function superTrend(
	ohlcv: OHLCV[],
	period = 10,
	multiplier = 3
): SuperTrendResult {
	if (ohlcv.length < period + 1) return { supertrend: [], direction: [] };

	const atrLine = atr(ohlcv, period);
	const atrMap = new Map(atrLine.map((d) => [d.time, d.value]));

	const supertrend: IndicatorDataPoint[] = [];
	const direction: IndicatorDataPoint[] = [];

	let prevUpperBand = 0;
	let prevLowerBand = 0;
	let prevST = 0;
	let prevDir = 1;

	for (let i = 1; i < ohlcv.length; i++) {
		const bar = ohlcv[i];
		const atrVal = atrMap.get(bar.time);
		if (atrVal === undefined) continue;

		const hl2 = (bar.high + bar.low) / 2;
		const rawUpper = hl2 + multiplier * atrVal;
		const rawLower = hl2 - multiplier * atrVal;

		const upperBand =
			rawUpper < prevUpperBand || ohlcv[i - 1].close > prevUpperBand ? rawUpper : prevUpperBand;
		const lowerBand =
			rawLower > prevLowerBand || ohlcv[i - 1].close < prevLowerBand ? rawLower : prevLowerBand;

		let dir: number;
		let st: number;

		if (prevST === prevUpperBand) {
			dir = bar.close > upperBand ? 1 : -1;
		} else {
			dir = bar.close < lowerBand ? -1 : 1;
		}

		st = dir === 1 ? lowerBand : upperBand;

		supertrend.push(toDP(bar.time, st));
		direction.push(toDP(bar.time, dir));

		prevUpperBand = upperBand;
		prevLowerBand = lowerBand;
		prevST = st;
		prevDir = dir;
	}

	return { supertrend, direction };
}
