// Tests for drawdown monitor — T-303
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	classifyRiskLevel,
	calcCurrentDrawdown,
	calcDailyPnL,
	calcOpenRisk,
	calcOverallRiskScore,
	buildRiskSnapshot,
	DEFAULT_LIMITS,
} from './drawdownMonitor';
import type { PortfolioSnapshot } from '$lib/types/portfolio';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

vi.mock('../supabaseAdmin.server', () => ({
	getSupabaseAdminClient: vi.fn(),
}));

// Import tool to register it
import '../tools/riskMonitor.tool';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = '2024-06-01';

function makeSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
	return {
		positions: [],
		closedTrades: [],
		totalUnrealisedPnL: 0,
		totalRealised: 0,
		winRate: null,
		avgRMultiple: null,
		equityCurve: [],
		...overrides,
	};
}

// ─── classifyRiskLevel ────────────────────────────────────────────────────────

describe('classifyRiskLevel', () => {
	it('returns safe below 50', () => {
		expect(classifyRiskLevel(0)).toBe('safe');
		expect(classifyRiskLevel(49)).toBe('safe');
	});

	it('returns warning at 50', () => {
		expect(classifyRiskLevel(50)).toBe('warning');
		expect(classifyRiskLevel(74)).toBe('warning');
	});

	it('returns danger at 75', () => {
		expect(classifyRiskLevel(75)).toBe('danger');
		expect(classifyRiskLevel(89)).toBe('danger');
	});

	it('returns critical at 90+', () => {
		expect(classifyRiskLevel(90)).toBe('critical');
		expect(classifyRiskLevel(100)).toBe('critical');
	});

	it('respects custom thresholds', () => {
		expect(classifyRiskLevel(30, { warning: 30, danger: 60, critical: 80 })).toBe('warning');
		expect(classifyRiskLevel(29, { warning: 30, danger: 60, critical: 80 })).toBe('safe');
	});
});

// ─── calcCurrentDrawdown ──────────────────────────────────────────────────────

describe('calcCurrentDrawdown', () => {
	it('returns 0 with empty curve', () => {
		const result = calcCurrentDrawdown([], 10000);
		expect(result.currentDrawdownPct).toBe(0);
		expect(result.peakEquity).toBe(10000);
		expect(result.currentEquity).toBe(10000);
		expect(result.riskLevel).toBe('safe');
	});

	it('calculates drawdown from peak correctly', () => {
		const curve = [
			{ date: '2024-01-01', equity: 10000 },
			{ date: '2024-01-02', equity: 11000 },
			{ date: '2024-01-03', equity: 9350 }, // drawdown from 11000
		];
		const result = calcCurrentDrawdown(curve, 10000);
		expect(result.peakEquity).toBe(11000);
		expect(result.currentEquity).toBe(9350);
		// (11000 - 9350) / 11000 * 100 = 15%
		expect(result.currentDrawdownPct).toBeCloseTo(15, 1);
	});

	it('returns 0 when at new peak', () => {
		const curve = [
			{ date: '2024-01-01', equity: 10000 },
			{ date: '2024-01-02', equity: 11000 },
			{ date: '2024-01-03', equity: 12000 },
		];
		const result = calcCurrentDrawdown(curve, 10000);
		expect(result.currentDrawdownPct).toBe(0);
		expect(result.peakEquity).toBe(12000);
	});

	it('uses startingEquity as floor for peak', () => {
		const curve = [{ date: '2024-01-01', equity: 8000 }];
		const result = calcCurrentDrawdown(curve, 10000);
		expect(result.peakEquity).toBe(10000);
		// (10000 - 8000) / 10000 * 100 = 20%
		expect(result.currentDrawdownPct).toBeCloseTo(20, 1);
	});

	it('classifies drawdown risk correctly', () => {
		// 60% drawdown from 10000 starting
		const curve = [
			{ date: '2024-01-01', equity: 10000 },
			{ date: '2024-01-02', equity: 4000 },
		];
		const result = calcCurrentDrawdown(curve, 10000);
		// 60% drawdown → risk level depends on classifyRiskLevel defaults (50=warning, 75=danger, 90=crit)
		expect(result.riskLevel).toBe('warning');
	});
});

// ─── calcDailyPnL ─────────────────────────────────────────────────────────────

