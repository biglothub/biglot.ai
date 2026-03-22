// Yield Curve & Macro Data — T-803
// Fetches US Treasury yields from Yahoo Finance and computes key spreads

// ─── Types ────────────────────────────────────────────────────────────────────

export type YieldPoint = {
	maturity:  string;  // e.g. '3M', '2Y', '5Y', '10Y', '30Y'
	symbol:    string;  // Yahoo Finance symbol
	yield:     number;  // annualised yield in %
	prevYield: number;  // previous close
	change:    number;  // day change in bps (basis points)
};

export type YieldSpread = {
	name:      string;
	shortYield: number;
	longYield:  number;
	spread:     number;  // bps = (longYield - shortYield) * 100
	signal:     string;
};

export type CurveClassification = 'normal' | 'flat' | 'inverted' | 'humped';

export type YieldCurveSnapshot = {
	yields:         YieldPoint[];
	spreads:        YieldSpread[];
	classification: CurveClassification;
	classificationLabel: string;
	fetchedAt:      number;
};

// ─── Yahoo Finance tickers ────────────────────────────────────────────────────

const TREASURY_TICKERS: { maturity: string; symbol: string }[] = [
	{ maturity: '3M',  symbol: '^IRX'    },  // 13-week T-Bill
	{ maturity: '2Y',  symbol: '^UST2Y'  },  // 2-year Treasury
	{ maturity: '5Y',  symbol: '^FVX'    },  // 5-year Treasury
	{ maturity: '10Y', symbol: '^TNX'    },  // 10-year Treasury
	{ maturity: '30Y', symbol: '^TYX'    },  // 30-year Treasury
];

// ─── Fetcher ──────────────────────────────────────────────────────────────────

export type YieldFetcher = (symbol: string) => Promise<{ current: number; prev: number } | null>;

export const defaultYieldFetcher: YieldFetcher = async (symbol) => {
	try {
		const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return null;

		const data = await res.json() as {
			chart?: {
				result?: {
					indicators?: {
						quote?: { close?: (number | null)[] }[];
					};
				}[];
			};
		};

		const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
		if (!closes || closes.length < 2) return null;

		// Filter out nulls
		const valid = closes.filter((v): v is number => v !== null && isFinite(v));
		if (valid.length < 2) return null;

		return { current: valid[valid.length - 1], prev: valid[valid.length - 2] };
	} catch {
		return null;
	}
};

// ─── Curve Classification ─────────────────────────────────────────────────────

export function classifyCurve(
	y3m:  number | null,
	y2y:  number | null,
	y10y: number | null,
	y30y: number | null,
): CurveClassification {
	// Inverted: short rates > long rates
	if (y3m !== null && y10y !== null && y3m > y10y) return 'inverted';
	if (y2y !== null && y10y !== null && y2y > y10y) return 'inverted';

	// Flat: less than 25bps spread between 2Y and 10Y
	if (y2y !== null && y10y !== null && Math.abs(y10y - y2y) < 0.25) return 'flat';

	// Humped: 5Y > 10Y > 30Y (unusual)
	// Normal: yields increase with maturity
	return 'normal';
}

export function classificationLabel(c: CurveClassification): string {
	switch (c) {
		case 'inverted': return 'INVERTED — Recession warning signal';
		case 'flat':     return 'FLAT — Late-cycle / uncertainty';
		case 'humped':   return 'HUMPED — Unusual shape';
		case 'normal':   return 'NORMAL — Healthy growth expectations';
	}
}

// ─── Builder ──────────────────────────────────────────────────────────────────

export async function buildYieldCurveSnapshot(
	fetcher: YieldFetcher = defaultYieldFetcher,
): Promise<YieldCurveSnapshot> {
	// Fetch all yields in parallel
	const results = await Promise.allSettled(
		TREASURY_TICKERS.map(async (t) => {
			const data = await fetcher(t.symbol);
			return { ...t, data };
		}),
	);

	const yields: YieldPoint[] = [];

	for (const r of results) {
		if (r.status !== 'fulfilled') continue;
		const { maturity, symbol, data } = r.value;
		if (!data) continue;

		yields.push({
			maturity,
			symbol,
			yield:     data.current,
			prevYield: data.prev,
			change:    (data.current - data.prev) * 100,  // bps
		});
	}

	// Extract key yields by maturity
	const get = (m: string) => yields.find(y => y.maturity === m)?.yield ?? null;
	const y3m  = get('3M');
	const y2y  = get('2Y');
	const y5y  = get('5Y');
	const y10y = get('10Y');
	const y30y = get('30Y');

	// ── Key Spreads ────────────────────────────────────────────────────────────
	const spreads: YieldSpread[] = [];

	if (y2y !== null && y10y !== null) {
		const spread = (y10y - y2y) * 100; // bps
		spreads.push({
			name:       '2s10s (2Y vs 10Y)',
			shortYield: y2y,
			longYield:  y10y,
			spread,
			signal:     spread < -25 ? 'INVERTED — Recession risk elevated' :
			            spread <   0 ? 'Slightly inverted — watch closely' :
			            spread <  50 ? 'Flat — late cycle signal' :
			            spread < 150 ? 'Normal — healthy curve' :
			                           'Steep — early cycle / reflationary',
		});
	}

	if (y3m !== null && y10y !== null) {
		const spread = (y10y - y3m) * 100; // bps
		spreads.push({
			name:       '3m10y (Fed-preferred)',
			shortYield: y3m,
			longYield:  y10y,
			spread,
			signal:     spread < -25 ? 'INVERTED — Fed model signals recession' :
			            spread <   0 ? 'Slightly inverted' :
			            spread < 100 ? 'Flat / compressed' :
			                           'Positive — growth expectations intact',
		});
	}

	if (y5y !== null && y30y !== null) {
		const spread = (y30y - y5y) * 100; // bps
		spreads.push({
			name:       '5s30s (Belly vs Long)',
			shortYield: y5y,
			longYield:  y30y,
			spread,
			signal:     spread < 0 ? 'Inverted belly' : spread < 50 ? 'Flat long end' : 'Normal steepening',
		});
	}

	const classification = classifyCurve(y3m, y2y, y10y, y30y);

	return {
		yields,
		spreads,
		classification,
		classificationLabel: classificationLabel(classification),
		fetchedAt: Date.now(),
	};
}
