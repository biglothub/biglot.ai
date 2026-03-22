// Liquidation Heatmap Data — T-1206
// Estimate liquidation clusters by leverage tier from open interest + funding data
// Source: Binance Futures public API

// ─── Types ────────────────────────────────────────────────────────────────────

export const LEVERAGE_TIERS = [5, 10, 25, 50, 100] as const;
export type LeverageTier = typeof LEVERAGE_TIERS[number];

/** Assumed distribution of total OI across leverage tiers (sums to 1.0) */
export const LEVERAGE_DISTRIBUTION: Record<LeverageTier, number> = {
	5:   0.30,
	10:  0.25,
	25:  0.20,
	50:  0.15,
	100: 0.10,
};

export type LiquidationCluster = {
	priceLevel: number;          // absolute price at which positions liquidate
	leverageTier: LeverageTier;
	estimatedVolumeUSD: number;
	side: 'long' | 'short';
	distancePct: number;         // % distance from current price (negative = below)
};

export type LiquidationHeatmapData = {
	symbol: string;
	currentPrice: number;
	openInterestUSD: number;
	longPct: number;             // 0–1
	shortPct: number;            // 0–1
	fundingRate: number;         // raw 8h rate
	clusters: LiquidationCluster[];
	priceBuckets: number[];      // price levels, low → high
	heatmapData: number[][];     // [bucketIdx][leverageTierIdx], signed: neg=long liq, pos=short liq, ±100
	nearestLongCluster: LiquidationCluster | null;
	nearestShortCluster: LiquidationCluster | null;
	magneticLevels: { price: number; totalVolumeUSD: number }[];
};

// ─── Pure Functions ───────────────────────────────────────────────────────────

/**
 * Build liquidation clusters for each leverage tier.
 * Long positions liquidate 1/leverage below current price,
 * short positions liquidate 1/leverage above current price.
 * (Simplified — ignores maintenance margin for estimation purposes.)
 */
export function buildLiquidationClusters(
	currentPrice: number,
	openInterestUSD: number,
	longPct: number,
	shortPct: number,
): LiquidationCluster[] {
	const clusters: LiquidationCluster[] = [];
	const longOI = openInterestUSD * longPct;
	const shortOI = openInterestUSD * shortPct;

	for (const tier of LEVERAGE_TIERS) {
		const weight = LEVERAGE_DISTRIBUTION[tier];

		// Long liquidation: below current price
		const longLiqPrice = currentPrice * (1 - 1 / tier);
		clusters.push({
			priceLevel: longLiqPrice,
			leverageTier: tier,
			estimatedVolumeUSD: longOI * weight,
			side: 'long',
			distancePct: ((longLiqPrice - currentPrice) / currentPrice) * 100,
		});

		// Short liquidation: above current price
		const shortLiqPrice = currentPrice * (1 + 1 / tier);
		clusters.push({
			priceLevel: shortLiqPrice,
			leverageTier: tier,
			estimatedVolumeUSD: shortOI * weight,
			side: 'short',
			distancePct: ((shortLiqPrice - currentPrice) / currentPrice) * 100,
		});
	}

	return clusters;
}

/**
 * Generate evenly-spaced price bucket levels around current price.
 * Range: ±22% covers all leverage tiers (5x liquidates at ±20%).
 */
export function buildPriceBuckets(currentPrice: number, count = 15): number[] {
	const pctRange = 22;
	const buckets: number[] = [];
	for (let i = 0; i < count; i++) {
		const pct = -pctRange + (i / (count - 1)) * pctRange * 2;
		buckets.push(currentPrice * (1 + pct / 100));
	}
	return buckets;
}

/** Gaussian weight for spreading cluster volume across nearby price buckets */
export function gaussianWeight(distance: number, sigma: number): number {
	return Math.exp(-0.5 * (distance / sigma) ** 2);
}

/**
 * Build 2D signed heatmap: [priceIdx][leverageTierIdx].
 * Positive values = short liquidation zone (above price) → green.
 * Negative values = long liquidation zone (below price) → red.
 * Normalized to ±100.
 */
export function buildHeatmapData(
	clusters: LiquidationCluster[],
	priceBuckets: number[],
): number[][] {
	const numTiers = LEVERAGE_TIERS.length;
	const numBuckets = priceBuckets.length;
	const bucketWidth = numBuckets > 1 ? Math.abs(priceBuckets[1] - priceBuckets[0]) : 1;
	const sigma = bucketWidth * 1.5;

	const raw: number[][] = Array.from({ length: numBuckets }, () =>
		new Array<number>(numTiers).fill(0),
	);

	for (const cluster of clusters) {
		const tierIdx = LEVERAGE_TIERS.indexOf(cluster.leverageTier);
		if (tierIdx === -1) continue;
		const sign = cluster.side === 'short' ? 1 : -1;

		for (let b = 0; b < numBuckets; b++) {
			const dist = Math.abs(priceBuckets[b] - cluster.priceLevel);
			const weight = gaussianWeight(dist, sigma);
			raw[b][tierIdx] += sign * cluster.estimatedVolumeUSD * weight;
		}
	}

	// Normalise to ±100
	let maxAbs = 0;
	for (const row of raw) {
		for (const v of row) {
			if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
		}
	}
	if (maxAbs === 0) return raw;

	return raw.map(row =>
		row.map(v => parseFloat(((v / maxAbs) * 100).toFixed(1))),
	);
}

