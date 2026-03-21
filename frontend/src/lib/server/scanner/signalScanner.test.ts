// Tests for Signal Scanner — T-402
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	normaliseSymbol,
	buildTradeSetup,
	scanSymbol,
	scanWatchlist,
	DEFAULT_WATCHLIST,
} from './signalScanner';
import type { ConfluenceResult } from '../indicators/confluence';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeConfluence(overrides: Partial<ConfluenceResult> = {}): ConfluenceResult {
	return {
		signals: [],
		bullishScore: 5,
		bearishScore: 1,
		dominantDirection: 'bullish',
		confluenceScore: 5,
		currentPrice: 50000,
		atrValue: 1000,
		...overrides,
	};
}

// ─── normaliseSymbol ──────────────────────────────────────────────────────────

describe('normaliseSymbol', () => {
	it('appends USDT when no pair suffix', () => {
		expect(normaliseSymbol('BTC')).toBe('BTCUSDT');
		expect(normaliseSymbol('ETH')).toBe('ETHUSDT');
	});

	it('preserves existing USDT pair', () => {
		expect(normaliseSymbol('BTCUSDT')).toBe('BTCUSDT');
		expect(normaliseSymbol('ETHUSDT')).toBe('ETHUSDT');
	});

	it('preserves BUSD pair', () => {
		expect(normaliseSymbol('BTCBUSD')).toBe('BTCBUSD');
	});

	it('preserves BTC quote pair (length > 3)', () => {
		expect(normaliseSymbol('ETHBTC')).toBe('ETHBTC');
	});

	it('uppercases input', () => {
		expect(normaliseSymbol('btcusdt')).toBe('BTCUSDT');
	});
});

// ─── buildTradeSetup ─────────────────────────────────────────────────────────

describe('buildTradeSetup', () => {
	it('builds a long setup for bullish confluence', () => {
		const confluence = makeConfluence({
			dominantDirection: 'bullish',
			currentPrice: 50000,
			atrValue: 1000,
		});
		const setup = buildTradeSetup('BTCUSDT', '4h', confluence);

		expect(setup.type).toBe('trade_setup');
		expect(setup.direction).toBe('long');
		expect(setup.asset).toBe('BTCUSDT');
		expect(setup.timeframe).toBe('4h');
		expect(setup.targets).toHaveLength(3);
		expect(setup.targets[0].rMultiple).toBe(1.5);
		expect(setup.targets[1].rMultiple).toBe(3);
		expect(setup.targets[2].rMultiple).toBe(5);
	});

	it('builds a short setup for bearish confluence', () => {
		const confluence = makeConfluence({
			dominantDirection: 'bearish',
			bullishScore: 1,
			bearishScore: 6,
			confluenceScore: 6,
			currentPrice: 50000,
			atrValue: 1000,
		});
		const setup = buildTradeSetup('BTCUSDT', '4h', confluence);

		expect(setup.direction).toBe('short');
		expect(setup.stopLoss).toBeGreaterThan(setup.entryZone.high);
	});

	it('entry zone is ±0.5 ATR around current price', () => {
		const confluence = makeConfluence({ currentPrice: 100, atrValue: 10 });
		const setup = buildTradeSetup('ETH', '1d', confluence);

		expect(setup.entryZone.low).toBeCloseTo(95, 1);
		expect(setup.entryZone.high).toBeCloseTo(105, 1);
	});

	it('stop loss is 1.5 ATR from entry midpoint for long', () => {
		const confluence = makeConfluence({
			dominantDirection: 'bullish',
			currentPrice: 100,
			atrValue: 10,
		});
		const setup = buildTradeSetup('ETH', '1d', confluence);
		const entryMid = (setup.entryZone.low + setup.entryZone.high) / 2;
		// stop = entryMid - 1.5 * 10 = 100 - 15 = 85
		expect(Math.abs(entryMid - setup.stopLoss)).toBeCloseTo(15, 1);
	});

	it('includes invalidation message', () => {
		const setup = buildTradeSetup('BTC', '4h', makeConfluence());
		expect(setup.invalidation).toContain('invalidates setup');
	});

	it('uses signal descriptions for thesis', () => {
		const confluence = makeConfluence({
			signals: [
				{ type: 'ma_crossover', direction: 'bullish', strength: 2, description: 'Golden cross', price: 100, time: 1000 },
			],
		});
		const setup = buildTradeSetup('BTC', '4h', confluence);
		expect(setup.thesis).toContain('Golden cross');
	});
});

