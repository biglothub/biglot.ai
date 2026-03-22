// Tests for dailyBriefing.ts — T-605
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	fetchTopMovers,
	assembleDailyBriefing,
	formatBriefingTelegram,
	type DailyBriefing,
	type TopMover,
} from './dailyBriefing';

// ─── Mock paperTrader ─────────────────────────────────────────────────────────

vi.mock('../paperTrading/paperTrader', () => ({
	listOpenTrades: vi.fn(async () => []),
	listClosedTrades: vi.fn(async () => []),
	buildPaperPortfolio: vi.fn((_open, _map, _closed) => ({
		openTrades:          [],
		closedTrades:        [],
		totalUnrealisedPnL:  0,
		totalRealisedPnL:    0,
		winRate:             null,
		openCount:           0,
		tradeCount:          0,
	})),
}));

// ─── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeTicker(symbol: string, changePct: string, volume = '10000000', price = '100') {
	return { symbol, priceChangePercent: changePct, lastPrice: price, quoteVolume: volume };
}

function mockTickerResponse(tickers: ReturnType<typeof makeTicker>[]) {
	mockFetch.mockResolvedValueOnce({
		ok: true,
		json: async () => tickers,
	});
}

// ─── fetchTopMovers ───────────────────────────────────────────────────────────

describe('fetchTopMovers', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns gainers and losers sorted correctly', async () => {
		mockTickerResponse([
			makeTicker('BTCUSDT',  '5.0'),
			makeTicker('ETHUSDT',  '3.0'),
			makeTicker('SOLUSDT',  '-4.0'),
			makeTicker('BNBUSDT',  '-2.0'),
			makeTicker('XRPUSDT',  '1.0'),
		]);

		const { gainers, losers } = await fetchTopMovers(2);
		expect(gainers.length).toBe(2);
		expect(gainers[0].symbol).toBe('BTCUSDT');
		expect(gainers[0].priceChangePct).toBeCloseTo(5.0);
		expect(losers.length).toBe(2);
		expect(losers[0].symbol).toBe('SOLUSDT');
		expect(losers[0].priceChangePct).toBeCloseTo(-4.0);
	});

	it('filters out leveraged tokens (UP/DOWN)', async () => {
		mockTickerResponse([
			makeTicker('BTCUPUSDT',   '10.0'),
			makeTicker('BTCDOWNUSDT', '-10.0'),
			makeTicker('BTCUSDT',     '2.0'),
		]);

		const { gainers } = await fetchTopMovers(5);
		expect(gainers.every(g => !g.symbol.includes('UP') && !g.symbol.includes('DOWN'))).toBe(true);
	});

	it('filters out low-volume pairs', async () => {
		mockTickerResponse([
			makeTicker('LOWVOLUSDT', '50.0', '100'), // volume < 5M
			makeTicker('BTCUSDT',    '2.0',  '10000000'),
		]);

		const { gainers } = await fetchTopMovers(5);
		expect(gainers.some(g => g.symbol === 'LOWVOLUSDT')).toBe(false);
	});

	it('filters non-USDT pairs', async () => {
		mockTickerResponse([
			makeTicker('ETHBTC',  '5.0'),
			makeTicker('BTCUSDT', '2.0'),
		]);

		const { gainers } = await fetchTopMovers(5);
		expect(gainers.every(g => g.symbol.endsWith('USDT'))).toBe(true);
	});

	it('returns empty arrays on fetch error', async () => {
		mockFetch.mockRejectedValueOnce(new Error('network failure'));

		const { gainers, losers } = await fetchTopMovers(5);
		expect(gainers).toEqual([]);
		expect(losers).toEqual([]);
	});

	it('returns empty arrays on non-ok response', async () => {
		mockFetch.mockResolvedValueOnce({ ok: false });

		const { gainers, losers } = await fetchTopMovers(5);
		expect(gainers).toEqual([]);
		expect(losers).toEqual([]);
	});

	it('currentPrice is parsed from lastPrice string', async () => {
		mockTickerResponse([makeTicker('BTCUSDT', '1.0', '10000000', '65000.50')]);

		const { gainers } = await fetchTopMovers(1);
		expect(gainers[0].currentPrice).toBeCloseTo(65000.5);
	});
});

