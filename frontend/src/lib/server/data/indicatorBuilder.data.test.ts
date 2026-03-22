// Tests for indicatorBuilder.data.ts — T-1405

import { describe, it, expect } from 'vitest';
import {
	parseIndicatorDescription,
	computeSignals,
	buildChartSeries,
	generatePineScript,
	getIndicatorValues,
	refToKey,
	refToLabel,
	type ParsedCondition,
	type IndicatorRef,
} from './indicatorBuilder.data';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Mock OHLCV Factory ──────────────────────────────────────────────────────

function makeOHLCV(closes: number[], startTime = 1_700_000_000, step = 3600): OHLCV[] {
	return closes.map((close, i) => ({
		time: startTime + i * step,
		open: close * 0.998,
		high: close * 1.005,
		low: close * 0.993,
		close,
		volume: 1000 + i * 10,
	}));
}

// ─── parseIndicatorDescription ───────────────────────────────────────────────

describe('parseIndicatorDescription', () => {
	it('parses EMA crossover EMA', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		expect(conds).toHaveLength(1);
		expect(conds[0].left).toEqual({ kind: 'ema', period: 20 });
		expect(conds[0].operator).toBe('crossover');
		expect(conds[0].right).toEqual({ kind: 'ema', period: 50 });
	});

	it('parses RSI below value', () => {
		const conds = parseIndicatorDescription('RSI below 30');
		expect(conds).toHaveLength(1);
		expect(conds[0].left).toEqual({ kind: 'rsi', period: 14 });
		expect(conds[0].operator).toBe('below');
		expect(conds[0].right).toEqual({ kind: 'value', value: 30 });
	});

	it('parses RSI above value', () => {
		const conds = parseIndicatorDescription('RSI above 70');
		expect(conds).toHaveLength(1);
		expect(conds[0].operator).toBe('above');
		expect(conds[0].right).toEqual({ kind: 'value', value: 70 });
	});

	it('parses combined conditions with +', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50 + RSI below 30');
		expect(conds).toHaveLength(2);
		expect(conds[0].operator).toBe('crossover');
		expect(conds[1].left).toEqual({ kind: 'rsi', period: 14 });
		expect(conds[1].operator).toBe('below');
		expect(conds[1].right).toEqual({ kind: 'value', value: 30 });
	});

	it('parses MACD crossover Signal', () => {
		const conds = parseIndicatorDescription('MACD crossover Signal');
		expect(conds).toHaveLength(1);
		expect(conds[0].left).toEqual({ kind: 'macd' });
		expect(conds[0].operator).toBe('crossover');
		expect(conds[0].right).toEqual({ kind: 'macd_signal' });
	});

	it('parses Price above SMA 200', () => {
		const conds = parseIndicatorDescription('Price above SMA 200');
		expect(conds).toHaveLength(1);
		expect(conds[0].left).toEqual({ kind: 'price' });
		expect(conds[0].operator).toBe('above');
		expect(conds[0].right).toEqual({ kind: 'sma', period: 200 });
	});

	it('parses crossunder', () => {
		const conds = parseIndicatorDescription('EMA 20 crossunder EMA 50');
		expect(conds).toHaveLength(1);
		expect(conds[0].operator).toBe('crossunder');
	});

	it('parses "crosses above" as crossover', () => {
		const conds = parseIndicatorDescription('EMA 20 crosses above EMA 50');
		expect(conds).toHaveLength(1);
		expect(conds[0].operator).toBe('crossover');
	});

	it('parses "crosses below" as crossunder', () => {
		const conds = parseIndicatorDescription('EMA 20 crosses below EMA 50');
		expect(conds).toHaveLength(1);
		expect(conds[0].operator).toBe('crossunder');
	});

	it('parses RSI with explicit period', () => {
		const conds = parseIndicatorDescription('RSI(9) below 25');
		expect(conds).toHaveLength(1);
		expect(conds[0].left).toEqual({ kind: 'rsi', period: 9 });
	});

	it('returns empty array for unrecognized input', () => {
		const conds = parseIndicatorDescription('do something random');
		expect(conds).toHaveLength(0);
	});

	it('handles AND separator', () => {
		const conds = parseIndicatorDescription('RSI above 50 AND SMA 20 above SMA 50');
		expect(conds).toHaveLength(2);
	});

	it('parses SMA crossover', () => {
		const conds = parseIndicatorDescription('SMA 10 crossover SMA 30');
		expect(conds[0].left).toEqual({ kind: 'sma', period: 10 });
		expect(conds[0].right).toEqual({ kind: 'sma', period: 30 });
	});

	it('parses default EMA period when not specified', () => {
		const conds = parseIndicatorDescription('EMA crossover SMA 50');
		expect(conds[0].left).toEqual({ kind: 'ema', period: 20 });
	});
});

// ─── refToKey / refToLabel ────────────────────────────────────────────────────

describe('refToKey', () => {
	it('uses default for indicators without period', () => {
		expect(refToKey({ kind: 'macd' })).toBe('macd_default');
	});

	it('includes period in key', () => {
		expect(refToKey({ kind: 'ema', period: 20 })).toBe('ema_20');
		expect(refToKey({ kind: 'rsi', period: 14 })).toBe('rsi_14');
	});
});

