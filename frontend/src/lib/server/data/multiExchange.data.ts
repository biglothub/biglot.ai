// Multi-Exchange Price Aggregator — T-1205
// Fetches spot price/volume from Binance, Bybit (v5), OKX (v5), Coinbase

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExchangeQuote {
	exchange: string;
	price: number;
	volume24hUsd: number; // 24h volume in USD
	bid: number;
	ask: number;
	spreadPct: number; // (ask - bid) / price * 100
	fetchedAt: number;
	error?: string;
}

export interface VolumeShare {
	exchange: string;
	pct: number;
}

export interface MultiExchangeSnapshot {
	symbol: string;       // normalized base symbol e.g. "BTC"
	quotes: ExchangeQuote[];
	maxSpreadPct: number; // max spread between exchange prices
	bestBuyVenue: string; // exchange with lowest ask
	bestSellVenue: string; // exchange with highest bid
	arbOpportunity: boolean;
	arbPct: number;       // (bestBid - bestAsk_across) / bestAsk * 100
	totalVolume24hUsd: number;
	volumeDistribution: VolumeShare[];
}

// ─── Symbol normalization ─────────────────────────────────────────────────────

/**
 * Extracts base symbol from various formats:
 *   "BTC", "BTCUSDT", "BTC/USDT", "BTC-USDT", "btc" → "BTC"
 */
export function extractBaseSymbol(input: string): string {
	return input
		.toUpperCase()
		.replace(/[\s/-]/g, '')
		.replace(/USDT$/, '')
		.replace(/USDC$/, '')
		.replace(/USD$/, '')
		.replace(/BUSD$/, '')
		.trim();
}

export interface ExchangeSymbols {
	binance: string;  // e.g. "BTCUSDT"
	bybit: string;    // e.g. "BTCUSDT"
	okx: string;      // e.g. "BTC-USDT"
	coinbase: string; // e.g. "BTC-USD"
}

export function buildExchangeSymbols(base: string): ExchangeSymbols {
	return {
		binance: `${base}USDT`,
		bybit: `${base}USDT`,
		okx: `${base}-USDT`,
		coinbase: `${base}-USD`,
	};
}

// ─── Fetcher interface (injectable for tests) ─────────────────────────────────

export type ExchangeFetcher = (symbol: ExchangeSymbols) => Promise<ExchangeQuote>;

// ─── Binance Spot ─────────────────────────────────────────────────────────────
// GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT

interface BinanceTicker {
	symbol: string;
	lastPrice: string;
	quoteVolume: string; // 24h quote volume in USDT
	bidPrice: string;
	askPrice: string;
}

export const fetchBinanceQuote: ExchangeFetcher = async (symbols) => {
	const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbols.binance)}`;
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const d = await res.json() as BinanceTicker;
		const price = parseFloat(d.lastPrice);
		const bid = parseFloat(d.bidPrice);
		const ask = parseFloat(d.askPrice);
		return {
			exchange: 'Binance',
			price,
			volume24hUsd: parseFloat(d.quoteVolume),
			bid,
			ask,
			spreadPct: price > 0 ? ((ask - bid) / price) * 100 : 0,
			fetchedAt: Date.now(),
		};
	} catch (err) {
		return {
			exchange: 'Binance',
			price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
			fetchedAt: Date.now(),
			error: err instanceof Error ? err.message : 'Fetch failed',
		};
	}
};

// ─── Bybit V5 Spot ────────────────────────────────────────────────────────────
// GET https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT

interface BybitTicker {
	symbol: string;
	lastPrice: string;
	turnover24h: string; // 24h quote volume in USDT
	bid1Price: string;
	ask1Price: string;
}

interface BybitResponse {
	retCode: number;
	result: { list: BybitTicker[] };
}

export const fetchBybitQuote: ExchangeFetcher = async (symbols) => {
	const url = `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbols.bybit)}`;
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json() as BybitResponse;
		if (data.retCode !== 0) throw new Error(`Bybit retCode ${data.retCode}`);
		const d = data.result?.list?.[0];
		if (!d) throw new Error('No ticker data');
		const price = parseFloat(d.lastPrice);
		const bid = parseFloat(d.bid1Price);
		const ask = parseFloat(d.ask1Price);
		return {
			exchange: 'Bybit',
			price,
			volume24hUsd: parseFloat(d.turnover24h),
			bid,
			ask,
			spreadPct: price > 0 ? ((ask - bid) / price) * 100 : 0,
			fetchedAt: Date.now(),
		};
	} catch (err) {
		return {
			exchange: 'Bybit',
			price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
			fetchedAt: Date.now(),
			error: err instanceof Error ? err.message : 'Fetch failed',
		};
	}
};

// ─── OKX V5 Spot ─────────────────────────────────────────────────────────────
// GET https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT

interface OkxTicker {
	instId: string;
	last: string;
	volCcy24h: string; // 24h volume in quote ccy (USDT)
	bidPx: string;
	askPx: string;
}

interface OkxResponse {
	code: string;
	data: OkxTicker[];
}

export const fetchOkxQuote: ExchangeFetcher = async (symbols) => {
	const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(symbols.okx)}`;
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json() as OkxResponse;
		if (data.code !== '0') throw new Error(`OKX code ${data.code}`);
		const d = data.data?.[0];
		if (!d) throw new Error('No ticker data');
		const price = parseFloat(d.last);
		const bid = parseFloat(d.bidPx);
		const ask = parseFloat(d.askPx);
		return {
			exchange: 'OKX',
			price,
			volume24hUsd: parseFloat(d.volCcy24h),
			bid,
			ask,
			spreadPct: price > 0 ? ((ask - bid) / price) * 100 : 0,
			fetchedAt: Date.now(),
		};
	} catch (err) {
		return {
			exchange: 'OKX',
			price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
			fetchedAt: Date.now(),
			error: err instanceof Error ? err.message : 'Fetch failed',
		};
	}
};

