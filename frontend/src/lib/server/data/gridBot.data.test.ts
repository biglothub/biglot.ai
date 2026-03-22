// Grid Bot Engine Data Layer Tests — T-1204

import { describe, it, expect } from 'vitest';
import {
	calcGridLevels,
	detectGridCrossings,
	calcGridProfit,
	calcAmountPerGrid,
	calcGridSpacingAbs,
	calcGridSpacingPct,
	calcEstimatedAPY,
	countCompletedCycles,
	calcGridPerformance,
	isValidGridConfig,
	describeGridBot,
	mapGridBotRow,
	mapGridExecutionRow,
	type GridBot,
	type GridExecution,
	type GridBotRow,
	type GridExecutionRow,
} from './gridBot.data';

// ─── calcGridLevels ───────────────────────────────────────────────────────────

describe('calcGridLevels', () => {
	it('returns gridLevels + 1 price points', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		expect(levels).toHaveLength(5); // 4 intervals → 5 points
	});

	it('first level equals lowerPrice and last equals upperPrice', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		expect(levels[0].price).toBeCloseTo(10_000);
		expect(levels[4].price).toBeCloseTo(12_000);
	});

	it('levels are evenly spaced', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		const spacing = 500; // (12000 - 10000) / 4
		for (let i = 1; i < levels.length; i++) {
			expect(levels[i].price - levels[i - 1].price).toBeCloseTo(spacing);
		}
	});

	it('assigns buy side to levels below currentPrice', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		// currentPrice = 11000; levels at 10000, 10500 are below → buy
		expect(levels[0].side).toBe('buy');  // 10000
		expect(levels[1].side).toBe('buy');  // 10500
	});

	it('assigns sell side to levels at or above currentPrice', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		// levels at 11000, 11500, 12000 are >= currentPrice → sell
		expect(levels[2].side).toBe('sell'); // 11000
		expect(levels[3].side).toBe('sell'); // 11500
		expect(levels[4].side).toBe('sell'); // 12000
	});

	it('all levels start as pending', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		for (const level of levels) {
			expect(level.status).toBe('pending');
		}
	});

	it('indices are sequential starting at 0', () => {
		const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
		levels.forEach((level, i) => expect(level.index).toBe(i));
	});

	it('with 2 grid levels returns 3 price points', () => {
		const levels = calcGridLevels(1_000, 2_000, 2, 1_500);
		expect(levels).toHaveLength(3);
		expect(levels[0].price).toBeCloseTo(1_000);
		expect(levels[1].price).toBeCloseTo(1_500);
		expect(levels[2].price).toBeCloseTo(2_000);
	});
});

// ─── detectGridCrossings ──────────────────────────────────────────────────────

describe('detectGridCrossings', () => {
	const levels = calcGridLevels(10_000, 12_000, 4, 11_000);
	// prices: 10000(buy), 10500(buy), 11000(sell), 11500(sell), 12000(sell)

	it('returns empty array when price unchanged', () => {
		const crossed = detectGridCrossings(levels, 11_000, 11_000);
		expect(crossed).toHaveLength(0);
	});

	it('detects buy levels crossed when price moves down', () => {
		// Price moves from 11000 down to 10200 → crosses 10500 (buy)
		const crossed = detectGridCrossings(levels, 11_000, 10_200);
		expect(crossed).toHaveLength(1);
		expect(crossed[0].price).toBeCloseTo(10_500);
		expect(crossed[0].side).toBe('buy');
	});

	it('detects multiple buy levels on large down move', () => {
		// Price moves from 11000 down to 9800 → crosses 10500 and 10000?
		// lo=9800, hi=11000, movingDown=true, buy levels strictly between 9800 and 11000 → 10000, 10500
		const crossed = detectGridCrossings(levels, 11_000, 9_800);
		expect(crossed).toHaveLength(2);
		const prices = crossed.map((l) => l.price).sort((a, b) => a - b);
		expect(prices[0]).toBeCloseTo(10_000);
		expect(prices[1]).toBeCloseTo(10_500);
	});

	it('detects sell levels crossed when price moves up', () => {
		// Price moves from 11000 up to 11800 → crosses 11500 (sell)
		const crossed = detectGridCrossings(levels, 11_000, 11_800);
		expect(crossed).toHaveLength(1);
		expect(crossed[0].price).toBeCloseTo(11_500);
		expect(crossed[0].side).toBe('sell');
	});

	it('does not detect buy levels when price moves up', () => {
		const crossed = detectGridCrossings(levels, 10_200, 11_400);
		// movingUp, sell levels strictly between 10200 and 11400 → 11000
		const buySideCrossed = crossed.filter((l) => l.side === 'buy');
		expect(buySideCrossed).toHaveLength(0);
	});

	it('excludes exact boundary prices', () => {
		// lastPrice=11000, currentPrice=10500 → lo=10500, hi=11000, excludes both boundaries
		const crossed = detectGridCrossings(levels, 11_000, 10_500);
		expect(crossed).toHaveLength(0);
	});
});

