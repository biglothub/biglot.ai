// Footprint Chart Data — T-1207
// Aggregate Binance aggTrades into footprint: bid/ask volume per price level per candle

// ─── Types ────────────────────────────────────────────────────────────────────

export type FootprintLevel = {
	price: number;        // price level (rounded to tick size)
	bidVolume: number;    // sell volume (maker was buyer = seller hit bid)
	askVolume: number;    // buy volume (taker was buyer = buyer lifted ask)
	delta: number;        // askVolume - bidVolume (positive = net buying)
	totalVolume: number;  // bidVolume + askVolume
	imbalancePct: number; // |delta| / totalVolume * 100
};

export type FootprintCandle = {
	time: number;           // unix seconds (candle open time)
	open: number;
	high: number;
	low: number;
	close: number;
	totalVolume: number;
	totalBuyVolume: number;
	totalSellVolume: number;
	netDelta: number;        // totalBuyVolume - totalSellVolume
	levels: FootprintLevel[]; // sorted high → low by price
	dominantSide: 'buy' | 'sell' | 'balanced';
};

export type AbsorptionEvent = {
	candleTime: number;
	price: number;
	volume: number;
	side: 'buy' | 'sell'; // side that was absorbed
	description: string;
};

export type ImbalanceZone = {
	priceFrom: number;    // lower bound of zone
	priceTo: number;      // upper bound of zone
	side: 'buy' | 'sell';
	avgImbalancePct: number;
};

export type FootprintData = {
	symbol: string;
	candles: FootprintCandle[];
	cvd: number;              // cumulative volume delta
	totalBuyVolume: number;
	totalSellVolume: number;
	buyPressurePct: number;   // 0–100
	dominantSide: 'buy' | 'sell' | 'balanced';
	absorptionEvents: AbsorptionEvent[];
	imbalanceZones: ImbalanceZone[];
	error?: string;
};

// ─── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Adaptive tick size for rounding prices to footprint levels.
 * Prevents too many micro-levels on high-priced assets.
 */
export function getTickSize(price: number): number {
	if (price >= 50_000) return 50;
	if (price >= 10_000) return 10;
	if (price >= 1_000) return 1;
	if (price >= 100) return 0.1;
	if (price >= 10) return 0.01;
	if (price >= 1) return 0.001;
	return 0.0001;
}

/**
 * Classify dominant side from buy pressure percentage.
 */
export function classifyDominantSide(buyPct: number): 'buy' | 'sell' | 'balanced' {
	if (buyPct >= 55) return 'buy';
	if (buyPct <= 45) return 'sell';
	return 'balanced';
}

/**
 * Calculate cumulative volume delta across all candles.
 */
export function calcFootprintCVD(candles: FootprintCandle[]): number {
	return candles.reduce((sum, c) => sum + c.netDelta, 0);
}

type RawAggTrade = {
	T: number;   // timestamp ms
	p: string;   // price
	q: string;   // quantity
	m: boolean;  // true = buyer is maker (passive) = sell order hit; false = buyer is taker = buy order lifted
};

/**
 * Aggregate raw aggTrades into footprint candles.
 * Groups by candleDurationMs buckets, then groups within each candle by price level.
 */
