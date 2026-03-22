// Post-Trade Analyst Data Tests — T-1303

import { describe, it, expect } from 'vitest';
import {
	calcTimingEfficiency,
	replayIndicatorsAt,
	findCandleIndex,
	findExitCandleIndex,
	dateToUnixDay,
	parseCoachingResponse,
	buildFallbackCoaching,
} from './postTradeAnalyst.data';
import type { JournalEntry } from '../portfolio/journal';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandle(time: number, open: number, high: number, low: number, close: number, volume = 1000): OHLCV {
	return { time, open, high, low, close, volume };
}

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id: 'test-id',
		userId: 'default',
		symbol: 'BTCUSDT',
		direction: 'long',
		entryPrice: 100,
		exitPrice: null,
		size: 1,
		pnlUSD: null,
		rMultiple: null,
		setupType: 'pullback',
		emotion: 'calm',
		preNotes: 'Bullish setup',
		postNotes: null,
		mistakes: [],
		followedPlan: true,
		tradeDate: '2024-01-15',
		createdAt: '2024-01-15T00:00:00Z',
		...overrides,
	};
}

// ─── dateToUnixDay ────────────────────────────────────────────────────────────

describe('dateToUnixDay', () => {
	it('converts YYYY-MM-DD to UTC midnight unix seconds', () => {
		const result = dateToUnixDay('2024-01-15');
		// 2024-01-15T00:00:00Z
		expect(result).toBe(new Date('2024-01-15T00:00:00Z').getTime() / 1000);
	});

	it('is consistent for different dates', () => {
		const day1 = dateToUnixDay('2024-01-15');
		const day2 = dateToUnixDay('2024-01-16');
		expect(day2 - day1).toBe(86400);
	});
});

// ─── findCandleIndex ──────────────────────────────────────────────────────────

describe('findCandleIndex', () => {
	const DAY1 = dateToUnixDay('2024-01-15');
	const DAY2 = dateToUnixDay('2024-01-16');
	const DAY3 = dateToUnixDay('2024-01-17');

	const ohlcv: OHLCV[] = [
		makeCandle(DAY1, 95, 105, 90, 100),
		makeCandle(DAY2, 100, 110, 95, 108),
		makeCandle(DAY3, 108, 115, 105, 112),
	];

	it('finds the exact day', () => {
		expect(findCandleIndex(ohlcv, DAY2)).toBe(1);
	});

	it('returns 0 for empty ohlcv', () => {
		expect(findCandleIndex([], DAY1)).toBe(0);
	});

	it('falls back to closest candle when no exact match', () => {
		// Target 2 days after the last candle — no candle falls in that window
		const farFuture = DAY3 + 86400 * 2;
		const result = findCandleIndex(ohlcv, farFuture);
		expect(result).toBe(2); // DAY3 (index 2) is closest
	});
});

// ─── findExitCandleIndex ──────────────────────────────────────────────────────

describe('findExitCandleIndex', () => {
	const BASE = 1_700_000_000;
	const ohlcv: OHLCV[] = [
		makeCandle(BASE + 0,      95,  105, 90,  100),
		makeCandle(BASE + 86400,  100, 110, 95,  108),
		makeCandle(BASE + 172800, 108, 120, 105, 115),  // exit near here
		makeCandle(BASE + 259200, 115, 125, 110, 120),
	];

	it('finds candle where close matches exit price within 1%', () => {
		// exit at 115 → candle at index 2 has close=115
		expect(findExitCandleIndex(ohlcv, 0, 115)).toBe(2);
	});

	it('finds candle by high within 1%', () => {
		// ohlcv[2].high=120, so exit=120 matches at index 2 (not 3)
		expect(findExitCandleIndex(ohlcv, 0, 120)).toBe(2);
	});

	it('falls back to entryIndex + defaultOffset when no match', () => {
		// exit at 9999 — no match
		expect(findExitCandleIndex(ohlcv, 0, 9999, 2)).toBe(2);
	});
});

// ─── calcTimingEfficiency (LONG) ──────────────────────────────────────────────

