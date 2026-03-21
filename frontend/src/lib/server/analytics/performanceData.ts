// Performance Analytics Data — T-403
// Computes equity curve, monthly returns, trade distribution, Sharpe/Sortino

import type { ClosedTrade } from '$lib/types/portfolio';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EquityPoint = {
	date: string;   // YYYY-MM-DD
	equity: number;
	drawdownPct: number;
};

export type MonthlyReturn = {
	year: number;
	month: number;   // 1-12
	pnl: number;
	returnPct: number | null;  // null if startEquity=0
};

export type TradeDistribution = {
	winCount: number;
	lossCount: number;
	breakEvenCount: number;
	avgWin: number | null;
	avgLoss: number | null;
	largestWin: number;
	largestLoss: number;
	rMultipleHistogram: { bucket: string; count: number }[];
};

export type PerformanceMetrics = {
	sharpe: number | null;    // annualised (252 trading days)
	sortino: number | null;   // annualised, downside only
	calmar: number | null;    // annualised return / max drawdown
	maxDrawdownPct: number;
	avgDailyReturn: number | null;
};

export type PerformanceData = {
	equityCurve: EquityPoint[];
	monthlyReturns: MonthlyReturn[];
	distribution: TradeDistribution;
	metrics: PerformanceMetrics;
	totalPnL: number;
	totalTrades: number;
};

// ─── Equity curve ─────────────────────────────────────────────────────────────

/**
 * Build daily equity curve from closed trades, starting at `startEquity`.
 * Trades are grouped by close date and summed.
 */
export function buildEquityCurve(
	trades: ClosedTrade[],
	startEquity: number
): EquityPoint[] {
	if (trades.length === 0) return [];

	// Group PnL by date
	const byDate = new Map<string, number>();
	for (const t of trades) {
		const date = t.closedAt.slice(0, 10);
		byDate.set(date, (byDate.get(date) ?? 0) + t.pnlUSD);
	}

	// Sort dates
	const dates = [...byDate.keys()].sort();

	let equity = startEquity;
	let peak = startEquity;
	const curve: EquityPoint[] = [];

	for (const date of dates) {
		equity += byDate.get(date)!;
		if (equity > peak) peak = equity;
		const drawdownPct = peak > 0 ? (peak - equity) / peak * 100 : 0;
		curve.push({ date, equity, drawdownPct });
	}

	return curve;
}

/**
 * Find maximum drawdown percentage from equity curve.
 */
export function calcMaxDrawdown(curve: EquityPoint[]): number {
	return curve.reduce((max, p) => Math.max(max, p.drawdownPct), 0);
}

// ─── Monthly returns ──────────────────────────────────────────────────────────

/**
 * Compute monthly PnL totals and return percentages.
 * returnPct = monthly pnl / equity at start of month.
 */
export function buildMonthlyReturns(
	trades: ClosedTrade[],
	startEquity: number
): MonthlyReturn[] {
	if (trades.length === 0) return [];

	// Group by YYYY-MM
	const byMonth = new Map<string, number>();
	for (const t of trades) {
		const key = t.closedAt.slice(0, 7); // YYYY-MM
		byMonth.set(key, (byMonth.get(key) ?? 0) + t.pnlUSD);
	}

	const keys = [...byMonth.keys()].sort();
	let equity = startEquity;
	const result: MonthlyReturn[] = [];

	for (const key of keys) {
		const pnl = byMonth.get(key)!;
		const [y, m] = key.split('-').map(Number);
		const returnPct = equity !== 0 ? (pnl / equity) * 100 : null;
		result.push({ year: y, month: m, pnl, returnPct });
		equity += pnl;
	}

	return result;
}

// ─── Trade distribution ───────────────────────────────────────────────────────

const R_BUCKETS = [
	{ label: '< -2R', min: -Infinity, max: -2 },
	{ label: '-2R to -1R', min: -2, max: -1 },
	{ label: '-1R to 0', min: -1, max: 0 },
	{ label: '0 to 1R', min: 0, max: 1 },
	{ label: '1R to 2R', min: 1, max: 2 },
	{ label: '2R to 3R', min: 2, max: 3 },
	{ label: '> 3R', min: 3, max: Infinity },
];

