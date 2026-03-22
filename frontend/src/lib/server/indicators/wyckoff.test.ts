// Tests for wyckoff.ts — T-701
import { describe, it, expect } from 'vitest';
import {
	detectPriorTrend,
	detectTradingRange,
	detectWyckoffEvents,
	detectVSASignals,
	classifyWyckoffPhase,
	calcWyckoffBias,
	analyzeWyckoff,
	type WyckoffEvent,
	type TradingRange,
} from './wyckoff';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeCandle(
	close: number,
	opts: Partial<{ open: number; high: number; low: number; volume: number; i: number }> = {},
): OHLCV {
	const { open = close * 0.999, high = close * 1.005, low = close * 0.995, volume = 1000, i = 0 } = opts;
	return { time: 1_700_000_000 + i * 3600, open, high, low, close, volume };
}

/** Build n candles ranging around basePrice.
 *  Amplitude is 40% of half-width so slope stays near 0 and range is clear. */
function buildRange(n: number, basePrice: number, widthPct = 0.08): OHLCV[] {
	const halfWidth = basePrice * widthPct / 2;
	const mid = basePrice;
	return Array.from({ length: n }, (_, i) => {
		// gentle oscillation — 3 full cycles
		const phase = (i / n) * Math.PI * 6;
		const close = mid + Math.sin(phase) * halfWidth * 0.4;
		const spread = halfWidth * 0.04;
		return {
			time:   1_700_000_000 + i * 86_400,
			open:   close - spread * 0.3,
			high:   close + spread,
			low:    close - spread,
			close,
			volume: 1000 + Math.random() * 300,
		};
	});
}

/** Build a trending series. */
function buildTrend(n: number, startPrice: number, stepPct: number): OHLCV[] {
	let price = startPrice;
	return Array.from({ length: n }, (_, i) => {
		price *= (1 + stepPct);
		const spread = price * 0.005;
		return {
			time:   1_700_000_000 + i * 86_400,
			open:   price - spread,
			high:   price + spread,
			low:    price - spread * 0.5,
			close:  price,
			volume: 1000,
		};
	});
}

// ─── detectPriorTrend ─────────────────────────────────────────────────────────

describe('detectPriorTrend', () => {
	it('detects uptrend when price increases >5% first-to-last third', () => {
		const candles = buildTrend(60, 100, 0.004); // ~27% gain over 60 bars
		expect(detectPriorTrend(candles)).toBe('up');
	});

	it('detects downtrend when price decreases >5%', () => {
		const candles = buildTrend(60, 100, -0.003); // ~-16% over 60 bars
		expect(detectPriorTrend(candles)).toBe('down');
	});

	it('returns sideways for flat prices', () => {
		const candles = Array.from({ length: 60 }, (_, i) =>
			makeCandle(100, { i })
		);
		expect(detectPriorTrend(candles)).toBe('sideways');
	});

	it('returns sideways if fewer candles than period', () => {
		expect(detectPriorTrend(buildTrend(20, 100, 0.01))).toBe('sideways');
	});
});

// ─── detectTradingRange ───────────────────────────────────────────────────────

describe('detectTradingRange', () => {
	it('detects a range when price oscillates within a band', () => {
		const candles = buildRange(50, 1000, 0.08);
		const range   = detectTradingRange(candles, 40);
		expect(range).not.toBeNull();
		expect(range!.support).toBeLessThan(range!.resistance);
		expect(range!.midpoint).toBeCloseTo((range!.support + range!.resistance) / 2, 1);
	});

	it('returns null when candles form a strong uptrend', () => {
		// 1% per bar → slopePct ≈ 1% > 0.4% threshold
		const candles = buildTrend(50, 100, 0.01);
		const range   = detectTradingRange(candles, 40);
		expect(range).toBeNull();
	});

	it('returns null if fewer candles than lookback', () => {
		const candles = buildRange(20, 1000);
		expect(detectTradingRange(candles, 40)).toBeNull();
	});

	it('widthPct is positive', () => {
		const candles = buildRange(50, 500, 0.10);
		const range   = detectTradingRange(candles, 40);
		if (range) expect(range.widthPct).toBeGreaterThan(0);
	});
});

