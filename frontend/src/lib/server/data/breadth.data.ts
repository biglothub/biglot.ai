// Market Breadth Data — T-206
// Sector ETF relative performance via Yahoo Finance

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SectorPerformance = {
	ticker: string;
	name: string;
	price: number;
	change1d: number;   // % change 1 day
	change1w: number;   // % change 1 week (~5 trading days)
	change1m: number;   // % change 1 month (~21 trading days)
	vsSpY1m: number;    // relative to SPY 1M (ETF 1M - SPY 1M)
};

export type BreadthSnapshot = {
	sectors: SectorPerformance[];
	spyChange1m: number;
	fetchedAt: string;
};

// ─── Sector ETF definitions ───────────────────────────────────────────────────

export const SECTOR_ETFS: Array<{ ticker: string; name: string }> = [
	{ ticker: 'SPY',  name: 'S&P 500' },
	{ ticker: 'XLK',  name: 'Technology' },
	{ ticker: 'XLF',  name: 'Financials' },
	{ ticker: 'XLV',  name: 'Health Care' },
	{ ticker: 'XLY',  name: 'Cons. Disc.' },
	{ ticker: 'XLP',  name: 'Cons. Staples' },
	{ ticker: 'XLE',  name: 'Energy' },
	{ ticker: 'XLI',  name: 'Industrials' },
	{ ticker: 'XLC',  name: 'Comm. Svcs.' },
	{ ticker: 'XLRE', name: 'Real Estate' },
	{ ticker: 'XLB',  name: 'Materials' },
	{ ticker: 'XLU',  name: 'Utilities' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Calculate % change from first to last close.
 */
export function calcPctChange(closes: number[], fromIndex: number): number {
	const base = closes[fromIndex];
	const last = closes[closes.length - 1];
	if (!base || base === 0) return 0;
	return ((last - base) / base) * 100;
}

/**
 * Classify sector performance relative to SPY.
 */
export function classifyRelative(vsSpy: number): 'outperform' | 'inline' | 'underperform' {
	if (vsSpy > 1) return 'outperform';
	if (vsSpy < -1) return 'underperform';
	return 'inline';
}

/**
 * Color for heatmap cell based on % change.
 */
export function heatmapColor(pct: number): string {
	if (pct > 5) return '#16a34a';      // strong green
	if (pct > 2) return '#4ade80';      // light green
	if (pct > 0) return '#86efac';      // pale green
	if (pct > -2) return '#fca5a5';     // pale red
	if (pct > -5) return '#f87171';     // light red
	return '#dc2626';                   // strong red
}

// ─── Yahoo Finance OHLCV fetch for ETF ───────────────────────────────────────

type YahooChartResult = {
	timestamp: number[];
	meta: { shortName?: string; regularMarketPrice?: number };
	indicators: { quote: Array<{ close: (number | null)[] }> };
};

async function fetchETFCloses(ticker: string): Promise<number[] | null> {
	const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=2mo`;
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BigLot.ai/1.0)', Accept: 'application/json' },
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) return null;

		const json = await res.json() as { chart?: { result?: YahooChartResult[] } };
		const result = json.chart?.result?.[0];
		if (!result?.indicators?.quote?.[0]?.close) return null;

		// Filter out null values and return valid closes
		return result.indicators.quote[0].close.filter((c): c is number => c !== null && !isNaN(c));
	} catch {
		return null;
	}
}

// ─── Main snapshot function ───────────────────────────────────────────────────

export async function fetchBreadthSnapshot(): Promise<BreadthSnapshot | null> {
	// Fetch all ETFs in parallel
	const results = await Promise.allSettled(
		SECTOR_ETFS.map(etf => fetchETFCloses(etf.ticker))
	);

	const closesMap = new Map<string, number[]>();
	for (let i = 0; i < SECTOR_ETFS.length; i++) {
		const r = results[i];
		if (r.status === 'fulfilled' && r.value && r.value.length >= 5) {
			closesMap.set(SECTOR_ETFS[i].ticker, r.value);
		}
	}

	// Need at least SPY + some sectors to be useful
	const spyCloses = closesMap.get('SPY');
	if (!spyCloses) return null;

	const spyChange1m = calcPctChange(spyCloses, Math.max(0, spyCloses.length - 22));
	const sectors: SectorPerformance[] = [];

	for (const etf of SECTOR_ETFS) {
		const closes = closesMap.get(etf.ticker);
		if (!closes || closes.length < 5) continue;

		const n = closes.length;
		const change1d = calcPctChange(closes, n - 2);
		const change1w = calcPctChange(closes, Math.max(0, n - 6));
		const change1m = calcPctChange(closes, Math.max(0, n - 22));
		const vsSpY1m = change1m - spyChange1m;

		sectors.push({
			ticker: etf.ticker,
			name: etf.name,
			price: closes[n - 1],
			change1d,
			change1w,
			change1m,
			vsSpY1m,
		});
	}

	if (sectors.length === 0) return null;

	return {
		sectors,
		spyChange1m,
		fetchedAt: new Date().toISOString(),
	};
}