describe('calcDailyPnL', () => {
	it('returns only unrealised when no trades today', () => {
		const snap = makeSnapshot({
			totalUnrealisedPnL: 200,
			closedTrades: [
				{
					id: 't1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
					entryPrice: 50000, exitPrice: 51000, size: 0.1,
					pnlUSD: 100, rMultiple: null, openedAt: '2024-05-31T00:00:00Z',
					closedAt: '2024-05-31T10:00:00Z', notes: null,
				}
			],
		});
		expect(calcDailyPnL(snap, TODAY)).toBeCloseTo(200);
	});

	it('adds today\'s realised trades to unrealised', () => {
		const snap = makeSnapshot({
			totalUnrealisedPnL: 100,
			closedTrades: [
				{
					id: 't1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
					entryPrice: 50000, exitPrice: 51000, size: 0.1,
					pnlUSD: 300, rMultiple: null, openedAt: '2024-06-01T00:00:00Z',
					closedAt: `${TODAY}T10:00:00Z`, notes: null,
				},
				{
					id: 't2', userId: 'u1', symbol: 'ETHUSDT', direction: 'short',
					entryPrice: 3000, exitPrice: 2900, size: 1,
					pnlUSD: -200, rMultiple: null, openedAt: '2024-06-01T00:00:00Z',
					closedAt: `${TODAY}T14:00:00Z`, notes: null,
				}
			],
		});
		// 100 unrealised + 300 - 200 today = 200
		expect(calcDailyPnL(snap, TODAY)).toBeCloseTo(200);
	});

	it('handles negative total (net loss day)', () => {
		const snap = makeSnapshot({
			totalUnrealisedPnL: -500,
			closedTrades: [{
				id: 't1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
				entryPrice: 50000, exitPrice: 49000, size: 0.1,
				pnlUSD: -100, rMultiple: null, openedAt: '2024-06-01T00:00:00Z',
				closedAt: `${TODAY}T09:00:00Z`, notes: null,
			}],
		});
		expect(calcDailyPnL(snap, TODAY)).toBeCloseTo(-600);
	});
});

// ─── calcOpenRisk ─────────────────────────────────────────────────────────────

describe('calcOpenRisk', () => {
	it('returns zero risk with no positions', () => {
		const snap = makeSnapshot();
		const result = calcOpenRisk(snap, 10000);
		expect(result.totalOpenRiskUSD).toBe(0);
		expect(result.accountRiskPct).toBe(0);
		expect(result.positionsWithoutStop).toBe(0);
	});

	it('calculates risk from stop distance', () => {
		const snap = makeSnapshot({
			positions: [{
				id: 'p1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
				entryPrice: 50000, size: 0.1, stopPrice: 48000, targetPrice: null,
				notes: null, openedAt: '2024-06-01T00:00:00Z',
				currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
			}],
		});
		const result = calcOpenRisk(snap, 10000);
		// |50000 - 48000| * 0.1 = 200
		expect(result.totalOpenRiskUSD).toBeCloseTo(200);
		// 200 / 10000 * 100 = 2%
		expect(result.accountRiskPct).toBeCloseTo(2);
		expect(result.positionsWithoutStop).toBe(0);
	});

	it('counts positions without stop separately', () => {
		const snap = makeSnapshot({
			positions: [
				{
					id: 'p1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
					entryPrice: 50000, size: 0.1, stopPrice: null, targetPrice: null,
					notes: null, openedAt: '2024-06-01T00:00:00Z',
					currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
				},
				{
					id: 'p2', userId: 'u1', symbol: 'ETHUSDT', direction: 'short',
					entryPrice: 3000, size: 1, stopPrice: 3300, targetPrice: null,
					notes: null, openedAt: '2024-06-01T00:00:00Z',
					currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
				},
			],
		});
		const result = calcOpenRisk(snap, 10000);
		expect(result.positionsWithoutStop).toBe(1);
		// Only p2 counted: |3000 - 3300| * 1 = 300
		expect(result.totalOpenRiskUSD).toBeCloseTo(300);
	});

	it('handles short position risk correctly', () => {
		const snap = makeSnapshot({
			positions: [{
				id: 'p1', userId: 'u1', symbol: 'BTCUSDT', direction: 'short',
				entryPrice: 50000, size: 0.2, stopPrice: 52000, targetPrice: null,
				notes: null, openedAt: '2024-06-01T00:00:00Z',
				currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
			}],
		});
		const result = calcOpenRisk(snap, 10000);
		// |50000 - 52000| * 0.2 = 400
		expect(result.totalOpenRiskUSD).toBeCloseTo(400);
	});
});

// ─── calcOverallRiskScore ─────────────────────────────────────────────────────

describe('calcOverallRiskScore', () => {
	it('returns 0 with no risk', () => {
		expect(calcOverallRiskScore(0, 20, 0, 0, 10)).toBe(0);
	});

	it('returns 100 when all dimensions maxed', () => {
		// drawdown = 20/20 → 100%, dailyLoss = 100%, openRisk = 10/10 → 100%
		const score = calcOverallRiskScore(20, 20, 100, 10, 10);
		expect(score).toBe(100);
	});

	it('caps individual dimensions at 100', () => {
		// drawdown exceeds limit by 2x, daily loss 150%
		const score = calcOverallRiskScore(40, 20, 150, 20, 10);
		expect(score).toBe(100);
	});

	it('weights correctly with only drawdown at limit', () => {
		// drawdown 100%, others 0 → 40 * 0.4 = 40
		const score = calcOverallRiskScore(20, 20, 0, 0, 10);
		expect(score).toBeCloseTo(40);
	});
});