// ─── calcGridProfit ───────────────────────────────────────────────────────────

describe('calcGridProfit', () => {
	it('calculates profit correctly', () => {
		expect(calcGridProfit(0.1, 500)).toBeCloseTo(50);
	});

	it('returns 0 for zero qty', () => {
		expect(calcGridProfit(0, 500)).toBe(0);
	});
});

// ─── calcAmountPerGrid ────────────────────────────────────────────────────────

describe('calcAmountPerGrid', () => {
	it('divides equally', () => {
		expect(calcAmountPerGrid(1000, 10)).toBeCloseTo(100);
	});

	it('handles fractional result', () => {
		expect(calcAmountPerGrid(100, 3)).toBeCloseTo(33.333);
	});
});

// ─── calcGridSpacingAbs ───────────────────────────────────────────────────────

describe('calcGridSpacingAbs', () => {
	it('returns correct spacing', () => {
		expect(calcGridSpacingAbs(10_000, 12_000, 4)).toBeCloseTo(500);
	});

	it('handles single interval', () => {
		expect(calcGridSpacingAbs(100, 200, 1)).toBeCloseTo(100);
	});
});

// ─── calcGridSpacingPct ───────────────────────────────────────────────────────

describe('calcGridSpacingPct', () => {
	it('returns correct percentage', () => {
		// spacing=500, midpoint=11000 → 500/11000 × 100 ≈ 4.545%
		const pct = calcGridSpacingPct(10_000, 12_000, 4);
		expect(pct).toBeCloseTo(4.545, 1);
	});

	it('returns 0 for zero midpoint', () => {
		// degenerate: lower=0, upper=0
		expect(calcGridSpacingPct(0, 0, 4)).toBe(0);
	});
});

// ─── calcEstimatedAPY ─────────────────────────────────────────────────────────

describe('calcEstimatedAPY', () => {
	it('returns 0 for zero profit', () => {
		expect(calcEstimatedAPY(0, 1000, new Date().toISOString())).toBe(0);
	});

	it('returns 0 for zero investmentAmount', () => {
		const apy = calcEstimatedAPY(100, 0, new Date(Date.now() - 30 * 86400_000).toISOString());
		expect(apy).toBe(0);
	});

	it('calculates correct APY over 30 days', () => {
		const createdAt = new Date(Date.now() - 30 * 86400_000).toISOString();
		// profit=100 on 1000 investment over 30 days → 10%/30d × 365 ≈ 121.67%
		const apy = calcEstimatedAPY(100, 1000, createdAt);
		expect(apy).toBeCloseTo((100 / 1000) * (365 / 30) * 100, 0);
	});

	it('returns 0 when created less than 1 day ago', () => {
		const createdAt = new Date(Date.now() - 3600_000).toISOString(); // 1 hour ago
		expect(calcEstimatedAPY(50, 1000, createdAt)).toBe(0);
	});
});

