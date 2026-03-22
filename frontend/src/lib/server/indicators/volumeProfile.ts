// Volume Profile Analysis — T-801
// Computes volume-at-price distribution: POC, VAH, VAL, value area

import type { OHLCV } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type VolumeBin = {
	priceLevel: number;   // mid-price of bin
	priceLow:   number;   // bin lower bound
	priceHigh:  number;   // bin upper bound
	volume:     number;   // total volume in this bin
	pct:        number;   // percentage of total volume (0–100)
};

export type VolumeProfile = {
	bins:           VolumeBin[];
	poc:            number;   // Point of Control price
	pocVolume:      number;   // volume at POC
	vah:            number;   // Value Area High (70% of volume above POC)
	val:            number;   // Value Area Low  (70% of volume below POC)
	valueAreaPct:   number;   // value area as % of price range
	totalVolume:    number;
	priceRangeLow:  number;
	priceRangeHigh: number;
	binCount:       number;
};

// ─── Core ─────────────────────────────────────────────────────────────────────

/**
 * Build a volume-at-price profile from OHLCV candles.
 *
 * Each candle's volume is distributed uniformly across all bins that overlap
 * [low, high].  This is the standard TPO/fixed-range approach.
 *
 * @param candles  OHLCV array (at least 1 element)
 * @param bins     number of price buckets (default 24, min 5, max 200)
 * @returns        VolumeProfile or null when insufficient data
 */
export function buildVolumeProfile(candles: OHLCV[], bins = 24): VolumeProfile | null {
	if (!candles || candles.length === 0) return null;

	bins = Math.min(200, Math.max(5, bins));

	// ── Price range ───────────────────────────────────────────────────────────
	let priceRangeLow  = Infinity;
	let priceRangeHigh = -Infinity;
	for (const c of candles) {
		if (c.low  < priceRangeLow)  priceRangeLow  = c.low;
		if (c.high > priceRangeHigh) priceRangeHigh = c.high;
	}

	if (!isFinite(priceRangeLow) || !isFinite(priceRangeHigh)) return null;
	if (priceRangeHigh <= priceRangeLow) return null;

	const binSize = (priceRangeHigh - priceRangeLow) / bins;

	// ── Initialise bins ───────────────────────────────────────────────────────
	const volumeBins: number[] = new Array(bins).fill(0);

	for (const c of candles) {
		if (c.volume <= 0) continue;

		// Indices of first/last overlapping bin
		const firstBin = Math.floor((c.low  - priceRangeLow) / binSize);
		const lastBin  = Math.floor((c.high - priceRangeLow) / binSize);

		const clampedFirst = Math.max(0, Math.min(bins - 1, firstBin));
		const clampedLast  = Math.max(0, Math.min(bins - 1, lastBin));

		const spanBins = clampedLast - clampedFirst + 1;
		const volPerBin = c.volume / spanBins;

		for (let i = clampedFirst; i <= clampedLast; i++) {
			volumeBins[i] += volPerBin;
		}
	}

	const totalVolume = volumeBins.reduce((s, v) => s + v, 0);
	if (totalVolume === 0) return null;

	// ── POC — bin with highest volume ─────────────────────────────────────────
	let pocIdx = 0;
	for (let i = 1; i < bins; i++) {
		if (volumeBins[i] > volumeBins[pocIdx]) pocIdx = i;
	}

	// ── Value Area (70% of total volume centred on POC) ───────────────────────
	const VA_TARGET = 0.70;
	let vaVolume = volumeBins[pocIdx];
	let vaLow    = pocIdx;
	let vaHigh   = pocIdx;

	while (vaVolume / totalVolume < VA_TARGET) {
		const canExpandDown = vaLow  > 0;
		const canExpandUp   = vaHigh < bins - 1;

		if (!canExpandDown && !canExpandUp) break;

		const nextDown = canExpandDown ? volumeBins[vaLow  - 1] : -Infinity;
		const nextUp   = canExpandUp   ? volumeBins[vaHigh + 1] : -Infinity;

		if (nextDown >= nextUp) {
			vaLow--;
			vaVolume += volumeBins[vaLow];
		} else {
			vaHigh++;
			vaVolume += volumeBins[vaHigh];
		}
	}

	// ── Assemble result ───────────────────────────────────────────────────────
	const resultBins: VolumeBin[] = volumeBins.map((vol, i) => {
		const priceLow  = priceRangeLow + i * binSize;
		const priceHigh = priceLow + binSize;
		return {
			priceLevel: priceLow + binSize / 2,
			priceLow,
			priceHigh,
			volume: vol,
			pct: totalVolume > 0 ? (vol / totalVolume) * 100 : 0,
		};
	});

	const poc = priceRangeLow + pocIdx * binSize + binSize / 2;
	const val = priceRangeLow + vaLow  * binSize;
	const vah = priceRangeLow + vaHigh * binSize + binSize;

	const valueAreaPct = ((vah - val) / (priceRangeHigh - priceRangeLow)) * 100;

	return {
		bins:           resultBins,
		poc,
		pocVolume:      volumeBins[pocIdx],
		vah,
		val,
		valueAreaPct,
		totalVolume,
		priceRangeLow,
		priceRangeHigh,
		binCount:       bins,
	};
}

// ─── VPOC Shift Detection ─────────────────────────────────────────────────────

export type VPOCShift = {
	direction: 'up' | 'down' | 'stable';
	previousPOC: number;
	currentPOC:  number;
	shiftPct:    number;  // abs % price change of POC
};

/**
 * Compare POC of first half vs second half of candle array to detect
 * VPOC migration (used by institutional traders to gauge buying/selling pressure).
 */
export function detectVPOCShift(candles: OHLCV[], bins = 24): VPOCShift | null {
	if (candles.length < 10) return null;

	const mid  = Math.floor(candles.length / 2);
	const prev = buildVolumeProfile(candles.slice(0, mid), bins);
	const curr = buildVolumeProfile(candles.slice(mid),    bins);

	if (!prev || !curr) return null;

	const shiftPct = ((curr.poc - prev.poc) / prev.poc) * 100;
	const direction: 'up' | 'down' | 'stable' =
		shiftPct >  0.1 ? 'up'   :
		shiftPct < -0.1 ? 'down' : 'stable';

	return { direction, previousPOC: prev.poc, currentPOC: curr.poc, shiftPct };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtPrice(price: number): string {
	if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
	if (price >= 1)    return price.toFixed(2);
	return price.toFixed(6);
}
