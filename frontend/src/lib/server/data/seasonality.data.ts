// Seasonality Analysis Data — T-704
// Monthly return averages + day-of-week effects from Yahoo Finance historical data

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MonthlyReturn {
	year:      number;
	month:     number; // 1-12
	returnPct: number;
}

export interface SeasonalScore {
	month:         number; // 1-12
	monthName:     string;
	avgReturnPct:  number;
	medianReturn:  number;
	positiveYears: number;
	totalYears:    number;
	winRate:       number; // 0-100
	score:         number; // -100..+100 composite seasonal strength
}

export interface DayOfWeekScore {
	dayIndex:     number; // 0=Sunday..6=Saturday
	dayName:      string;
	avgReturnPct: number;
	sampleCount:  number;
}

export interface SeasonalityData {
	symbol:        string;
	monthlyScores: SeasonalScore[];
	dowScores:     DayOfWeekScore[];
	bestMonths:    number[];  // top 3 month indices (1-12)
	worstMonths:   number[];  // bottom 3 month indices
	currentMonth:  number;
	currentMonthScore: SeasonalScore | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const MONTH_NAMES = [
	'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
	'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Compute monthly returns from a price series with timestamps. */
export function computeMonthlyReturns(
	timestamps: number[], // Unix seconds
	closes:     number[],
): MonthlyReturn[] {
	if (timestamps.length !== closes.length || timestamps.length < 2) return [];

	const byMonth = new Map<string, { open: number; close: number }>();

	for (let i = 0; i < timestamps.length; i++) {
		const d = new Date(timestamps[i] * 1000);
		const key = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`;

		if (!byMonth.has(key)) {
			byMonth.set(key, { open: closes[i], close: closes[i] });
		} else {
			const entry = byMonth.get(key)!;
			entry.close = closes[i];
		}
	}

	const results: MonthlyReturn[] = [];
	for (const [key, { open, close }] of byMonth.entries()) {
		const [yearStr, monthStr] = key.split('-');
		if (open === 0) continue;
		results.push({
			year:       parseInt(yearStr),
			month:      parseInt(monthStr),
			returnPct:  (close - open) / open * 100,
		});
	}

	return results.sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month));
}

/** Compute average returns per day of week from daily closes. */
export function computeDOWReturns(
	timestamps: number[],
	closes:     number[],
): DayOfWeekScore[] {
	if (timestamps.length < 2) return [];

	const buckets: number[][] = Array.from({ length: 7 }, () => []);

	for (let i = 1; i < timestamps.length; i++) {
		const ret = closes[i - 1] > 0 ? (closes[i] - closes[i - 1]) / closes[i - 1] * 100 : 0;
		const day = new Date(timestamps[i] * 1000).getUTCDay();
		buckets[day].push(ret);
	}

	return buckets.map((rets, dayIndex) => ({
		dayIndex,
		dayName:     DAY_NAMES[dayIndex],
		avgReturnPct: rets.length > 0 ? rets.reduce((s, r) => s + r, 0) / rets.length : 0,
		sampleCount: rets.length,
	})).filter(d => d.sampleCount > 0);
}

/** Aggregate monthly returns into seasonal scores per month (1–12). */
export function aggregateMonthlyScores(monthly: MonthlyReturn[]): SeasonalScore[] {
	const buckets = new Map<number, number[]>();
	for (const r of monthly) {
		if (!buckets.has(r.month)) buckets.set(r.month, []);
		buckets.get(r.month)!.push(r.returnPct);
	}

	const scores: SeasonalScore[] = [];
	for (let m = 1; m <= 12; m++) {
		const rets = buckets.get(m) ?? [];
		if (rets.length === 0) {
			scores.push({ month: m, monthName: MONTH_NAMES[m - 1], avgReturnPct: 0, medianReturn: 0, positiveYears: 0, totalYears: 0, winRate: 0, score: 0 });
			continue;
		}

		const sorted     = [...rets].sort((a, b) => a - b);
		const midIdx     = Math.floor(sorted.length / 2);
		const median     = sorted.length % 2 === 0
			? (sorted[midIdx - 1] + sorted[midIdx]) / 2
			: sorted[midIdx];
		const positive   = rets.filter(r => r > 0).length;
		const winRate    = positive / rets.length * 100;
		const avgReturn  = rets.reduce((s, r) => s + r, 0) / rets.length;

		// Composite score: blend avg return (weighted 60%) + win rate above 50% (40%)
		const retScore   = Math.max(-100, Math.min(100, avgReturn * 10));
		const wrScore    = (winRate - 50) * 2; // -100..+100
		const score      = Math.round(retScore * 0.6 + wrScore * 0.4);

		scores.push({
			month: m, monthName: MONTH_NAMES[m - 1],
			avgReturnPct: avgReturn,
			medianReturn: median,
			positiveYears: positive,
			totalYears: rets.length,
			winRate,
			score: Math.max(-100, Math.min(100, score)),
		});
	}

	return scores;
}

// ─── Yahoo Finance fetcher ────────────────────────────────────────────────────

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';

export async function fetchYahooHistory(
	symbol: string,
	years = 5,
): Promise<{ timestamps: number[]; closes: number[] }> {
	try {
		const period2 = Math.floor(Date.now() / 1000);
		const period1 = period2 - years * 365 * 86_400;
		const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?interval=1d&period1=${period1}&period2=${period2}`;
		const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
		if (!resp.ok) return { timestamps: [], closes: [] };
		const json = await resp.json() as Record<string, unknown>;
		const result = (json as { chart?: { result?: unknown[] } })?.chart?.result?.[0] as Record<string, unknown> | undefined;
		const ts: number[] = (result?.timestamp as number[] | undefined) ?? [];
		const closes: number[] = ((result?.indicators as Record<string, unknown> | undefined)
			?.quote as Array<Record<string, unknown>> | undefined)?.[0]
			?.close as number[] ?? [];
		const filtered: { t: number; c: number }[] = [];
		for (let i = 0; i < Math.min(ts.length, closes.length); i++) {
			const c = closes[i];
			if (typeof c === 'number' && c > 0) {
				filtered.push({ t: ts[i], c });
			}
		}
		return {
			timestamps: filtered.map(x => x.t),
			closes:     filtered.map(x => x.c),
		};
	} catch {
		return { timestamps: [], closes: [] };
	}
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildSeasonalityData(
	symbol: string,
	years = 5,
	fetcher: (s: string, y: number) => Promise<{ timestamps: number[]; closes: number[] }> = fetchYahooHistory,
): Promise<SeasonalityData> {
	const { timestamps, closes } = await fetcher(symbol, years);
	const monthly  = computeMonthlyReturns(timestamps, closes);
	const scores   = aggregateMonthlyScores(monthly);
	const dowScores = computeDOWReturns(timestamps, closes);

	const sorted      = [...scores].sort((a, b) => b.score - a.score);
	const bestMonths  = sorted.slice(0, 3).map(s => s.month);
	const worstMonths = sorted.slice(-3).map(s => s.month);

	const currentMonth = new Date().getUTCMonth() + 1;
	const currentMonthScore = scores.find(s => s.month === currentMonth) ?? null;

	return { symbol, monthlyScores: scores, dowScores, bestMonths, worstMonths, currentMonth, currentMonthScore };
}
