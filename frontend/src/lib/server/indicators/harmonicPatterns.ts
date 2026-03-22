// Harmonic Pattern Scanner — T-1001
// Detects XABCD harmonic patterns (Gartley, Butterfly, Bat, Crab, Cypher) and ABCD patterns
// using pivot-based Fibonacci ratio validation (±5% tolerance).

import type { OHLCV } from '$lib/types/contentBlock';
import { findPivots, type Pivot } from './patterns';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HarmonicPatternName = 'ABCD' | 'Gartley' | 'Butterfly' | 'Bat' | 'Crab' | 'Cypher';

export interface HarmonicPattern {
	name: HarmonicPatternName;
	direction: 'bullish' | 'bearish';
	/** Pivot prices: [X,A,B,C,D] for XABCD; [A,B,C,D] for ABCD */
	pivotPrices: number[];
	przLow: number;   // Potential Reversal Zone low boundary
	przHigh: number;  // Potential Reversal Zone high boundary
	prz: number;      // PRZ midpoint
	score: number;    // 0-100 ratio adherence score
	completing: boolean; // true when D leg is projected (not yet confirmed)
	ratios: Record<string, number>; // actual computed ratios for display
}

export interface HarmonicScanResult {
	patterns: HarmonicPattern[];
	currentPrice: number;
	strongestPattern: HarmonicPattern | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOLERANCE = 0.05; // ±5% ratio tolerance

// ─── Pattern specifications ───────────────────────────────────────────────────

interface XABCDSpec {
	name: Exclude<HarmonicPatternName, 'ABCD'>;
	ab_xa: number[];   // AB/XA target ratios
	bc_ab: number[];   // BC/AB target ratios (empty for Cypher)
	cd_bc: number[];   // CD/BC target ratios (empty for Cypher)
	ad_xa: number[];   // AD/XA primary completion ratios (empty for Cypher)
	// Cypher-specific:
	xc_xa?: number[];  // XC/XA (C extends beyond A)
	cd_xc?: number[];  // CD/XC (D retraces XC)
}

const XABCD_SPECS: XABCDSpec[] = [
	{
		name: 'Gartley',
		ab_xa: [0.618],
		bc_ab: [0.382, 0.886],
		cd_bc: [1.272, 1.618],
		ad_xa: [0.786],
	},
	{
		name: 'Bat',
		ab_xa: [0.382, 0.500],
		bc_ab: [0.382, 0.886],
		cd_bc: [1.618, 2.618],
		ad_xa: [0.886],
	},
	{
		name: 'Butterfly',
		ab_xa: [0.786],
		bc_ab: [0.382, 0.886],
		cd_bc: [1.618, 2.618],
		ad_xa: [1.272, 1.618], // D extends beyond X
	},
	{
		name: 'Crab',
		ab_xa: [0.382, 0.618],
		bc_ab: [0.382, 0.886],
		cd_bc: [2.618, 3.618],
		ad_xa: [1.618],
	},
	{
		name: 'Cypher',
		ab_xa: [0.382, 0.618],
		bc_ab: [],  // not used
		cd_bc: [],  // not used
		ad_xa: [],  // not used
		xc_xa: [1.272, 1.414], // C extends beyond A
		cd_xc: [0.786],        // D retraces XC
	},
];

// ─── Ratio helpers ────────────────────────────────────────────────────────────

/**
 * Returns the best score (0–1) for `actual` against a list of target ratios.
 * Returns 0 if no target is within TOLERANCE.
 */
export function bestRatioScore(actual: number, targets: number[]): number {
	let best = 0;
	for (const t of targets) {
		if (t === 0) continue;
		const dev = Math.abs(actual - t) / t;
		if (dev <= TOLERANCE) {
			const s = 1 - dev / TOLERANCE;
			if (s > best) best = s;
		}
	}
	return best;
}

// ─── XABCD validation ─────────────────────────────────────────────────────────

interface ValidationResult {
	score: number;
	ratios: Record<string, number>;
}

/**
 * Validate a complete XABCD pattern against a spec.
 * Returns null if any required ratio is out of tolerance.
 */
export function validateXABCD(
	x: number, a: number, b: number, c: number, d: number,
	spec: XABCDSpec,
): ValidationResult | null {
	const xa = Math.abs(a - x);
	const ab = Math.abs(b - a);
	const bc = Math.abs(c - b);
	const cd = Math.abs(d - c);
	const ad = Math.abs(d - a);
	const xc = Math.abs(c - x);

	if (xa === 0 || ab === 0 || bc === 0 || cd === 0) return null;

	// Cypher uses different ratio set
	if (spec.xc_xa && spec.cd_xc) {
		const ratios: Record<string, number> = {
			'AB/XA': ab / xa,
			'XC/XA': xc / xa,
			'CD/XC': xc > 0 ? cd / xc : 0,
		};

		const s_ab = bestRatioScore(ab / xa, spec.ab_xa);
		const s_xc = bestRatioScore(xc / xa, spec.xc_xa);
		const s_cd = xc > 0 ? bestRatioScore(cd / xc, spec.cd_xc) : 0;

		if (s_ab === 0 || s_xc === 0 || s_cd === 0) return null;

		const score = (s_ab * 0.25 + s_xc * 0.40 + s_cd * 0.35) * 100;
		return { score, ratios };
	}

	// Standard XABCD
	const ratios: Record<string, number> = {
		'AB/XA': ab / xa,
		'BC/AB': bc / ab,
		'CD/BC': cd / bc,
		'AD/XA': ad / xa,
	};

	const s_ab = bestRatioScore(ab / xa, spec.ab_xa);
	const s_bc = bestRatioScore(bc / ab, spec.bc_ab);
	const s_cd = bestRatioScore(cd / bc, spec.cd_bc);
	const s_ad = bestRatioScore(ad / xa, spec.ad_xa);

	if (s_ab === 0 || s_bc === 0 || s_cd === 0 || s_ad === 0) return null;

	// AD/XA is the primary completion ratio — weight it more
	const score = (s_ab * 0.20 + s_bc * 0.20 + s_cd * 0.25 + s_ad * 0.35) * 100;
	return { score, ratios };
}

/**
 * Validate XABC pivots only (D is forming).
 * Returns a partial score based on the first three ratios.
 */
export function validateXABC(
	x: number, a: number, b: number, c: number,
	spec: XABCDSpec,
): ValidationResult | null {
	const xa = Math.abs(a - x);
	const ab = Math.abs(b - a);
	const bc = Math.abs(c - b);
	const xc = Math.abs(c - x);

	if (xa === 0 || ab === 0 || bc === 0) return null;

	if (spec.xc_xa) {
		// Cypher: check AB/XA and XC/XA
		const s_ab = bestRatioScore(ab / xa, spec.ab_xa);
		const s_xc = bestRatioScore(xc / xa, spec.xc_xa);
		if (s_ab === 0 || s_xc === 0) return null;
		const score = (s_ab * 0.45 + s_xc * 0.55) * 70; // max 70 — incomplete
		return { score, ratios: { 'AB/XA': ab / xa, 'XC/XA': xc / xa } };
	}

	const s_ab = bestRatioScore(ab / xa, spec.ab_xa);
	const s_bc = bestRatioScore(bc / ab, spec.bc_ab);
	if (s_ab === 0 || s_bc === 0) return null;

	const score = (s_ab * 0.5 + s_bc * 0.5) * 70;
	return { score, ratios: { 'AB/XA': ab / xa, 'BC/AB': bc / ab } };
}

// ─── PRZ computation ──────────────────────────────────────────────────────────

/**
 * Compute the Potential Reversal Zone (PRZ) for a given XABC set.
 * The PRZ is the average of all D projections from XA and BC legs.
 */
export function computePRZ(
	x: number, a: number, b: number, c: number,
	spec: XABCDSpec,
	bullish: boolean,
): { low: number; high: number; prz: number } {
	const xa = Math.abs(a - x);
	const bc = Math.abs(c - b);
	const xc = Math.abs(c - x);

	const points: number[] = [];

	if (spec.xc_xa && spec.cd_xc) {
		// Cypher: D = C ∓ cd_xc × XC
		for (const r of spec.cd_xc) {
			points.push(bullish ? c - r * xc : c + r * xc);
		}
	} else {
		// Component 1: AD/XA projection — D = A ∓ ad_xa × XA
		for (const r of spec.ad_xa) {
			points.push(bullish ? a - r * xa : a + r * xa);
		}
		// Component 2: CD/BC extension — D = C ∓ cd_bc × BC
		for (const r of spec.cd_bc) {
			points.push(bullish ? c - r * bc : c + r * bc);
		}
	}

	if (points.length === 0) return { low: c, high: c, prz: c };

	return {
		low:  Math.min(...points),
		high: Math.max(...points),
		prz:  points.reduce((s, p) => s + p, 0) / points.length,
	};
}

// ─── ABCD validation ──────────────────────────────────────────────────────────

const ABCD_BC_AB = [0.618, 0.786];
const ABCD_CD_BC = [1.272, 1.618];

export function validateABCD(
	a: number, b: number, c: number, d: number,
): ValidationResult | null {
	const ab = Math.abs(b - a);
	const bc = Math.abs(c - b);
	const cd = Math.abs(d - c);

	if (ab === 0 || bc === 0 || cd === 0) return null;

	const ratios: Record<string, number> = {
		'BC/AB': bc / ab,
		'CD/BC': cd / bc,
	};

	const s_bc = bestRatioScore(bc / ab, ABCD_BC_AB);
	const s_cd = bestRatioScore(cd / bc, ABCD_CD_BC);

	if (s_bc === 0 || s_cd === 0) return null;

	const score = (s_bc * 0.5 + s_cd * 0.5) * 100;
	return { score, ratios };
}

/** Compute ABCD PRZ from AB projection */
export function computeABCDPRZ(
	a: number, b: number, c: number,
	bullish: boolean,
): { low: number; high: number; prz: number } {
	const bc = Math.abs(c - b);
	const points = ABCD_CD_BC.map(r => bullish ? c - r * bc : c + r * bc);
	return {
		low:  Math.min(...points),
		high: Math.max(...points),
		prz:  (points[0] + points[1]) / 2,
	};
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/** Remove near-duplicate patterns (same name + direction + PRZ within 1%) */
export function deduplicatePatterns(patterns: HarmonicPattern[]): HarmonicPattern[] {
	const unique: HarmonicPattern[] = [];
	for (const p of patterns) {
		const dup = unique.find(u =>
			u.name === p.name &&
			u.direction === p.direction &&
			Math.abs(u.prz - p.prz) / Math.max(u.prz, 1) < 0.01
		);
		if (!dup || p.score > dup.score) {
			if (dup) unique.splice(unique.indexOf(dup), 1);
			unique.push(p);
		}
	}
	return unique;
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

/**
 * Scan OHLCV data for harmonic patterns.
 * Returns detected patterns sorted by score descending.
 */
export function scanHarmonicPatterns(
	ohlcv: OHLCV[],
	options: {
		lookback?: number;   // pivot detection window (default 5)
		minScore?: number;   // minimum score to include (default 60)
		maxPivots?: number;  // max pivots to examine (default 30)
	} = {},
): HarmonicScanResult {
	const { lookback = 5, minScore = 60, maxPivots = 30 } = options;
	const currentPrice = ohlcv[ohlcv.length - 1].close;

	if (ohlcv.length < lookback * 2 + 5) {
		return { patterns: [], currentPrice, strongestPattern: null };
	}

	const allPivots = findPivots(ohlcv, lookback);
	if (allPivots.length < 4) {
		return { patterns: [], currentPrice, strongestPattern: null };
	}

	const pivots = allPivots.slice(-maxPivots);
	const lastPivotIndex = pivots[pivots.length - 1]?.index ?? -1;
	const detected: HarmonicPattern[] = [];

	// ── Scan XABCD complete patterns (5 consecutive pivots) ───────────────────
	for (let i = 0; i <= pivots.length - 5; i++) {
		const [xp, ap, bp, cp, dp] = pivots.slice(i, i + 5) as [Pivot, Pivot, Pivot, Pivot, Pivot];

		const bullish = xp.type === 'low'  && ap.type === 'high' && bp.type === 'low'  && cp.type === 'high' && dp.type === 'low';
		const bearish = xp.type === 'high' && ap.type === 'low'  && bp.type === 'high' && cp.type === 'low'  && dp.type === 'high';
		if (!bullish && !bearish) continue;

		const [x, a, b, c, d] = [xp.price, ap.price, bp.price, cp.price, dp.price];

		for (const spec of XABCD_SPECS) {
			const result = validateXABCD(x, a, b, c, d, spec);
			if (!result || result.score < minScore) continue;

			const { low, high, prz } = computePRZ(x, a, b, c, spec, bullish);

			detected.push({
				name: spec.name,
				direction: bullish ? 'bullish' : 'bearish',
				pivotPrices: [x, a, b, c, d],
				przLow:  low,
				przHigh: high,
				prz,
				score: Math.round(result.score),
				completing: dp.index === lastPivotIndex,
				ratios: result.ratios,
			});
		}
	}

	// ── Scan ABCD complete patterns (4 consecutive pivots) ────────────────────
	for (let i = 0; i <= pivots.length - 4; i++) {
		const [ap, bp, cp, dp] = pivots.slice(i, i + 4) as [Pivot, Pivot, Pivot, Pivot];

		const bullish = ap.type === 'high' && bp.type === 'low'  && cp.type === 'high' && dp.type === 'low';
		const bearish = ap.type === 'low'  && bp.type === 'high' && cp.type === 'low'  && dp.type === 'high';
		if (!bullish && !bearish) continue;

		const [a, b, c, d] = [ap.price, bp.price, cp.price, dp.price];
		const result = validateABCD(a, b, c, d);
		if (!result || result.score < minScore) continue;

		const { low, high, prz } = computeABCDPRZ(a, b, c, bullish);

		detected.push({
			name: 'ABCD',
			direction: bullish ? 'bullish' : 'bearish',
			pivotPrices: [a, b, c, d],
			przLow:  low,
			przHigh: high,
			prz,
			score: Math.round(result.score),
			completing: dp.index === lastPivotIndex,
			ratios: result.ratios,
		});
	}

	// ── Scan forming XABC patterns (D not yet confirmed) ──────────────────────
	if (pivots.length >= 4) {
		const last4 = pivots.slice(-4) as [Pivot, Pivot, Pivot, Pivot];
		const [xp, ap, bp, cp] = last4;

		const bullish = xp.type === 'low'  && ap.type === 'high' && bp.type === 'low'  && cp.type === 'high';
		const bearish = xp.type === 'high' && ap.type === 'low'  && bp.type === 'high' && cp.type === 'low';

		if (bullish || bearish) {
			const [x, a, b, c] = [xp.price, ap.price, bp.price, cp.price];

			for (const spec of XABCD_SPECS) {
				const result = validateXABC(x, a, b, c, spec);
				if (!result || result.score < minScore * 0.7) continue;

				const { low, high, prz } = computePRZ(x, a, b, c, spec, bullish);

				detected.push({
					name: spec.name,
					direction: bullish ? 'bullish' : 'bearish',
					pivotPrices: [x, a, b, c],
					przLow:  low,
					przHigh: high,
					prz,
					score: Math.round(result.score),
					completing: true,
					ratios: result.ratios,
				});
			}
		}

		// Also check forming ABCD (last 3 pivots = A, B, C)
		if (pivots.length >= 3) {
			const last3 = pivots.slice(-3) as [Pivot, Pivot, Pivot];
			const [ap2, bp2, cp2] = last3;

			const bul2 = ap2.type === 'high' && bp2.type === 'low' && cp2.type === 'high';
			const bea2 = ap2.type === 'low'  && bp2.type === 'high' && cp2.type === 'low';

			if (bul2 || bea2) {
				const [a2, b2, c2] = [ap2.price, bp2.price, cp2.price];
				const ab2 = Math.abs(b2 - a2);
				const bc2 = Math.abs(c2 - b2);

				if (ab2 > 0) {
					const s_bc = bestRatioScore(bc2 / ab2, ABCD_BC_AB);
					if (s_bc > 0) {
						const score = Math.round(s_bc * 50); // partial score
						if (score >= minScore * 0.5) {
							const { low, high, prz } = computeABCDPRZ(a2, b2, c2, bul2);
							detected.push({
								name: 'ABCD',
								direction: bul2 ? 'bullish' : 'bearish',
								pivotPrices: [a2, b2, c2],
								przLow:  low,
								przHigh: high,
								prz,
								score,
								completing: true,
								ratios: { 'BC/AB': bc2 / ab2 },
							});
						}
					}
				}
			}
		}
	}

	const unique = deduplicatePatterns(detected);
	unique.sort((a, b) => b.score - a.score);

	return {
		patterns: unique,
		currentPrice,
		strongestPattern: unique[0] ?? null,
	};
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtHarmonicPrice(price: number): string {
	if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	if (price >= 1)    return price.toFixed(4);
	return price.toFixed(6);
}
