// T-203: OHLCV Provider tests
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	normalizeBinanceSymbol,
	normalizeBinanceInterval,
	resolveCoinGeckoId,
	fetchBinanceOHLCV,
	fetchCoinGeckoOHLCV,
	fetchYahooOHLCVProvider,
	fetchOHLCV,
} from './ohlcvProvider';

afterEach(() => vi.restoreAllMocks());

// ─── Candle factory ───────────────────────────────────────────────────────────

function makeBinanceCandle(time = 1_700_000_000_000): unknown[] {
	return [time, '50000', '51000', '49000', '50500', '100.5', time + 3_600_000, '50000', 100, '50', '25000', '0'];
}

function makeCGCandle(time = 1_700_000_000_000): [number, number, number, number, number] {
	return [time, 50000, 51000, 49000, 50500];
}

// ─── normalizeBinanceSymbol ───────────────────────────────────────────────────

describe('normalizeBinanceSymbol', () => {
	it('appends USDT to bare tickers', () => {
		expect(normalizeBinanceSymbol('BTC')).toBe('BTCUSDT');
		expect(normalizeBinanceSymbol('ETH')).toBe('ETHUSDT');
		expect(normalizeBinanceSymbol('SOL')).toBe('SOLUSDT');
	});

	it('preserves full pairs', () => {
		expect(normalizeBinanceSymbol('BTCUSDT')).toBe('BTCUSDT');
		expect(normalizeBinanceSymbol('ETHBUSD')).toBe('ETHBUSD');
	});

	it('uppercases input', () => {
		expect(normalizeBinanceSymbol('btcusdt')).toBe('BTCUSDT');
		expect(normalizeBinanceSymbol('eth')).toBe('ETHUSDT');
	});

	it('strips non-alphanumeric chars', () => {
		expect(normalizeBinanceSymbol('BTC/USDT')).toBe('BTCUSDT');
	});

	it('does not double-append USDT', () => {
		expect(normalizeBinanceSymbol('BTCUSDT')).toBe('BTCUSDT');
	});
});

// ─── normalizeBinanceInterval ─────────────────────────────────────────────────

describe('normalizeBinanceInterval', () => {
	it('passes through valid Binance intervals', () => {
		expect(normalizeBinanceInterval('1h')).toBe('1h');
		expect(normalizeBinanceInterval('4h')).toBe('4h');
		expect(normalizeBinanceInterval('1d')).toBe('1d');
		expect(normalizeBinanceInterval('1w')).toBe('1w');
		expect(normalizeBinanceInterval('1M')).toBe('1M');
	});

	it('falls back to 1d for unknown intervals', () => {
		expect(normalizeBinanceInterval('3h')).toBe('1d');
		expect(normalizeBinanceInterval('weird')).toBe('1d');
	});
});

// ─── resolveCoinGeckoId ───────────────────────────────────────────────────────

describe('resolveCoinGeckoId', () => {
	it('resolves BTC → bitcoin', () => {
		expect(resolveCoinGeckoId('BTC')).toBe('bitcoin');
		expect(resolveCoinGeckoId('BTCUSDT')).toBe('bitcoin');
	});

	it('resolves ETH → ethereum', () => {
		expect(resolveCoinGeckoId('ETH')).toBe('ethereum');
	});

	it('resolves SOL → solana', () => {
		expect(resolveCoinGeckoId('SOL')).toBe('solana');
	});

	it('returns null for unknown symbols', () => {
		expect(resolveCoinGeckoId('UNKNOWN123')).toBeNull();
	});
});

// ─── fetchBinanceOHLCV ────────────────────────────────────────────────────────

describe('fetchBinanceOHLCV', () => {
	it('returns normalized OHLCV on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeBinanceCandle(), makeBinanceCandle(1_700_003_600_000)],
		}));

		const result = await fetchBinanceOHLCV('BTCUSDT', '1h', 100);
		expect('error' in result).toBe(false);
		if ('error' in result) return;

		expect(result.source).toBe('binance');
		expect(result.ohlcv).toHaveLength(2);
		expect(result.ohlcv[0]).toMatchObject({
			time: expect.any(Number),
			open: expect.any(Number),
			high: expect.any(Number),
			low: expect.any(Number),
			close: expect.any(Number),
			volume: expect.any(Number),
		});
	});

	it('returns error on HTTP failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 400 }));
		const result = await fetchBinanceOHLCV('BTCUSDT', '1h', 100);
		expect('error' in result).toBe(true);
	});

	it('returns error on network failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('timeout')));
		const result = await fetchBinanceOHLCV('BTCUSDT', '1h', 100);
		expect('error' in result).toBe(true);
	});

	it('returns error on empty response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] }));
		const result = await fetchBinanceOHLCV('BTCUSDT', '1h', 100);
		expect('error' in result).toBe(true);
	});

	it('converts ms timestamps to seconds', async () => {
		const MS = 1_700_000_000_000;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeBinanceCandle(MS)],
		}));
		const result = await fetchBinanceOHLCV('BTCUSDT', '1h', 100);
		if ('error' in result) return;
		expect(result.ohlcv[0].time).toBe(Math.floor(MS / 1000));
	});
});

// ─── fetchCoinGeckoOHLCV ──────────────────────────────────────────────────────

