// DCA Bot Engine Tests — T-1203
import { describe, it, expect } from 'vitest';
import {
	isValidDcaInterval,
	calcAvgCostBasis,
	calcDcaPerformance,
	calcNextExecution,
	isDipCondition,
	describeDcaBot,
	formatInterval,
	buildEquityCurve,
	mapDcaBotRow,
	mapDcaExecutionRow,
	VALID_DCA_INTERVALS,
	type DcaExecution,
	type DcaBot,
	type DcaBotRow,
	type DcaExecutionRow,
} from './dcaBot.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseBot: DcaBot = {
	id: 'bot-1',
	userId: 'user-1',
	symbol: 'BTCUSDT',
	amountPerInterval: 100,
	interval: 'weekly',
	dipMultiplier: null,
	dipMaLength: null,
	dipThresholdPct: null,
	active: true,
	nextExecutionAt: '2026-03-29T00:00:00Z',
	lastExecutionAt: null,
	totalInvested: 0,
	executionCount: 0,
	createdAt: '2026-03-22T00:00:00Z',
};

const makeExecution = (
	price: number,
	amount: number,
	executedAt: string,
	isDipBuy = false
): DcaExecution => ({
	id: `exec-${executedAt}`,
	botId: 'bot-1',
	userId: 'user-1',
	symbol: 'BTCUSDT',
	price,
	amount,
	qty: amount / price,
	isDipBuy,
	executedAt,
});

// ─── isValidDcaInterval ───────────────────────────────────────────────────────

describe('isValidDcaInterval', () => {
	it('accepts all valid intervals', () => {
		for (const i of VALID_DCA_INTERVALS) {
			expect(isValidDcaInterval(i)).toBe(true);
		}
	});

	it('rejects invalid strings', () => {
		expect(isValidDcaInterval('hourly')).toBe(false);
		expect(isValidDcaInterval('annually')).toBe(false);
		expect(isValidDcaInterval('')).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidDcaInterval(null)).toBe(false);
		expect(isValidDcaInterval(undefined)).toBe(false);
		expect(isValidDcaInterval(7)).toBe(false);
	});
});

// ─── calcAvgCostBasis ─────────────────────────────────────────────────────────

describe('calcAvgCostBasis', () => {
	it('returns 0 for empty executions', () => {
		expect(calcAvgCostBasis([])).toBe(0);
	});

	it('returns purchase price for single execution', () => {
		const exec = makeExecution(50000, 100, '2026-01-01T00:00:00Z');
		expect(calcAvgCostBasis([exec])).toBeCloseTo(50000, 2);
	});

	it('computes weighted average for multiple executions', () => {
		// Buy 100 at 50000 = 0.002 BTC, then 100 at 100000 = 0.001 BTC
		// Total cost = 200, total qty = 0.003 BTC
		// avg = 200 / 0.003 = 66666.67
		const execs = [
			makeExecution(50000, 100, '2026-01-01T00:00:00Z'),
			makeExecution(100000, 100, '2026-01-08T00:00:00Z'),
		];
		const avg = calcAvgCostBasis(execs);
		expect(avg).toBeCloseTo(66666.67, 0);
	});

	it('handles equal buys at different prices', () => {
		const execs = [
			makeExecution(40000, 100, '2026-01-01T00:00:00Z'),
			makeExecution(60000, 100, '2026-01-08T00:00:00Z'),
		];
		const avg = calcAvgCostBasis(execs);
		// 100/40000 + 100/60000 = 0.0025 + 0.00167 = 0.00417 BTC
		// avg = 200 / 0.00417 = 48000
		expect(avg).toBeCloseTo(48000, 0);
	});
});

// ─── calcDcaPerformance ───────────────────────────────────────────────────────

describe('calcDcaPerformance — empty', () => {
	it('returns zeros for empty executions', () => {
		const perf = calcDcaPerformance([], 50000);
		expect(perf.totalInvested).toBe(0);
		expect(perf.totalQty).toBe(0);
		expect(perf.avgCostBasis).toBe(0);
		expect(perf.currentValue).toBe(0);
		expect(perf.unrealisedPnL).toBe(0);
		expect(perf.unrealisedPct).toBe(0);
		expect(perf.executionCount).toBe(0);
		expect(perf.lumpSumValue).toBeNull();
	});
});

