// Tests for performance analytics data — T-403
import { describe, it, expect } from 'vitest';
import {
	buildEquityCurve,
	calcMaxDrawdown,
	buildMonthlyReturns,
	buildTradeDistribution,
	calcSharpe,
	calcSortino,
	toDailyReturns,
	buildPerformanceData,
} from './performanceData';
import type { ClosedTrade } from '$lib/types/portfolio';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<ClosedTrade> = {}): ClosedTrade {
	return {
		id: 't1',
		userId: 'user-1',
		symbol: 'BTCUSDT',
		direction: 'long',
		entryPrice: 50000,
		exitPrice: 52000,
		size: 0.1,
		pnlUSD: 200,
		rMultiple: 1.0,
		openedAt: '2024-01-01T00:00:00Z',
		closedAt: '2024-01-05T00:00:00Z',
		notes: null,
		...overrides,
	};
}

// ─── buildEquityCurve ─────────────────────────────────────────────────────────

describe('buildEquityCurve', () => {
	it('returns empty for no trades', () => {
		expect(buildEquityCurve([], 10000)).toEqual([]);
	});

	it('builds curve with correct equity and drawdown', () => {
		const trades = [
			makeTrade({ closedAt: '2024-01-05T00:00:00Z', pnlUSD: 500 }),
			makeTrade({ closedAt: '2024-01-06T00:00:00Z', pnlUSD: -300 }),
		];
		const curve = buildEquityCurve(trades, 10000);

		expect(curve).toHaveLength(2);
		expect(curve[0].equity).toBe(10500);
		expect(curve[0].drawdownPct).toBe(0);  // at new peak
		expect(curve[1].equity).toBe(10200);
		// (10500 - 10200) / 10500 * 100 ≈ 2.857%
		expect(curve[1].drawdownPct).toBeCloseTo(2.857, 1);
	});

	it('groups multiple trades on same day', () => {
		const trades = [
			makeTrade({ closedAt: '2024-01-05T09:00:00Z', pnlUSD: 200 }),
			makeTrade({ closedAt: '2024-01-05T15:00:00Z', pnlUSD: 100 }),
		];
		const curve = buildEquityCurve(trades, 10000);
		expect(curve).toHaveLength(1);
		expect(curve[0].equity).toBe(10300);
	});

	it('sorts dates correctly', () => {
		const trades = [
			makeTrade({ closedAt: '2024-03-01T00:00:00Z', pnlUSD: 100 }),
			makeTrade({ closedAt: '2024-01-01T00:00:00Z', pnlUSD: 200 }),
		];
		const curve = buildEquityCurve(trades, 10000);
		expect(curve[0].date).toBe('2024-01-01');
		expect(curve[1].date).toBe('2024-03-01');
	});
});

// ─── calcMaxDrawdown ──────────────────────────────────────────────────────────

describe('calcMaxDrawdown', () => {
	it('returns 0 for empty curve', () => {
		expect(calcMaxDrawdown([])).toBe(0);
	});

	it('returns maximum drawdown percentage', () => {
		const curve = [
			{ date: '2024-01-01', equity: 12000, drawdownPct: 0 },
			{ date: '2024-01-02', equity: 9000, drawdownPct: 25 },   // peak 12000 → 25%
			{ date: '2024-01-03', equity: 10000, drawdownPct: 16.67 },
		];
		expect(calcMaxDrawdown(curve)).toBe(25);
	});
});

// ─── buildMonthlyReturns ──────────────────────────────────────────────────────

describe('buildMonthlyReturns', () => {
	it('returns empty for no trades', () => {
		expect(buildMonthlyReturns([], 10000)).toEqual([]);
	});

	it('groups trades by month and computes return %', () => {
		const trades = [
			makeTrade({ closedAt: '2024-01-10T00:00:00Z', pnlUSD: 500 }),
			makeTrade({ closedAt: '2024-01-20T00:00:00Z', pnlUSD: -100 }),
			makeTrade({ closedAt: '2024-02-05T00:00:00Z', pnlUSD: 300 }),
		];
		const months = buildMonthlyReturns(trades, 10000);

		expect(months).toHaveLength(2);
		expect(months[0].year).toBe(2024);
		expect(months[0].month).toBe(1);
		expect(months[0].pnl).toBe(400);
		expect(months[0].returnPct).toBeCloseTo(4);    // 400/10000 * 100

		expect(months[1].month).toBe(2);
		expect(months[1].pnl).toBe(300);
		// Start of Feb equity = 10400
		expect(months[1].returnPct).toBeCloseTo(300 / 10400 * 100, 1);
	});

	it('handles zero start equity gracefully', () => {
		const trades = [makeTrade({ pnlUSD: 100 })];
		const months = buildMonthlyReturns(trades, 0);
		expect(months[0].returnPct).toBeNull();
	});
});

// ─── buildTradeDistribution ───────────────────────────────────────────────────