describe('fetchCoinGeckoOHLCV', () => {
	it('returns normalized OHLCV on success', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeCGCandle(), makeCGCandle(1_700_003_600_000)],
		}));

		const result = await fetchCoinGeckoOHLCV('BTCUSDT', '1d', 100);
		expect('error' in result).toBe(false);
		if ('error' in result) return;

		expect(result.source).toBe('coingecko');
		expect(result.ohlcv).toHaveLength(2);
		// CoinGecko doesn't have volume
		expect(result.ohlcv[0].volume).toBe(0);
	});

	it('returns error for unknown symbol', async () => {
		const result = await fetchCoinGeckoOHLCV('UNKNOWNXYZ', '1d', 100);
		expect('error' in result).toBe(true);
	});

	it('returns error on HTTP failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }));
		const result = await fetchCoinGeckoOHLCV('BTCUSDT', '1d', 100);
		expect('error' in result).toBe(true);
	});

	it('trims to limit', async () => {
		const candles = Array.from({ length: 50 }, (_, i) => makeCGCandle(1_700_000_000_000 + i * 86_400_000));
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => candles,
		}));
		const result = await fetchCoinGeckoOHLCV('BTCUSDT', '1d', 10);
		if ('error' in result) return;
		expect(result.ohlcv).toHaveLength(10);
	});

	it('converts ms timestamps to seconds', async () => {
		const MS = 1_700_000_000_000;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeCGCandle(MS)],
		}));
		const result = await fetchCoinGeckoOHLCV('BTCUSDT', '1d', 100);
		if ('error' in result) return;
		expect(result.ohlcv[0].time).toBe(Math.floor(MS / 1000));
	});
});

// ─── fetchYahooOHLCVProvider ──────────────────────────────────────────────────

describe('fetchYahooOHLCVProvider', () => {
	it('returns OHLCV on success', async () => {
		// Yahoo Finance response format
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				chart: {
					result: [{
						timestamp: [1_700_000_000, 1_700_086_400],
						meta: { shortName: 'Gold Futures' },
						indicators: {
							quote: [{
								open:   [1900, 1905],
								high:   [1910, 1915],
								low:    [1890, 1895],
								close:  [1905, 1910],
								volume: [1000, 1200],
							}],
						},
					}],
				},
			}),
		}));

		const result = await fetchYahooOHLCVProvider('XAUUSD', '1d', 100);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.source).toBe('yahoo');
		expect(result.ohlcv.length).toBeGreaterThan(0);
	});

	it('returns error on fetch failure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network error')));
		const result = await fetchYahooOHLCVProvider('XAUUSD', '1d', 100);
		expect('error' in result).toBe(true);
	});
});

// ─── fetchOHLCV (main provider) ───────────────────────────────────────────────

describe('fetchOHLCV', () => {
	it('uses Yahoo for forex symbols (XAUUSD)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				chart: {
					result: [{
						timestamp: [1_700_000_000],
						meta: { shortName: 'Gold' },
						indicators: {
							quote: [{ open: [1900], high: [1910], low: [1890], close: [1905], volume: [1000] }],
						},
					}],
				},
			}),
		}));

		const result = await fetchOHLCV('XAUUSD', '1d', 10);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.source).toBe('yahoo');
	});

	it('uses Binance for crypto symbols', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeBinanceCandle()],
		}));

		const result = await fetchOHLCV('BTCUSDT', '1h', 10);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.source).toBe('binance');
	});

	it('falls back to Yahoo when Binance fails', async () => {
		let calls = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
			calls++;
			if (String(url).includes('binance.com')) {
				return { ok: false, status: 503 };
			}
			// Yahoo response
			return {
				ok: true,
				json: async () => ({
					chart: {
						result: [{
							timestamp: [1_700_000_000],
							meta: { shortName: 'Bitcoin' },
							indicators: {
								quote: [{ open: [50000], high: [51000], low: [49000], close: [50500], volume: [100] }],
							},
						}],
					},
				}),
			};
		}));

		const result = await fetchOHLCV('BTCUSDT', '1h', 10);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.source).toBe('yahoo');
		expect(calls).toBeGreaterThanOrEqual(2);
	});

	it('falls back to CoinGecko when Binance and Yahoo both fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
			if (String(url).includes('coingecko')) {
				return {
					ok: true,
					json: async () => [makeCGCandle()],
				};
			}
			return { ok: false, status: 503 };
		}));

		const result = await fetchOHLCV('BTCUSDT', '1d', 10);
		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.source).toBe('coingecko');
	});

	it('returns error when all sources fail', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all fail')));
		const result = await fetchOHLCV('UNKNOWNXYZ123', '1d', 10);
		expect('error' in result).toBe(true);
	});

	it('returns OHLCV array with correct structure', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => [makeBinanceCandle()],
		}));

		const result = await fetchOHLCV('BTC', '1h', 100);
		if ('error' in result) return;
		const candle = result.ohlcv[0];
		expect(candle).toHaveProperty('time');
		expect(candle).toHaveProperty('open');
		expect(candle).toHaveProperty('high');
		expect(candle).toHaveProperty('low');
		expect(candle).toHaveProperty('close');
		expect(candle).toHaveProperty('volume');
		expect(candle.high).toBeGreaterThanOrEqual(candle.low);
	});

	it('normalizes bare ticker BTC to BTCUSDT for Binance', async () => {
		let capturedUrl = '';
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
			capturedUrl = url;
			return { ok: true, json: async () => [makeBinanceCandle()] };
		}));

		await fetchOHLCV('BTC', '1h', 10);
		expect(capturedUrl).toContain('BTCUSDT');
	});

	it('supports all major timeframes without throwing', async () => {
		const intervals = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

		for (const interval of intervals) {
			vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
				ok: true,
				json: async () => [makeBinanceCandle()],
			}));
			const result = await fetchOHLCV('BTCUSDT', interval, 10);
			expect('ohlcv' in result || 'error' in result).toBe(true);
		}
	});
});
