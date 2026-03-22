// Candlestick Pattern Tests — T-804
import { describe, it, expect } from 'vitest';
import { detectPatterns, summarisePatterns } from './candlePatterns';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function c(open: number, high: number, low: number, close: number, i = 0): OHLCV {
	return { time: i * 86400, open, high, low, close, volume: 1000 };
}

/** Filler neutral candle */
function filler(price: number, i = 0): OHLCV {
	return c(price, price * 1.005, price * 0.995, price, i);
}

// ─── detectPatterns ───────────────────────────────────────────────────────────

describe('detectPatterns', () => {
	it('returns empty array for fewer than 3 candles', () => {
		const candles = [filler(100, 0), filler(100, 1)];
		expect(detectPatterns(candles)).toEqual([]);
	});

	// ── Doji ────────────────────────────────────────────────────────────────────
	it('detects Doji (open ≈ close)', () => {
		const candles = [filler(100, 0), filler(100, 1), c(100, 110, 90, 100.5, 2)];
		const m = detectPatterns(candles);
		expect(m.some(p => p.pattern === 'Doji')).toBe(true);
	});

	// ── Marubozu ─────────────────────────────────────────────────────────────────
	it('detects Bullish Marubozu', () => {
		// No shadows: open = low, close = high
		const candles = [filler(100, 0), filler(100, 1), c(100, 110, 100, 110, 2)];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bullish Marubozu');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
	});

	it('detects Bearish Marubozu', () => {
		const candles = [filler(100, 0), filler(100, 1), c(110, 110, 100, 100, 2)];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bearish Marubozu');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Hammer ───────────────────────────────────────────────────────────────────
	it('detects Hammer (small body top, long lower shadow)', () => {
		// Price going down: older candle much higher
		const old = filler(120, 0);
		const prev = filler(110, 1);
		// Hammer: open=105, close=107 (small bullish body at top), low=90, high=108
		const hammer = c(105, 108, 90, 107, 2);
		const m = detectPatterns([old, prev, hammer]);
		const p = m.find(x => x.pattern === 'Hammer');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
	});

	// ── Shooting Star ─────────────────────────────────────────────────────────────
	it('detects Shooting Star (small bearish body bottom, long upper shadow)', () => {
		const candles = [
			filler(100, 0), filler(102, 1),
			// open=108, high=120, low=106, close=107 (small bearish at bottom, long upper shadow)
			c(108, 120, 106, 107, 2),
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Shooting Star');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Bullish Engulfing ─────────────────────────────────────────────────────────
	it('detects Bullish Engulfing', () => {
		const candles = [
			filler(100, 0),
			c(105, 106, 98, 99, 1),   // bearish: open=105, close=99
			c(97, 110, 97, 108, 2),   // bullish: open < prev close, close > prev open
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bullish Engulfing');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
		expect(p!.confidence).toBeGreaterThan(0.7);
	});

	// ── Bearish Engulfing ─────────────────────────────────────────────────────────
	it('detects Bearish Engulfing', () => {
		const candles = [
			filler(100, 0),
			c(99, 106, 98, 105, 1),   // bullish: close=105
			c(107, 108, 96, 97, 2),   // bearish: open > prev close, close < prev open
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bearish Engulfing');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Bullish Harami ────────────────────────────────────────────────────────────
	it('detects Bullish Harami', () => {
		const candles = [
			filler(100, 0),
			c(110, 111, 90, 92, 1),   // large bearish body (open=110, close=92)
			c(94, 97, 93, 96, 2),     // small bullish inside (open > close_prev, close < open_prev)
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bullish Harami');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
	});

	// ── Bearish Harami ────────────────────────────────────────────────────────────
	it('detects Bearish Harami', () => {
		const candles = [
			filler(100, 0),
			c(90, 111, 89, 110, 1),   // large bullish body (close=110)
			c(108, 110, 105, 106, 2), // small bearish inside
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bearish Harami');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Morning Star ──────────────────────────────────────────────────────────────
	it('detects Morning Star', () => {
		const candles = [
			filler(105, 0),
			c(105, 106, 90, 91, 1),   // large bearish (c0)
			c(90, 91, 88, 90, 2),     // small star (c1)
			c(90, 102, 89, 101, 3),   // bullish recovery > midpoint of c0
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Morning Star');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
		expect(p!.confidence).toBeGreaterThan(0.8);
	});

	// ── Evening Star ──────────────────────────────────────────────────────────────
	it('detects Evening Star', () => {
		const candles = [
			filler(95, 0),
			c(95, 115, 94, 114, 1),   // large bullish (c0)
			c(114, 116, 113, 115, 2), // small star (c1)
			c(115, 116, 96, 97, 3),   // bearish drop < midpoint of c0 (mid = 104.5)
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Evening Star');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Three White Soldiers ──────────────────────────────────────────────────────
	it('detects Three White Soldiers', () => {
		const candles = [
			filler(90, 0),
			c(90, 96, 89, 95, 1),   // first bullish
			c(92, 100, 91, 99, 2),  // second bullish opens in body, closes higher
			c(96, 104, 95, 103, 3), // third bullish
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Three White Soldiers');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bullish');
	});

	// ── Three Black Crows ─────────────────────────────────────────────────────────
	it('detects Three Black Crows', () => {
		const candles = [
			filler(110, 0),
			c(110, 111, 100, 101, 1), // first bearish
			c(108, 109, 99, 100, 2),  // second bearish opens in body, closes lower
			c(104, 105, 95, 96, 3),   // third bearish
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Three Black Crows');
		expect(p).toBeDefined();
		expect(p!.signal).toBe('bearish');
	});

	// ── Confidence checks ─────────────────────────────────────────────────────────
	it('all patterns have confidence between 0 and 1', () => {
		const candles = [
			filler(100, 0), filler(101, 1), filler(102, 2), filler(103, 3),
			c(105, 106, 98, 99, 4),   // bearish
			c(97, 110, 97, 108, 5),   // engulfing
		];
		const m = detectPatterns(candles);
		for (const p of m) {
			expect(p.confidence).toBeGreaterThan(0);
			expect(p.confidence).toBeLessThanOrEqual(1);
		}
	});

	it('index matches position in candle array', () => {
		const candles = [
			filler(100, 0), filler(100, 1), c(100, 110, 100, 110, 2), // Bullish Marubozu at index 2
		];
		const m = detectPatterns(candles);
		const p = m.find(x => x.pattern === 'Bullish Marubozu');
		if (p) expect(p.index).toBe(2);
	});

	it('all patterns have non-empty description', () => {
		const candles = [filler(100, 0), filler(100, 1), c(100, 110, 100, 110, 2)];
		const m = detectPatterns(candles);
		for (const p of m) {
			expect(p.description.length).toBeGreaterThan(0);
		}
	});
});

// ─── summarisePatterns ────────────────────────────────────────────────────────

describe('summarisePatterns', () => {
	it('empty matches gives neutral signal', () => {
		const s = summarisePatterns([]);
		expect(s.overallSignal).toBe('neutral');
		expect(s.bullishCount).toBe(0);
		expect(s.bearishCount).toBe(0);
	});

	it('all bullish patterns give bullish signal', () => {
		const matches = [
			{ pattern: 'X', signal: 'bullish' as const, confidence: 0.9, index: 0, description: '' },
			{ pattern: 'Y', signal: 'bullish' as const, confidence: 0.8, index: 1, description: '' },
		];
		const s = summarisePatterns(matches);
		expect(s.overallSignal).toBe('bullish');
		expect(s.overallScore).toBeGreaterThan(0);
	});

	it('all bearish patterns give bearish signal', () => {
		const matches = [
			{ pattern: 'X', signal: 'bearish' as const, confidence: 0.9, index: 0, description: '' },
			{ pattern: 'Y', signal: 'bearish' as const, confidence: 0.8, index: 1, description: '' },
		];
		const s = summarisePatterns(matches);
		expect(s.overallSignal).toBe('bearish');
		expect(s.overallScore).toBeLessThan(0);
	});

	it('overallScore is clamped to -100 to +100', () => {
		const bullish = Array.from({ length: 20 }, (_, i) => ({
			pattern: 'X', signal: 'bullish' as const, confidence: 1.0, index: i, description: '',
		}));
		const s = summarisePatterns(bullish);
		expect(s.overallScore).toBeLessThanOrEqual(100);
		expect(s.overallScore).toBeGreaterThanOrEqual(-100);
	});

	it('counts match by signal type', () => {
		const matches = [
			{ pattern: 'A', signal: 'bullish' as const,  confidence: 0.8, index: 0, description: '' },
			{ pattern: 'B', signal: 'bearish' as const,  confidence: 0.7, index: 1, description: '' },
			{ pattern: 'C', signal: 'neutral' as const,  confidence: 0.6, index: 2, description: '' },
		];
		const s = summarisePatterns(matches);
		expect(s.bullishCount).toBe(1);
		expect(s.bearishCount).toBe(1);
		expect(s.neutralCount).toBe(1);
	});
});