describe('calcDcaPerformance — with executions', () => {
	const execs = [
		makeExecution(50000, 100, '2026-01-01T00:00:00Z'),
		makeExecution(40000, 100, '2026-01-08T00:00:00Z'),
		makeExecution(60000, 100, '2026-01-15T00:00:00Z'),
	];
	const currentPrice = 55000;

	it('computes totalInvested correctly', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(perf.totalInvested).toBe(300);
	});

	it('computes totalQty correctly', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		const expectedQty = 100/50000 + 100/40000 + 100/60000;
		expect(perf.totalQty).toBeCloseTo(expectedQty, 8);
	});

	it('computes avgCostBasis = totalInvested / totalQty', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(perf.avgCostBasis).toBeCloseTo(perf.totalInvested / perf.totalQty, 2);
	});

	it('computes currentValue = totalQty × currentPrice', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(perf.currentValue).toBeCloseTo(perf.totalQty * currentPrice, 2);
	});

	it('computes unrealisedPnL = currentValue - totalInvested', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(perf.unrealisedPnL).toBeCloseTo(perf.currentValue - perf.totalInvested, 4);
	});

	it('computes unrealisedPct correctly', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		const expectedPct = (perf.unrealisedPnL / perf.totalInvested) * 100;
		expect(perf.unrealisedPct).toBeCloseTo(expectedPct, 4);
	});

	it('computes lump sum: all invested at first execution price', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		// lump sum qty = totalInvested / firstPrice = 300 / 50000 = 0.006 BTC
		const expectedLumpSumQty = 300 / 50000;
		const expectedLumpSumValue = expectedLumpSumQty * currentPrice;
		expect(perf.lumpSumValue).toBeCloseTo(expectedLumpSumValue, 4);
	});

	it('lump sum pct is a number', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(typeof perf.lumpSumPct).toBe('number');
	});

	it('returns executionCount = 3', () => {
		const perf = calcDcaPerformance(execs, currentPrice);
		expect(perf.executionCount).toBe(3);
	});
});

// ─── calcNextExecution ────────────────────────────────────────────────────────

describe('calcNextExecution', () => {
	const base = new Date('2026-03-22T00:00:00Z');

	it('daily = +1 day', () => {
		const next = calcNextExecution('daily', base);
		expect(next.getDate()).toBe(23);
	});

	it('weekly = +7 days', () => {
		const next = calcNextExecution('weekly', base);
		const diff = (next.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);
		expect(diff).toBe(7);
	});

	it('biweekly = +14 days', () => {
		const next = calcNextExecution('biweekly', base);
		const diff = (next.getTime() - base.getTime()) / (1000 * 60 * 60 * 24);
		expect(diff).toBe(14);
	});

	it('monthly = +1 month', () => {
		const next = calcNextExecution('monthly', base);
		expect(next.getMonth()).toBe(3); // April (0-indexed)
		expect(next.getDate()).toBe(22);
	});

	it('defaults fromDate to now and returns a future date', () => {
		const now = new Date();
		const next = calcNextExecution('weekly');
		expect(next.getTime()).toBeGreaterThan(now.getTime());
	});
});

// ─── isDipCondition ───────────────────────────────────────────────────────────

describe('isDipCondition', () => {
	it('returns true when price is below MA by >= threshold', () => {
		// MA = 100, price = 90, threshold = 10% → 10% drop → triggers
		expect(isDipCondition(90, 100, 10)).toBe(true);
	});

	it('returns true when drop exactly equals threshold', () => {
		expect(isDipCondition(90, 100, 10)).toBe(true);
	});

	it('returns false when price drop is less than threshold', () => {
		// MA = 100, price = 95, threshold = 10% → 5% drop → does not trigger
		expect(isDipCondition(95, 100, 10)).toBe(false);
	});

	it('returns false when price is above MA', () => {
		expect(isDipCondition(105, 100, 5)).toBe(false);
	});

	it('returns false when maPrice is 0 (guard against division by zero)', () => {
		expect(isDipCondition(50, 0, 5)).toBe(false);
	});

	it('returns false when maPrice is negative (guard)', () => {
		expect(isDipCondition(50, -10, 5)).toBe(false);
	});

	it('triggers with small threshold of 1%', () => {
		// MA = 100, price = 98.5 → 1.5% drop >= 1% threshold
		expect(isDipCondition(98.5, 100, 1)).toBe(true);
	});
});

// ─── describeDcaBot ───────────────────────────────────────────────────────────

describe('describeDcaBot', () => {
	it('describes a simple bot without dip config', () => {
		const desc = describeDcaBot(baseBot);
		expect(desc).toContain('BTCUSDT');
		expect(desc).toContain('$100');
		expect(desc).toContain('weekly');
	});

	it('includes dip multiplier info when configured', () => {
		const bot: DcaBot = {
			...baseBot,
			dipMultiplier: 2,
			dipMaLength: 200,
			dipThresholdPct: 5,
		};
		const desc = describeDcaBot(bot);
		expect(desc).toContain('2×');
		expect(desc).toContain('5%');
		expect(desc).toContain('MA200');
	});

	it('omits dip info when dipMultiplier is null', () => {
		const desc = describeDcaBot({ ...baseBot, dipMultiplier: null, dipMaLength: 200, dipThresholdPct: 5 });
		expect(desc).not.toContain('MA200');
	});
});

// ─── formatInterval ───────────────────────────────────────────────────────────

describe('formatInterval', () => {
	it('formats all intervals', () => {
		expect(formatInterval('daily')).toBe('Daily');
		expect(formatInterval('weekly')).toBe('Weekly');
		expect(formatInterval('biweekly')).toBe('Bi-weekly');
		expect(formatInterval('monthly')).toBe('Monthly');
	});
});

// ─── buildEquityCurve ─────────────────────────────────────────────────────────