export function buildFootprintCandles(trades: RawAggTrade[], candleDurationMs = 60_000): FootprintCandle[] {
	if (trades.length === 0) return [];

	const sorted = [...trades].sort((a, b) => a.T - b.T);

	// Group trades into candle buckets
	const candleMap = new Map<number, RawAggTrade[]>();
	for (const trade of sorted) {
		const cs = Math.floor(trade.T / candleDurationMs) * candleDurationMs;
		if (!candleMap.has(cs)) candleMap.set(cs, []);
		candleMap.get(cs)!.push(trade);
	}

	const result: FootprintCandle[] = [];

	for (const [cs, candleTrades] of [...candleMap.entries()].sort((a, b) => a[0] - b[0])) {
		const firstPrice = Number(candleTrades[0].p);
		const tickSize = getTickSize(firstPrice);

		const levelMap = new Map<number, FootprintLevel>();
		let open = firstPrice;
		let close = Number(candleTrades[candleTrades.length - 1].p);
		let high = open, low = open;
		let totalBuyVolume = 0, totalSellVolume = 0;

		for (const trade of candleTrades) {
			const price = Number(trade.p);
			const qty = Number(trade.q);
			// Round to nearest tick size level
			const level = Math.round(price / tickSize) * tickSize;

			high = Math.max(high, price);
			low = Math.min(low, price);

			if (!levelMap.has(level)) {
				levelMap.set(level, { price: level, bidVolume: 0, askVolume: 0, delta: 0, totalVolume: 0, imbalancePct: 0 });
			}
			const lev = levelMap.get(level)!;
			// m=true: buyer is maker (passive) → market sell order (adds to bidVolume)
			// m=false: buyer is taker (aggressive) → market buy order (adds to askVolume)
			if (trade.m) {
				lev.bidVolume += qty;
				totalSellVolume += qty;
			} else {
				lev.askVolume += qty;
				totalBuyVolume += qty;
			}
		}

		// Compute delta and imbalance per level
		for (const lev of levelMap.values()) {
			lev.delta = lev.askVolume - lev.bidVolume;
			lev.totalVolume = lev.bidVolume + lev.askVolume;
			lev.imbalancePct = lev.totalVolume > 0 ? (Math.abs(lev.delta) / lev.totalVolume) * 100 : 0;
		}

		const levels = [...levelMap.values()].sort((a, b) => b.price - a.price); // high → low
		const totalVolume = totalBuyVolume + totalSellVolume;
		const netDelta = totalBuyVolume - totalSellVolume;
		const buyPct = totalVolume > 0 ? (totalBuyVolume / totalVolume) * 100 : 50;

		result.push({
			time: cs / 1000,
			open,
			high,
			low,
			close,
			totalVolume,
			totalBuyVolume,
			totalSellVolume,
			netDelta,
			levels,
			dominantSide: classifyDominantSide(buyPct),
		});
	}

	return result;
}

/**
 * Detect absorption events: large volume at price extremes that doesn't advance price.
 * - Bid absorption (bullish): heavy selling near candle low, but price recovered.
 * - Ask absorption (bearish): heavy buying near candle high, but price reversed.
 * A level qualifies if it holds at least `minVolumePct` of the total candle volume.
 */
export function detectAbsorption(candles: FootprintCandle[], minVolumePct = 0.25): AbsorptionEvent[] {
	const events: AbsorptionEvent[] = [];

	for (const candle of candles) {
		if (candle.levels.length === 0 || candle.totalVolume === 0) continue;

		const volumeThreshold = candle.totalVolume * minVolumePct;

		for (const level of candle.levels) {
			if (level.totalVolume < volumeThreshold) continue;

			const isNearLow = level.price <= candle.low * 1.002;
			const isNearHigh = level.price >= candle.high * 0.998;

			// Bid absorption (bullish): sellers dominated near low, but price recovered
			if (isNearLow && level.bidVolume > level.askVolume * 2) {
				events.push({
					candleTime: candle.time,
					price: level.price,
					volume: level.bidVolume,
					side: 'sell',
					description: `Bid absorption at $${level.price}: ${level.bidVolume.toFixed(2)} sell volume absorbed near candle low (bullish)`,
				});
			}

			// Ask absorption (bearish): buyers dominated near high, but price reversed
			if (isNearHigh && level.askVolume > level.bidVolume * 2) {
				events.push({
					candleTime: candle.time,
					price: level.price,
					volume: level.askVolume,
					side: 'buy',
					description: `Ask absorption at $${level.price}: ${level.askVolume.toFixed(2)} buy volume absorbed near candle high (bearish)`,
				});
			}
		}
	}

	return events;
}