// ─── assembleDailyBriefing ────────────────────────────────────────────────────

describe('assembleDailyBriefing', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns DailyBriefing with correct shape', async () => {
		mockTickerResponse([
			makeTicker('BTCUSDT', '3.0'),
			makeTicker('ETHUSDT', '-2.0'),
		]);

		const briefing = await assembleDailyBriefing('user-1', 1);
		expect(briefing).toMatchObject({
			date:               expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
			topGainers:         expect.any(Array),
			topLosers:          expect.any(Array),
			totalUnrealisedPnL: 0,
			totalRealisedPnL:   0,
			openTradeCount:     0,
			closedTradeCount:   0,
			winRate:            null,
		});
	});

	it('date is today in ISO format', async () => {
		mockTickerResponse([]);

		const briefing = await assembleDailyBriefing();
		const today = new Date().toISOString().slice(0, 10);
		expect(briefing.date).toBe(today);
	});

	it('uses buildPaperPortfolio with fetched trades', async () => {
		const { buildPaperPortfolio } = await import('../paperTrading/paperTrader');
		mockTickerResponse([]);

		await assembleDailyBriefing('test-user');
		expect(buildPaperPortfolio).toHaveBeenCalled();
	});
});

// ─── formatBriefingTelegram ───────────────────────────────────────────────────

describe('formatBriefingTelegram', () => {
	function makeBriefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
		return {
			date:               '2026-03-22',
			topGainers:         [],
			topLosers:          [],
			totalUnrealisedPnL: 0,
			totalRealisedPnL:   0,
			openTradeCount:     0,
			closedTradeCount:   0,
			winRate:            null,
			...overrides,
		};
	}

	it('contains date', () => {
		const msg = formatBriefingTelegram(makeBriefing());
		expect(msg).toContain('2026-03-22');
	});

	it('contains BigLot.ai header', () => {
		const msg = formatBriefingTelegram(makeBriefing());
		expect(msg).toContain('BigLot.ai');
	});

	it('shows gainers with + sign', () => {
		const gainers: TopMover[] = [{ symbol: 'BTCUSDT', priceChangePct: 5.23, currentPrice: 65000 }];
		const msg = formatBriefingTelegram(makeBriefing({ topGainers: gainers }));
		expect(msg).toContain('+5.23%');
		expect(msg).toContain('BTC');
	});

	it('shows losers with - sign', () => {
		const losers: TopMover[] = [{ symbol: 'ETHUSDT', priceChangePct: -3.5, currentPrice: 3000 }];
		const msg = formatBriefingTelegram(makeBriefing({ topLosers: losers }));
		expect(msg).toContain('-3.50%');
		expect(msg).toContain('ETH');
	});

	it('shows portfolio PnL', () => {
		const msg = formatBriefingTelegram(makeBriefing({
			totalUnrealisedPnL: 1500,
			totalRealisedPnL:   -200,
		}));
		expect(msg).toContain('+$1.50K');
		expect(msg).toContain('-$200.00');
	});

	it('shows win rate when available', () => {
		const msg = formatBriefingTelegram(makeBriefing({ winRate: 0.667 }));
		expect(msg).toContain('Win rate');
		expect(msg).toContain('66.7%');
	});

	it('omits win rate when null', () => {
		const msg = formatBriefingTelegram(makeBriefing({ winRate: null }));
		expect(msg).not.toContain('Win rate');
	});

	it('includes virtual money disclaimer', () => {
		const msg = formatBriefingTelegram(makeBriefing());
		expect(msg).toContain('Virtual');
	});

	it('omits gainers section when empty', () => {
		const msg = formatBriefingTelegram(makeBriefing({ topGainers: [] }));
		expect(msg).not.toContain('Top Gainers');
	});

	it('omits losers section when empty', () => {
		const msg = formatBriefingTelegram(makeBriefing({ topLosers: [] }));
		expect(msg).not.toContain('Top Losers');
	});

	it('formats large PnL in M suffix', () => {
		const msg = formatBriefingTelegram(makeBriefing({ totalRealisedPnL: 2_000_000 }));
		expect(msg).toContain('$2.00M');
	});
});
