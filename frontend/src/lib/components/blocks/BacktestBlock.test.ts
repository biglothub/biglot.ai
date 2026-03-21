// BacktestBlock snapshot tests - T-105
// Tests BacktestBlock type correctness and data transformation helpers.
// Component rendering is deferred to manual/E2E testing (no Svelte test env configured).

import { describe, expect, it } from 'vitest';
import type { BacktestBlock, BacktestTrade, BacktestEquityPoint, BacktestMetricsSummary } from '$lib/types/contentBlock';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_METRICS: BacktestMetricsSummary = {
	totalReturn: 42.5,
	maxDrawdown: 12.3,
	sharpe: 1.8,
	winRate: 58.3,
	totalTrades: 24,
	profitFactor: 2.1,
	avgRMultiple: 0.65,
	expectancy: 87.5,
	maxConsecutiveLosses: 3,
};

const MOCK_TRADES: BacktestTrade[] = [
	{
		entryTime: 1_700_000_000,
		exitTime: 1_700_086_400,
		direction: 'long',
		entryPrice: 42_000,
		exitPrice: 44_100,
		size: 0.238,
		pnl: 499.8,
		pnlPct: 5.0,
		rMultiple: 2.0,
		exitReason: 'take_profit',
	},
	{
		entryTime: 1_700_172_800,
		exitTime: 1_700_259_200,
		direction: 'long',
		entryPrice: 43_500,
		exitPrice: 43_065,
		size: 0.23,
		pnl: -100.05,
		pnlPct: -1.0,
		rMultiple: -1.0,
		exitReason: 'stop_loss',
	},
];

const MOCK_EQUITY: BacktestEquityPoint[] = [
	{ time: 1_700_000_000, equity: 10_000, drawdownPct: 0 },
	{ time: 1_700_086_400, equity: 10_499.8, drawdownPct: 0 },
	{ time: 1_700_259_200, equity: 10_399.75, drawdownPct: 0.952 },
];

const MOCK_BLOCK: BacktestBlock = {
	type: 'backtest',
	symbol: 'BTCUSDT',
	timeframe: '4h',
	initialCapital: 10_000,
	finalCapital: 14_250,
	startTime: 1_700_000_000,
	endTime: 1_702_592_000,
	trades: MOCK_TRADES,
	equity: MOCK_EQUITY,
	metrics: MOCK_METRICS,
};

// ─── Type shape ───────────────────────────────────────────────────────────────

describe('BacktestBlock type', () => {
	it('has type discriminant "backtest"', () => {
		expect(MOCK_BLOCK.type).toBe('backtest');
	});

	it('contains all required top-level fields', () => {
		expect(MOCK_BLOCK.symbol).toBe('BTCUSDT');
		expect(MOCK_BLOCK.timeframe).toBe('4h');
		expect(MOCK_BLOCK.initialCapital).toBe(10_000);
		expect(MOCK_BLOCK.finalCapital).toBe(14_250);
		expect(MOCK_BLOCK.startTime).toBeDefined();
		expect(MOCK_BLOCK.endTime).toBeDefined();
	});

	it('walk-forward fields are optional', () => {
		const block: BacktestBlock = { ...MOCK_BLOCK };
		expect(block.inSampleMetrics).toBeUndefined();
		expect(block.outOfSampleMetrics).toBeUndefined();
		expect(block.degradationPct).toBeUndefined();
	});

	it('accepts walk-forward data', () => {
		const block: BacktestBlock = {
			...MOCK_BLOCK,
			inSampleMetrics: { ...MOCK_METRICS, totalReturn: 50 },
			outOfSampleMetrics: { ...MOCK_METRICS, totalReturn: 35 },
			degradationPct: 30,
		};
		expect(block.inSampleMetrics?.totalReturn).toBe(50);
		expect(block.outOfSampleMetrics?.totalReturn).toBe(35);
		expect(block.degradationPct).toBe(30);
	});
});

// ─── Trades ───────────────────────────────────────────────────────────────────

