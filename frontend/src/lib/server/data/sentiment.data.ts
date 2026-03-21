// Sentiment data aggregation
// Sources: Alternative.me (Fear & Greed), Binance Futures (funding rates, long/short ratios)

// ─── Types ────────────────────────────────────────────────────────────────────

export type FearGreedData = {
	value: number;      // 0–100
	label: string;      // "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed"
	yesterday: number | null;
};

export type FundingRateData = {
	symbol: string;     // e.g. "BTCUSDT"
	rate: number;       // annualised %, e.g. 12.5 = 12.5% p.a.
	rawRate: number;    // 8h rate as decimal, e.g. 0.0001
	markPrice: number;
};

export type LongShortData = {
	symbol: string;
	longPct: number;    // 0–100
	shortPct: number;   // 0–100
};

export type SentimentSnapshot = {
	fearGreed: FearGreedData | null;
	fundingRates: FundingRateData[];
	longShort: LongShortData[];
	/** Composite sentiment score 0–100 (0=extreme bearish, 100=extreme bullish) */
	compositeScore: number;
	compositeLabel: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function computeFundingSentiment(rate: number): number {
	// rate is 8h decimal. Positive = bullish pressure, negative = bearish.
	// Map ±0.05% (±0.0005) per 8h to 0–100
	// 0.0005 → 75 (greed), -0.0005 → 25 (fear), 0 → 50 (neutral)
	const clamped = Math.max(-0.001, Math.min(0.001, rate));
	return 50 + (clamped / 0.001) * 50;
}

export function computeLongShortSentiment(longPct: number): number {
	// longPct 0–100. Map directly, but with contrarian dampening at extremes.
	// > 70 long: contrarian bearish signal → score capped at 60
	// < 30 long: contrarian bullish signal → score floored at 40
	if (longPct >= 70) return Math.min(60, longPct * 0.6);
	if (longPct <= 30) return Math.max(40, longPct * 0.6 + 40);
	return longPct;
}

export function computeCompositeScore(
	fearGreedValue: number | null,
	avgFundingSentiment: number | null,
	avgLongShortSentiment: number | null,
): number {
	const components: { value: number; weight: number }[] = [];
	if (fearGreedValue !== null) components.push({ value: fearGreedValue, weight: 0.5 });
	if (avgFundingSentiment !== null) components.push({ value: avgFundingSentiment, weight: 0.3 });
	if (avgLongShortSentiment !== null) components.push({ value: avgLongShortSentiment, weight: 0.2 });

	if (components.length === 0) return 50;

	const totalWeight = components.reduce((s, c) => s + c.weight, 0);
	const weighted = components.reduce((s, c) => s + c.value * c.weight, 0);
	return Math.round(weighted / totalWeight);
}

export function sentimentLabel(score: number): string {
	if (score <= 20) return 'Extreme Fear';
	if (score <= 40) return 'Fear';
	if (score <= 60) return 'Neutral';
	if (score <= 80) return 'Greed';
	return 'Extreme Greed';
}

export function annualisedFundingRate(rawRate: number): number {
	// 3 funding events per day × 365 days
	return rawRate * 3 * 365 * 100;
}

// ─── Fetchers ─────────────────────────────────────────────────────────────────

export async function fetchFearGreed(): Promise<FearGreedData | null> {
	try {
		const resp = await fetch('https://api.alternative.me/fng/?limit=2&format=json', {
			signal: AbortSignal.timeout(8_000),
		});
		if (!resp.ok) return null;
		const data = await resp.json() as {
			data: { value: string; value_classification: string }[];
		};
		const entries = data?.data;
		if (!entries?.length) return null;
		return {
			value: parseInt(entries[0].value, 10),
			label: entries[0].value_classification,
			yesterday: entries[1] ? parseInt(entries[1].value, 10) : null,
		};
	} catch {
		return null;
	}
}

export async function fetchFundingRates(symbols: string[]): Promise<FundingRateData[]> {
	const results: FundingRateData[] = [];
	await Promise.allSettled(
		symbols.map(async (symbol) => {
			try {
				const resp = await fetch(
					`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`,
					{ signal: AbortSignal.timeout(8_000) }
				);
				if (!resp.ok) return;
				const d = await resp.json() as {
					symbol: string;
					lastFundingRate: string;
					markPrice: string;
				};
				const rawRate = parseFloat(d.lastFundingRate);
				results.push({
					symbol: d.symbol,
					rate: annualisedFundingRate(rawRate),
					rawRate,
					markPrice: parseFloat(d.markPrice),
				});
			} catch {
				// skip on error
			}
		})
	);
	return results;
}

export async function fetchLongShortRatios(symbols: string[]): Promise<LongShortData[]> {
	const results: LongShortData[] = [];
	await Promise.allSettled(
		symbols.map(async (symbol) => {
			try {
				const resp = await fetch(
					`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`,
					{ signal: AbortSignal.timeout(8_000) }
				);
				if (!resp.ok) return;
				const data = await resp.json() as { longAccount: string; shortAccount: string }[];
				if (!data?.length) return;
				const longPct = parseFloat(data[0].longAccount) * 100;
				results.push({
					symbol,
					longPct: Math.round(longPct * 10) / 10,
					shortPct: Math.round((100 - longPct) * 10) / 10,
				});
			} catch {
				// skip on error
			}
		})
	);
	return results;
}

export async function fetchSentimentSnapshot(
	symbols = ['BTCUSDT', 'ETHUSDT']
): Promise<SentimentSnapshot> {
	const [fearGreed, fundingRates, longShort] = await Promise.all([
		fetchFearGreed(),
		fetchFundingRates(symbols),
		fetchLongShortRatios(symbols),
	]);

	const avgFunding = fundingRates.length > 0
		? fundingRates.reduce((s, f) => s + computeFundingSentiment(f.rawRate), 0) / fundingRates.length
		: null;

	const avgLS = longShort.length > 0
		? longShort.reduce((s, ls) => s + computeLongShortSentiment(ls.longPct), 0) / longShort.length
		: null;

	const compositeScore = computeCompositeScore(fearGreed?.value ?? null, avgFunding, avgLS);

	return {
		fearGreed,
		fundingRates,
		longShort,
		compositeScore,
		compositeLabel: sentimentLabel(compositeScore),
	};
}