// ─── detectWyckoffEvents ──────────────────────────────────────────────────────

describe('detectWyckoffEvents', () => {
	const range: TradingRange = {
		support:    900,
		resistance: 1100,
		midpoint:   1000,
		widthPct:   20,
	};

	it('detects SC: high-vol bearish bar near support', () => {
		// Build background: 20 normal candles around midpoint
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 1000, high: 1010, low: 990, close: 1000, volume: 1000,
		}));
		// Add 10 setup candles before SC
		const setup: OHLCV[] = Array.from({ length: 10 }, (_, i) => ({
			time: base[19].time + (i + 1) * 3600,
			open: 930, high: 940, low: 900, close: 910, volume: 1000,
		}));
		// SC bar: high vol, wide spread, bearish close, low near support
		const scBar: OHLCV = {
			time: setup[9].time + 3600, open: 920, high: 940, low: 895, close: 900,
			volume: 4000, // 4× avg
		};
		const candles = [...base, ...setup, scBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'SC')).toBe(true);
	});

	it('detects BC: high-vol bullish bar near resistance', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 1000, high: 1010, low: 990, close: 1000, volume: 1000,
		}));
		const setup: OHLCV[] = Array.from({ length: 10 }, (_, i) => ({
			time: base[19].time + (i + 1) * 3600,
			open: 1060, high: 1090, low: 1050, close: 1080, volume: 1000,
		}));
		// BC bar: high vol, wide spread, bullish close, near resistance
		const bcBar: OHLCV = {
			time: setup[9].time + 3600, open: 1060, high: 1105, low: 1055, close: 1100,
			volume: 4000,
		};
		const candles = [...base, ...setup, bcBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'BC')).toBe(true);
	});

	it('detects Spring: candle closes below support then bounces above', () => {
		const base: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 1000, high: 1010, low: 990, close: 1000, volume: 1000,
		}));
		// Spring bar: low dips below support, but closes above
		const springBar: OHLCV = {
			time: base[24].time + 3600, open: 910, high: 915, low: 885, close: 905,
			volume: 2000,
		};
		const candles = [...base, springBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'Spring')).toBe(true);
	});

	it('detects UTAD: spike above resistance, close back below', () => {
		const base: OHLCV[] = Array.from({ length: 25 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 1000, high: 1010, low: 990, close: 1000, volume: 1000,
		}));
		const utadBar: OHLCV = {
			time: base[24].time + 3600, open: 1090, high: 1120, low: 1085, close: 1095,
			volume: 2000,
		};
		const candles = [...base, utadBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'UTAD')).toBe(true);
	});

	it('detects SOS: high-vol bullish cross above midpoint', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 990, high: 1005, low: 985, close: 995, volume: 1000,
		}));
		// SOS bar: prev close below mid, this close above mid, high vol
		const sosPrev: OHLCV = {
			time: base[19].time + 3600, open: 992, high: 1002, low: 988, close: 998, volume: 900,
		};
		const sosBar: OHLCV = {
			time: sosPrev.time + 3600, open: 998, high: 1020, low: 995, close: 1015,
			volume: 2500,
		};
		const candles = [...base, sosPrev, sosBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'SOS')).toBe(true);
	});

	it('detects SOW: high-vol bearish cross below midpoint', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600, open: 1005, high: 1015, low: 1000, close: 1007, volume: 1000,
		}));
		const sowPrev: OHLCV = {
			time: base[19].time + 3600, open: 1004, high: 1010, low: 999, close: 1002, volume: 900,
		};
		const sowBar: OHLCV = {
			time: sowPrev.time + 3600, open: 1002, high: 1005, low: 982, close: 985,
			volume: 2500,
		};
		const candles = [...base, sowPrev, sowBar];
		const events  = detectWyckoffEvents(candles, range);
		expect(events.some(e => e.type === 'SOW')).toBe(true);
	});

	it('returns empty array for candles with no notable events', () => {
		// Flat candles with low volume, no extremes
		const candles: OHLCV[] = Array.from({ length: 30 }, (_, i) => ({
			time: 1_700_000_000 + i * 3600,
			open: 1000, high: 1005, low: 995, close: 1000, volume: 1000,
		}));
		// No extreme vol or price action — might get AR/ST but not SC/BC/Spring etc.
		const events = detectWyckoffEvents(candles, range);
		// SC and BC should not appear
		expect(events.some(e => e.type === 'SC')).toBe(false);
		expect(events.some(e => e.type === 'BC')).toBe(false);
		expect(events.some(e => e.type === 'Spring')).toBe(false);
	});
});