describe('calcTimingEfficiency — long trade', () => {
	const BASE = 1_700_000_000;
	// Entry candle: open=95, high=105, low=90, close=100
	// Exit candle: open=110, high=120, low=108, close=115
	const ohlcv: OHLCV[] = [
		makeCandle(BASE,          95,  105, 90,  100),
		makeCandle(BASE + 86400,  100, 110, 95,  108),
		makeCandle(BASE + 172800, 108, 120, 105, 115),
	];

	it('calculates timing efficiency correctly for a winning long', () => {
		// optimalEntry = min low in window [0,1] = min(90, 95) = 90
		// optimalExit = max high in window [1,2] = max(110, 120) = 120
		// maxPossiblePnL = (120 - 90) * 1 = 30
		// actual entry=100, exit=115, pnlUSD=15
		const entry = makeEntry({ entryPrice: 100, exitPrice: 115, pnlUSD: 15, size: 1 });
		const result = calcTimingEfficiency(entry, ohlcv, 0, 2);

		expect(result.hasExitData).toBe(true);
		expect(result.optimalEntryPrice).toBeLessThanOrEqual(95); // ≤ min of window
		expect(result.optimalExitPrice).toBeGreaterThanOrEqual(115); // ≥ max of window
		expect(result.maxPossiblePnL).toBeGreaterThan(15);
		expect(result.timingEfficiencyPct).toBeGreaterThan(0);
		expect(result.timingEfficiencyPct).toBeLessThanOrEqual(100);
	});

	it('returns 0 timing efficiency for open trade', () => {
		const entry = makeEntry({ entryPrice: 100, exitPrice: null, pnlUSD: null, size: 1 });
		const result = calcTimingEfficiency(entry, ohlcv, 0, 0);
		expect(result.hasExitData).toBe(false);
		expect(result.timingEfficiencyPct).toBe(0);
	});

	it('returns empty bundle for empty ohlcv', () => {
		const entry = makeEntry({ entryPrice: 100, exitPrice: 110, pnlUSD: 10, size: 1 });
		const result = calcTimingEfficiency(entry, [], 0, 0);
		expect(result.maxPossiblePnL).toBe(0);
		expect(result.timingEfficiencyPct).toBe(0);
	});

	it('clamps timing efficiency to 0-100', () => {
		// Even if actual > max possible, clamp to 100
		const entry = makeEntry({ entryPrice: 100, exitPrice: 150, pnlUSD: 50, size: 1 });
		const result = calcTimingEfficiency(entry, ohlcv, 0, 2);
		expect(result.timingEfficiencyPct).toBeLessThanOrEqual(100);
		expect(result.timingEfficiencyPct).toBeGreaterThanOrEqual(0);
	});
});

// ─── calcTimingEfficiency (SHORT) ─────────────────────────────────────────────

describe('calcTimingEfficiency — short trade', () => {
	const BASE = 1_700_000_000;
	const ohlcv: OHLCV[] = [
		makeCandle(BASE,          110, 120, 105, 115),  // entry
		makeCandle(BASE + 86400,  115, 118, 100, 108),
		makeCandle(BASE + 172800, 108, 112, 90,  95),   // exit
	];

	it('calculates timing efficiency for a winning short', () => {
		// optimalEntry for short = max high in entry window = max(120, 118) = 120
		// optimalExit for short = min low in exit window = min(100, 90) = 90
		// maxPossiblePnL = (120 - 90) * 1 = 30
		// actual entry=115, exit=95, pnlUSD=20
		const entry = makeEntry({ direction: 'short', entryPrice: 115, exitPrice: 95, pnlUSD: 20, size: 1 });
		const result = calcTimingEfficiency(entry, ohlcv, 0, 2);

		expect(result.hasExitData).toBe(true);
		expect(result.optimalEntryPrice).toBeGreaterThanOrEqual(115);
		expect(result.optimalExitPrice).toBeLessThanOrEqual(100);
		expect(result.maxPossiblePnL).toBeGreaterThan(0);
		expect(result.timingEfficiencyPct).toBeGreaterThan(0);
	});
});

// ─── replayIndicatorsAt ───────────────────────────────────────────────────────

describe('replayIndicatorsAt', () => {
	// Generate 60 synthetic candles with a simple upward trend
	const ohlcv: OHLCV[] = Array.from({ length: 60 }, (_, i) => {
		const price = 100 + i;
		return makeCandle(1_700_000_000 + i * 86400, price, price + 2, price - 2, price + 1);
	});

	it('returns a signal snapshot at the given index', () => {
		const snap = replayIndicatorsAt(ohlcv, 59);
		expect(snap.timestamp).toBe(ohlcv[59].time);
		expect(snap.price).toBe(ohlcv[59].close);
	});

	it('computes RSI when enough data available', () => {
		const snap = replayIndicatorsAt(ohlcv, 30);
		expect(snap.rsi14).not.toBeNull();
		if (snap.rsi14 !== null) {
			expect(snap.rsi14).toBeGreaterThanOrEqual(0);
			expect(snap.rsi14).toBeLessThanOrEqual(100);
		}
	});

	it('returns null indicators when not enough data', () => {
		const snap = replayIndicatorsAt(ohlcv, 5); // only 6 candles
		expect(snap.rsi14).toBeNull();
		expect(snap.ema50).toBeNull();
	});

	it('computes EMA20 when >= 20 candles available', () => {
		const snap = replayIndicatorsAt(ohlcv, 25); // 26 candles
		expect(snap.ema20).not.toBeNull();
	});

	it('computes MACD when >= 35 candles available', () => {
		const snap = replayIndicatorsAt(ohlcv, 40);
		expect(snap.macdLine).not.toBeNull();
		expect(snap.macdSignal).not.toBeNull();
	});
});

