// Backtest Performance Metrics - T-104
// Pure functions: Trade[] + EquityPoint[] → BacktestMetrics

import type { Trade, EquityPoint, BacktestMetrics } from '$lib/types/backtest';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[], sampleMean?: number): number {
	if (values.length < 2) return 0;
	const m = sampleMean ?? mean(values);
	const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
	return Math.sqrt(variance);
}

// ─── Max Drawdown ─────────────────────────────────────────────────────────────

export function calcMaxDrawdown(equity: EquityPoint[]): number {
	if (equity.length === 0) return 0;
	let peak = equity[0].equity;
	let maxDD = 0;
	for (const pt of equity) {
		if (pt.equity > peak) peak = pt.equity;
		const dd = peak > 0 ? ((peak - pt.equity) / peak) * 100 : 0;
		if (dd > maxDD) maxDD = dd;
	}
	return maxDD;
}

// ─── Equity Curve with Drawdown ───────────────────────────────────────────────

export function buildEquityCurve(
	initialCapital: number,
	trades: Trade[],
	startTime: number,
	endTime: number
): EquityPoint[] {
	const points: EquityPoint[] = [{ time: startTime, equity: initialCapital, drawdownPct: 0 }];
	let equity = initialCapital;
	let peak = initialCapital;

	for (const trade of trades) {
		equity += trade.pnl;
		if (equity > peak) peak = equity;
		const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
		points.push({ time: trade.exitTime, equity, drawdownPct });
	}

	// Add final point if the last trade exit isn't at endTime
	if (trades.length > 0 && trades[trades.length - 1].exitTime < endTime) {
		const last = points[points.length - 1];
		points.push({ time: endTime, equity: last.equity, drawdownPct: last.drawdownPct });
	}

	return points;
}

// ─── Sharpe Ratio (annualised, rf = 0) ───────────────────────────────────────

/** Estimates bar duration in seconds based on median gap between equity points */
function estimateBarsPerYear(equity: EquityPoint[]): number {
	if (equity.length < 2) return 252; // default daily
	const gaps: number[] = [];
	for (let i = 1; i < Math.min(equity.length, 100); i++) {
		const gap = equity[i].time - equity[i - 1].time;
		if (gap > 0) gaps.push(gap);
	}
	if (gaps.length === 0) return 252;
	gaps.sort((a, b) => a - b);
	const medianGap = gaps[Math.floor(gaps.length / 2)];
	const secondsPerYear = 365 * 24 * 3600;
	return secondsPerYear / medianGap;
}

export function calcSharpe(trades: Trade[], equity: EquityPoint[]): number {
	if (trades.length < 2) return 0;
	const returns = trades.map((t) => t.pnlPct);
	const m = mean(returns);
	const sd = stdDev(returns, m);
	if (sd === 0) return 0;
	const barsPerYear = estimateBarsPerYear(equity);
	// Annualise by assuming each trade takes 1 bar on average (conservative)
	return (m / sd) * Math.sqrt(barsPerYear);
}

// ─── Sortino Ratio (annualised, rf = 0) ──────────────────────────────────────

export function calcSortino(trades: Trade[], equity: EquityPoint[]): number {
	if (trades.length < 2) return 0;
	const returns = trades.map((t) => t.pnlPct);
	const m = mean(returns);
	const downsideReturns = returns.filter((r) => r < 0);
	if (downsideReturns.length === 0) return m > 0 ? Infinity : 0;
	const downsideStd = stdDev(downsideReturns, 0); // target = 0
	if (downsideStd === 0) return 0;
	const barsPerYear = estimateBarsPerYear(equity);
	return (m / downsideStd) * Math.sqrt(barsPerYear);
}

// ─── CAGR ────────────────────────────────────────────────────────────────────

export function calcCAGR(initialCapital: number, finalCapital: number, startTime: number, endTime: number): number {
	const seconds = endTime - startTime;
	if (seconds <= 0 || initialCapital <= 0) return 0;
	const years = seconds / (365 * 24 * 3600);
	if (years < 0.001) return 0;
	return (Math.pow(finalCapital / initialCapital, 1 / years) - 1) * 100;
}

// ─── Consecutive Losses ───────────────────────────────────────────────────────

export function calcMaxConsecutiveLosses(trades: Trade[]): number {
	let maxStreak = 0;
	let streak = 0;
	for (const t of trades) {
		if (t.pnl < 0) {
			streak++;
			if (streak > maxStreak) maxStreak = streak;
		} else {
			streak = 0;
		}
	}
	return maxStreak;
}

// ─── Profit Factor ────────────────────────────────────────────────────────────

export function calcProfitFactor(trades: Trade[]): number {
	let grossProfit = 0;
	let grossLoss = 0;
	for (const t of trades) {
		if (t.pnl > 0) grossProfit += t.pnl;
		else grossLoss += Math.abs(t.pnl);
	}
	if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
	return grossProfit / grossLoss;
}

// ─── Expectancy ───────────────────────────────────────────────────────────────

export function calcExpectancy(trades: Trade[]): number {
	if (trades.length === 0) return 0;
	return mean(trades.map((t) => t.pnl));
}

// ─── Master Metrics Calculator ────────────────────────────────────────────────

export function calcMetrics(
	trades: Trade[],
	equity: EquityPoint[],
	initialCapital: number,
	finalCapital: number,
	startTime: number,
	endTime: number
): BacktestMetrics {
	const profitableTrades = trades.filter((t) => t.pnl > 0);
	const losingTrades = trades.filter((t) => t.pnl <= 0);

	const winRate = trades.length > 0 ? (profitableTrades.length / trades.length) * 100 : 0;
	const avgRMultiple = trades.length > 0 ? mean(trades.map((t) => t.rMultiple)) : 0;

	const avgWin =
		profitableTrades.length > 0 ? mean(profitableTrades.map((t) => t.pnlPct)) : 0;
	const avgLoss =
		losingTrades.length > 0 ? mean(losingTrades.map((t) => t.pnlPct)) : 0;

	const totalReturn =
		initialCapital > 0 ? ((finalCapital - initialCapital) / initialCapital) * 100 : 0;

	return {
		totalReturn,
		cagr: calcCAGR(initialCapital, finalCapital, startTime, endTime),
		maxDrawdown: calcMaxDrawdown(equity),
		sharpe: calcSharpe(trades, equity),
		sortino: calcSortino(trades, equity),
		winRate,
		avgRMultiple,
		profitFactor: calcProfitFactor(trades),
		maxConsecutiveLosses: calcMaxConsecutiveLosses(trades),
		totalTrades: trades.length,
		profitableTrades: profitableTrades.length,
		losingTrades: losingTrades.length,
		avgWin,
		avgLoss,
		expectancy: calcExpectancy(trades),
	};
}