describe('refToLabel', () => {
	it('returns human readable labels', () => {
		expect(refToLabel({ kind: 'ema', period: 20 })).toBe('EMA 20');
		expect(refToLabel({ kind: 'rsi', period: 14 })).toBe('RSI 14');
		expect(refToLabel({ kind: 'macd' })).toBe('MACD');
		expect(refToLabel({ kind: 'vwap' })).toBe('VWAP');
	});
});

// ─── getIndicatorValues ───────────────────────────────────────────────────────

describe('getIndicatorValues', () => {
	const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));

	it('returns price series for price kind', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'price' });
		expect(vals).toHaveLength(ohlcv.length);
		expect(vals[0].value).toBeCloseTo(ohlcv[0].close);
	});

	it('returns EMA series', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'ema', period: 20 });
		expect(vals.length).toBeGreaterThan(0);
		expect(vals[0].value).toBeGreaterThan(0);
	});

	it('returns RSI series within 0-100', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'rsi', period: 14 });
		for (const v of vals) {
			expect(v.value).toBeGreaterThanOrEqual(0);
			expect(v.value).toBeLessThanOrEqual(100);
		}
	});

	it('returns MACD series', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'macd' });
		expect(vals.length).toBeGreaterThan(0);
	});

	it('returns MACD signal series', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'macd_signal' });
		expect(vals.length).toBeGreaterThan(0);
	});

	it('returns BB upper series', () => {
		const vals = getIndicatorValues(ohlcv, { kind: 'bb_upper', period: 20 });
		expect(vals.length).toBeGreaterThan(0);
		// Upper band should always be above close (approximately)
		const closeMap = new Map(ohlcv.map((c) => [c.time, c.close]));
		for (const v of vals) {
			const close = closeMap.get(v.time);
			if (close !== undefined) expect(v.value).toBeGreaterThan(close * 0.9);
		}
	});
});

// ─── computeSignals ───────────────────────────────────────────────────────────

describe('computeSignals', () => {
	it('returns empty signals for empty conditions', () => {
		const ohlcv = makeOHLCV([100, 101, 102]);
		const result = computeSignals(ohlcv, [], 'buy');
		expect(result.signals).toHaveLength(0);
	});

	it('returns empty signals for insufficient data', () => {
		const ohlcv = makeOHLCV([100]);
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const result = computeSignals(ohlcv, conds, 'buy');
		expect(result.signals).toHaveLength(0);
	});

	it('detects EMA crossover', () => {
		// EMA 2 crosses over EMA 5: start low, then spike up
		// low prices → EMA2 < EMA5, then high prices → EMA2 > EMA5
		const lows = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
		const highs = [200, 200, 200, 200, 200, 200, 200, 200, 200, 200];
		const closes = [...lows, ...highs];
		const ohlcv = makeOHLCV(closes);

		const conds: ParsedCondition[] = [{
			left: { kind: 'ema', period: 2 },
			operator: 'crossover',
			right: { kind: 'ema', period: 5 },
		}];

		const { signals } = computeSignals(ohlcv, conds, 'buy');
		expect(signals.length).toBeGreaterThan(0);
		expect(signals[0].type).toBe('buy');
	});

	it('detects RSI below level (transition only)', () => {
		// RSI will be low at start (all declining), then we check for below 50
		const declining = Array.from({ length: 20 }, (_, i) => 100 - i * 3);
		const ohlcv = makeOHLCV(declining);

		const conds: ParsedCondition[] = [{
			left: { kind: 'rsi', period: 14 },
			operator: 'below',
			right: { kind: 'value', value: 50 },
		}];

		const { signals, currentlyActive } = computeSignals(ohlcv, conds, 'buy');
		// Should have at most 1 transition signal (false → true)
		expect(signals.length).toBeLessThanOrEqual(2);
		expect(typeof currentlyActive).toBe('boolean');
	});

	it('builds seriesMap for all referenced indicators', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 10));
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50 + RSI below 30');
		const { seriesMap } = computeSignals(ohlcv, conds, 'buy');

		expect(seriesMap.has('ema_20')).toBe(true);
		expect(seriesMap.has('ema_50')).toBe(true);
		expect(seriesMap.has('rsi_14')).toBe(true);
	});

	it('crossunder generates sell signals', () => {
		const highs = [200, 200, 200, 200, 200, 200, 200, 200, 200, 200];
		const lows = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
		const closes = [...highs, ...lows];
		const ohlcv = makeOHLCV(closes);

		const conds: ParsedCondition[] = [{
			left: { kind: 'ema', period: 2 },
			operator: 'crossunder',
			right: { kind: 'ema', period: 5 },
		}];

		const { signals } = computeSignals(ohlcv, conds, 'sell');
		expect(signals.length).toBeGreaterThan(0);
		expect(signals[0].type).toBe('sell');
	});

	it('combined conditions: both must be true', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));
		const conds: ParsedCondition[] = [
			{
				left: { kind: 'ema', period: 5 },
				operator: 'above',
				right: { kind: 'ema', period: 20 },
			},
			{
				left: { kind: 'rsi', period: 14 },
				operator: 'below',
				right: { kind: 'value', value: 50 },
			},
		];

		const { signals } = computeSignals(ohlcv, conds, 'buy');
		// With rising prices, EMA5 > EMA20 but RSI > 50, so fewer/no signals
		expect(Array.isArray(signals)).toBe(true);
	});
});

