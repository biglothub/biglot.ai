// Order Flow Data — T-503
// Binance order book depth, CVD, buy/sell volume ratio

// ─── Types ────────────────────────────────────────────────────────────────────

export type OrderBookLevel = {
	price: number;
	quantity: number;
};

export type OrderBook = {
	symbol: string;
	bids: OrderBookLevel[];  // sorted desc (highest bid first)
	asks: OrderBookLevel[];  // sorted asc (lowest ask first)
	timestamp: number;
};

export type OrderBookStats = {
	bestBid: number;
	bestAsk: number;
	midPrice: number;
	spread: number;
	spreadPct: number;
	bidWallPrice: number | null;   // price of largest bid cluster
	bidWallQty: number | null;
	askWallPrice: number | null;
	askWallQty: number | null;
	buyPressure: number;  // 0-100: share of top 20 levels that are bids (by qty)
};

export type CandleVolume = {
	time: number;
	buyVolume: number;
	sellVolume: number;
};

export type CVDPoint = {
	time: number;
	cvd: number;   // cumulative delta = sum of (buy - sell) volume
};

export type OrderFlowSnapshot = {
	symbol: string;
	orderBook: OrderBook | null;
	stats: OrderBookStats | null;
	cvdPoints: CVDPoint[];
	buySellRatio: number | null;  // buy volume / total volume (0-1)
	error?: string;
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Calculate order book stats from bids and asks.
 * Looks at top `depth` levels on each side.
 */
export function calcOrderBookStats(orderBook: OrderBook, depth = 20): OrderBookStats {
	const bids = orderBook.bids.slice(0, depth);
	const asks = orderBook.asks.slice(0, depth);

	const bestBid = bids.length > 0 ? bids[0].price : 0;
	const bestAsk = asks.length > 0 ? asks[0].price : 0;
	const midPrice = (bestBid + bestAsk) / 2;
	const spread = bestAsk - bestBid;
	const spreadPct = midPrice > 0 ? (spread / midPrice) * 100 : 0;

	// Find walls: largest single level by quantity
	const bidWall = bids.reduce((max, l) => l.quantity > max.quantity ? l : max, { price: 0, quantity: 0 });
	const askWall = asks.reduce((max, l) => l.quantity > max.quantity ? l : max, { price: 0, quantity: 0 });

	const totalBidQty = bids.reduce((s, l) => s + l.quantity, 0);
	const totalAskQty = asks.reduce((s, l) => s + l.quantity, 0);
	const buyPressure = totalBidQty + totalAskQty > 0
		? (totalBidQty / (totalBidQty + totalAskQty)) * 100
		: 50;

	return {
		bestBid,
		bestAsk,
		midPrice,
		spread,
		spreadPct,
		bidWallPrice: bidWall.quantity > 0 ? bidWall.price : null,
		bidWallQty: bidWall.quantity > 0 ? bidWall.quantity : null,
		askWallPrice: askWall.quantity > 0 ? askWall.price : null,
		askWallQty: askWall.quantity > 0 ? askWall.quantity : null,
		buyPressure,
	};
}

/**
 * Build CVD (Cumulative Volume Delta) from candle volumes.
 * Delta = buy volume - sell volume per candle.
 */
export function buildCVD(candles: CandleVolume[]): CVDPoint[] {
	let cumulative = 0;
	return candles.map(c => {
		cumulative += c.buyVolume - c.sellVolume;
		return { time: c.time, cvd: cumulative };
	});
}

/**
 * Calculate buy/sell ratio from candle volumes.
 * Returns 0-1 (0 = all sells, 1 = all buys).
 */
export function calcBuySellRatio(candles: CandleVolume[]): number | null {
	const totalBuy = candles.reduce((s, c) => s + c.buyVolume, 0);
	const totalSell = candles.reduce((s, c) => s + c.sellVolume, 0);
	const total = totalBuy + totalSell;
	return total > 0 ? totalBuy / total : null;
}

/**
 * Classify buy pressure as a sentiment label.
 */
export function classifyBuyPressure(pct: number): string {
	if (pct >= 65) return 'Strong Buying';
	if (pct >= 55) return 'Moderate Buying';
	if (pct >= 45) return 'Balanced';
	if (pct >= 35) return 'Moderate Selling';
	return 'Strong Selling';
}

// ─── Binance API fetchers ─────────────────────────────────────────────────────

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const BINANCE_API = 'https://api.binance.com/api/v3';

type BinanceDepthResponse = {
	lastUpdateId: number;
	bids: [string, string][];
	asks: [string, string][];
};

type BinanceAggTradeResponse = {
	T: number;    // timestamp
	p: string;    // price
	q: string;    // quantity
	m: boolean;   // is buyer the maker (true = sell, false = buy)
}[];

export async function fetchOrderBook(symbol: string, limit = 20): Promise<OrderBook | null> {
	try {
		// Try futures first, fall back to spot
		const urls = [
			`${BINANCE_FAPI}/depth?symbol=${symbol}&limit=${limit}`,
			`${BINANCE_API}/depth?symbol=${symbol}&limit=${limit}`,
		];

		for (const url of urls) {
			try {
				const res = await fetch(url);
				if (!res.ok) continue;
				const data = await res.json() as BinanceDepthResponse;

				return {
					symbol,
					bids: data.bids.map(([price, qty]) => ({ price: Number(price), quantity: Number(qty) })),
					asks: data.asks.map(([price, qty]) => ({ price: Number(price), quantity: Number(qty) })),
					timestamp: Date.now(),
				};
			} catch {
				continue;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Fetch recent aggregate trades and compute buy/sell volume candles.
 * Uses Binance aggTrades endpoint.
 */
export async function fetchCandleVolumes(symbol: string, limit = 500): Promise<CandleVolume[]> {
	try {
		const urls = [
			`${BINANCE_FAPI}/aggTrades?symbol=${symbol}&limit=${limit}`,
			`${BINANCE_API}/aggTrades?symbol=${symbol}&limit=${limit}`,
		];

		for (const url of urls) {
			try {
				const res = await fetch(url);
				if (!res.ok) continue;
				const trades = await res.json() as BinanceAggTradeResponse;

				// Group into 5-minute buckets
				const BUCKET_MS = 5 * 60 * 1000;
				const buckets = new Map<number, CandleVolume>();

				for (const t of trades) {
					const bucket = Math.floor(t.T / BUCKET_MS) * BUCKET_MS;
					if (!buckets.has(bucket)) {
						buckets.set(bucket, { time: bucket / 1000, buyVolume: 0, sellVolume: 0 });
					}
					const cv = buckets.get(bucket)!;
					const qty = Number(t.q);
					if (t.m) cv.sellVolume += qty;  // maker = sell
					else cv.buyVolume += qty;
				}

				return [...buckets.values()].sort((a, b) => a.time - b.time);
			} catch {
				continue;
			}
		}
		return [];
	} catch {
		return [];
	}
}

export async function fetchOrderFlowSnapshot(symbol: string): Promise<OrderFlowSnapshot> {
	const upperSymbol = symbol.toUpperCase();

	const [orderBook, candleVolumes] = await Promise.all([
		fetchOrderBook(upperSymbol, 20),
		fetchCandleVolumes(upperSymbol, 500),
	]);

	const stats = orderBook ? calcOrderBookStats(orderBook) : null;
	const cvdPoints = buildCVD(candleVolumes);
	const buySellRatio = calcBuySellRatio(candleVolumes);

	return {
		symbol: upperSymbol,
		orderBook,
		stats,
		cvdPoints,
		buySellRatio,
	};
}
