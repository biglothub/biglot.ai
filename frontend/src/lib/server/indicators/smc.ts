// Smart Money Concepts (SMC) Analysis Engine — T-601
// Order Blocks, Fair Value Gaps, BOS/CHOCH, Liquidity Zones

import type { OHLCV } from '$lib/types/contentBlock';
import { findPivots, type Pivot } from './patterns';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrderBlock {
	type: 'bullish' | 'bearish';
	high: number;
	low: number;
	open: number;
	close: number;
	timestamp: number;
	index: number;
	mitigated: boolean;
	strength: number; // 0–1
}

export interface FairValueGap {
	type: 'bullish' | 'bearish';
	top: number;
	bottom: number;
	mid: number;
	timestamp: number;
	index: number; // middle candle
	filled: boolean;
	fillPct: number; // 0–100
}

export interface StructurePoint {
	type: 'HH' | 'HL' | 'LH' | 'LL';
	price: number;
	timestamp: number;
	index: number;
}

export interface StructureBreak {
	type: 'BOS' | 'CHOCH';
	direction: 'bullish' | 'bearish';
	level: number;
	timestamp: number;
	index: number;
}

export interface LiquidityZone {
	type: 'BSL' | 'SSL'; // Buy-Side Liquidity, Sell-Side Liquidity
	price: number;
	touchCount: number;
	timestamp: number;
	swept: boolean;
}

export interface SMCAnalysis {
	orderBlocks: OrderBlock[];
	fairValueGaps: FairValueGap[];
	structurePoints: StructurePoint[];
	structureBreaks: StructureBreak[];
	liquidityZones: LiquidityZone[];
	currentBias: 'bullish' | 'bearish' | 'neutral';
	biasScore: number; // -100 to +100
}

// ─── Order Blocks ─────────────────────────────────────────────────────────────

/**
 * Detect order blocks: the last opposing candle before a strong impulse move.
 * Bullish OB = last bearish candle before a significant upward move from a pivot low.
 * Bearish OB = last bullish candle before a significant downward move from a pivot high.
 */
export function detectOrderBlocks(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	lookback = 5,
	minMovePct = 0.5
): OrderBlock[] {
	const blocks: OrderBlock[] = [];
	const n = ohlcv.length;
	if (n < 10) return blocks;

	const pivotLows = pivots.filter(p => p.type === 'low');
	const pivotHighs = pivots.filter(p => p.type === 'high');

	// Bullish OBs from pivot lows
	for (const pivot of pivotLows) {
		const i = pivot.index;
		if (i >= n - 2) continue;

		// Find the last bearish candle at or before the pivot
		let obIndex = -1;
		for (let j = i; j >= Math.max(0, i - lookback); j--) {
			if (ohlcv[j].close < ohlcv[j].open) {
				obIndex = j;
				break;
			}
		}
		if (obIndex < 0) continue;

		const ob = ohlcv[obIndex];
		const fwdLen = Math.min(lookback, n - i - 1);
		if (fwdLen < 2) continue;

		// Measure the forward move
		let moveHigh = -Infinity;
		for (let j = i + 1; j <= i + fwdLen; j++) {
			if (ohlcv[j].high > moveHigh) moveHigh = ohlcv[j].high;
		}
		const movePct = ob.low > 0 ? ((moveHigh - ob.low) / ob.low) * 100 : 0;
		if (movePct < minMovePct) continue;

		const strength = Math.min(1, movePct / 10);

		// Mitigated if any subsequent candle's low entered the OB zone
		let mitigated = false;
		for (let j = i + 1; j < n; j++) {
			if (ohlcv[j].low <= ob.high) {
				mitigated = true;
				break;
			}
		}

		blocks.push({
			type: 'bullish',
			high: ob.high,
			low: ob.low,
			open: ob.open,
			close: ob.close,
			timestamp: ob.time,
			index: obIndex,
			mitigated,
			strength,
		});
	}

	// Bearish OBs from pivot highs
	for (const pivot of pivotHighs) {
		const i = pivot.index;
		if (i >= n - 2) continue;

		let obIndex = -1;
		for (let j = i; j >= Math.max(0, i - lookback); j--) {
			if (ohlcv[j].close > ohlcv[j].open) {
				obIndex = j;
				break;
			}
		}
		if (obIndex < 0) continue;

		const ob = ohlcv[obIndex];
		const fwdLen = Math.min(lookback, n - i - 1);
		if (fwdLen < 2) continue;

		let moveLow = Infinity;
		for (let j = i + 1; j <= i + fwdLen; j++) {
			if (ohlcv[j].low < moveLow) moveLow = ohlcv[j].low;
		}
		const movePct = ob.high > 0 ? ((ob.high - moveLow) / ob.high) * 100 : 0;
		if (movePct < minMovePct) continue;

		const strength = Math.min(1, movePct / 10);

		let mitigated = false;
		for (let j = i + 1; j < n; j++) {
			if (ohlcv[j].high >= ob.low) {
				mitigated = true;
				break;
			}
		}

		blocks.push({
			type: 'bearish',
			high: ob.high,
			low: ob.low,
			open: ob.open,
			close: ob.close,
			timestamp: ob.time,
			index: obIndex,
			mitigated,
			strength,
		});
	}

	// Sort by strength desc and keep top 10
	return blocks.sort((a, b) => b.strength - a.strength).slice(0, 10);
}