describe('BacktestTrade', () => {
	it('winning trade has positive pnl and rMultiple', () => {
		const win = MOCK_TRADES[0];
		expect(win.pnl).toBeGreaterThan(0);
		expect(win.rMultiple).toBeGreaterThan(0);
		expect(win.exitReason).toBe('take_profit');
	});

	it('losing trade has negative pnl and -1 rMultiple', () => {
		const loss = MOCK_TRADES[1];
		expect(loss.pnl).toBeLessThan(0);
		expect(loss.rMultiple).toBe(-1.0);
		expect(loss.exitReason).toBe('stop_loss');
	});

	it('all exit reasons are valid literals', () => {
		const validReasons = new Set([
			'stop_loss', 'take_profit', 'trailing_stop',
			'indicator', 'time_based', 'end_of_data', 'max_drawdown',
		]);
		for (const trade of MOCK_TRADES) {
			expect(validReasons.has(trade.exitReason)).toBe(true);
		}
	});

	it('direction is long or short', () => {
		for (const trade of MOCK_TRADES) {
			expect(['long', 'short']).toContain(trade.direction);
		}
	});
});

// ─── Equity ───────────────────────────────────────────────────────────────────

describe('BacktestEquityPoint', () => {
	it('starts at initialCapital', () => {
		expect(MOCK_EQUITY[0].equity).toBe(MOCK_BLOCK.initialCapital);
	});

	it('drawdownPct is non-negative', () => {
		for (const pt of MOCK_EQUITY) {
			expect(pt.drawdownPct).toBeGreaterThanOrEqual(0);
		}
	});

	it('equity is positive throughout', () => {
		for (const pt of MOCK_EQUITY) {
			expect(pt.equity).toBeGreaterThan(0);
		}
	});
});

// ─── Metrics ──────────────────────────────────────────────────────────────────

describe('BacktestMetricsSummary', () => {
	it('winRate is between 0 and 100', () => {
		expect(MOCK_METRICS.winRate).toBeGreaterThanOrEqual(0);
		expect(MOCK_METRICS.winRate).toBeLessThanOrEqual(100);
	});

	it('maxDrawdown is non-negative', () => {
		expect(MOCK_METRICS.maxDrawdown).toBeGreaterThanOrEqual(0);
	});

	it('totalTrades is a positive integer', () => {
		expect(MOCK_METRICS.totalTrades).toBeGreaterThan(0);
		expect(Number.isInteger(MOCK_METRICS.totalTrades)).toBe(true);
	});

	it('maxConsecutiveLosses is non-negative', () => {
		expect(MOCK_METRICS.maxConsecutiveLosses).toBeGreaterThanOrEqual(0);
	});
});

// ─── Data formatting helpers (inline, matching component logic) ───────────────

describe('data formatting logic', () => {
	function fmtPct(v: number, decimals = 1): string {
		const sign = v > 0 ? '+' : '';
		return `${sign}${v.toFixed(decimals)}%`;
	}

	function fmtNum(v: number, decimals = 2): string {
		if (!isFinite(v)) return '∞';
		return v.toFixed(decimals);
	}

	it('fmtPct shows + for positive returns', () => {
		expect(fmtPct(42.5)).toBe('+42.5%');
	});

	it('fmtPct shows − for negative returns', () => {
		expect(fmtPct(-12.3)).toBe('-12.3%');
	});

	it('fmtPct zero has no sign prefix', () => {
		expect(fmtPct(0)).toBe('0.0%');
	});

	it('fmtNum handles infinity', () => {
		expect(fmtNum(Infinity)).toBe('∞');
	});

	it('fmtNum rounds to specified decimals', () => {
		expect(fmtNum(1.8, 2)).toBe('1.80');
	});
});

// ─── Snapshot ─────────────────────────────────────────────────────────────────

describe('BacktestBlock snapshot', () => {
	it('mock block matches snapshot', () => {
		expect(MOCK_BLOCK).toMatchSnapshot();
	});

	it('metrics snapshot', () => {
		expect(MOCK_METRICS).toMatchSnapshot();
	});
});
