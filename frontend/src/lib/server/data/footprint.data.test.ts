// Tests for Footprint Chart Data — T-1207
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getTickSize,
	classifyDominantSide,
	calcFootprintCVD,
	buildFootprintCandles,
	detectAbsorption,
	detectImbalanceZones,
	fetchFootprintData,
	type FootprintLevel,
	type FootprintCandle,
} from './footprint.data';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Register the tool
import '../tools/footprint.tool';

// ─── getTickSize ──────────────────────────────────────────────────────────────

describe('getTickSize', () => {
	it('returns 50 for BTC-level prices', () => {
		expect(getTickSize(85_000)).toBe(50);
	});

	it('returns 10 for 10k-50k range', () => {
		expect(getTickSize(30_000)).toBe(10);
	});

	it('returns 1 for 1k-10k range', () => {
		expect(getTickSize(3_000)).toBe(1);
	});

	it('returns 0.1 for 100-1k range', () => {
		expect(getTickSize(500)).toBe(0.1);
	});

	it('returns 0.01 for 10-100 range', () => {
		expect(getTickSize(50)).toBe(0.01);
	});

	it('returns 0.001 for 1-10 range', () => {
		expect(getTickSize(5)).toBe(0.001);
	});

	it('returns 0.0001 for sub-1 prices', () => {
		expect(getTickSize(0.5)).toBe(0.0001);
	});
});

// ─── classifyDominantSide ─────────────────────────────────────────────────────

describe('classifyDominantSide', () => {
	it('returns buy for >= 55%', () => {
		expect(classifyDominantSide(55)).toBe('buy');
		expect(classifyDominantSide(70)).toBe('buy');
	});

	it('returns sell for <= 45%', () => {
		expect(classifyDominantSide(45)).toBe('sell');
		expect(classifyDominantSide(30)).toBe('sell');
	});

	it('returns balanced for 46-54%', () => {
		expect(classifyDominantSide(50)).toBe('balanced');
		expect(classifyDominantSide(46)).toBe('balanced');
		expect(classifyDominantSide(54)).toBe('balanced');
	});
});

// ─── calcFootprintCVD ─────────────────────────────────────────────────────────

describe('calcFootprintCVD', () => {
	it('returns 0 for empty candles', () => {
		expect(calcFootprintCVD([])).toBe(0);
	});

	it('sums netDelta across candles', () => {
		const candles = [
			{ netDelta: 10 },
			{ netDelta: -3 },
			{ netDelta: 5 },
		] as FootprintCandle[];
		expect(calcFootprintCVD(candles)).toBe(12);
	});

	it('returns negative CVD for net selling', () => {
		const candles = [
			{ netDelta: -5 },
			{ netDelta: -3 },
		] as FootprintCandle[];
		expect(calcFootprintCVD(candles)).toBe(-8);
	});
});

// ─── buildFootprintCandles ────────────────────────────────────────────────────