// ─── Fair Value Gaps ──────────────────────────────────────────────────────────

/**
 * Detect Fair Value Gaps (FVGs / imbalances).
 * Bullish FVG: candle[i+2].low > candle[i].high — a gap price may return to fill.
 * Bearish FVG: candle[i+2].high < candle[i].low — gap on the downside.
 */
export function detectFairValueGaps(ohlcv: OHLCV[], minSizePct = 0.1): FairValueGap[] {
	const gaps: FairValueGap[] = [];
	const n = ohlcv.length;
	if (n < 3) return gaps;

	for (let i = 0; i < n - 2; i++) {
		const c0 = ohlcv[i];
		const c1 = ohlcv[i + 1];
		const c2 = ohlcv[i + 2];

		// Bullish FVG
		if (c2.low > c0.high) {
			const top = c2.low;
			const bottom = c0.high;
			const sizePct = bottom > 0 ? ((top - bottom) / bottom) * 100 : 0;
			if (sizePct < minSizePct) continue;

			let fillPct = 0;
			for (let j = i + 3; j < n; j++) {
				if (ohlcv[j].low <= top) {
					if (ohlcv[j].low <= bottom) {
						fillPct = 100;
						break;
					}
					const candidate = ((top - ohlcv[j].low) / (top - bottom)) * 100;
					if (candidate > fillPct) fillPct = candidate;
				}
			}

			gaps.push({
				type: 'bullish',
				top,
				bottom,
				mid: (top + bottom) / 2,
				timestamp: c1.time,
				index: i + 1,
				filled: fillPct >= 100,
				fillPct,
			});
		}

		// Bearish FVG
		if (c2.high < c0.low) {
			const top = c0.low;
			const bottom = c2.high;
			const sizePct = bottom > 0 ? ((top - bottom) / bottom) * 100 : 0;
			if (sizePct < minSizePct) continue;

			let fillPct = 0;
			for (let j = i + 3; j < n; j++) {
				if (ohlcv[j].high >= bottom) {
					if (ohlcv[j].high >= top) {
						fillPct = 100;
						break;
					}
					const candidate = ((ohlcv[j].high - bottom) / (top - bottom)) * 100;
					if (candidate > fillPct) fillPct = candidate;
				}
			}

			gaps.push({
				type: 'bearish',
				top,
				bottom,
				mid: (top + bottom) / 2,
				timestamp: c1.time,
				index: i + 1,
				filled: fillPct >= 100,
				fillPct,
			});
		}
	}

	// Return most recent 15 FVGs
	return gaps.slice(-15);
}

// ─── Market Structure ─────────────────────────────────────────────────────────

/**
 * Classify pivot points as HH/HL/LH/LL and detect BOS (Break of Structure)
 * and CHOCH (Change of Character) from the sequence.
 */