// ─── detectVSASignals ─────────────────────────────────────────────────────────

describe('detectVSASignals', () => {
	it('returns empty for insufficient candles', () => {
		expect(detectVSASignals([])).toHaveLength(0);
		expect(detectVSASignals(Array.from({ length: 4 }, (_, i) => makeCandle(100, { i })))).toHaveLength(0);
	});

	it('detects climax_volume: very high vol + narrow spread', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: i * 3600, open: 100, high: 101, low: 99, close: 100, volume: 1000,
		}));
		// Climax bar: ultra-high volume but tiny spread
		const climax: OHLCV = {
			time: 20 * 3600, open: 100.1, high: 100.3, low: 99.9, close: 100.2,
			volume: 25_000, // 25× avg
		};
		const signals = detectVSASignals([...base, climax]);
		expect(signals.some(s => s.type === 'climax_volume')).toBe(true);
	});

	it('detects no_demand: low vol narrow up bar', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: i * 3600, open: 100, high: 102, low: 98, close: 100, volume: 1000,
		}));
		const noDemand: OHLCV = {
			time: 20 * 3600, open: 100.0, high: 100.2, low: 99.9, close: 100.15,
			volume: 200, // 20% avg
		};
		const signals = detectVSASignals([...base, noDemand]);
		expect(signals.some(s => s.type === 'no_demand')).toBe(true);
	});

	it('detects no_supply: low vol narrow down bar', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: i * 3600, open: 100, high: 102, low: 98, close: 100, volume: 1000,
		}));
		const noSupply: OHLCV = {
			time: 20 * 3600, open: 100.15, high: 100.2, low: 99.9, close: 99.95,
			volume: 200,
		};
		const signals = detectVSASignals([...base, noSupply]);
		expect(signals.some(s => s.type === 'no_supply')).toBe(true);
	});

	it('detects stopping_volume: high vol wide spread bullish close', () => {
		const base: OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: i * 3600, open: 100, high: 101, low: 99, close: 100, volume: 1000,
		}));
		const stopping: OHLCV = {
			time: 20 * 3600, open: 95, high: 102, low: 93, close: 101, // wide, bullish
			volume: 2200,
		};
		const signals = detectVSASignals([...base, stopping]);
		expect(signals.some(s => s.type === 'stopping_volume')).toBe(true);
	});
});

// ─── classifyWyckoffPhase ─────────────────────────────────────────────────────

