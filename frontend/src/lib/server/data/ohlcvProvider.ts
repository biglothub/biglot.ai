// Multi-Source OHLCV Provider — T-203
// Fallback chain: Binance → Yahoo Finance → CoinGecko
// Normalises all sources to OHLCV[]

import type { OHLCV } from '$lib/types/contentBlock';
import { isForexOrCommodity, fetchYahooOHLCV } from '../tools/yahooFinance';

export type OHLCVSource = 'binance' | 'yahoo' | 'coingecko';

export type FetchOHLCVSuccess = {
	ohlcv: OHLCV[];
	source: OHLCVSource;
	displayName: string;
};

export type FetchOHLCVResult = FetchOHLCVSuccess | { error: string };

// ─── Interval maps ────────────────────────────────────────────────────────────

const BINANCE_INTERVALS = new Set([
	'1m', '3m', '5m', '15m', '30m',
	'1h', '2h', '4h', '6h', '8h', '12h',
	'1d', '3d', '1w', '1M',
]);

const BINANCE_BASE = 'https://api.binance.com/api/v3';

// CoinGecko OHLC `days` param by our interval
const COINGECKO_DAYS: Record<string, number> = {
	'1m':  1, '5m':  1, '15m': 1, '30m': 1,
	'1h':  1, '2h':  2, '4h':  7,
	'6h':  7, '8h': 14, '12h': 14,
	'1d': 30, '1w': 90, '1M': 365,
};

// Common crypto symbol → CoinGecko id
const CG_ID: Record<string, string> = {
	btc: 'bitcoin', bitcoin: 'bitcoin',
	eth: 'ethereum', ethereum: 'ethereum',
	bnb: 'binancecoin',
	sol: 'solana', solana: 'solana',
	xrp: 'ripple',
	ada: 'cardano',
	doge: 'dogecoin',
	dot: 'polkadot',
	avax: 'avalanche-2',
	link: 'chainlink',
	ltc: 'litecoin',
	atom: 'cosmos',
	near: 'near',
	apt: 'aptos',
	arb: 'arbitrum',
	op: 'optimism',
	sui: 'sui',
	ton: 'the-open-network',
	pepe: 'pepe',
	shib: 'shiba-inu',
	inj: 'injective-protocol',
	tia: 'celestia',
	stx: 'blockstack',
	kas: 'kaspa',
	render: 'render-token',
	fet: 'artificial-superintelligence-alliance',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a symbol string to a Binance USDT-perp format.
 */
export function normalizeBinanceSymbol(symbol: string): string {
	let s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
	const isFullPair =
		s.endsWith('USDT') || s.endsWith('BUSD') ||
		(s.endsWith('BTC') && s.length > 3) ||
		(s.endsWith('ETH') && s.length > 3);
	if (!isFullPair) s += 'USDT';
	return s;
}

/**
 * Map our interval to a valid Binance interval, defaulting to nearest supported.
 */
export function normalizeBinanceInterval(interval: string): string {
	if (BINANCE_INTERVALS.has(interval)) return interval;
	return '1d';
}

/**
 * Extract a base symbol from a Binance-style pair (e.g. "BTCUSDT" → "btc").
 * Removes quote-currency suffix only when the remaining base is non-empty.
 */
function extractBase(symbol: string): string {
	const s = symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
	for (const quote of ['usdt', 'busd', 'usdc', 'btc', 'eth']) {
		if (s.endsWith(quote) && s.length > quote.length) {
			return s.slice(0, s.length - quote.length);
		}
	}
	return s;
}

/**
 * Resolve a symbol to a CoinGecko coin ID.
 */
export function resolveCoinGeckoId(symbol: string): string | null {
	const base = extractBase(normalizeBinanceSymbol(symbol));
	return CG_ID[base] ?? null;
}

// ─── Source 1: Binance ───────────────────────────────────────────────────────

export async function fetchBinanceOHLCV(
	symbol: string,
	interval: string,
	limit: number,
): Promise<FetchOHLCVResult> {
	const binanceSymbol = normalizeBinanceSymbol(symbol);
	const binanceInterval = normalizeBinanceInterval(interval);
	const url = `${BINANCE_BASE}/klines?symbol=${binanceSymbol}&interval=${binanceInterval}&limit=${Math.min(limit, 1000)}`;

	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return { error: `Binance HTTP ${res.status}` };
		const raw = (await res.json()) as unknown[][];
		if (!Array.isArray(raw) || raw.length === 0) return { error: 'Binance returned empty data' };

		const ohlcv: OHLCV[] = raw.map((k) => ({
			time:   Math.floor((k[0] as number) / 1000),
			open:   parseFloat(k[1] as string),
			high:   parseFloat(k[2] as string),
			low:    parseFloat(k[3] as string),
			close:  parseFloat(k[4] as string),
			volume: parseFloat(k[5] as string),
		}));

		return { ohlcv, source: 'binance', displayName: binanceSymbol };
	} catch (err) {
		return { error: err instanceof Error ? err.message : 'Binance fetch failed' };
	}
}

