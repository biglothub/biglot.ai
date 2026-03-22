// Indicator Builder Data — T-1405
// NL → composable indicator definition → signals + PineScript v6

import type { OHLCV, IndicatorDataPoint } from '$lib/types/contentBlock';
import {
	sma,
	ema,
	rsi,
	macd,
	bollingerBands,
	atr,
	adx,
	obv,
	vwap,
	cci,
	mfi,
	superTrend,
} from '../indicators/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IndicatorKind =
	| 'ema'
	| 'sma'
	| 'rsi'
	| 'macd'
	| 'macd_signal'
	| 'bb_upper'
	| 'bb_middle'
	| 'bb_lower'
	| 'atr'
	| 'vwap'
	| 'obv'
	| 'adx'
	| 'cci'
	| 'mfi'
	| 'supertrend'
	| 'price';

export type IndicatorRef = {
	kind: IndicatorKind;
	period?: number;
};

export type ConditionOperator = 'crossover' | 'crossunder' | 'above' | 'below';

export type ConditionRHS = IndicatorRef | { kind: 'value'; value: number };

export type ParsedCondition = {
	left: IndicatorRef;
	operator: ConditionOperator;
	right: ConditionRHS;
};

export type ComputedSignal = {
	time: number;      // unix seconds
	type: 'buy' | 'sell';
	barIndex: number;
};