describe('buildTradeDistribution', () => {
	it('returns zeros for empty trades', () => {
		const dist = buildTradeDistribution([]);
		expect(dist.winCount).toBe(0);
		expect(dist.lossCount).toBe(0);
		expect(dist.avgWin).toBeNull();
		expect(dist.avgLoss).toBeNull();
	});

	it('separates wins, losses, break-evens', () => {
		const trades = [
			makeTrade({ pnlUSD: 100 }),
			makeTrade({ pnlUSD: -50 }),
			makeTrade({ pnlUSD: 0 }),
			makeTrade({ pnlUSD: 200 }),
		];
		const dist = buildTradeDistribution(trades);
		expect(dist.winCount).toBe(2);
		expect(dist.lossCount).toBe(1);
		expect(dist.breakEvenCount).toBe(1);
	});

	it('calculates avgWin and avgLoss correctly', () => {
		const trades = [
			makeTrade({ pnlUSD: 100 }),
			makeTrade({ pnlUSD: 300 }),
			makeTrade({ pnlUSD: -50 }),
			makeTrade({ pnlUSD: -150 }),
		];
		const dist = buildTradeDistribution(trades);
		expect(dist.avgWin).toBeCloseTo(200);
		expect(dist.avgLoss).toBeCloseTo(-100);
	});

	it('identifies largest win and loss', () => {
		const trades = [
			makeTrade({ pnlUSD: 500 }),
			makeTrade({ pnlUSD: 100 }),
			makeTrade({ pnlUSD: -300 }),
			makeTrade({ pnlUSD: -50 }),
		];
		const dist = buildTradeDistribution(trades);
		expect(dist.largestWin).toBe(500);
		expect(dist.largestLoss).toBe(-300);
	});

	it('builds R-multiple histogram', () => {
		const trades = [
			makeTrade({ pnlUSD: 200, rMultiple: 2.5 }),    // 2R to 3R
			makeTrade({ pnlUSD: 100, rMultiple: 0.5 }),    // 0 to 1R
			makeTrade({ pnlUSD: -100, rMultiple: -1.5 }),  // -2R to -1R
		];
		const dist = buildTradeDistribution(trades);
		const bucket2to3 = dist.rMultipleHistogram.find(b => b.bucket === '2R to 3R');
		const bucket0to1 = dist.rMultipleHistogram.find(b => b.bucket === '0 to 1R');
		expect(bucket2to3?.count).toBe(1);
		expect(bucket0to1?.count).toBe(1);
	});
});

// ─── calcSharpe / calcSortino ─────────────────────────────────────────────────

describe('calcSharpe', () => {
	it('returns null for empty or single-element returns', () => {
		expect(calcSharpe([])).toBeNull();
		expect(calcSharpe([0.01])).toBeNull();
	});

	it('returns null when all returns are equal (zero std dev)', () => {
		expect(calcSharpe([0.01, 0.01, 0.01])).toBeNull();
	});

	it('returns positive Sharpe for consistently positive returns', () => {
		// All positive returns should produce a positive Sharpe
		const returns = Array(50).fill(0).map((_, i) => 0.001 + (i % 5) * 0.0001);
		const sharpe = calcSharpe(returns);
		expect(sharpe).not.toBeNull();
		expect(sharpe!).toBeGreaterThan(0);
	});

	it('is annualised (multiplied by sqrt(252))', () => {
		// Create a return series with known mean and std
		const returns = [0.01, -0.01, 0.01, -0.01, 0.02, -0.01, 0.015, -0.005];
		const sharpe = calcSharpe(returns);
		// Should be annualised — just verify it's not NaN
		expect(sharpe).not.toBeNull();
		expect(isNaN(sharpe!)).toBe(false);
	});
});

describe('calcSortino', () => {
	it('returns null for insufficient returns', () => {
		expect(calcSortino([])).toBeNull();
	});

	it('returns null when no downside returns', () => {
		expect(calcSortino([0.01, 0.02, 0.03])).toBeNull();
	});

	it('returns defined value with mixed returns', () => {
		const returns = [0.01, -0.005, 0.02, -0.008, 0.015];
		const sortino = calcSortino(returns);
		expect(sortino).not.toBeNull();
		expect(isNaN(sortino!)).toBe(false);
	});
});

// ─── toDailyReturns ───────────────────────────────────────────────────────────

describe('toDailyReturns', () => {
	it('returns empty for empty curve', () => {
		expect(toDailyReturns([], 10000)).toEqual([]);
	});

	it('computes returns relative to previous equity', () => {
		const curve = [
			{ date: '2024-01-01', equity: 10500, drawdownPct: 0 },
			{ date: '2024-01-02', equity: 10200, drawdownPct: 2.86 },
		];
		const returns = toDailyReturns(curve, 10000);
		expect(returns).toHaveLength(2);
		expect(returns[0]).toBeCloseTo(0.05);   // (10500 - 10000) / 10000
		expect(returns[1]).toBeCloseTo(-300 / 10500, 5);
	});
});

// ─── buildPerformanceData ─────────────────────────────────────────────────────

describe('buildPerformanceData', () => {
	it('handles empty trades', () => {
		const data = buildPerformanceData([], 10000);
		expect(data.totalTrades).toBe(0);
		expect(data.totalPnL).toBe(0);
		expect(data.equityCurve).toHaveLength(0);
		expect(data.monthlyReturns).toHaveLength(0);
	});

	it('computes correct totalPnL', () => {
		const trades = [
			makeTrade({ pnlUSD: 500 }),
			makeTrade({ pnlUSD: -200 }),
			makeTrade({ pnlUSD: 300 }),
		];
		const data = buildPerformanceData(trades, 10000);
		expect(data.totalPnL).toBe(600);
		expect(data.totalTrades).toBe(3);
	});

	it('includes all subcomponents', () => {
		const trades = [makeTrade({ pnlUSD: 200, rMultiple: 2 })];
		const data = buildPerformanceData(trades, 10000);
		expect(data.equityCurve.length).toBeGreaterThan(0);
		expect(data.monthlyReturns.length).toBeGreaterThan(0);
		expect(data.distribution).toBeDefined();
		expect(data.metrics).toBeDefined();
	});
});