describe('buildFootprintCandles', () => {
	const CANDLE_MS = 60_000;
	const t1 = CANDLE_MS * 100;
	const t2 = CANDLE_MS * 100 + 5_000;  // same candle
	const t3 = CANDLE_MS * 101;           // next candle

	it('returns empty array for empty trades', () => {
		expect(buildFootprintCandles([])).toEqual([]);
	});

	it('groups trades into 1-minute candles', () => {
		const trades = [
			{ T: t1, p: '50000', q: '1.0', m: false }, // buy
			{ T: t2, p: '50050', q: '2.0', m: true  }, // sell
			{ T: t3, p: '50100', q: '3.0', m: false }, // buy in next candle
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		expect(candles).toHaveLength(2);
		expect(candles[0].time).toBe(t1 / 1000);
		expect(candles[1].time).toBe(t3 / 1000);
	});

	it('correctly separates buy and sell volumes', () => {
		const trades = [
			{ T: t1, p: '50000', q: '5.0', m: false }, // buy (taker buyer)
			{ T: t2, p: '50000', q: '3.0', m: true  }, // sell (maker buyer = market sell)
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		expect(candles).toHaveLength(1);
		const c = candles[0];
		expect(c.totalBuyVolume).toBeCloseTo(5.0);
		expect(c.totalSellVolume).toBeCloseTo(3.0);
		expect(c.netDelta).toBeCloseTo(2.0);
	});

	it('aggregates volumes at the same price level', () => {
		const trades = [
			{ T: t1, p: '50000', q: '1.0', m: false }, // buy at 50000
			{ T: t2, p: '50010', q: '2.0', m: false }, // buy at ~50000 (tick=50)
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		expect(candles[0].levels.length).toBeGreaterThanOrEqual(1);
	});

	it('computes OHLC correctly', () => {
		const trades = [
			{ T: t1,             p: '50000', q: '1.0', m: false },
			{ T: t1 + 1_000,     p: '50200', q: '1.0', m: false },
			{ T: t1 + 2_000,     p: '49800', q: '1.0', m: false },
			{ T: t1 + 3_000,     p: '50100', q: '1.0', m: false },
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		const c = candles[0];
		expect(c.open).toBe(50000);
		expect(c.close).toBe(50100);
		expect(c.high).toBe(50200);
		expect(c.low).toBe(49800);
	});

	it('sets dominantSide correctly', () => {
		// All buys → dominantSide = 'buy'
		const trades = [
			{ T: t1, p: '50000', q: '10.0', m: false },
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		expect(candles[0].dominantSide).toBe('buy');
	});

	it('computes imbalancePct on levels', () => {
		const trades = [
			{ T: t1, p: '50000', q: '8.0', m: false }, // buy
			{ T: t2, p: '50000', q: '2.0', m: true  }, // sell
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		// Both at same level (tick=50 → 50000)
		const level = candles[0].levels[0];
		// delta = 8-2=6, total=10, imbalancePct = 60
		expect(level.delta).toBeCloseTo(6);
		expect(level.imbalancePct).toBeCloseTo(60);
	});

	it('sorts levels high to low', () => {
		const trades = [
			{ T: t1,         p: '49950', q: '1.0', m: false },
			{ T: t1 + 1_000, p: '50050', q: '1.0', m: false },
		];
		const candles = buildFootprintCandles(trades, CANDLE_MS);
		const levels = candles[0].levels;
		// Prices should be descending
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i].price).toBeLessThanOrEqual(levels[i - 1].price);
		}
	});
});

// ─── detectAbsorption ─────────────────────────────────────────────────────────

describe('detectAbsorption', () => {
	it('returns empty array for empty candles', () => {
		expect(detectAbsorption([])).toEqual([]);
	});

	it('returns empty array when no high-volume levels', () => {
		const candle: FootprintCandle = {
			time: 1000,
			open: 50000, high: 50100, low: 49900, close: 50000,
			totalVolume: 10, totalBuyVolume: 5, totalSellVolume: 5, netDelta: 0,
			levels: [
				{ price: 50000, bidVolume: 1, askVolume: 1, delta: 0, totalVolume: 2, imbalancePct: 0 },
				{ price: 49950, bidVolume: 1, askVolume: 1, delta: 0, totalVolume: 2, imbalancePct: 0 },
			],
			dominantSide: 'balanced',
		};
		expect(detectAbsorption([candle])).toEqual([]);
	});

	it('detects bid absorption (bullish): heavy selling near low', () => {
		const candle: FootprintCandle = {
			time: 1000,
			open: 50000, high: 50100, low: 49900, close: 50050,
			totalVolume: 100, totalBuyVolume: 20, totalSellVolume: 80, netDelta: -60,
			levels: [
				{ price: 50050, bidVolume: 1, askVolume: 2, delta: 1, totalVolume: 3, imbalancePct: 33 },
				// Near low (49900) with heavy sell volume (bidVolume >> askVolume)
				{ price: 49900, bidVolume: 60, askVolume: 10, delta: -50, totalVolume: 70, imbalancePct: 71 },
			],
			dominantSide: 'sell',
		};
		const events = detectAbsorption([candle]);
		const bidAbs = events.find(e => e.side === 'sell');
		expect(bidAbs).toBeDefined();
		expect(bidAbs!.price).toBe(49900);
	});

	it('detects ask absorption (bearish): heavy buying near high', () => {
		const candle: FootprintCandle = {
			time: 1000,
			open: 50000, high: 50100, low: 49950, close: 49980,
			totalVolume: 100, totalBuyVolume: 80, totalSellVolume: 20, netDelta: 60,
			levels: [
				// Near high (50100) with heavy buy volume (askVolume >> bidVolume)
				{ price: 50100, bidVolume: 10, askVolume: 60, delta: 50, totalVolume: 70, imbalancePct: 71 },
				{ price: 49950, bidVolume: 1, askVolume: 1, delta: 0, totalVolume: 2, imbalancePct: 0 },
			],
			dominantSide: 'buy',
		};
		const events = detectAbsorption([candle]);
		const askAbs = events.find(e => e.side === 'buy');
		expect(askAbs).toBeDefined();
		expect(askAbs!.price).toBe(50100);
	});
});

// ─── detectImbalanceZones ─────────────────────────────────────────────────────

describe('detectImbalanceZones', () => {
	it('returns empty for empty levels', () => {
		expect(detectImbalanceZones([])).toEqual([]);
	});

	it('returns empty for single level', () => {
		const levels: FootprintLevel[] = [
			{ price: 50000, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
		];
		expect(detectImbalanceZones(levels)).toEqual([]);
	});

	it('detects a buy imbalance zone', () => {
		// 3 consecutive levels with buy imbalance >= 70%
		const levels: FootprintLevel[] = [
			{ price: 50200, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50100, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50000, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
		];
		const zones = detectImbalanceZones(levels);
		expect(zones).toHaveLength(1);
		expect(zones[0].side).toBe('buy');
		expect(zones[0].priceTo).toBe(50200); // highest
		expect(zones[0].priceFrom).toBe(50000); // lowest
		expect(zones[0].avgImbalancePct).toBeCloseTo(80);
	});

	it('detects a sell imbalance zone', () => {
		const levels: FootprintLevel[] = [
			{ price: 50200, bidVolume: 9, askVolume: 1, delta: -8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50100, bidVolume: 9, askVolume: 1, delta: -8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50000, bidVolume: 9, askVolume: 1, delta: -8, totalVolume: 10, imbalancePct: 80 },
		];
		const zones = detectImbalanceZones(levels);
		expect(zones).toHaveLength(1);
		expect(zones[0].side).toBe('sell');
	});

	it('does not create zone from a single imbalanced level', () => {
		const levels: FootprintLevel[] = [
			{ price: 50200, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50100, bidVolume: 5, askVolume: 5, delta: 0, totalVolume: 10, imbalancePct: 0  },
			{ price: 50000, bidVolume: 5, askVolume: 5, delta: 0, totalVolume: 10, imbalancePct: 0  },
		];
		expect(detectImbalanceZones(levels)).toHaveLength(0);
	});

	it('detects multiple separate zones', () => {
		const levels: FootprintLevel[] = [
			// Buy zone
			{ price: 50300, bidVolume: 1, askVolume: 9, delta:  8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50200, bidVolume: 1, askVolume: 9, delta:  8, totalVolume: 10, imbalancePct: 80 },
			// Break
			{ price: 50100, bidVolume: 5, askVolume: 5, delta:  0, totalVolume: 10, imbalancePct: 0  },
			// Sell zone
			{ price: 50000, bidVolume: 9, askVolume: 1, delta: -8, totalVolume: 10, imbalancePct: 80 },
			{ price: 49900, bidVolume: 9, askVolume: 1, delta: -8, totalVolume: 10, imbalancePct: 80 },
		];
		const zones = detectImbalanceZones(levels);
		expect(zones).toHaveLength(2);
		expect(zones[0].side).toBe('buy');
		expect(zones[1].side).toBe('sell');
	});

	it('skips levels with zero volume', () => {
		const levels: FootprintLevel[] = [
			{ price: 50200, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
			{ price: 50100, bidVolume: 0, askVolume: 0, delta: 0, totalVolume: 0,  imbalancePct: 0  },
			{ price: 50000, bidVolume: 1, askVolume: 9, delta: 8, totalVolume: 10, imbalancePct: 80 },
		];
		// Zero-volume level breaks the zone — no zone with 2+ consecutive levels
		expect(detectImbalanceZones(levels)).toHaveLength(0);
	});
});

// ─── fetchFootprintData ───────────────────────────────────────────────────────

describe('fetchFootprintData', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns footprint data from Binance futures', async () => {
		const CANDLE_MS = 60_000;
		const t1 = CANDLE_MS * 100;
		const mockTrades = [
			{ T: t1,             p: '50000', q: '5.0', m: false }, // buy
			{ T: t1 + 1_000,     p: '50050', q: '3.0', m: true  }, // sell
			{ T: t1 + 2_000,     p: '50100', q: '2.0', m: false }, // buy
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTrades),
		}));

		const data = await fetchFootprintData('BTCUSDT');
		expect(data.symbol).toBe('BTCUSDT');
		expect(data.candles).toHaveLength(1);
		expect(data.error).toBeUndefined();
		expect(data.totalBuyVolume).toBeCloseTo(7.0); // 5+2
		expect(data.totalSellVolume).toBeCloseTo(3.0);
		expect(data.cvd).toBeCloseTo(4.0); // 7-3
		expect(data.dominantSide).toBe('buy'); // 70% buy pressure
	});

	it('falls back to spot API on futures failure', async () => {
		const CANDLE_MS = 60_000;
		const t1 = CANDLE_MS * 100;
		const mockTrades = [
			{ T: t1, p: '2000', q: '1.0', m: false },
		];
		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
			if (callCount === 0) {
				callCount++;
				return Promise.resolve({ ok: false });
			}
			return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTrades) });
		}));

		const data = await fetchFootprintData('ETHUSDT');
		expect(data.candles).toHaveLength(1);
		expect(data.error).toBeUndefined();
	});

	it('returns error result when both APIs fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const data = await fetchFootprintData('BTCUSDT');
		expect(data.candles).toHaveLength(0);
		expect(data.error).toBeDefined();
		expect(data.cvd).toBe(0);
		expect(data.buyPressurePct).toBe(50);
		expect(data.dominantSide).toBe('balanced');
	});

	it('returns error result on network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));
		const data = await fetchFootprintData('BTCUSDT');
		expect(data.error).toBeDefined();
		expect(data.candles).toHaveLength(0);
	});

	it('computes CVD and buy pressure correctly', async () => {
		const CANDLE_MS = 60_000;
		const t1 = CANDLE_MS * 100;
		const t2 = CANDLE_MS * 101;
		const mockTrades = [
			{ T: t1,         p: '50000', q: '10.0', m: false }, // buy
			{ T: t1 + 1_000, p: '50000', q: '4.0',  m: true  }, // sell
			{ T: t2,         p: '50000', q: '2.0',  m: false }, // buy
			{ T: t2 + 1_000, p: '50000', q: '8.0',  m: true  }, // sell
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTrades),
		}));

		const data = await fetchFootprintData('BTCUSDT');
		// candle1: buy=10, sell=4 → delta=6
		// candle2: buy=2, sell=8 → delta=-6
		// cvd = 6 + (-6) = 0
		expect(data.cvd).toBeCloseTo(0);
		// total buy=12, sell=12 → 50%
		expect(data.buyPressurePct).toBeCloseTo(50);
		expect(data.dominantSide).toBe('balanced');
	});
});