export type ChartIndicatorSeries = {
	name: string;
	data: IndicatorDataPoint[];
	color: string;
	overlay: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function refToKey(ref: IndicatorRef): string {
	return `${ref.kind}_${ref.period ?? 'default'}`;
}

export function refToLabel(ref: IndicatorRef): string {
	switch (ref.kind) {
		case 'ema': return `EMA ${ref.period ?? 20}`;
		case 'sma': return `SMA ${ref.period ?? 20}`;
		case 'rsi': return `RSI ${ref.period ?? 14}`;
		case 'macd': return 'MACD';
		case 'macd_signal': return 'MACD Signal';
		case 'bb_upper': return `BB Upper (${ref.period ?? 20})`;
		case 'bb_middle': return `BB Mid (${ref.period ?? 20})`;
		case 'bb_lower': return `BB Lower (${ref.period ?? 20})`;
		case 'atr': return `ATR ${ref.period ?? 14}`;
		case 'vwap': return 'VWAP';
		case 'obv': return 'OBV';
		case 'adx': return `ADX ${ref.period ?? 14}`;
		case 'cci': return `CCI ${ref.period ?? 20}`;
		case 'mfi': return `MFI ${ref.period ?? 14}`;
		case 'supertrend': return 'SuperTrend';
		case 'price': return 'Price';
	}
}

function isOverlayKind(kind: IndicatorKind): boolean {
	return ['ema', 'sma', 'bb_upper', 'bb_middle', 'bb_lower', 'vwap', 'supertrend', 'price'].includes(kind);
}

const CHART_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// ─── NL Parser ────────────────────────────────────────────────────────────────

function parseRef(token: string): IndicatorRef | null {
	const t = token.trim().toUpperCase().replace(/\s+/g, ' ');

	// EMA
	let m = t.match(/^EMA\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'ema', period: parseInt(m[1], 10) };
	if (t === 'EMA') return { kind: 'ema', period: 20 };

	// SMA / MA
	m = t.match(/^(?:SMA|MA)\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'sma', period: parseInt(m[1], 10) };
	if (t === 'SMA' || t === 'MA') return { kind: 'sma', period: 20 };

	// RSI
	m = t.match(/^RSI\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'rsi', period: parseInt(m[1], 10) };
	if (t === 'RSI') return { kind: 'rsi', period: 14 };

	// MACD
	if (t === 'MACD') return { kind: 'macd' };
	if (t === 'MACD SIGNAL' || t === 'MACD_SIGNAL' || t === 'SIGNAL') return { kind: 'macd_signal' };

	// Bollinger Bands
	if (/BB\s*UPPER|BOLLINGER\s*UPPER/.test(t)) return { kind: 'bb_upper', period: 20 };
	if (/BB\s*LOWER|BOLLINGER\s*LOWER/.test(t)) return { kind: 'bb_lower', period: 20 };
	if (/BB\s*(MID|MIDDLE)|BOLLINGER\s*(MID|MIDDLE)/.test(t)) return { kind: 'bb_middle', period: 20 };
	if (/^BB$|^BOLLINGER$|^BOLLINGER BANDS$/.test(t)) return { kind: 'bb_upper', period: 20 };

	// Price / Close
	if (t === 'PRICE' || t === 'CLOSE') return { kind: 'price' };

	// ATR
	m = t.match(/^ATR\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'atr', period: parseInt(m[1], 10) };
	if (t === 'ATR') return { kind: 'atr', period: 14 };

	// VWAP
	if (t === 'VWAP') return { kind: 'vwap' };

	// OBV
	if (t === 'OBV') return { kind: 'obv' };

	// ADX
	m = t.match(/^ADX\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'adx', period: parseInt(m[1], 10) };
	if (t === 'ADX') return { kind: 'adx', period: 14 };

	// CCI
	m = t.match(/^CCI\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'cci', period: parseInt(m[1], 10) };
	if (t === 'CCI') return { kind: 'cci', period: 20 };

	// MFI
	m = t.match(/^MFI\s*\(?(\d+)\)?$/);
	if (m) return { kind: 'mfi', period: parseInt(m[1], 10) };
	if (t === 'MFI') return { kind: 'mfi', period: 14 };

	// SuperTrend
	if (t === 'SUPERTREND' || t === 'SUPER TREND') return { kind: 'supertrend' };

	return null;
}

function parseValue(token: string): { kind: 'value'; value: number } | null {
	const n = parseFloat(token.trim());
	if (isNaN(n)) return null;
	return { kind: 'value', value: n };
}

function parseConditionString(s: string): ParsedCondition | null {
	const normalized = s.trim()
		.replace(/crosses?\s+above/gi, 'crossover')
		.replace(/crosses?\s+below/gi, 'crossunder')
		.replace(/greater\s+than/gi, 'above')
		.replace(/less\s+than/gi, 'below');

	for (const op of ['crossover', 'crossunder', 'above', 'below'] as ConditionOperator[]) {
		const re = new RegExp(`^(.+?)\\s+${op}\\s+(.+)$`, 'i');
		const m = normalized.match(re);
		if (!m) continue;

		const left = parseRef(m[1].trim());
		if (!left) continue;

		const right: ConditionRHS = parseRef(m[2].trim()) ?? parseValue(m[2].trim()) ?? { kind: 'value', value: 0 };
		return { left, operator: op, right };
	}

	return null;
}

/**
 * Parse a natural-language indicator description into structured conditions.
 * Supports: "EMA 20 crossover EMA 50 + RSI below 30", "MACD crossover Signal", etc.
 */
export function parseIndicatorDescription(description: string): ParsedCondition[] {
	const parts = description.split(/\s*[+&]\s*|\s+AND\s+/i).filter(Boolean);
	const conditions: ParsedCondition[] = [];

	for (const part of parts) {
		const cond = parseConditionString(part.trim());
		if (cond) conditions.push(cond);
	}

	// Try whole string as one condition if nothing parsed
	if (conditions.length === 0) {
		const cond = parseConditionString(description.trim());
		if (cond) conditions.push(cond);
	}

	return conditions;
}

// ─── Indicator Computation ───────────────────────────────────────────────────

export function getIndicatorValues(ohlcv: OHLCV[], ref: IndicatorRef): IndicatorDataPoint[] {
	switch (ref.kind) {
		case 'ema': return ema(ohlcv, ref.period ?? 20);
		case 'sma': return sma(ohlcv, ref.period ?? 20);
		case 'rsi': return rsi(ohlcv, ref.period ?? 14);
		case 'macd': return macd(ohlcv).macd;
		case 'macd_signal': return macd(ohlcv).signal;
		case 'bb_upper': return bollingerBands(ohlcv, ref.period ?? 20).upper;
		case 'bb_middle': return bollingerBands(ohlcv, ref.period ?? 20).middle;
		case 'bb_lower': return bollingerBands(ohlcv, ref.period ?? 20).lower;
		case 'atr': return atr(ohlcv, ref.period ?? 14);
		case 'vwap': return vwap(ohlcv);
		case 'obv': return obv(ohlcv);
		case 'adx': return adx(ohlcv, ref.period ?? 14).adx;
		case 'cci': return cci(ohlcv, ref.period ?? 20);
		case 'mfi': return mfi(ohlcv, ref.period ?? 14);
		case 'supertrend': return superTrend(ohlcv).supertrend;
		case 'price': return ohlcv.map((c) => ({ time: c.time, value: c.close }));
	}
}

/**
 * Compute signals for all conditions against OHLCV data.
 * - Crossover/crossunder: fires only at the crossing bar
 * - Above/below without any crossover: fires only at transitions (false→true)
 * - Combined: ALL conditions must be satisfied on the same bar
 */
export function computeSignals(
	ohlcv: OHLCV[],
	conditions: ParsedCondition[],
	signalDir: 'buy' | 'sell' | 'both' = 'buy',
): { signals: ComputedSignal[]; seriesMap: Map<string, IndicatorDataPoint[]>; currentlyActive: boolean } {
	if (ohlcv.length < 2 || conditions.length === 0) {
		return { signals: [], seriesMap: new Map(), currentlyActive: false };
	}

	// Build series map for all referenced indicators
	const seriesMap = new Map<string, IndicatorDataPoint[]>();
	for (const cond of conditions) {
		const lk = refToKey(cond.left);
		if (!seriesMap.has(lk)) seriesMap.set(lk, getIndicatorValues(ohlcv, cond.left));
		if (cond.right.kind !== 'value') {
			const rk = refToKey(cond.right as IndicatorRef);
			if (!seriesMap.has(rk)) seriesMap.set(rk, getIndicatorValues(ohlcv, cond.right as IndicatorRef));
		}
	}

	// Build time-indexed maps for O(1) lookup
	const indexed = new Map<string, Map<number, number>>();
	for (const [key, data] of seriesMap) {
		indexed.set(key, new Map(data.map((d) => [d.time, d.value])));
	}

	const hasTrigger = conditions.some(
		(c) => c.operator === 'crossover' || c.operator === 'crossunder',
	);

	const signals: ComputedSignal[] = [];
	let prevAllMet = false;

	for (let i = 1; i < ohlcv.length; i++) {
		const cur = ohlcv[i];
		const prev = ohlcv[i - 1];
		let allMet = true;

		for (const cond of conditions) {
			const lMap = indexed.get(refToKey(cond.left));
			const lCur = lMap?.get(cur.time);
			const lPrev = lMap?.get(prev.time);
			if (lCur === undefined) { allMet = false; break; }

			let rCur: number;
			let rPrev: number | undefined;

			if (cond.right.kind === 'value') {
				rCur = cond.right.value;
				rPrev = cond.right.value;
			} else {
				const rMap = indexed.get(refToKey(cond.right as IndicatorRef));
				const rv = rMap?.get(cur.time);
				if (rv === undefined) { allMet = false; break; }
				rCur = rv;
				rPrev = rMap?.get(prev.time);
			}

			let condMet: boolean;
			switch (cond.operator) {
				case 'crossover':
					condMet = lCur > rCur && lPrev !== undefined && rPrev !== undefined && lPrev <= rPrev;
					break;
				case 'crossunder':
					condMet = lCur < rCur && lPrev !== undefined && rPrev !== undefined && lPrev >= rPrev;
					break;
				case 'above':
					condMet = lCur > rCur;
					break;
				case 'below':
					condMet = lCur < rCur;
					break;
			}

			if (!condMet) { allMet = false; break; }
		}

		// Fire: either on trigger bar OR on transition (no trigger conditions)
		const fires = hasTrigger ? allMet : (allMet && !prevAllMet);

		if (fires) {
			// Determine signal type
			const hasCrossover = conditions.some((c) => c.operator === 'crossover');
			const hasCrossunder = conditions.some((c) => c.operator === 'crossunder');
			let type: 'buy' | 'sell';
			if (hasCrossover && !hasCrossunder) type = 'buy';
			else if (hasCrossunder && !hasCrossover) type = 'sell';
			else type = signalDir === 'sell' ? 'sell' : 'buy';

			if (signalDir === 'both' || signalDir === type) {
				signals.push({ time: cur.time, type, barIndex: i });
			}
		}

		prevAllMet = allMet;
	}

	// Current state: are all above/below conditions true on the last bar?
	let currentlyActive = false;
	if (ohlcv.length > 0) {
		const lastBar = ohlcv[ohlcv.length - 1];
		currentlyActive = conditions.every((cond) => {
			const lMap = indexed.get(refToKey(cond.left));
			const lVal = lMap?.get(lastBar.time);
			if (lVal === undefined) return false;

			let rVal: number;
			if (cond.right.kind === 'value') {
				rVal = cond.right.value;
			} else {
				const rMap = indexed.get(refToKey(cond.right as IndicatorRef));
				const rv = rMap?.get(lastBar.time);
				if (rv === undefined) return false;
				rVal = rv;
			}

			switch (cond.operator) {
				case 'above': return lVal > rVal;
				case 'below': return lVal < rVal;
				// For crossover/crossunder, check if it happened on the last bar
				case 'crossover': {
					if (ohlcv.length < 2) return false;
					const prevBar = ohlcv[ohlcv.length - 2];
					const lPrev = lMap?.get(prevBar.time);
					const rMap = indexed.get(cond.right.kind !== 'value' ? refToKey(cond.right as IndicatorRef) : '');
					const rPrev = cond.right.kind === 'value' ? cond.right.value : rMap?.get(prevBar.time);
					return lVal > rVal && lPrev !== undefined && rPrev !== undefined && lPrev <= rPrev;
				}
				case 'crossunder': {
					if (ohlcv.length < 2) return false;
					const prevBar = ohlcv[ohlcv.length - 2];
					const lPrev = lMap?.get(prevBar.time);
					const rMap = indexed.get(cond.right.kind !== 'value' ? refToKey(cond.right as IndicatorRef) : '');
					const rPrev = cond.right.kind === 'value' ? cond.right.value : rMap?.get(prevBar.time);
					return lVal < rVal && lPrev !== undefined && rPrev !== undefined && lPrev >= rPrev;
				}
			}
		});
	}

	return { signals, seriesMap, currentlyActive };
}

/**
 * Build chart indicator series from the computed series map.
 * Only includes series for indicators referenced in conditions.
 */
export function buildChartSeries(
	seriesMap: Map<string, IndicatorDataPoint[]>,
	conditions: ParsedCondition[],
	fromTime: number,
): ChartIndicatorSeries[] {
	const result: ChartIndicatorSeries[] = [];
	const seen = new Set<string>();
	let colorIdx = 0;

	const refs: IndicatorRef[] = [];
	for (const cond of conditions) {
		refs.push(cond.left);
		if (cond.right.kind !== 'value') refs.push(cond.right as IndicatorRef);
	}

	for (const ref of refs) {
		if (ref.kind === 'price') continue;
		const key = refToKey(ref);
		if (seen.has(key)) continue;
		seen.add(key);

		const data = (seriesMap.get(key) ?? []).filter((d) => d.time >= fromTime);
		if (data.length === 0) continue;

		result.push({
			name: refToLabel(ref),
			data,
			color: CHART_COLORS[colorIdx % CHART_COLORS.length],
			overlay: isOverlayKind(ref.kind),
		});
		colorIdx++;
	}

	return result;
}

// ─── PineScript v6 Generator ─────────────────────────────────────────────────

/**
 * Generate PineScript v6 code from parsed conditions.
 */
export function generatePineScript(
	description: string,
	conditions: ParsedCondition[],
	signalDir: 'buy' | 'sell' | 'both',
): string {
	const title = description.length > 60 ? description.substring(0, 57) + '...' : description;
	const lines: string[] = [
		'//@version=6',
		`indicator("Custom: ${title}", overlay=true, shorttitle="Custom")`,
		'',
		'// === Indicator Computations ===',
	];

	// Track variable names and multi-value declarations already emitted
	const varNames = new Map<string, string>(); // refKey → varName
	const multiDeclared = new Set<string>();     // e.g. 'macd', 'bb_20'

	function ensureVar(ref: IndicatorRef): string {
		const key = refToKey(ref);
		if (varNames.has(key)) return varNames.get(key)!;

		const p = ref.period;

		switch (ref.kind) {
			case 'price':
				varNames.set(key, 'close');
				return 'close';

			case 'ema': {
				const n = p ?? 20;
				const v = `ema${n}`;
				lines.push(`${v} = ta.ema(close, ${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'sma': {
				const n = p ?? 20;
				const v = `sma${n}`;
				lines.push(`${v} = ta.sma(close, ${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'rsi': {
				const n = p ?? 14;
				const v = `rsi${n}`;
				lines.push(`${v} = ta.rsi(close, ${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'macd':
			case 'macd_signal': {
				if (!multiDeclared.has('macd')) {
					lines.push('[macdLine, macdSignal, macdHist] = ta.macd(close, 12, 26, 9)');
					multiDeclared.add('macd');
					varNames.set('macd_default', 'macdLine');
					varNames.set('macd_signal_default', 'macdSignal');
				}
				return ref.kind === 'macd' ? 'macdLine' : 'macdSignal';
			}

			case 'bb_upper':
			case 'bb_middle':
			case 'bb_lower': {
				const n = p ?? 20;
				const tag = `bb_${n}`;
				if (!multiDeclared.has(tag)) {
					lines.push(`[bbUpper${n}, bbMid${n}, bbLower${n}] = ta.bb(close, ${n}, 2)`);
					multiDeclared.add(tag);
					varNames.set(`bb_upper_${n}`, `bbUpper${n}`);
					varNames.set(`bb_middle_${n}`, `bbMid${n}`);
					varNames.set(`bb_lower_${n}`, `bbLower${n}`);
				}
				const suffix = ref.kind === 'bb_upper' ? `Upper${n}` : ref.kind === 'bb_middle' ? `Mid${n}` : `Lower${n}`;
				return `bb${suffix}`;
			}

			case 'vwap': {
				const v = 'vwapVal';
				lines.push(`${v} = ta.vwap(close)`);
				varNames.set(key, v);
				return v;
			}

			case 'atr': {
				const n = p ?? 14;
				const v = `atr${n}`;
				lines.push(`${v} = ta.atr(${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'obv': {
				const v = 'obvVal';
				lines.push(`${v} = ta.obv`);
				varNames.set(key, v);
				return v;
			}

			case 'adx': {
				const n = p ?? 14;
				const tag = `adx_${n}`;
				if (!multiDeclared.has(tag)) {
					lines.push(`[adx${n}, diPlus${n}, diMinus${n}] = ta.dmi(${n}, ${n})`);
					multiDeclared.add(tag);
					varNames.set(`adx_${n}`, `adx${n}`);
				}
				return `adx${n}`;
			}

			case 'cci': {
				const n = p ?? 20;
				const v = `cci${n}`;
				lines.push(`${v} = ta.cci(high, low, close, ${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'mfi': {
				const n = p ?? 14;
				const v = `mfi${n}`;
				lines.push(`${v} = ta.mfi(high, low, close, volume, ${n})`);
				varNames.set(key, v);
				return v;
			}

			case 'supertrend': {
				if (!multiDeclared.has('supertrend')) {
					lines.push('[stVal, stDir] = ta.supertrend(3, 10)');
					multiDeclared.add('supertrend');
					varNames.set('supertrend_default', 'stVal');
				}
				return 'stVal';
			}

			default:
				return 'close';
		}
	}

	// First pass: declare all variables by calling ensureVar
	// Build condition expressions
	const condExprs: string[] = [];
	for (const cond of conditions) {
		const lVar = ensureVar(cond.left);
		const rStr = cond.right.kind === 'value'
			? String(cond.right.value)
			: ensureVar(cond.right as IndicatorRef);

		let expr: string;
		switch (cond.operator) {
			case 'crossover': expr = `ta.crossover(${lVar}, ${rStr})`; break;
			case 'crossunder': expr = `ta.crossunder(${lVar}, ${rStr})`; break;
			case 'above': expr = `${lVar} > ${rStr}`; break;
			case 'below': expr = `${lVar} < ${rStr}`; break;
		}
		condExprs.push(expr!);
	}

	// Condition declarations
	lines.push('');
	lines.push('// === Signal Conditions ===');
	for (let i = 0; i < condExprs.length; i++) {
		lines.push(`cond${i + 1} = ${condExprs[i]}`);
	}

	// Combined signal
	const combined = condExprs.join(' and ');
	lines.push('');
	lines.push('// === Combined Signal ===');
	if (signalDir === 'buy' || signalDir === 'both') lines.push(`buySignal = ${combined}`);
	if (signalDir === 'sell' || signalDir === 'both') lines.push(`sellSignal = ${combined}`);

	// Plots for overlay indicators
	lines.push('');
	lines.push('// === Plots ===');
	const plotted = new Set<string>();
	for (const cond of conditions) {
		const refs: IndicatorRef[] = [cond.left];
		if (cond.right.kind !== 'value') refs.push(cond.right as IndicatorRef);

		for (const ref of refs) {
			if (ref.kind === 'price') continue;
			const key = refToKey(ref);
			if (plotted.has(key)) continue;
			plotted.add(key);

			const varName = varNames.get(key);
			if (!varName) continue;

			if (isOverlayKind(ref.kind)) {
				lines.push(`plot(${varName}, title="${refToLabel(ref)}", linewidth=1)`);
			} else {
				// Non-overlay: add as comment guidance
				lines.push(`// Add ${refToLabel(ref)} to a separate pane: plot(${varName}, title="${refToLabel(ref)}")`);
			}
		}
	}

	// Signal markers and alerts
	lines.push('');
	lines.push('// === Signal Markers ===');
	if (signalDir === 'buy' || signalDir === 'both') {
		lines.push('plotshape(buySignal, title="Buy", location=location.belowbar, color=color.green, style=shape.triangleup, size=size.small)');
		lines.push('alertcondition(buySignal, title="Buy Alert", message="Custom Indicator Buy Signal")');
	}
	if (signalDir === 'sell' || signalDir === 'both') {
		lines.push('plotshape(sellSignal, title="Sell", location=location.abovebar, color=color.red, style=shape.triangledown, size=size.small)');
		lines.push('alertcondition(sellSignal, title="Sell Alert", message="Custom Indicator Sell Signal")');
	}

	return lines.join('\n');
}