/**
 * Detect imbalance zones in a candle's footprint levels.
 * An imbalance zone is 2+ consecutive price levels where one side dominates by the threshold.
 * Levels must be sorted high → low.
 */
export function detectImbalanceZones(levels: FootprintLevel[], threshold = 70): ImbalanceZone[] {
	const zones: ImbalanceZone[] = [];
	if (levels.length < 2) return zones;

	let zoneStartIdx: number | null = null;
	let zoneSide: 'buy' | 'sell' | null = null;

	const getSide = (l: FootprintLevel): 'buy' | 'sell' | null => {
		if (l.totalVolume === 0) return null;
		if (l.imbalancePct >= threshold && l.delta > 0) return 'buy';
		if (l.imbalancePct >= threshold && l.delta < 0) return 'sell';
		return null;
	};

	const closeZone = (endIdx: number) => {
		if (zoneStartIdx === null || zoneSide === null) return;
		const count = endIdx - zoneStartIdx;
		if (count >= 2) {
			const slice = levels.slice(zoneStartIdx, endIdx);
			zones.push({
				priceFrom: levels[endIdx - 1].price,  // lowest price in zone
				priceTo: levels[zoneStartIdx].price,   // highest price in zone
				side: zoneSide,
				avgImbalancePct: slice.reduce((s, l) => s + l.imbalancePct, 0) / count,
			});
		}
	};

	for (let i = 0; i < levels.length; i++) {
		const side = getSide(levels[i]);
		if (side === zoneSide && side !== null) {
			// continue zone
		} else {
			closeZone(i);
			zoneStartIdx = side !== null ? i : null;
			zoneSide = side;
		}
	}

	// Close final zone
	closeZone(levels.length);

	return zones;
}

// ─── Binance API fetcher ───────────────────────────────────────────────────────

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const BINANCE_API = 'https://api.binance.com/api/v3';

export async function fetchFootprintData(symbol: string, limit = 1000): Promise<FootprintData> {
	const upperSymbol = symbol.toUpperCase();

	let trades: RawAggTrade[] = [];

	const urls = [
		`${BINANCE_FAPI}/aggTrades?symbol=${upperSymbol}&limit=${limit}`,
		`${BINANCE_API}/aggTrades?symbol=${upperSymbol}&limit=${limit}`,
	];

	for (const url of urls) {
		try {
			const res = await fetch(url);
			if (!res.ok) continue;
			trades = await res.json() as RawAggTrade[];
			if (trades.length > 0) break;
		} catch {
			continue;
		}
	}

	if (trades.length === 0) {
		return {
			symbol: upperSymbol,
			candles: [],
			cvd: 0,
			totalBuyVolume: 0,
			totalSellVolume: 0,
			buyPressurePct: 50,
			dominantSide: 'balanced',
			absorptionEvents: [],
			imbalanceZones: [],
			error: `No trade data available for ${upperSymbol}`,
		};
	}

	const candles = buildFootprintCandles(trades, 60_000); // 1-minute candles
	const cvd = calcFootprintCVD(candles);
	const absorptionEvents = detectAbsorption(candles);

	const totalBuyVolume = candles.reduce((s, c) => s + c.totalBuyVolume, 0);
	const totalSellVolume = candles.reduce((s, c) => s + c.totalSellVolume, 0);
	const totalVolume = totalBuyVolume + totalSellVolume;
	const buyPressurePct = totalVolume > 0 ? (totalBuyVolume / totalVolume) * 100 : 50;

	const latestCandle = candles[candles.length - 1];
	const imbalanceZones = latestCandle ? detectImbalanceZones(latestCandle.levels) : [];

	return {
		symbol: upperSymbol,
		candles,
		cvd,
		totalBuyVolume,
		totalSellVolume,
		buyPressurePct,
		dominantSide: classifyDominantSide(buyPressurePct),
		absorptionEvents,
		imbalanceZones,
	};
}