// ─── countCompletedCycles ─────────────────────────────────────────────────────

describe('countCompletedCycles', () => {
	it('counts sell executions as completed cycles', () => {
		const execs: GridExecution[] = [
			{ id: '1', botId: 'b', userId: 'u', symbol: 'BTCUSDT', levelIndex: 0, levelPrice: 10000, execType: 'buy', qty: 0.1, amount: 1000, profit: 0, executedAt: '' },
			{ id: '2', botId: 'b', userId: 'u', symbol: 'BTCUSDT', levelIndex: 1, levelPrice: 10500, execType: 'sell', qty: 0.1, amount: 1050, profit: 50, executedAt: '' },
			{ id: '3', botId: 'b', userId: 'u', symbol: 'BTCUSDT', levelIndex: 1, levelPrice: 10500, execType: 'buy', qty: 0.1, amount: 1050, profit: 0, executedAt: '' },
		];
		expect(countCompletedCycles(execs)).toBe(1);
	});

	it('returns 0 for empty executions', () => {
		expect(countCompletedCycles([])).toBe(0);
	});
});

// ─── isValidGridConfig ────────────────────────────────────────────────────────

describe('isValidGridConfig', () => {
	it('accepts valid config', () => {
		const r = isValidGridConfig(12000, 10000, 10, 1000);
		expect(r.valid).toBe(true);
	});

	it('rejects when upper <= lower', () => {
		expect(isValidGridConfig(10000, 12000, 10, 1000).valid).toBe(false);
		expect(isValidGridConfig(10000, 10000, 10, 1000).valid).toBe(false);
	});

	it('rejects grid levels below 2', () => {
		expect(isValidGridConfig(12000, 10000, 1, 1000).valid).toBe(false);
	});

	it('rejects grid levels above 100', () => {
		expect(isValidGridConfig(12000, 10000, 101, 1000).valid).toBe(false);
	});

	it('rejects zero or negative investment amount', () => {
		expect(isValidGridConfig(12000, 10000, 10, 0).valid).toBe(false);
		expect(isValidGridConfig(12000, 10000, 10, -100).valid).toBe(false);
	});
});

// ─── calcGridPerformance ──────────────────────────────────────────────────────

describe('calcGridPerformance', () => {
	const bot: GridBot = {
		id: 'b1', userId: 'u', symbol: 'BTCUSDT',
		upperPrice: 12_000, lowerPrice: 10_000,
		gridLevels: 4, investmentAmount: 1000,
		active: true, lastPrice: 11_000,
		totalProfit: 100, fillCount: 3,
		createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
	};

	const executions: GridExecution[] = [
		{ id: '1', botId: 'b1', userId: 'u', symbol: 'BTCUSDT', levelIndex: 1, levelPrice: 10500, execType: 'buy', qty: 0.2381, amount: 250, profit: 0, executedAt: '' },
		{ id: '2', botId: 'b1', userId: 'u', symbol: 'BTCUSDT', levelIndex: 2, levelPrice: 11000, execType: 'sell', qty: 0.2381, amount: 250, profit: 50, executedAt: '' },
		{ id: '3', botId: 'b1', userId: 'u', symbol: 'BTCUSDT', levelIndex: 0, levelPrice: 10000, execType: 'buy', qty: 0.25, amount: 250, profit: 0, executedAt: '' },
	];

	it('returns correct totalProfit', () => {
		const perf = calcGridPerformance(bot, executions);
		expect(perf.totalProfit).toBe(100);
	});

	it('returns correct fillCount', () => {
		const perf = calcGridPerformance(bot, executions);
		expect(perf.fillCount).toBe(3);
	});

	it('returns correct completedCycles (sell count)', () => {
		const perf = calcGridPerformance(bot, executions);
		expect(perf.completedCycles).toBe(1);
	});

	it('returns correct amountPerGrid', () => {
		const perf = calcGridPerformance(bot, executions);
		expect(perf.amountPerGrid).toBeCloseTo(250);
	});

	it('returns correct gridSpacingAbs', () => {
		const perf = calcGridPerformance(bot, executions);
		// (12000 - 10000) / 4 = 500
		expect(perf.gridSpacingAbs).toBeCloseTo(500);
	});

	it('returns positive estimatedAPY when profit > 0 and days > 1', () => {
		const perf = calcGridPerformance(bot, executions);
		expect(perf.estimatedAPY).toBeGreaterThan(0);
	});
});