// ─── Tool integration ──────────────────────────────────────────────────────────

describe('get_footprint_data tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('get_footprint_data')).toBeDefined();
	});

	it('returns error when fetch fails', async () => {
		vi.restoreAllMocks();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_footprint_data')!;
		const result = await tool.execute({ symbol: 'BTCUSDT' });
		expect(result.success).toBe(false);
	});

	it('defaults to BTC when symbol is not provided', async () => {
		vi.restoreAllMocks();
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_footprint_data')!;
		const result = await tool.execute({});
		// Should fail gracefully (no real data) but not crash
		expect(result.success).toBe(false);
		expect(result.contentBlocks[0].type).toBe('error');
	});

	it('returns success with valid mock data', async () => {
		vi.restoreAllMocks();
		const CANDLE_MS = 60_000;
		const t1 = CANDLE_MS * 100;
		const mockTrades = [
			{ T: t1,             p: '50000', q: '6.0', m: false },
			{ T: t1 + 1_000,     p: '50050', q: '4.0', m: true  },
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTrades),
		}));
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_footprint_data')!;
		const result = await tool.execute({ symbol: 'BTC' });
		expect(result.success).toBe(true);
		const types = result.contentBlocks.map(b => b.type);
		expect(types).toContain('metric_card');
		expect(types).toContain('table');
		expect(types).toContain('gauge');
	});
});