/**
 * Find the top N price buckets by total estimated liquidation volume.
 * These act as "magnetic" levels that price may gravitate toward.
 */
export function findMagneticLevels(
	clusters: LiquidationCluster[],
	priceBuckets: number[],
	topN = 3,
): { price: number; totalVolumeUSD: number }[] {
	const bucketWidth =
		priceBuckets.length > 1 ? Math.abs(priceBuckets[1] - priceBuckets[0]) : 1;
	const sigma = bucketWidth * 1.5;

	const bucketVolumes = priceBuckets.map(price => {
		const totalVolumeUSD = clusters.reduce((sum, cluster) => {
			const dist = Math.abs(price - cluster.priceLevel);
			return sum + cluster.estimatedVolumeUSD * gaussianWeight(dist, sigma);
		}, 0);
		return { price, totalVolumeUSD };
	});

	return [...bucketVolumes]
		.sort((a, b) => b.totalVolumeUSD - a.totalVolumeUSD)
		.slice(0, topN);
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

const BINANCE_FUTURES = 'https://fapi.binance.com/fapi/v1';

type BinancePriceTick    = { price: string };
type BinanceOIRow        = { openInterest: string };
type BinanceLSRow        = { longAccount: string; shortAccount: string };
type BinancePremiumIndex = { lastFundingRate: string };

export async function fetchLiquidationHeatmap(symbol: string): Promise<LiquidationHeatmapData> {
	const [priceRes, oiRes, lsRes, fundingRes] = await Promise.allSettled([
		fetch(`${BINANCE_FUTURES}/ticker/price?symbol=${symbol}`, { signal: AbortSignal.timeout(8_000) }),
		fetch(`${BINANCE_FUTURES}/openInterest?symbol=${symbol}`, { signal: AbortSignal.timeout(8_000) }),
		fetch(`${BINANCE_FUTURES}/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`, { signal: AbortSignal.timeout(8_000) }),
		fetch(`${BINANCE_FUTURES}/premiumIndex?symbol=${symbol}`, { signal: AbortSignal.timeout(8_000) }),
	]);

	// Current price is required
	if (priceRes.status !== 'fulfilled' || !priceRes.value.ok) {
		throw new Error(`Failed to fetch price for ${symbol}`);
	}
	const priceTick = await priceRes.value.json() as BinancePriceTick;
	const currentPrice = parseFloat(priceTick.price);
	if (isNaN(currentPrice) || currentPrice <= 0) {
		throw new Error(`Invalid price for ${symbol}: ${priceTick.price}`);
	}

	// Open interest (coin amount × current price = USD)
	let openInterestUSD = 0;
	if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
		const row = await oiRes.value.json() as BinanceOIRow;
		const oiCoin = parseFloat(row.openInterest);
		if (!isNaN(oiCoin)) openInterestUSD = oiCoin * currentPrice;
	}

	// Long/short account ratio
	let longPct = 0.5;
	let shortPct = 0.5;
	if (lsRes.status === 'fulfilled' && lsRes.value.ok) {
		const rows = await lsRes.value.json() as BinanceLSRow[];
		const row = rows[0];
		if (row) {
			const lp = parseFloat(row.longAccount);
			const sp = parseFloat(row.shortAccount);
			if (!isNaN(lp) && !isNaN(sp)) {
				longPct = lp;
				shortPct = sp;
			}
		}
	}

	// Funding rate
	let fundingRate = 0;
	if (fundingRes.status === 'fulfilled' && fundingRes.value.ok) {
		const data = await fundingRes.value.json() as BinancePremiumIndex;
		const fr = parseFloat(data.lastFundingRate);
		if (!isNaN(fr)) fundingRate = fr;
	}

	const clusters = buildLiquidationClusters(currentPrice, openInterestUSD, longPct, shortPct);
	const priceBuckets = buildPriceBuckets(currentPrice, 15);
	const heatmapData = buildHeatmapData(clusters, priceBuckets);
	const magneticLevels = findMagneticLevels(clusters, priceBuckets, 3);

	// Nearest clusters: highest-price long liq (100x is nearest), lowest-price short liq (100x nearest)
	const nearestLongCluster =
		clusters
			.filter(c => c.side === 'long')
			.sort((a, b) => b.priceLevel - a.priceLevel)[0] ?? null;

	const nearestShortCluster =
		clusters
			.filter(c => c.side === 'short')
			.sort((a, b) => a.priceLevel - b.priceLevel)[0] ?? null;

	return {
		symbol,
		currentPrice,
		openInterestUSD,
		longPct,
		shortPct,
		fundingRate,
		clusters,
		priceBuckets,
		heatmapData,
		nearestLongCluster,
		nearestShortCluster,
		magneticLevels,
	};
}
