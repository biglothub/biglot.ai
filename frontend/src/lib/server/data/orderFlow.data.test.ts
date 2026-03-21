// Tests for Order Flow Data — T-503
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	calcOrderBookStats,
	buildCVD,
	calcBuySellRatio,
	classifyBuyPressure,
	fetchOrderBook,
	fetchCandleVolumes,
	fetchOrderFlowSnapshot,
	type OrderBook,
	type CandleVolume,
} from './orderFlow.data';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Import tool to register it
import '../tools/orderFlow.tool';

// ─── calcOrderBookStats ───────────────────────────────────────────────────────

describe('calcOrderBookStats', () => {
	const book: OrderBook = {
		symbol: 'BTCUSDT',
		bids: [
			{ price: 50000, quantity: 2.0 },
			{ price: 49990, quantity: 0.5 },
			{ price: 49980, quantity: 1.0 },
		],
		asks: [
			{ price: 50010, quantity: 1.0 },
			{ price: 50020, quantity: 3.0 },
			{ price: 50030, quantity: 0.5 },
		],
		timestamp: Date.now(),
	};

	it('calculates best bid and ask', () => {
		const stats = calcOrderBookStats(book);
		expect(stats.bestBid).toBe(50000);
		expect(stats.bestAsk).toBe(50010);
	});

	it('calculates mid price and spread', () => {
		const stats = calcOrderBookStats(book);
		expect(stats.midPrice).toBeCloseTo(50005);
		expect(stats.spread).toBeCloseTo(10);
		expect(stats.spreadPct).toBeCloseTo((10 / 50005) * 100);
	});

	it('finds bid and ask walls', () => {
		const stats = calcOrderBookStats(book);
		expect(stats.bidWallPrice).toBe(50000); // qty=2.0 is the largest bid
		expect(stats.bidWallQty).toBe(2.0);
		expect(stats.askWallPrice).toBe(50020); // qty=3.0 is the largest ask
		expect(stats.askWallQty).toBe(3.0);
	});

	it('calculates buy pressure', () => {
		const stats = calcOrderBookStats(book);
		// totalBid = 2+0.5+1 = 3.5, totalAsk = 1+3+0.5 = 4.5, total = 8
		expect(stats.buyPressure).toBeCloseTo((3.5 / 8) * 100);
	});

	it('returns null walls for empty book', () => {
		const emptyBook: OrderBook = {
			symbol: 'BTCUSDT',
			bids: [],
			asks: [],
			timestamp: Date.now(),
		};
		const stats = calcOrderBookStats(emptyBook);
		expect(stats.bidWallPrice).toBeNull();
		expect(stats.askWallPrice).toBeNull();
		expect(stats.buyPressure).toBe(50); // default balanced
	});

	it('respects depth limit', () => {
		const stats = calcOrderBookStats(book, 1);
		// Only top 1 level on each side
		expect(stats.bidWallPrice).toBe(50000);
		expect(stats.askWallPrice).toBe(50010);
	});
});

// ─── buildCVD ─────────────────────────────────────────────────────────────────

describe('buildCVD', () => {
	it('builds cumulative delta correctly', () => {
		const candles: CandleVolume[] = [
			{ time: 1000, buyVolume: 10, sellVolume: 5 },
			{ time: 1300, buyVolume: 3, sellVolume: 8 },
			{ time: 1600, buyVolume: 7, sellVolume: 7 },
		];
		const cvd = buildCVD(candles);
		expect(cvd).toHaveLength(3);
		expect(cvd[0]).toEqual({ time: 1000, cvd: 5 });   // 10-5
		expect(cvd[1]).toEqual({ time: 1300, cvd: 0 });   // 5+(3-8)
		expect(cvd[2]).toEqual({ time: 1600, cvd: 0 });   // 0+(7-7)
	});

	it('returns empty array for empty input', () => {
		expect(buildCVD([])).toEqual([]);
	});

	it('handles all sell pressure', () => {
		const candles: CandleVolume[] = [
			{ time: 1000, buyVolume: 0, sellVolume: 10 },
			{ time: 1300, buyVolume: 0, sellVolume: 5 },
		];
		const cvd = buildCVD(candles);
		expect(cvd[0].cvd).toBe(-10);
		expect(cvd[1].cvd).toBe(-15);
	});
});

// ─── calcBuySellRatio ─────────────────────────────────────────────────────────

describe('calcBuySellRatio', () => {
	it('returns null for empty candles', () => {
		expect(calcBuySellRatio([])).toBeNull();
	});

	it('calculates buy/sell ratio correctly', () => {
		const candles: CandleVolume[] = [
			{ time: 1000, buyVolume: 60, sellVolume: 40 },
		];
		expect(calcBuySellRatio(candles)).toBeCloseTo(0.6);
	});

	it('returns 1 for all buys', () => {
		const candles: CandleVolume[] = [
			{ time: 1000, buyVolume: 100, sellVolume: 0 },
		];
		expect(calcBuySellRatio(candles)).toBe(1);
	});

	it('returns 0 for all sells', () => {
		const candles: CandleVolume[] = [
			{ time: 1000, buyVolume: 0, sellVolume: 100 },
		];
		expect(calcBuySellRatio(candles)).toBe(0);
	});
});

