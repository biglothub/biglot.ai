// Funding Rate Arbitrage Scanner — T-1103
// Detects cash-and-carry arb between Binance perp futures and spot

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PremiumIndexEntry {
	symbol:          string;
	markPrice:       number;
	indexPrice:      number;
	lastFundingRate: number;   // raw 8h rate (e.g. 0.0001)
	nextFundingTime: number;   // epoch ms
}

export interface FundingArbOpportunity {
	symbol:          string;
	fundingRateRaw:  number;   // raw 8h rate
	fundingAnn:      number;   // annualised % (rate * 3 * 365 * 100)
	markPrice:       number;
	indexPrice:      number;
	basisPct:        number;   // (mark - index) / index * 100
	basisAnn:        number;   // basisPct * 3 * 365 (annualised basis cost)
	carryAnn:        number;   // fundingAnn - basisAnn (net annualised carry)
	direction:       'positive' | 'negative' | 'neutral';
	strategy:        string;   // human-readable trade description
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum absolute annualised carry (%) to flag as an opportunity */
export const DEFAULT_MIN_CARRY_PCT = 10;

/** Number of funding payments per year (8h intervals × 3/day × 365 days) */
export const FUNDING_PERIODS_PER_YEAR = 3 * 365;  // 1095

// ─── Top 20 USDT perpetual futures to scan ───────────────────────────────────

export const DEFAULT_SYMBOLS = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',   'ADAUSDT',
	'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'LTCUSDT',  'LINKUSDT',
	'AVAXUSDT', 'MATICUSDT', 'UNIUSDT', 'ATOMUSDT', 'ETCUSDT',
	'FILUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT',   'OPUSDT',
];

// ─── Fetcher interface (injectable for tests) ─────────────────────────────────

export type PremiumIndexFetcher = (symbols: string[]) => Promise<PremiumIndexEntry[]>;

/**
 * Fetch Binance premiumIndex for a batch of perpetual symbols.
 * Endpoint: GET https://fapi.binance.com/fapi/v1/premiumIndex
 * Returns all symbols if no `symbol` param — we filter on client side.
 */
export const defaultPremiumFetcher: PremiumIndexFetcher = async (symbols: string[]) => {
	const url    = 'https://fapi.binance.com/fapi/v1/premiumIndex';
	const res    = await fetch(url);
	if (!res.ok) throw new Error(`Binance premiumIndex HTTP ${res.status}`);

	const data   = await res.json() as Array<{
		symbol:          string;
		markPrice:       string;
		indexPrice:      string;
		lastFundingRate: string;
		nextFundingTime: number;
	}>;

	const symbolSet = new Set(symbols.map(s => s.toUpperCase()));
	return data
		.filter(d => symbolSet.has(d.symbol))
		.map(d => ({
			symbol:          d.symbol,
			markPrice:       parseFloat(d.markPrice),
			indexPrice:      parseFloat(d.indexPrice),
			lastFundingRate: parseFloat(d.lastFundingRate),
			nextFundingTime: d.nextFundingTime,
		}));
};

// ─── Core calculation ─────────────────────────────────────────────────────────

/** Annualise an 8h rate to a yearly percentage. */
export function annualise8h(rate: number): number {
	return rate * FUNDING_PERIODS_PER_YEAR * 100;
}

/** Build an arb opportunity from a premiumIndex entry. */
export function buildArbOpportunity(entry: PremiumIndexEntry): FundingArbOpportunity {
	const fundingAnn = annualise8h(entry.lastFundingRate);
	const basisPct   = entry.indexPrice > 0
		? ((entry.markPrice - entry.indexPrice) / entry.indexPrice) * 100
		: 0;
	const basisAnn   = basisPct * FUNDING_PERIODS_PER_YEAR;
	const carryAnn   = fundingAnn - basisAnn;

	let direction: FundingArbOpportunity['direction'];
	let strategy:  string;

	if (carryAnn > 0) {
		direction = 'positive';
		strategy  = `Buy spot ${entry.symbol.replace(/USDT$/, '')} + Short perp → earn ${carryAnn.toFixed(1)}% p.a.`;
	} else if (carryAnn < 0) {
		direction = 'negative';
		strategy  = `Short spot ${entry.symbol.replace(/USDT$/, '')} + Long perp → earn ${Math.abs(carryAnn).toFixed(1)}% p.a.`;
	} else {
		direction = 'neutral';
		strategy  = 'No meaningful carry';
	}

	return {
		symbol:         entry.symbol,
		fundingRateRaw: entry.lastFundingRate,
		fundingAnn,
		markPrice:      entry.markPrice,
		indexPrice:     entry.indexPrice,
		basisPct,
		basisAnn,
		carryAnn,
		direction,
		strategy,
	};
}

// ─── Scanner ──────────────────────────────────────────────────────────────────

export interface FundingArbSnapshot {
	opportunities:     FundingArbOpportunity[];  // sorted by |carry| desc
	positiveCount:     number;
	negativeCount:     number;
	neutralCount:      number;
	bestOpportunity:   FundingArbOpportunity | null;
	worstCarry:        FundingArbOpportunity | null;  // most negative
	symbolsScanned:    number;
	minCarryThreshold: number;   // in % p.a.
}

/**
 * Scan funding arb opportunities across USDT perpetuals.
 *
 * @param symbols          - list of perpetual symbols to scan
 * @param minCarryPct      - minimum |carry| % to include (default 10)
 * @param fetcher          - injectable premium index fetcher
 */
export async function buildFundingArbSnapshot(
	symbols       = DEFAULT_SYMBOLS,
	minCarryPct   = DEFAULT_MIN_CARRY_PCT,
	fetcher: PremiumIndexFetcher = defaultPremiumFetcher,
): Promise<FundingArbSnapshot> {
	const entries = await fetcher(symbols);

	const all: FundingArbOpportunity[] = entries.map(buildArbOpportunity);

	// Filter by minimum carry threshold
	const filtered = all.filter(o => Math.abs(o.carryAnn) >= minCarryPct);

	// Sort by absolute carry descending
	filtered.sort((a, b) => Math.abs(b.carryAnn) - Math.abs(a.carryAnn));

	const positiveOpps = filtered.filter(o => o.direction === 'positive');
	const negativeOpps = filtered.filter(o => o.direction === 'negative');

	return {
		opportunities:     filtered,
		positiveCount:     positiveOpps.length,
		negativeCount:     negativeOpps.length,
		neutralCount:      all.filter(o => o.direction === 'neutral').length,
		bestOpportunity:   filtered.length > 0 ? filtered[0] : null,
		worstCarry:        negativeOpps.length > 0 ? negativeOpps[negativeOpps.length - 1] : null,
		symbolsScanned:    entries.length,
		minCarryThreshold: minCarryPct,
	};
}