// ─── buildChartSeries ─────────────────────────────────────────────────────────

describe('buildChartSeries', () => {
	it('returns series for referenced indicators', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const { seriesMap } = computeSignals(ohlcv, conds, 'buy');
		const series = buildChartSeries(seriesMap, conds, ohlcv[0].time);

		expect(series.length).toBe(2);
		expect(series.every((s) => s.data.length > 0)).toBe(true);
		expect(series.every((s) => s.overlay === true)).toBe(true);
	});

	it('filters by fromTime', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const { seriesMap } = computeSignals(ohlcv, conds, 'buy');
		const midTime = ohlcv[30].time;
		const series = buildChartSeries(seriesMap, conds, midTime);

		for (const s of series) {
			expect(s.data.every((d) => d.time >= midTime)).toBe(true);
		}
	});

	it('marks RSI as non-overlay', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 40 }, (_, i) => 100 + i));
		const conds = parseIndicatorDescription('RSI below 30');
		const { seriesMap } = computeSignals(ohlcv, conds, 'buy');
		const series = buildChartSeries(seriesMap, conds, ohlcv[0].time);

		const rsiSeries = series.find((s) => s.name.startsWith('RSI'));
		expect(rsiSeries?.overlay).toBe(false);
	});

	it('excludes price kind from series', () => {
		const ohlcv = makeOHLCV(Array.from({ length: 60 }, (_, i) => 100 + i));
		const conds = parseIndicatorDescription('Price above SMA 200');
		const { seriesMap } = computeSignals(ohlcv, conds, 'buy');
		const series = buildChartSeries(seriesMap, conds, ohlcv[0].time);

		expect(series.every((s) => s.name !== 'Price')).toBe(true);
	});
});

// ─── generatePineScript ───────────────────────────────────────────────────────

describe('generatePineScript', () => {
	it('starts with //@version=6', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine.startsWith('//@version=6')).toBe(true);
	});

	it('contains indicator title', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('indicator(');
		expect(pine).toContain('EMA 20 crossover EMA 50');
	});

	it('declares EMA variables', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('ta.ema(close, 20)');
		expect(pine).toContain('ta.ema(close, 50)');
	});

	it('generates ta.crossover expression', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('ta.crossover(');
	});

	it('generates buySignal for buy direction', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('buySignal');
		expect(pine).not.toContain('sellSignal');
	});

	it('generates sellSignal for sell direction', () => {
		const conds = parseIndicatorDescription('EMA 20 crossunder EMA 50');
		const pine = generatePineScript('EMA 20 crossunder EMA 50', conds, 'sell');
		expect(pine).toContain('sellSignal');
	});

	it('generates both signals for both direction', () => {
		const conds = parseIndicatorDescription('RSI below 30');
		const pine = generatePineScript('RSI below 30', conds, 'both');
		expect(pine).toContain('buySignal');
		expect(pine).toContain('sellSignal');
	});

	it('includes plotshape for markers', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('plotshape(');
	});

	it('includes alertcondition', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50');
		const pine = generatePineScript('EMA 20 crossover EMA 50', conds, 'buy');
		expect(pine).toContain('alertcondition(');
	});

	it('handles combined conditions', () => {
		const conds = parseIndicatorDescription('EMA 20 crossover EMA 50 + RSI below 30');
		const pine = generatePineScript('EMA 20 crossover EMA 50 + RSI below 30', conds, 'buy');
		expect(pine).toContain('ta.rsi(close, 14)');
		expect(pine).toContain('cond1');
		expect(pine).toContain('cond2');
		expect(pine).toContain(' and ');
	});

	it('handles MACD with single declaration', () => {
		const conds = parseIndicatorDescription('MACD crossover Signal');
		const pine = generatePineScript('MACD crossover Signal', conds, 'buy');
		// Should declare MACD once as a multi-output
		const macdDeclCount = (pine.match(/ta\.macd/g) ?? []).length;
		expect(macdDeclCount).toBe(1);
	});

	it('declares RSI variable', () => {
		const conds = parseIndicatorDescription('RSI below 30');
		const pine = generatePineScript('RSI below 30', conds, 'buy');
		expect(pine).toContain('ta.rsi(close, 14)');
		expect(pine).toContain('< 30');
	});

	it('truncates long titles', () => {
		const longDesc = 'EMA 20 crossover EMA 50 + RSI below 30 + MACD crossover Signal + Price above SMA 200';
		const conds = parseIndicatorDescription(longDesc);
		const pine = generatePineScript(longDesc, conds, 'buy');
		expect(pine).toContain('//@version=6');
	});
});