export function buildTradeDistribution(trades: ClosedTrade[]): TradeDistribution {
	const closed = trades.filter(t => t.pnlUSD !== undefined);
	const wins = closed.filter(t => t.pnlUSD > 0);
	const losses = closed.filter(t => t.pnlUSD < 0);
	const breakEvens = closed.filter(t => t.pnlUSD === 0);

	const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlUSD, 0) / wins.length : null;
	const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlUSD, 0) / losses.length : null;
	const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.pnlUSD)) : 0;
	const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.pnlUSD)) : 0;

	// R-multiple histogram
	const withR = closed.filter(t => t.rMultiple !== null);
	const histogram = R_BUCKETS.map(b => ({
		bucket: b.label,
		count: withR.filter(t => (t.rMultiple ?? 0) >= b.min && (t.rMultiple ?? 0) < b.max).length,
	}));

	return {
		winCount: wins.length,
		lossCount: losses.length,
		breakEvenCount: breakEvens.length,
		avgWin,
		avgLoss,
		largestWin,
		largestLoss,
		rMultipleHistogram: histogram,
	};
}

// ─── Risk metrics ─────────────────────────────────────────────────────────────

/**
 * Compute Sharpe ratio (annualised, 252 trading days).
 * Uses daily PnL relative to starting equity as daily returns.
 */
export function calcSharpe(dailyReturns: number[], riskFreeRate = 0): number | null {
	if (dailyReturns.length < 2) return null;
	const avg = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
	const variance = dailyReturns.reduce((s, r) => s + (r - avg) ** 2, 0) / (dailyReturns.length - 1);
	const stdDev = Math.sqrt(variance);
	if (stdDev === 0) return null;
	return ((avg - riskFreeRate / 252) / stdDev) * Math.sqrt(252);
}

/**
 * Compute Sortino ratio (annualised). Only penalises downside volatility.
 */
export function calcSortino(dailyReturns: number[], riskFreeRate = 0): number | null {
	if (dailyReturns.length < 2) return null;
	const avg = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
	const downsideReturns = dailyReturns.filter(r => r < 0);
	if (downsideReturns.length === 0) return null;
	const downsideVariance = downsideReturns.reduce((s, r) => s + r ** 2, 0) / downsideReturns.length;
	const downsideStdDev = Math.sqrt(downsideVariance);
	if (downsideStdDev === 0) return null;
	return ((avg - riskFreeRate / 252) / downsideStdDev) * Math.sqrt(252);
}

/**
 * Build daily returns array from equity curve (% return each day).
 */
export function toDailyReturns(curve: EquityPoint[], startEquity: number): number[] {
	if (curve.length === 0) return [];
	const points = [startEquity, ...curve.map(p => p.equity)];
	const returns: number[] = [];
	for (let i = 1; i < points.length; i++) {
		if (points[i - 1] === 0) continue;
		returns.push((points[i] - points[i - 1]) / points[i - 1]);
	}
	return returns;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildPerformanceData(
	trades: ClosedTrade[],
	startEquity: number
): PerformanceData {
	const equityCurve = buildEquityCurve(trades, startEquity);
	const monthlyReturns = buildMonthlyReturns(trades, startEquity);
	const distribution = buildTradeDistribution(trades);
	const maxDrawdownPct = calcMaxDrawdown(equityCurve);
	const dailyReturns = toDailyReturns(equityCurve, startEquity);

	const sharpe = calcSharpe(dailyReturns);
	const sortino = calcSortino(dailyReturns);

	// Calmar = annualised return / max drawdown
	const totalPnL = trades.reduce((s, t) => s + t.pnlUSD, 0);
	const totalReturnPct = startEquity > 0 ? (totalPnL / startEquity) * 100 : null;
	const calmar = maxDrawdownPct > 0 && totalReturnPct !== null
		? totalReturnPct / maxDrawdownPct
		: null;

	const avgDailyReturn = dailyReturns.length > 0
		? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length
		: null;

	return {
		equityCurve,
		monthlyReturns,
		distribution,
		metrics: { sharpe, sortino, calmar, maxDrawdownPct, avgDailyReturn },
		totalPnL,
		totalTrades: trades.length,
	};
}
