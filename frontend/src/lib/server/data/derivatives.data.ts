// Derivatives Data — T-205
// Sources: Binance Futures public API (open interest, funding, liquidations)
//          Deribit public API (options: put/call ratio, max pain)

// ─── Types ────────────────────────────────────────────────────────────────────

export type FundingRate = {
	symbol: string;
	rate: number;           // raw funding rate (e.g. 0.0001)
	annualised: number;     // rate * 3 * 365 (8h intervals)
};

export type OpenInterest = {
	symbol: string;
	openInterestUSD: number;
	openInterestCoin: number;
};

export type LiquidationStats = {
	symbol: string;
	longLiqUSD: number;    // long liquidations (USD, last 24h)
	shortLiqUSD: number;   // short liquidations (USD, last 24h)
};

export type LongShortRatio = {
	symbol: string;
	longPct: number;       // 0–1
	shortPct: number;      // 0–1
};

export type DeribitInstrument = {
	instrument_name: string;
	strike: number;
	option_type: 'call' | 'put';
	expiration_timestamp: number;
	open_interest: number;
};

export type OptionsData = {
	maxPain: number | null;       // strike with max pain in USD
	putCallRatio: number | null;  // put OI / call OI
	totalCallOI: number;
	totalPutOI: number;
};

export type DerivativesSnapshot = {
	fundingRates: FundingRate[];
	openInterest: OpenInterest[];
	longShortRatios: LongShortRatio[];
	liquidations: LiquidationStats[];
	options: OptionsData | null;   // BTC only (Deribit)
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Annualise an 8-hour funding rate to a yearly percentage.
 * Funding is paid 3x per day → *3 * 365.
 */
export function annualiseFundingRate(rate: number): number {
	return rate * 3 * 365 * 100; // as percent
}

/**
 * Classify funding sentiment from the annualised funding rate (%).
 */
export function classifyFunding(annualisedPct: number): string {
	if (annualisedPct > 100) return 'Extreme greed';
	if (annualisedPct > 30) return 'Bullish';
	if (annualisedPct > -10) return 'Neutral';
	if (annualisedPct > -50) return 'Bearish';
	return 'Extreme fear';
}

/**
 * Format a USD value with K/M/B suffix.
 */
export function formatUSD(usd: number): string {
	if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
	if (usd >= 1e6) return `$${(usd / 1e6).toFixed(2)}M`;
	if (usd >= 1e3) return `$${(usd / 1e3).toFixed(2)}K`;
	return `$${usd.toFixed(2)}`;
}

// ─── Source 1: Binance Futures ────────────────────────────────────────────────

const BINANCE_FUTURES = 'https://fapi.binance.com/fapi/v1';

type BinanceFundingRow = { symbol: string; lastFundingRate: string };
type BinanceOIRow = { symbol: string; openInterest: string; sumOpenInterestValue: string };
type BinanceLSRow = { symbol: string; longAccount: string; shortAccount: string };
type BinanceLiqRow = { symbol: string; side: 'BUY' | 'SELL'; origQty: string; price: string };

export async function fetchFundingRates(symbols: string[]): Promise<FundingRate[]> {
	const results: FundingRate[] = [];
	await Promise.all(symbols.map(async (symbol) => {
		try {
			const res = await fetch(`${BINANCE_FUTURES}/premiumIndex?symbol=${symbol}`, {
				signal: AbortSignal.timeout(8_000),
			});
			if (!res.ok) return;
			const row = await res.json() as BinanceFundingRow;
			const rate = parseFloat(row.lastFundingRate);
			if (!isNaN(rate)) {
				results.push({ symbol, rate, annualised: annualiseFundingRate(rate) });
			}
		} catch {
			// skip on error
		}
	}));
	return results;
}

export async function fetchOpenInterest(symbols: string[]): Promise<OpenInterest[]> {
	const results: OpenInterest[] = [];
	await Promise.all(symbols.map(async (symbol) => {
		try {
			const res = await fetch(`${BINANCE_FUTURES}/openInterest?symbol=${symbol}`, {
				signal: AbortSignal.timeout(8_000),
			});
			if (!res.ok) return;
			const row = await res.json() as BinanceOIRow;
			results.push({
				symbol,
				openInterestCoin: parseFloat(row.openInterest),
				openInterestUSD: parseFloat(row.sumOpenInterestValue ?? '0'),
			});
		} catch {
			// skip on error
		}
	}));
	return results;
}

export async function fetchLongShortRatios(symbols: string[]): Promise<LongShortRatio[]> {
	const results: LongShortRatio[] = [];
	await Promise.all(symbols.map(async (symbol) => {
		try {
			const res = await fetch(
				`${BINANCE_FUTURES}/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`,
				{ signal: AbortSignal.timeout(8_000) },
			);
			if (!res.ok) return;
			const rows = await res.json() as BinanceLSRow[];
			const row = rows[0];
			if (!row) return;
			const longPct = parseFloat(row.longAccount);
			const shortPct = parseFloat(row.shortAccount);
			if (!isNaN(longPct) && !isNaN(shortPct)) {
				results.push({ symbol, longPct, shortPct });
			}
		} catch {
			// skip on error
		}
	}));
	return results;
}

export async function fetchLiquidations(symbols: string[]): Promise<LiquidationStats[]> {
	const results: LiquidationStats[] = [];
	await Promise.all(symbols.map(async (symbol) => {
		try {
			// Binance provides recent liquidations via /allForceOrders (last 24h default)
			const res = await fetch(
				`${BINANCE_FUTURES}/allForceOrders?symbol=${symbol}&limit=100`,
				{ signal: AbortSignal.timeout(8_000) },
			);
			if (!res.ok) return;
			const rows = await res.json() as BinanceLiqRow[];
			let longLiqUSD = 0;
			let shortLiqUSD = 0;
			for (const r of rows) {
				// BUY side liquidation = short position liquidated
				// SELL side liquidation = long position liquidated
				const value = parseFloat(r.origQty) * parseFloat(r.price);
				if (r.side === 'BUY') shortLiqUSD += value;
				else longLiqUSD += value;
			}
			results.push({ symbol, longLiqUSD, shortLiqUSD });
		} catch {
			// skip on error
		}
	}));
	return results;
}

// ─── Source 2: Deribit Options (BTC only) ────────────────────────────────────

const DERIBIT_BASE = 'https://www.deribit.com/api/v2/public';

export async function fetchDeribitOptions(): Promise<OptionsData | null> {
	try {
		const res = await fetch(
			`${DERIBIT_BASE}/get_book_summary_by_currency?currency=BTC&kind=option`,
			{ signal: AbortSignal.timeout(12_000) },
		);
		if (!res.ok) return null;

		const json = await res.json() as { result?: Array<{
			instrument_name: string;
			open_interest: number;
			underlying_price: number;
		}> };

		if (!json.result || json.result.length === 0) return null;

		let totalCallOI = 0;
		let totalPutOI = 0;
		// Map strike → { callOI, putOI } for max pain
		const strikeOI = new Map<number, { call: number; put: number }>();

		for (const item of json.result) {
			// instrument format: BTC-28MAR25-90000-C
			const parts = item.instrument_name.split('-');
			if (parts.length !== 4) continue;
			const strike = parseInt(parts[2], 10);
			if (isNaN(strike)) continue;
			const isCall = parts[3] === 'C';
			const oi = item.open_interest ?? 0;

			if (isCall) {
				totalCallOI += oi;
				const existing = strikeOI.get(strike) ?? { call: 0, put: 0 };
				strikeOI.set(strike, { ...existing, call: existing.call + oi });
			} else {
				totalPutOI += oi;
				const existing = strikeOI.get(strike) ?? { call: 0, put: 0 };
				strikeOI.set(strike, { ...existing, put: existing.put + oi });
			}
		}

		// Max pain: strike where total options value (extrinsic) is minimised
		// Approximation: find strike where sum of (in-the-money OI * distance) is lowest
		let maxPain: number | null = null;
		let minPain = Infinity;
		const strikes = Array.from(strikeOI.keys()).sort((a, b) => a - b);

		for (const s of strikes) {
			let pain = 0;
			for (const [k, { call, put }] of strikeOI) {
				if (k > s) pain += call * (k - s);   // calls ITM above s
				if (k < s) pain += put * (s - k);    // puts ITM below s
			}
			if (pain < minPain) {
				minPain = pain;
				maxPain = s;
			}
		}

		return {
			maxPain,
			putCallRatio: totalCallOI > 0 ? totalPutOI / totalCallOI : null,
			totalCallOI,
			totalPutOI,
		};
	} catch {
		return null;
	}
}

// ─── Main snapshot ────────────────────────────────────────────────────────────

export async function fetchDerivativesSnapshot(symbols: string[]): Promise<DerivativesSnapshot> {
	const hasBTC = symbols.some(s => s.startsWith('BTC'));

	const [fundingRates, openInterest, longShortRatios, liquidations, options] =
		await Promise.all([
			fetchFundingRates(symbols),
			fetchOpenInterest(symbols),
			fetchLongShortRatios(symbols),
			fetchLiquidations(symbols),
			hasBTC ? fetchDeribitOptions() : Promise.resolve(null),
		]);

	return { fundingRates, openInterest, longShortRatios, liquidations, options };
}
