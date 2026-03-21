// On-Chain Data — T-204
// Sources: CoinMetrics Community API (free, no key) + Blockchain.com (BTC stats)

// ─── Types ────────────────────────────────────────────────────────────────────

export type OnChainAsset = 'btc' | 'eth';

export type OnChainSnapshot = {
	asset: OnChainAsset;
	activeAddresses: number | null;   // 24h active address count
	hashRateEH: number | null;        // EH/s (BTC) or TH/s (ETH)
	nvtRatio: number | null;          // NVT ratio (Network Value to Transactions)
	mvrv: number | null;              // Market Value to Realized Value
	transactions24h: number | null;   // Transactions in last 24h
	supplyOnExchanges: number | null; // % of supply on exchanges (approx)
	source: string;
};

// ─── CoinMetrics Community API ────────────────────────────────────────────────

const CM_BASE = 'https://community-api.coinmetrics.io/v4';
const CM_ASSET_MAP: Record<OnChainAsset, string> = { btc: 'btc', eth: 'eth' };

const CM_METRICS = [
	'AdrActCnt',     // Active address count
	'HashRate',      // Hash rate (GH/s)
	'NVTAdj',        // NVT ratio
	'CapMrktCurUSD', // Market cap
	'CapRealUSD',    // Realized cap (for MVRV)
	'TxCnt',         // Transaction count
] as const;

type CMMetricKey = typeof CM_METRICS[number];

type CMResponse = {
	data: Array<{
		asset: string;
		time: string;
		[key: string]: string | null;
	}>;
};

export async function fetchCoinMetrics(asset: OnChainAsset): Promise<Partial<Record<CMMetricKey, number>> | null> {
	const cmAsset = CM_ASSET_MAP[asset];
	const metricsParam = CM_METRICS.join(',');
	const url = `${CM_BASE}/timeseries/asset-metrics?assets=${cmAsset}&metrics=${metricsParam}&page_size=1&sort=time&direction=desc`;

	try {
		const resp = await fetch(url, {
			headers: { Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!resp.ok) return null;

		const json: CMResponse = await resp.json();
		const entry = json?.data?.[0];
		if (!entry) return null;

		const result: Partial<Record<CMMetricKey, number>> = {};
		for (const key of CM_METRICS) {
			const val = entry[key];
			if (val != null && val !== '') {
				const n = parseFloat(String(val));
				if (!isNaN(n)) result[key] = n;
			}
		}
		return result;
	} catch {
		return null;
	}
}

// ─── Blockchain.com stats (BTC only) ─────────────────────────────────────────

type BlockchainStats = {
	n_tx: number;
	n_unique_addresses: number;
	hash_rate: number; // GH/s
	total_fees_btc: number;
	n_btc_mined: number;
	blocks_size: number;
};

export async function fetchBlockchainStats(): Promise<BlockchainStats | null> {
	try {
		const resp = await fetch('https://blockchain.info/stats?format=json', {
			signal: AbortSignal.timeout(8_000),
		});
		if (!resp.ok) return null;
		return await resp.json() as BlockchainStats;
	} catch {
		return null;
	}
}

// ─── Aggregated snapshot ──────────────────────────────────────────────────────

export async function fetchOnChainData(asset: OnChainAsset = 'btc'): Promise<OnChainSnapshot> {
	// Run both fetches in parallel (BTC stats only available for BTC)
	const [cmData, blockchainStats] = await Promise.allSettled([
		fetchCoinMetrics(asset),
		asset === 'btc' ? fetchBlockchainStats() : Promise.resolve(null),
	]);

	const cm = cmData.status === 'fulfilled' ? cmData.value : null;
	const bc = blockchainStats.status === 'fulfilled' ? blockchainStats.value : null;

	// Derive MVRV from market cap / realized cap
	let mvrv: number | null = null;
	if (cm?.CapMrktCurUSD && cm?.CapRealUSD && cm.CapRealUSD > 0) {
		mvrv = cm.CapMrktCurUSD / cm.CapRealUSD;
	}

	// Hash rate: CoinMetrics gives GH/s, convert to EH/s for BTC (1 EH = 1e9 GH)
	let hashRateEH: number | null = null;
	if (cm?.HashRate) {
		hashRateEH = asset === 'btc' ? cm.HashRate / 1e9 : cm.HashRate / 1e6;
	} else if (bc?.hash_rate) {
		hashRateEH = bc.hash_rate / 1e9;
	}

	return {
		asset,
		activeAddresses: cm?.AdrActCnt ?? null,
		hashRateEH,
		nvtRatio: cm?.NVTAdj ?? null,
		mvrv,
		transactions24h: cm?.TxCnt ?? bc?.n_tx ?? null,
		supplyOnExchanges: null, // Would require Glassnode paid tier
		source: cm ? 'CoinMetrics Community' : bc ? 'Blockchain.com' : 'unavailable',
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Classify MVRV value: >3.7 historically overvalued, <1 undervalued
 */
export function classifyMVRV(mvrv: number): string {
	if (mvrv > 3.7) return 'Highly Overvalued';
	if (mvrv > 2.4) return 'Overvalued';
	if (mvrv > 1.5) return 'Fair Value';
	if (mvrv > 1.0) return 'Undervalued';
	return 'Deeply Undervalued';
}

/**
 * Classify NVT ratio: >150 overvalued, <45 undervalued
 */
export function classifyNVT(nvt: number): string {
	if (nvt > 150) return 'Overvalued (High NVT)';
	if (nvt > 90) return 'Neutral';
	if (nvt > 45) return 'Fairly Valued';
	return 'Undervalued (Low NVT)';
}

/**
 * Format hash rate with appropriate unit
 */
export function formatHashRate(eh: number, asset: OnChainAsset): string {
	if (asset === 'btc') {
		if (eh >= 1000) return `${(eh / 1000).toFixed(1)} ZH/s`;
		return `${eh.toFixed(1)} EH/s`;
	}
	return `${eh.toFixed(1)} PH/s`;
}