// ─── buildRiskSnapshot ────────────────────────────────────────────────────────

describe('buildRiskSnapshot', () => {
	it('returns safe snapshot with no activity', () => {
		const snap = makeSnapshot();
		const risk = buildRiskSnapshot(snap, 10000);

		expect(risk.overallRiskScore).toBe(0);
		expect(risk.overallRiskLevel).toBe('safe');
		expect(risk.alerts).toHaveLength(0);
		expect(risk.drawdown.currentDrawdownPct).toBe(0);
		expect(risk.dailyLoss.breached).toBe(false);
	});

	it('generates critical drawdown alert when limit exceeded', () => {
		const snap = makeSnapshot({
			equityCurve: [
				{ date: '2024-01-01', equity: 10000 },
				{ date: '2024-01-02', equity: 7000 }, // 30% drawdown > 20% limit
			],
		});
		const risk = buildRiskSnapshot(snap, 10000, { ...DEFAULT_LIMITS, maxDrawdownPct: 20 });
		expect(risk.alerts.some(a => a.includes('CRITICAL') && a.includes('Drawdown'))).toBe(true);
	});

	it('generates warning drawdown alert at 75% of limit', () => {
		const snap = makeSnapshot({
			equityCurve: [
				{ date: '2024-01-01', equity: 10000 },
				{ date: '2024-01-02', equity: 8600 }, // 14% drawdown → 70% of 20% limit
			],
		});
		const risk = buildRiskSnapshot(snap, 10000, { ...DEFAULT_LIMITS, maxDrawdownPct: 20 });
		// 14% / 20% = 70% → below 75% threshold, no warning
		expect(risk.alerts.some(a => a.includes('WARNING') && a.includes('Drawdown'))).toBe(false);
	});

	it('generates warning drawdown alert at 76% of limit', () => {
		const snap = makeSnapshot({
			equityCurve: [
				{ date: '2024-01-01', equity: 10000 },
				{ date: '2024-01-02', equity: 8480 }, // 15.2% drawdown → 76% of 20% limit
			],
		});
		const risk = buildRiskSnapshot(snap, 10000, { ...DEFAULT_LIMITS, maxDrawdownPct: 20 });
		expect(risk.alerts.some(a => a.includes('WARNING') && a.includes('Drawdown'))).toBe(true);
	});

	it('generates daily loss breach alert', () => {
		const snap = makeSnapshot({
			totalUnrealisedPnL: -600, // 6% loss on 10000 account, limit is 5%
		});
		const risk = buildRiskSnapshot(snap, 10000, { ...DEFAULT_LIMITS, dailyLossLimitPct: 5 });
		expect(risk.dailyLoss.breached).toBe(true);
		expect(risk.alerts.some(a => a.includes('CRITICAL') && a.includes('Daily loss'))).toBe(true);
	});

	it('generates open risk alert', () => {
		const snap = makeSnapshot({
			positions: [{
				id: 'p1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
				entryPrice: 50000, size: 2, stopPrice: 49500, targetPrice: null,
				notes: null, openedAt: '2024-06-01T00:00:00Z',
				currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
			}],
		});
		// Risk = |50000 - 49500| * 2 = 1000 = 10% of 10000, limit = 10%
		const risk = buildRiskSnapshot(snap, 10000, { ...DEFAULT_LIMITS, maxOpenRiskPct: 10 });
		expect(risk.alerts.some(a => a.includes('WARNING') && a.includes('Open risk'))).toBe(true);
	});

	it('generates info alert for positions without stop', () => {
		const snap = makeSnapshot({
			positions: [{
				id: 'p1', userId: 'u1', symbol: 'BTCUSDT', direction: 'long',
				entryPrice: 50000, size: 0.1, stopPrice: null, targetPrice: null,
				notes: null, openedAt: '2024-06-01T00:00:00Z',
				currentPrice: null, unrealisedPnLUSD: null, unrealisedPnLPct: null,
			}],
		});
		const risk = buildRiskSnapshot(snap, 10000);
		expect(risk.alerts.some(a => a.includes('INFO') && a.includes('no stop-loss'))).toBe(true);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('monitor_portfolio_risk tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('monitor_portfolio_risk')).toBeDefined();
	});

	it('returns error when account_size missing', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('monitor_portfolio_risk')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});

	it('returns error when account_size is zero', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('monitor_portfolio_risk')!;
		const result = await tool.execute({ account_size: 0 });
		expect(result.success).toBe(false);
	});
});