// ─── classifyBuyPressure ──────────────────────────────────────────────────────

describe('classifyBuyPressure', () => {
	it('classifies strong buying', () => {
		expect(classifyBuyPressure(70)).toBe('Strong Buying');
	});

	it('classifies moderate buying', () => {
		expect(classifyBuyPressure(58)).toBe('Moderate Buying');
	});

	it('classifies balanced', () => {
		expect(classifyBuyPressure(50)).toBe('Balanced');
	});

	it('classifies moderate selling', () => {
		expect(classifyBuyPressure(40)).toBe('Moderate Selling');
	});

	it('classifies strong selling', () => {
		expect(classifyBuyPressure(30)).toBe('Strong Selling');
	});
});

// ─── fetchOrderBook ───────────────────────────────────────────────────────────

describe('fetchOrderBook', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns parsed order book on success', async () => {
		const mockResponse = {
			lastUpdateId: 123,
			bids: [['50000', '2.0'], ['49990', '1.0']],
			asks: [['50010', '1.5'], ['50020', '0.5']],
		};
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockResponse),
		}));

		const book = await fetchOrderBook('BTCUSDT', 20);
		expect(book).not.toBeNull();
		expect(book!.symbol).toBe('BTCUSDT');
		expect(book!.bids).toHaveLength(2);
		expect(book!.bids[0].price).toBe(50000);
		expect(book!.bids[0].quantity).toBe(2.0);
		expect(book!.asks[0].price).toBe(50010);
	});

	it('returns null on fetch failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const book = await fetchOrderBook('BTCUSDT');
		expect(book).toBeNull();
	});

	it('returns null on thrown error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
		const book = await fetchOrderBook('BTCUSDT');
		expect(book).toBeNull();
	});
});

// ─── fetchCandleVolumes ───────────────────────────────────────────────────────

describe('fetchCandleVolumes', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('groups trades into 5-minute buckets', async () => {
		const BUCKET_MS = 5 * 60 * 1000;
		const t1 = BUCKET_MS * 10;       // bucket 10
		const t2 = BUCKET_MS * 10 + 100; // same bucket
		const t3 = BUCKET_MS * 11;       // bucket 11

		const mockTrades = [
			{ T: t1, p: '50000', q: '1.0', m: false },  // buy
			{ T: t2, p: '50000', q: '2.0', m: true  },  // sell
			{ T: t3, p: '50000', q: '3.0', m: false },  // buy
		];
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockTrades),
		}));

		const candles = await fetchCandleVolumes('BTCUSDT', 500);
		expect(candles).toHaveLength(2);

		const bucket10 = candles.find(c => c.time === t1 / 1000);
		expect(bucket10!.buyVolume).toBe(1.0);
		expect(bucket10!.sellVolume).toBe(2.0);

		const bucket11 = candles.find(c => c.time === t3 / 1000);
		expect(bucket11!.buyVolume).toBe(3.0);
		expect(bucket11!.sellVolume).toBe(0);
	});

	it('returns empty array on failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const candles = await fetchCandleVolumes('BTCUSDT');
		expect(candles).toEqual([]);
	});
});

// ─── fetchOrderFlowSnapshot ───────────────────────────────────────────────────

describe('fetchOrderFlowSnapshot', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns snapshot with stats and CVD', async () => {
		const mockDepth = {
			lastUpdateId: 1,
			bids: [['50000', '2.0']],
			asks: [['50010', '1.0']],
		};
		const BUCKET_MS = 5 * 60 * 1000;
		const mockTrades = [
			{ T: BUCKET_MS, p: '50000', q: '5.0', m: false },
			{ T: BUCKET_MS, p: '50000', q: '2.0', m: true  },
		];

		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(() => {
			const data = callCount === 0 ? mockDepth : mockTrades;
			callCount++;
			return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
		}));

		const snap = await fetchOrderFlowSnapshot('btcusdt');
		expect(snap.symbol).toBe('BTCUSDT');
		expect(snap.stats).not.toBeNull();
		expect(snap.cvdPoints).toHaveLength(1);
		expect(snap.cvdPoints[0].cvd).toBe(3); // 5-2
		expect(snap.buySellRatio).toBeCloseTo(5 / 7);
	});

	it('returns null stats when order book fails', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const snap = await fetchOrderFlowSnapshot('BTCUSDT');
		expect(snap.stats).toBeNull();
		expect(snap.cvdPoints).toEqual([]);
		expect(snap.buySellRatio).toBeNull();
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('get_order_flow tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('get_order_flow')).toBeDefined();
	});

	it('returns error when symbol is missing', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('get_order_flow')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