export function detectMarketStructure(
	ohlcv: OHLCV[],
	pivots: Pivot[]
): { structurePoints: StructurePoint[]; structureBreaks: StructureBreak[] } {
	const highs = pivots.filter(p => p.type === 'high').sort((a, b) => a.index - b.index);
	const lows = pivots.filter(p => p.type === 'low').sort((a, b) => a.index - b.index);

	const structurePoints: StructurePoint[] = [];

	// Classify each high relative to previous high
	for (let i = 1; i < highs.length; i++) {
		structurePoints.push({
			type: highs[i].price > highs[i - 1].price ? 'HH' : 'LH',
			price: highs[i].price,
			timestamp: ohlcv[highs[i].index].time,
			index: highs[i].index,
		});
	}

	// Classify each low relative to previous low
	for (let i = 1; i < lows.length; i++) {
		structurePoints.push({
			type: lows[i].price > lows[i - 1].price ? 'HL' : 'LL',
			price: lows[i].price,
			timestamp: ohlcv[lows[i].index].time,
			index: lows[i].index,
		});
	}

	structurePoints.sort((a, b) => a.index - b.index);

	// Detect BOS / CHOCH
	const structureBreaks: StructureBreak[] = [];

	// Determine initial trend from first 4 structure points
	const seed = structurePoints.slice(0, Math.min(4, structurePoints.length));
	const seedBull = seed.filter(p => p.type === 'HH' || p.type === 'HL').length;
	const seedBear = seed.filter(p => p.type === 'LH' || p.type === 'LL').length;
	let trend: 'bullish' | 'bearish' | 'neutral' =
		seedBull > seedBear ? 'bullish' : seedBear > seedBull ? 'bearish' : 'neutral';

	for (const sp of structurePoints) {
		if (trend === 'bullish') {
			if (sp.type === 'LH') {
				// First higher-low failure = change of character
				structureBreaks.push({
					type: 'CHOCH',
					direction: 'bearish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
				trend = 'bearish';
			} else if (sp.type === 'HH') {
				structureBreaks.push({
					type: 'BOS',
					direction: 'bullish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
			}
		} else if (trend === 'bearish') {
			if (sp.type === 'HL') {
				structureBreaks.push({
					type: 'CHOCH',
					direction: 'bullish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
				trend = 'bullish';
			} else if (sp.type === 'LL') {
				structureBreaks.push({
					type: 'BOS',
					direction: 'bearish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
			}
		} else {
			// Neutral: first clear signal establishes trend
			if (sp.type === 'HH') {
				trend = 'bullish';
				structureBreaks.push({
					type: 'BOS',
					direction: 'bullish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
			} else if (sp.type === 'LL') {
				trend = 'bearish';
				structureBreaks.push({
					type: 'BOS',
					direction: 'bearish',
					level: sp.price,
					timestamp: sp.timestamp,
					index: sp.index,
				});
			}
		}
	}

	return { structurePoints, structureBreaks };
}

// ─── Liquidity Zones ──────────────────────────────────────────────────────────

/**
 * Detect liquidity zones by grouping equal highs (buy-side) and equal lows (sell-side).
 * Equal = within tolerancePct of each other.
 */
export function detectLiquidityZones(
	ohlcv: OHLCV[],
	pivots: Pivot[],
	tolerancePct = 0.5
): LiquidityZone[] {
	const zones: LiquidityZone[] = [];
	const highs = pivots.filter(p => p.type === 'high');
	const lows = pivots.filter(p => p.type === 'low');
	const currentPrice = ohlcv.length > 0 ? ohlcv[ohlcv.length - 1].close : 0;

	// Group equal highs → Buy-Side Liquidity
	const usedHighs = new Set<number>();
	for (let i = 0; i < highs.length; i++) {
		if (usedHighs.has(i)) continue;
		const group = [highs[i]];
		for (let j = i + 1; j < highs.length; j++) {
			if (usedHighs.has(j)) continue;
			const diff = highs[i].price > 0
				? (Math.abs(highs[j].price - highs[i].price) / highs[i].price) * 100
				: 0;
			if (diff <= tolerancePct) {
				group.push(highs[j]);
				usedHighs.add(j);
			}
		}
		if (group.length < 2) continue;

		const avgPrice = group.reduce((s, h) => s + h.price, 0) / group.length;
		const lastPivot = group.reduce((best, h) => h.index > best.index ? h : best);
		// Swept if current price has already traded above this level
		const swept = currentPrice > avgPrice;

		zones.push({
			type: 'BSL',
			price: avgPrice,
			touchCount: group.length,
			timestamp: ohlcv[lastPivot.index]?.time ?? 0,
			swept,
		});
	}

	// Group equal lows → Sell-Side Liquidity
	const usedLows = new Set<number>();
	for (let i = 0; i < lows.length; i++) {
		if (usedLows.has(i)) continue;
		const group = [lows[i]];
		for (let j = i + 1; j < lows.length; j++) {
			if (usedLows.has(j)) continue;
			const diff = lows[i].price > 0
				? (Math.abs(lows[j].price - lows[i].price) / lows[i].price) * 100
				: 0;
			if (diff <= tolerancePct) {
				group.push(lows[j]);
				usedLows.add(j);
			}
		}
		if (group.length < 2) continue;

		const avgPrice = group.reduce((s, l) => s + l.price, 0) / group.length;
		const lastPivot = group.reduce((best, l) => l.index > best.index ? l : best);
		const swept = currentPrice < avgPrice;

		zones.push({
			type: 'SSL',
			price: avgPrice,
			touchCount: group.length,
			timestamp: ohlcv[lastPivot.index]?.time ?? 0,
			swept,
		});
	}

	return zones.sort((a, b) => b.touchCount - a.touchCount);
}

// ─── Bias Score ───────────────────────────────────────────────────────────────

/**
 * Compute overall SMC bias from structure breaks and order block positions.
 * Returns score -100 (max bearish) to +100 (max bullish).
 */
export function calcSMCBias(
	structureBreaks: StructureBreak[],
	orderBlocks: OrderBlock[],
	currentPrice: number
): { bias: 'bullish' | 'bearish' | 'neutral'; score: number } {
	if (structureBreaks.length === 0) return { bias: 'neutral', score: 0 };

	let score = 0;

	// Last structure break direction (highest weight)
	const lastBreak = structureBreaks[structureBreaks.length - 1];
	score += lastBreak.direction === 'bullish' ? 40 : -40;

	// BOS vs CHOCH: BOS = strong trend continuation, CHOCH = reversal signal
	if (lastBreak.type === 'BOS') score += lastBreak.direction === 'bullish' ? 10 : -10;
	else score += lastBreak.direction === 'bullish' ? 5 : -5; // CHOCH slightly weaker

	// Count recent 5 structure breaks
	const recent = structureBreaks.slice(-5);
	const bullCount = recent.filter(b => b.direction === 'bullish').length;
	const bearCount = recent.filter(b => b.direction === 'bearish').length;
	score += (bullCount - bearCount) * 6;

	// Unmitigated OBs below current price (demand) vs above (supply)
	const demandOBs = orderBlocks.filter(ob => !ob.mitigated && ob.type === 'bullish' && ob.high < currentPrice).length;
	const supplyOBs = orderBlocks.filter(ob => !ob.mitigated && ob.type === 'bearish' && ob.low > currentPrice).length;
	score += (demandOBs - supplyOBs) * 5;

	score = Math.max(-100, Math.min(100, score));
	const bias = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';
	return { bias, score };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run full SMC analysis on OHLCV data.
 */
export function buildSMCAnalysis(ohlcv: OHLCV[], pivotLookback = 5): SMCAnalysis {
	if (ohlcv.length < 20) {
		return {
			orderBlocks: [],
			fairValueGaps: [],
			structurePoints: [],
			structureBreaks: [],
			liquidityZones: [],
			currentBias: 'neutral',
			biasScore: 0,
		};
	}

	const pivots = findPivots(ohlcv, pivotLookback);
	const orderBlocks = detectOrderBlocks(ohlcv, pivots);
	const fairValueGaps = detectFairValueGaps(ohlcv);
	const { structurePoints, structureBreaks } = detectMarketStructure(ohlcv, pivots);
	const liquidityZones = detectLiquidityZones(ohlcv, pivots);

	const currentPrice = ohlcv[ohlcv.length - 1].close;
	const { bias: currentBias, score: biasScore } = calcSMCBias(structureBreaks, orderBlocks, currentPrice);

	return {
		orderBlocks,
		fairValueGaps,
		structurePoints,
		structureBreaks,
		liquidityZones,
		currentBias,
		biasScore,
	};
}
