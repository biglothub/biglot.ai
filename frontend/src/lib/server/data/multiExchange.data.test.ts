// Tests for multiExchange.data.ts — T-1205
import { describe, it, expect } from 'vitest';
import {
	extractBaseSymbol,
	buildExchangeSymbols,
	buildMultiExchangeSnapshot,
	ARB_FEE_THRESHOLD,
	type ExchangeFetcher,
	type ExchangeQuote,
} from './multiExchange.data';

// ─── extractBaseSymbol ────────────────────────────────────────────────────────

describe('extractBaseSymbol', () => {
	it('handles plain base symbol', () => {
		expect(extractBaseSymbol('BTC')).toBe('BTC');
	});

	it('strips USDT suffix', () => {
		expect(extractBaseSymbol('BTCUSDT')).toBe('BTC');
	});

	it('strips USD suffix', () => {
		expect(extractBaseSymbol('BTCUSD')).toBe('BTC');
	});

	it('strips USDC suffix', () => {
		expect(extractBaseSymbol('ETHUSDC')).toBe('ETH');
	});

	it('strips BUSD suffix', () => {
		expect(extractBaseSymbol('SOLUSDT')).toBe('SOL');
	});

	it('handles BTC/USDT slash format', () => {
		expect(extractBaseSymbol('BTC/USDT')).toBe('BTC');
	});

	it('handles BTC-USDT dash format', () => {
		expect(extractBaseSymbol('BTC-USDT')).toBe('BTC');
	});

	it('lowercases input and normalizes', () => {
		expect(extractBaseSymbol('btc')).toBe('BTC');
		expect(extractBaseSymbol('ethusdt')).toBe('ETH');
	});

	it('handles ETH', () => {
		expect(extractBaseSymbol('ETH')).toBe('ETH');
	});

	it('handles SOL/USDT', () => {
		expect(extractBaseSymbol('SOL/USDT')).toBe('SOL');
	});
});

// ─── buildExchangeSymbols ─────────────────────────────────────────────────────

describe('buildExchangeSymbols', () => {
	it('builds correct symbols for BTC', () => {
		const syms = buildExchangeSymbols('BTC');
		expect(syms.binance).toBe('BTCUSDT');
		expect(syms.bybit).toBe('BTCUSDT');
		expect(syms.okx).toBe('BTC-USDT');
		expect(syms.coinbase).toBe('BTC-USD');
	});

	it('builds correct symbols for ETH', () => {
		const syms = buildExchangeSymbols('ETH');
		expect(syms.binance).toBe('ETHUSDT');
		expect(syms.bybit).toBe('ETHUSDT');
		expect(syms.okx).toBe('ETH-USDT');
		expect(syms.coinbase).toBe('ETH-USD');
	});
});

// ─── buildMultiExchangeSnapshot ───────────────────────────────────────────────

function makeQuote(exchange: string, price: number, bid: number, ask: number, vol: number): ExchangeQuote {
	return {
		exchange,
		price,
		volume24hUsd: vol,
		bid,
		ask,
		spreadPct: price > 0 ? ((ask - bid) / price) * 100 : 0,
		fetchedAt: Date.now(),
	};
}

describe('buildMultiExchangeSnapshot', () => {
	it('computes maxSpreadPct between exchanges', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50010, 1_000_000_000),
			async () => makeQuote('Bybit',   50100, 50090, 50110, 500_000_000),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.symbol).toBe('BTC');
		expect(snap.maxSpreadPct).toBeCloseTo(0.2, 2); // (50100-50000)/50000*100
		expect(snap.quotes).toHaveLength(2);
	});

	it('identifies best buy venue (lowest ask)', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50010, 1_000_000_000),
			async () => makeQuote('Bybit',   50200, 50190, 50210, 500_000_000), // higher ask
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.bestBuyVenue).toBe('Binance');
	});

	it('identifies best sell venue (highest bid)', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50010, 1_000_000_000),
			async () => makeQuote('Bybit',   50200, 50190, 50210, 500_000_000), // higher bid
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.bestSellVenue).toBe('Bybit');
	});

	it('flags arb opportunity when spread exceeds fee threshold', async () => {
		// Bybit bid (50500) > Binance ask (50000) → arb exists
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50000, 1_000_000_000),
			async () => makeQuote('Bybit',   50500, 50500, 50510, 500_000_000),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.arbOpportunity).toBe(true);
		expect(snap.arbPct).toBeGreaterThan(ARB_FEE_THRESHOLD);
	});

	it('no arb when spread is below fee threshold', async () => {
		// Very close prices — spread < 0.1%
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49999, 50001, 1_000_000_000),
			async () => makeQuote('Bybit',   50005, 50004, 50006, 500_000_000),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		// Bybit bid (50004) vs Binance ask (50001) → (50004-50001)/50001 = ~0.006% < 0.1%
		expect(snap.arbPct).toBeLessThan(ARB_FEE_THRESHOLD);
		expect(snap.arbOpportunity).toBe(false);
	});

	it('computes volume distribution', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50010, 800_000_000),
			async () => makeQuote('Bybit',   50000, 49990, 50010, 200_000_000),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.totalVolume24hUsd).toBe(1_000_000_000);
		const binShare = snap.volumeDistribution.find((v) => v.exchange === 'Binance');
		const bybitShare = snap.volumeDistribution.find((v) => v.exchange === 'Bybit');
		expect(binShare?.pct).toBeCloseTo(80, 1);
		expect(bybitShare?.pct).toBeCloseTo(20, 1);
	});

	it('handles all exchanges failing gracefully', async () => {
		const fetchers: ExchangeFetcher[] = [
			async (): Promise<ExchangeQuote> => ({
				exchange: 'Binance', price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
				fetchedAt: Date.now(), error: 'Connection refused'
			}),
			async (): Promise<ExchangeQuote> => ({
				exchange: 'Bybit', price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
				fetchedAt: Date.now(), error: 'Timeout'
			}),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.maxSpreadPct).toBe(0);
		expect(snap.bestBuyVenue).toBe('N/A');
		expect(snap.bestSellVenue).toBe('N/A');
		expect(snap.arbOpportunity).toBe(false);
	});

	it('handles partial exchange failures', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 50000, 49990, 50010, 1_000_000_000),
			async (): Promise<ExchangeQuote> => ({
				exchange: 'Bybit', price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
				fetchedAt: Date.now(), error: 'API error'
			}),
		];
		const snap = await buildMultiExchangeSnapshot('BTC', fetchers);
		expect(snap.quotes).toHaveLength(2);
		// Only Binance is valid
		expect(snap.bestBuyVenue).toBe('Binance');
		expect(snap.bestSellVenue).toBe('Binance');
		expect(snap.totalVolume24hUsd).toBe(1_000_000_000);
	});

	it('normalizes symbol input', async () => {
		const fetchers: ExchangeFetcher[] = [
			async () => makeQuote('Binance', 3000, 2999, 3001, 500_000_000),
		];
		const snap = await buildMultiExchangeSnapshot('ETH/USDT', fetchers);
		expect(snap.symbol).toBe('ETH');
	});

	it('calculates per-quote spread correctly', () => {
		const q = makeQuote('Test', 100, 99.9, 100.1, 1000);
		// spreadPct = (100.1 - 99.9) / 100 * 100 = 0.2%
		expect(q.spreadPct).toBeCloseTo(0.2, 4);
	});
});

// ─── ARB_FEE_THRESHOLD constant ───────────────────────────────────────────────

describe('ARB_FEE_THRESHOLD', () => {
	it('is 0.1 percent', () => {
		expect(ARB_FEE_THRESHOLD).toBe(0.1);
	});
});