// ─── Coinbase Exchange (public) ───────────────────────────────────────────────
// GET https://api.exchange.coinbase.com/products/BTC-USD/ticker

interface CoinbaseTicker {
	price: string;
	volume: string; // 24h volume in base currency
	bid: string;
	ask: string;
}

export const fetchCoinbaseQuote: ExchangeFetcher = async (symbols) => {
	const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(symbols.coinbase)}/ticker`;
	try {
		const res = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const d = await res.json() as CoinbaseTicker;
		const price = parseFloat(d.price);
		const bid = parseFloat(d.bid);
		const ask = parseFloat(d.ask);
		const volumeBase = parseFloat(d.volume);
		return {
			exchange: 'Coinbase',
			price,
			volume24hUsd: volumeBase * price, // convert base volume to USD
			bid,
			ask,
			spreadPct: price > 0 ? ((ask - bid) / price) * 100 : 0,
			fetchedAt: Date.now(),
		};
	} catch (err) {
		return {
			exchange: 'Coinbase',
			price: 0, volume24hUsd: 0, bid: 0, ask: 0, spreadPct: 0,
			fetchedAt: Date.now(),
			error: err instanceof Error ? err.message : 'Fetch failed',
		};
	}
};

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export const DEFAULT_FETCHERS: ExchangeFetcher[] = [
	fetchBinanceQuote,
	fetchBybitQuote,
	fetchOkxQuote,
	fetchCoinbaseQuote,
];

/** Fee threshold (%) above which an arb opportunity is flagged */
export const ARB_FEE_THRESHOLD = 0.1;

/**
 * Fetch prices from all exchanges in parallel and compute spread/arb metrics.
 */
export async function buildMultiExchangeSnapshot(
	rawSymbol: string,
	fetchers: ExchangeFetcher[] = DEFAULT_FETCHERS,
): Promise<MultiExchangeSnapshot> {
	const base = extractBaseSymbol(rawSymbol);
	const symbols = buildExchangeSymbols(base);

	const results = await Promise.all(fetchers.map((f) => f(symbols)));

	// Only use successful quotes for calculations
	const valid = results.filter((q) => !q.error && q.price > 0);

	const totalVolume = valid.reduce((sum, q) => sum + q.volume24hUsd, 0);

	const volumeDistribution: VolumeShare[] = valid.map((q) => ({
		exchange: q.exchange,
		pct: totalVolume > 0 ? (q.volume24hUsd / totalVolume) * 100 : 0,
	}));

	if (valid.length === 0) {
		return {
			symbol: base,
			quotes: results,
			maxSpreadPct: 0,
			bestBuyVenue: 'N/A',
			bestSellVenue: 'N/A',
			arbOpportunity: false,
			arbPct: 0,
			totalVolume24hUsd: 0,
			volumeDistribution: [],
		};
	}

	const prices = valid.map((q) => q.price);
	const minPrice = Math.min(...prices);
	const maxPrice = Math.max(...prices);
	const maxSpreadPct = minPrice > 0 ? ((maxPrice - minPrice) / minPrice) * 100 : 0;

	// Best buy venue = lowest ask price
	const bestBuy = valid.reduce((a, b) => (a.ask > 0 && b.ask > 0 ? (a.ask < b.ask ? a : b) : a));
	// Best sell venue = highest bid price
	const bestSell = valid.reduce((a, b) => (a.bid > 0 && b.bid > 0 ? (a.bid > b.bid ? a : b) : a));

	// Arb: buy at bestBuy.ask, sell at bestSell.bid (cross-exchange)
	const arbPct =
		bestBuy.ask > 0 ? ((bestSell.bid - bestBuy.ask) / bestBuy.ask) * 100 : 0;

	return {
		symbol: base,
		quotes: results,
		maxSpreadPct,
		bestBuyVenue: bestBuy.exchange,
		bestSellVenue: bestSell.exchange,
		arbOpportunity: arbPct > ARB_FEE_THRESHOLD,
		arbPct,
		totalVolume24hUsd: totalVolume,
		volumeDistribution,
	};
}