// ─── scanSymbol ───────────────────────────────────────────────────────────────

describe('scanSymbol', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns null on fetch failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
		const result = await scanSymbol('BTCUSDT', '4h', 200);
		expect(result).toBeNull();
	});

	it('returns null when fewer than 50 candles', async () => {
		const sparse = Array.from({ length: 10 }, (_, i) => [
			(1700000000 + i * 14400) * 1000, '50000', '51000', '49000', '50500', '1000'
		]);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => sparse
		}));
		const result = await scanSymbol('BTCUSDT', '4h', 200);
		expect(result).toBeNull();
	});

	it('returns confluence result with sufficient data', async () => {
		const candles = Array.from({ length: 200 }, (_, i) => [
			(1700000000 + i * 14400) * 1000,
			String(50000 + i * 10),
			String(50500 + i * 10),
			String(49500 + i * 10),
			String(50200 + i * 10),
			'1000'
		]);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => candles
		}));
		const result = await scanSymbol('BTCUSDT', '4h', 200);
		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(typeof result!.result.confluenceScore).toBe('number');
	});

	it('normalises symbol before fetching', async () => {
		let capturedUrl = '';
		vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
			capturedUrl = url;
			return Promise.resolve({ ok: false });
		}));
		await scanSymbol('BTC', '4h', 200);
		expect(capturedUrl).toContain('BTCUSDT');
	});
});

// ─── scanWatchlist ────────────────────────────────────────────────────────────

describe('scanWatchlist', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('returns report with scanned count matching symbols length', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const report = await scanWatchlist({ symbols: ['BTCUSDT', 'ETHUSDT'] });
		expect(report.scanned).toBe(2);
		expect(report.hits).toHaveLength(0);
		expect(report.errors).toHaveLength(2);
	});

	it('handles empty watchlist', async () => {
		const report = await scanWatchlist({ symbols: [] });
		expect(report.scanned).toBe(0);
		expect(report.hits).toHaveLength(0);
		expect(report.timestamp).toBeGreaterThan(0);
	});

	it('sorts hits by confluenceScore descending', async () => {
		const candles = Array.from({ length: 200 }, (_, i) => [
			(1700000000 + i * 14400) * 1000,
			String(50000 + i),
			String(50500 + i),
			String(49500 + i),
			String(50200 + i),
			'1000'
		]);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => candles
		}));
		const report = await scanWatchlist({
			symbols: ['BTCUSDT', 'ETHUSDT'],
			minConfluenceScore: 0
		});
		for (let i = 1; i < report.hits.length; i++) {
			expect(report.hits[i - 1].confluenceScore).toBeGreaterThanOrEqual(
				report.hits[i].confluenceScore
			);
		}
	});

	it('filters hits below minConfluenceScore', async () => {
		const candles = Array.from({ length: 200 }, (_, i) => [
			(1700000000 + i * 14400) * 1000,
			String(50000 + i),
			String(50500 + i),
			String(49500 + i),
			String(50200 + i),
			'1000'
		]);
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: async () => candles
		}));
		// Set impossibly high min score
		const report = await scanWatchlist({
			symbols: ['BTCUSDT'],
			minConfluenceScore: 999
		});
		expect(report.hits).toHaveLength(0);
	});

	it('includes durationMs in report', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
		const report = await scanWatchlist({ symbols: ['BTC'] });
		expect(typeof report.durationMs).toBe('number');
		expect(report.durationMs).toBeGreaterThanOrEqual(0);
	});
});

// ─── DEFAULT_WATCHLIST ────────────────────────────────────────────────────────

describe('DEFAULT_WATCHLIST', () => {
	it('contains major crypto pairs', () => {
		expect(DEFAULT_WATCHLIST).toContain('BTCUSDT');
		expect(DEFAULT_WATCHLIST).toContain('ETHUSDT');
		expect(DEFAULT_WATCHLIST.length).toBeGreaterThan(4);
	});

	it('all entries end with USDT', () => {
		for (const sym of DEFAULT_WATCHLIST) {
			expect(sym).toMatch(/USDT$/);
		}
	});
});
