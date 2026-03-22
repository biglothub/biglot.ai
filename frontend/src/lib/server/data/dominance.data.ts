// Crypto Market Dominance Data — T-902
// Fetches global market stats from CoinGecko /global endpoint

export interface GlobalMarketData {
	totalMarketCapUsd: number;
	totalVolume24hUsd: number;
	marketCapChangePercent24h: number;
	btcDominance: number;           // %
	ethDominance: number;           // %
	altDominance: number;           // % (100 - btc - eth)
	activeCryptocurrencies: number;
	markets: number;
}

export type MarketSentiment =
	| 'btc_led'     // BTC dom > 50% and rising
	| 'eth_led'     // ETH dom > 20% and BTC dom declining
	| 'alt_season'  // alt dom > 40% (BTC dom < 40%)
	| 'risk_off';   // high BTC dom > 55% (flight to BTC safety)

export interface DominanceSnapshot extends GlobalMarketData {
	sentiment: MarketSentiment;
	sentimentLabel: string;
	sentimentDescription: string;
}

// ─── Injected fetcher pattern ─────────────────────────────────────────────────

export type GlobalFetcher = () => Promise<GlobalMarketData>;

export const defaultGlobalFetcher: GlobalFetcher = async () => {
	const url = 'https://api.coingecko.com/api/v3/global';
	const res  = await fetch(url, { headers: { Accept: 'application/json' } });
	if (!res.ok) throw new Error(`CoinGecko /global: HTTP ${res.status}`);

	const json  = (await res.json()) as { data: Record<string, unknown> };
	const d     = json.data;

	const caps  = (d.market_cap_percentage as Record<string, number>) ?? {};
	const btcDom = caps['btc'] ?? 0;
	const ethDom = caps['eth'] ?? 0;
	const altDom = Math.max(0, 100 - btcDom - ethDom);

	const totalCap = d.total_market_cap as Record<string, number> ?? {};
	const totalVol = d.total_volume as Record<string, number> ?? {};

	return {
		totalMarketCapUsd: totalCap['usd'] ?? 0,
		totalVolume24hUsd: totalVol['usd'] ?? 0,
		marketCapChangePercent24h: (d.market_cap_change_percentage_24h_usd as number) ?? 0,
		btcDominance: btcDom,
		ethDominance: ethDom,
		altDominance: altDom,
		activeCryptocurrencies: (d.active_cryptocurrencies as number) ?? 0,
		markets: (d.markets as number) ?? 0,
	};
};

// ─── Sentiment classification ─────────────────────────────────────────────────

export function classifyMarketSentiment(data: GlobalMarketData): MarketSentiment {
	const { btcDominance, ethDominance, altDominance } = data;

	if (btcDominance > 55) return 'risk_off';
	if (altDominance > 40) return 'alt_season';
	if (ethDominance > 20 && btcDominance < 48) return 'eth_led';
	return 'btc_led';
}

export function sentimentLabel(sentiment: MarketSentiment): string {
	const labels: Record<MarketSentiment, string> = {
		btc_led:    'BTC-Led Market',
		eth_led:    'ETH-Led Market',
		alt_season: 'Alt Season',
		risk_off:   'Risk-Off (BTC Dominance)',
	};
	return labels[sentiment];
}

export function sentimentDescription(sentiment: MarketSentiment, data: GlobalMarketData): string {
	switch (sentiment) {
		case 'risk_off':
			return `BTC dominance at ${data.btcDominance.toFixed(1)}% signals capital rotation into BTC (risk-off). Altcoins likely underperforming.`;
		case 'alt_season':
			return `Alt dominance at ${data.altDominance.toFixed(1)}% — capital rotating into altcoins. High-beta assets outperforming.`;
		case 'eth_led':
			return `ETH dominance at ${data.ethDominance.toFixed(1)}% with BTC at ${data.btcDominance.toFixed(1)}% — Ethereum ecosystem leading the move.`;
		case 'btc_led':
			return `BTC dominance at ${data.btcDominance.toFixed(1)}% — steady BTC-led market. Watch for breakout into alts.`;
	}
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildDominanceSnapshot(
	fetcher: GlobalFetcher = defaultGlobalFetcher,
): Promise<DominanceSnapshot> {
	const data = await fetcher();
	const sentiment = classifyMarketSentiment(data);
	return {
		...data,
		sentiment,
		sentimentLabel:       sentimentLabel(sentiment),
		sentimentDescription: sentimentDescription(sentiment, data),
	};
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtMarketCap(usd: number): string {
	if (usd >= 1e12) return `$${(usd / 1e12).toFixed(2)}T`;
	if (usd >= 1e9)  return `$${(usd / 1e9).toFixed(1)}B`;
	if (usd >= 1e6)  return `$${(usd / 1e6).toFixed(1)}M`;
	return `$${usd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}