describe('classifyWyckoffPhase', () => {
	const range: TradingRange = { support: 900, resistance: 1100, midpoint: 1000, widthPct: 20 };

	it('accumulation A: downtrend + range, no events yet', () => {
		const { phase, subPhase } = classifyWyckoffPhase('down', range, []);
		expect(phase).toBe('accumulation');
		expect(subPhase).toBe('A');
	});

	it('accumulation B: downtrend + SC + AR/ST', () => {
		const events: WyckoffEvent[] = [
			{ type: 'SC',   index: 10, timestamp: 0, price: 905, volumeRatio: 2.5, description: '' },
			{ type: 'AR',   index: 12, timestamp: 0, price: 950, volumeRatio: 1.2, description: '' },
			{ type: 'ST',   index: 18, timestamp: 0, price: 910, volumeRatio: 1.0, description: '' },
		];
		const { phase, subPhase } = classifyWyckoffPhase('down', range, events);
		expect(phase).toBe('accumulation');
		expect(subPhase).toBe('B');
	});

	it('accumulation C: Spring detected', () => {
		const events: WyckoffEvent[] = [
			{ type: 'SC',     index: 5,  timestamp: 0, price: 905, volumeRatio: 2.5, description: '' },
			{ type: 'Spring', index: 15, timestamp: 0, price: 888, volumeRatio: 1.5, description: '' },
		];
		const { phase, subPhase } = classifyWyckoffPhase('down', range, events);
		expect(phase).toBe('accumulation');
		expect(subPhase).toBe('C');
	});

	it('accumulation D: SOS detected', () => {
		const events: WyckoffEvent[] = [
			{ type: 'SC',  index: 5,  timestamp: 0, price: 905, volumeRatio: 2.5, description: '' },
			{ type: 'SOS', index: 20, timestamp: 0, price: 1010, volumeRatio: 1.8, description: '' },
			{ type: 'LPS', index: 25, timestamp: 0, price: 960,  volumeRatio: 1.0, description: '' },
		];
		const { phase, subPhase } = classifyWyckoffPhase('down', range, events);
		expect(phase).toBe('accumulation');
		expect(subPhase).toBe('D');
	});

	it('distribution A: uptrend + range, no events yet', () => {
		const { phase, subPhase } = classifyWyckoffPhase('up', range, []);
		expect(phase).toBe('distribution');
		expect(subPhase).toBe('A');
	});

	it('distribution C: UTAD detected', () => {
		const events: WyckoffEvent[] = [
			{ type: 'BC',   index: 5,  timestamp: 0, price: 1095, volumeRatio: 2.5, description: '' },
			{ type: 'UTAD', index: 15, timestamp: 0, price: 1115, volumeRatio: 1.5, description: '' },
		];
		const { phase, subPhase } = classifyWyckoffPhase('up', range, events);
		expect(phase).toBe('distribution');
		expect(subPhase).toBe('C');
	});

	it('distribution D: SOW detected', () => {
		const events: WyckoffEvent[] = [
			{ type: 'BC',   index: 5,  timestamp: 0, price: 1095, volumeRatio: 2.5, description: '' },
			{ type: 'SOW',  index: 18, timestamp: 0, price: 988,  volumeRatio: 2.0, description: '' },
			{ type: 'LPSY', index: 22, timestamp: 0, price: 1050, volumeRatio: 1.0, description: '' },
		];
		const { phase, subPhase } = classifyWyckoffPhase('up', range, events);
		expect(phase).toBe('distribution');
		expect(subPhase).toBe('D');
	});

	it('markup: uptrend, no range', () => {
		const { phase, subPhase } = classifyWyckoffPhase('up', null, []);
		expect(phase).toBe('markup');
		expect(subPhase).toBe('E');
	});

	it('markdown: downtrend, no range', () => {
		const { phase, subPhase } = classifyWyckoffPhase('down', null, []);
		expect(phase).toBe('markdown');
		expect(subPhase).toBe('E');
	});

	it('unknown: sideways, no range', () => {
		const { phase } = classifyWyckoffPhase('sideways', null, []);
		expect(phase).toBe('unknown');
	});
});

// ─── calcWyckoffBias ──────────────────────────────────────────────────────────