// ─── describeGridBot ──────────────────────────────────────────────────────────

describe('describeGridBot', () => {
	it('includes symbol, levels, and range', () => {
		const bot: GridBot = {
			id: 'x', userId: 'u', symbol: 'ETHUSDT',
			upperPrice: 4000, lowerPrice: 3000,
			gridLevels: 10, investmentAmount: 500,
			active: true, lastPrice: null,
			totalProfit: 0, fillCount: 0,
			createdAt: '',
		};
		const desc = describeGridBot(bot);
		expect(desc).toContain('ETHUSDT');
		expect(desc).toContain('10 grids');
		expect(desc).toContain('3000');
		expect(desc).toContain('4000');
	});
});

// ─── mapGridBotRow ────────────────────────────────────────────────────────────

describe('mapGridBotRow', () => {
	it('maps all fields correctly', () => {
		const row: GridBotRow = {
			id: 'abc', user_id: 'u', symbol: 'BTCUSDT',
			upper_price: 12000, lower_price: 10000,
			grid_levels: 4, investment_amount: 1000,
			active: true, last_price: 11000,
			total_profit: 50, fill_count: 2,
			created_at: '2024-01-01T00:00:00Z',
		};
		const bot = mapGridBotRow(row);
		expect(bot.id).toBe('abc');
		expect(bot.userId).toBe('u');
		expect(bot.upperPrice).toBe(12000);
		expect(bot.lowerPrice).toBe(10000);
		expect(bot.gridLevels).toBe(4);
		expect(bot.investmentAmount).toBe(1000);
		expect(bot.lastPrice).toBe(11000);
		expect(bot.totalProfit).toBe(50);
		expect(bot.fillCount).toBe(2);
	});

	it('maps null last_price correctly', () => {
		const row: GridBotRow = {
			id: 'x', user_id: 'u', symbol: 'BTCUSDT',
			upper_price: 12000, lower_price: 10000,
			grid_levels: 4, investment_amount: 1000,
			active: false, last_price: null,
			total_profit: 0, fill_count: 0,
			created_at: '',
		};
		expect(mapGridBotRow(row).lastPrice).toBeNull();
	});
});

// ─── mapGridExecutionRow ──────────────────────────────────────────────────────

describe('mapGridExecutionRow', () => {
	it('maps buy execution correctly', () => {
		const row: GridExecutionRow = {
			id: 'e1', bot_id: 'b', user_id: 'u', symbol: 'BTCUSDT',
			level_index: 1, level_price: 10500,
			exec_type: 'buy', qty: 0.1, amount: 1050, profit: 0,
			executed_at: '2024-01-01T00:00:00Z',
		};
		const exec = mapGridExecutionRow(row);
		expect(exec.execType).toBe('buy');
		expect(exec.profit).toBe(0);
	});

	it('maps sell execution correctly', () => {
		const row: GridExecutionRow = {
			id: 'e2', bot_id: 'b', user_id: 'u', symbol: 'BTCUSDT',
			level_index: 2, level_price: 11000,
			exec_type: 'sell', qty: 0.1, amount: 1100, profit: 50,
			executed_at: '2024-01-02T00:00:00Z',
		};
		const exec = mapGridExecutionRow(row);
		expect(exec.execType).toBe('sell');
		expect(exec.profit).toBe(50);
	});
});