// ─── parseCoachingResponse ────────────────────────────────────────────────────

describe('parseCoachingResponse', () => {
	it('parses a valid JSON coaching response', () => {
		const raw = JSON.stringify({
			thesisAccuracyScore: 75,
			wentWell: ['Good entry timing', 'Followed plan'],
			toImprove: ['Exit too early'],
			keyLesson: 'Let winners run.',
			coachingFeedback: '## Analysis\nGood trade overall.',
		});
		const result = parseCoachingResponse(raw);
		expect(result).not.toBeNull();
		expect(result!.thesisAccuracyScore).toBe(75);
		expect(result!.wentWell).toHaveLength(2);
		expect(result!.toImprove).toHaveLength(1);
		expect(result!.keyLesson).toBe('Let winners run.');
	});

	it('extracts JSON embedded in surrounding text', () => {
		const raw = `Here is the analysis:\n${JSON.stringify({ thesisAccuracyScore: 60, wentWell: ['ok'], toImprove: [], keyLesson: 'test', coachingFeedback: 'feedback' })}\nEnd.`;
		const result = parseCoachingResponse(raw);
		expect(result).not.toBeNull();
		expect(result!.thesisAccuracyScore).toBe(60);
	});

	it('clamps thesisAccuracyScore to 0-100', () => {
		const raw = JSON.stringify({ thesisAccuracyScore: 150, wentWell: [], toImprove: [], keyLesson: '', coachingFeedback: '' });
		const result = parseCoachingResponse(raw);
		expect(result!.thesisAccuracyScore).toBe(100);
	});

	it('clamps negative score to 0', () => {
		const raw = JSON.stringify({ thesisAccuracyScore: -50, wentWell: [], toImprove: [], keyLesson: '', coachingFeedback: '' });
		const result = parseCoachingResponse(raw);
		expect(result!.thesisAccuracyScore).toBe(0);
	});

	it('returns null for invalid JSON', () => {
		expect(parseCoachingResponse('not json at all')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseCoachingResponse('')).toBeNull();
	});

	it('handles missing fields gracefully', () => {
		const raw = JSON.stringify({ thesisAccuracyScore: 50 });
		const result = parseCoachingResponse(raw);
		expect(result).not.toBeNull();
		expect(result!.wentWell).toEqual([]);
		expect(result!.toImprove).toEqual([]);
	});
});

// ─── buildFallbackCoaching ────────────────────────────────────────────────────

describe('buildFallbackCoaching', () => {
	it('recognises a winning trade', () => {
		const entry = makeEntry({ pnlUSD: 500, followedPlan: true, emotion: 'calm' });
		const timing = calcTimingEfficiency(entry, [], 0, 0);
		// Since no OHLCV, timing is empty but pnlUSD=500 → win
		const coaching = buildFallbackCoaching(entry, { ...timing, actualPnlUSD: 500 });
		expect(coaching.thesisAccuracyScore).toBeGreaterThan(50);
		expect(coaching.coachingFeedback).toContain('Winner');
		expect(coaching.wentWell.length).toBeGreaterThan(0);
	});

	it('recognises a losing trade', () => {
		const entry = makeEntry({ pnlUSD: -200, followedPlan: false, mistakes: ['moved stop', 'oversized'] });
		const timing = calcTimingEfficiency(entry, [], 0, 0);
		const coaching = buildFallbackCoaching(entry, { ...timing, actualPnlUSD: -200 });
		expect(coaching.thesisAccuracyScore).toBeLessThan(50);
		expect(coaching.coachingFeedback).toContain('Loser');
		expect(coaching.toImprove.length).toBeGreaterThan(0);
	});

	it('flags poor plan adherence', () => {
		const entry = makeEntry({ followedPlan: false });
		const timing = calcTimingEfficiency(entry, [], 0, 0);
		const coaching = buildFallbackCoaching(entry, { ...timing, actualPnlUSD: 100 });
		const allPoints = coaching.toImprove.join(' ');
		expect(allPoints).toContain('plan');
	});

	it('flags emotional trading', () => {
		const entry = makeEntry({ emotion: 'impulsive' });
		const timing = calcTimingEfficiency(entry, [], 0, 0);
		const coaching = buildFallbackCoaching(entry, { ...timing, actualPnlUSD: -100 });
		const allPoints = coaching.toImprove.join(' ');
		expect(allPoints).toContain('impulsive');
	});

	it('always returns non-empty wentWell and toImprove arrays', () => {
		const entry = makeEntry();
		const timing = calcTimingEfficiency(entry, [], 0, 0);
		const coaching = buildFallbackCoaching(entry, timing);
		expect(coaching.wentWell.length).toBeGreaterThan(0);
		expect(coaching.toImprove.length).toBeGreaterThan(0);
		expect(coaching.keyLesson).toBeTruthy();
	});
});