// ─── Source 2: Yahoo Finance ─────────────────────────────────────────────────

export async function fetchYahooOHLCVProvider(
	symbol: string,
	interval: string,
	limit: number,
): Promise<FetchOHLCVResult> {
	try {
		const result = await fetchYahooOHLCV(symbol, interval, limit);
		if ('error' in result) return { error: result.error };
		return { ohlcv: result.ohlcv, source: 'yahoo', displayName: result.name ?? symbol };
	} catch (err) {
		return { error: err instanceof Error ? err.message : 'Yahoo Finance fetch failed' };
	}
}

// ─── Source 3: CoinGecko ─────────────────────────────────────────────────────

export async function fetchCoinGeckoOHLCV(
	symbol: string,
	interval: string,
	limit: number,
): Promise<FetchOHLCVResult> {
	const coinId = resolveCoinGeckoId(symbol);
	if (!coinId) return { error: `No CoinGecko ID for symbol: ${symbol}` };

	const days = COINGECKO_DAYS[interval] ?? 30;
	const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return { error: `CoinGecko HTTP ${res.status}` };

		const raw = (await res.json()) as [number, number, number, number, number][];
		if (!Array.isArray(raw) || raw.length === 0) return { error: 'CoinGecko returned empty data' };

		// CoinGecko OHLC: [timestamp_ms, open, high, low, close] — no volume
		const ohlcv: OHLCV[] = raw
			.slice(-limit)
			.map(([ts, open, high, low, close]) => ({
				time:   Math.floor(ts / 1000),
				open,
				high,
				low,
				close,
				volume: 0,
			}));

		return { ohlcv, source: 'coingecko', displayName: coinId };
	} catch (err) {
		return { error: err instanceof Error ? err.message : 'CoinGecko fetch failed' };
	}
}

// ─── Main provider with auto-fallback ────────────────────────────────────────

/**
 * Fetch OHLCV data with automatic source fallback.
 *
 * Routing:
 * - Forex / commodity symbols → Yahoo Finance only
 * - Crypto symbols → Binance → Yahoo Finance → CoinGecko
 *
 * @param symbol  Symbol string (e.g. "BTCUSDT", "BTC", "XAUUSD", "EURUSD")
 * @param interval  Candle interval (e.g. "1h", "4h", "1d")
 * @param limit  Number of candles (max 1000)
 */
export async function fetchOHLCV(
	symbol: string,
	interval: string,
	limit = 100,
): Promise<FetchOHLCVResult> {
	// Forex / commodity → Yahoo only
	if (isForexOrCommodity(symbol)) {
		return fetchYahooOHLCVProvider(symbol, interval, limit);
	}

	// Crypto → try Binance first
	const binanceResult = await fetchBinanceOHLCV(symbol, interval, limit);
	if (!('error' in binanceResult)) return binanceResult;

	// Fallback: Yahoo Finance (works for some crypto tickers like BTC-USD)
	const base = extractBase(normalizeBinanceSymbol(symbol));
	const yahooResult = await fetchYahooOHLCVProvider(`${base.toUpperCase()}USD`, interval, limit);
	if (!('error' in yahooResult)) return yahooResult;

	// Last resort: CoinGecko
	return fetchCoinGeckoOHLCV(symbol, interval, limit);
}