describe('buildEquityCurve', () => {
	it('returns empty arrays for empty executions', () => {
		const result = buildEquityCurve([]);
		expect(result.timestamps).toHaveLength(0);
		expect(result.dcaEquity).toHaveLength(0);
		expect(result.lumpSumEquity).toHaveLength(0);
	});

	it('returns one point per execution', () => {
		const execs = [
			makeExecution(50000, 100, '2026-01-01T00:00:00Z'),
			makeExecution(60000, 100, '2026-01-08T00:00:00Z'),
		];
		const result = buildEquityCurve(execs);
		expect(result.timestamps).toHaveLength(2);
		expect(result.dcaEquity).toHaveLength(2);
		expect(result.lumpSumEquity).toHaveLength(2);
	});

	it('DCA equity at first point = qty1 × price1', () => {
		const execs = [makeExecution(50000, 100, '2026-01-01T00:00:00Z')];
		const result = buildEquityCurve(execs);
		const qty1 = 100 / 50000;
		expect(result.dcaEquity[0]).toBeCloseTo(qty1 * 50000, 4);
	});

	it('lump sum equity equals DCA at first execution (same invested amount)', () => {
		const execs = [makeExecution(50000, 100, '2026-01-01T00:00:00Z')];
		const result = buildEquityCurve(execs);
		// Both deployed $100 at $50000
		expect(result.dcaEquity[0]).toBeCloseTo(result.lumpSumEquity[0], 4);
	});

	it('timestamps are in Unix seconds', () => {
		const execs = [makeExecution(50000, 100, '2026-01-01T00:00:00Z')];
		const result = buildEquityCurve(execs);
		// 2026-01-01 in seconds
		expect(result.timestamps[0]).toBeGreaterThan(1700000000);
	});

	it('curve grows as executions accumulate', () => {
		const execs = [
			makeExecution(50000, 100, '2026-01-01T00:00:00Z'),
			makeExecution(50000, 100, '2026-01-08T00:00:00Z'),
		];
		const result = buildEquityCurve(execs);
		// Second point should have higher equity (more qty at same price)
		expect(result.dcaEquity[1]).toBeGreaterThan(result.dcaEquity[0]);
	});
});

// ─── mapDcaBotRow ─────────────────────────────────────────────────────────────

describe('mapDcaBotRow', () => {
	const row: DcaBotRow = {
		id: 'bot-1',
		user_id: 'user-1',
		symbol: 'ETHUSDT',
		amount_per_interval: 50,
		interval: 'monthly',
		dip_multiplier: 2,
		dip_ma_length: 200,
		dip_threshold_pct: 5,
		active: true,
		next_execution_at: '2026-04-22T00:00:00Z',
		last_execution_at: null,
		total_invested: 150,
		execution_count: 3,
		created_at: '2026-01-22T00:00:00Z',
	};

	it('maps all fields correctly', () => {
		const bot = mapDcaBotRow(row);
		expect(bot.id).toBe('bot-1');
		expect(bot.userId).toBe('user-1');
		expect(bot.symbol).toBe('ETHUSDT');
		expect(bot.amountPerInterval).toBe(50);
		expect(bot.interval).toBe('monthly');
		expect(bot.dipMultiplier).toBe(2);
		expect(bot.dipMaLength).toBe(200);
		expect(bot.dipThresholdPct).toBe(5);
		expect(bot.active).toBe(true);
		expect(bot.totalInvested).toBe(150);
		expect(bot.executionCount).toBe(3);
	});

	it('defaults invalid interval to weekly', () => {
		const bot = mapDcaBotRow({ ...row, interval: 'invalid' });
		expect(bot.interval).toBe('weekly');
	});

	it('maps null optional fields to null', () => {
		const bot = mapDcaBotRow({ ...row, dip_multiplier: null, dip_ma_length: null, dip_threshold_pct: null });
		expect(bot.dipMultiplier).toBeNull();
		expect(bot.dipMaLength).toBeNull();
		expect(bot.dipThresholdPct).toBeNull();
	});
});

// ─── mapDcaExecutionRow ───────────────────────────────────────────────────────

describe('mapDcaExecutionRow', () => {
	const row: DcaExecutionRow = {
		id: 'exec-1',
		bot_id: 'bot-1',
		user_id: 'user-1',
		symbol: 'BTCUSDT',
		price: 75000,
		amount: 200,
		qty: 0.002667,
		is_dip_buy: true,
		executed_at: '2026-03-01T00:00:00Z',
	};

	it('maps all fields correctly', () => {
		const exec = mapDcaExecutionRow(row);
		expect(exec.id).toBe('exec-1');
		expect(exec.botId).toBe('bot-1');
		expect(exec.userId).toBe('user-1');
		expect(exec.symbol).toBe('BTCUSDT');
		expect(exec.price).toBe(75000);
		expect(exec.amount).toBe(200);
		expect(exec.qty).toBeCloseTo(0.002667, 6);
		expect(exec.isDipBuy).toBe(true);
		expect(exec.executedAt).toBe('2026-03-01T00:00:00Z');
	});

	it('maps is_dip_buy=false correctly', () => {
		const exec = mapDcaExecutionRow({ ...row, is_dip_buy: false });
		expect(exec.isDipBuy).toBe(false);
	});
});