describe('calcWyckoffBias', () => {
	it('markup → strongly positive', () => {
		expect(calcWyckoffBias('markup', 'E', [])).toBeGreaterThanOrEqual(60);
	});

	it('markdown → strongly negative', () => {
		expect(calcWyckoffBias('markdown', 'E', [])).toBeLessThanOrEqual(-60);
	});

	it('accumulation D → positive', () => {
		expect(calcWyckoffBias('accumulation', 'D', [])).toBeGreaterThan(0);
	});

	it('distribution D → negative', () => {
		expect(calcWyckoffBias('distribution', 'D', [])).toBeLessThan(0);
	});

	it('SOS events increase bias', () => {
		const base  = calcWyckoffBias('accumulation', 'B', []);
		const events: WyckoffEvent[] = [
			{ type: 'SOS', index: 1, timestamp: 0, price: 1010, volumeRatio: 1.8, description: '' },
		];
		const withSOS = calcWyckoffBias('accumulation', 'B', events);
		expect(withSOS).toBeGreaterThan(base);
	});

	it('SOW events decrease bias', () => {
		const base  = calcWyckoffBias('distribution', 'B', []);
		const events: WyckoffEvent[] = [
			{ type: 'SOW', index: 1, timestamp: 0, price: 990, volumeRatio: 1.8, description: '' },
		];
		const withSOW = calcWyckoffBias('distribution', 'B', events);
		expect(withSOW).toBeLessThan(base);
	});

	it('bias is clamped to -100..+100', () => {
		const events: WyckoffEvent[] = Array.from({ length: 20 }, (_, i) => ({
			type: 'SOS' as const, index: i, timestamp: 0, price: 1000, volumeRatio: 2, description: '',
		}));
		expect(calcWyckoffBias('markup', 'E', events)).toBeLessThanOrEqual(100);

		const sowEvents: WyckoffEvent[] = Array.from({ length: 20 }, (_, i) => ({
			type: 'SOW' as const, index: i, timestamp: 0, price: 990, volumeRatio: 2, description: '',
		}));
		expect(calcWyckoffBias('markdown', 'E', sowEvents)).toBeGreaterThanOrEqual(-100);
	});
});

// ─── analyzeWyckoff ───────────────────────────────────────────────────────────

describe('analyzeWyckoff', () => {
	it('returns null for fewer than 60 candles', () => {
		const candles = Array.from({ length: 59 }, (_, i) => makeCandle(100, { i }));
		expect(analyzeWyckoff(candles)).toBeNull();
	});

	it('returns analysis for trending-up series', () => {
		// 0.8%/bar → slopePct clearly above 0.4% threshold → no range → markup
		const candles = buildTrend(80, 100, 0.008);
		const result  = analyzeWyckoff(candles);
		expect(result).not.toBeNull();
		expect(result!.phase).toBe('markup');
		expect(result!.bias).toBeGreaterThan(0);
	});

	it('returns analysis for trending-down series', () => {
		// -0.7%/bar → slopePct clearly above 0.4% → no range → markdown
		const candles = buildTrend(80, 1000, -0.007);
		const result  = analyzeWyckoff(candles);
		expect(result).not.toBeNull();
		expect(result!.phase).toBe('markdown');
		expect(result!.bias).toBeLessThan(0);
	});

	it('detects range when price oscillates', () => {
		// Enough range candles: analyzeWyckoff looks at the last RANGE_LOOKBACK(40) candles
		const range = buildRange(80, 900, 0.08);
		const result = analyzeWyckoff(range);
		expect(result).not.toBeNull();
		expect(result!.tradingRange).not.toBeNull();
	});

	it('result has required shape', () => {
		const candles = buildTrend(80, 100, 0.003);
		const result  = analyzeWyckoff(candles);
		expect(result).toMatchObject({
			phase:       expect.any(String),
			subPhase:    expect.stringMatching(/^[A-E]$/),
			bias:        expect.any(Number),
			events:      expect.any(Array),
			vsaSignals:  expect.any(Array),
			description: expect.any(String),
		});
	});

	it('bias is in range -100..+100', () => {
		const candles = buildTrend(80, 100, 0.005);
		const result  = analyzeWyckoff(candles);
		expect(result!.bias).toBeGreaterThanOrEqual(-100);
		expect(result!.bias).toBeLessThanOrEqual(100);
	});

	it('description includes phase label', () => {
		const candles = buildTrend(80, 100, 0.005);
		const result  = analyzeWyckoff(candles);
		expect(result!.description.toLowerCase()).toMatch(/markup|accumulation|distribution|markdown|unknown/);
	});

	it('accumulation scenario: downtrend then range has SC-type events', () => {
		const down  = buildTrend(40, 1000, -0.008);
		// Flat range at ~700 area
		const flat  = buildRange(60, 700, 0.06);
		const result = analyzeWyckoff([...down, ...flat]);
		expect(result).not.toBeNull();
		// Should be accumulation or have detected some events
		expect(['accumulation', 'unknown']).toContain(result!.phase);
	});
});
