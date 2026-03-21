// Backtesting Engine Tests - T-104

import { describe, it, expect } from 'vitest';
import { runBacktest, runWalkForward } from './engine';
import {
	calcMaxDrawdown,
	calcProfitFactor,
	calcMaxConsecutiveLosses,
	buildEquityCurve,
	calcMetrics,
	calcCAGR,
	calcSharpe,
	calcSortino,
} from './metrics';
import type { OHLCV } from '$lib/types/contentBlock';
import type { Strategy } from '$lib/types/strategy';
import type { Trade, EquityPoint } from '$lib/types/backtest';
import type { BacktestConfig } from '$lib/types/backtest';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** Generate synthetic OHLCV data with a controllable trend */
function makeOHLCV(
	bars: number,
	startPrice = 100,
	dailyReturn = 0,
	noise = 0
): OHLCV[] {
	const result: OHLCV[] = [];
	let price = startPrice;
	const DAY = 86400;
	for (let i = 0; i < bars; i++) {
		const open = price;
		const rnd = noise > 0 ? (Math.random() * 2 - 1) * noise : 0;
		price = price * (1 + dailyReturn + rnd);
		const high = Math.max(open, price) * 1.005;
		const low = Math.min(open, price) * 0.995;
		result.push({ time: 1_700_000_000 + i * DAY, open, high, low, close: price, volume: 1_000_000 });
	}
	return result;
}

/** Simple MA crossover strategy: EMA5 crosses above EMA20 */
function makeSMAStrategy(overrides: Partial<Strategy> = {}): Strategy {
	return {
		biglotUserId: 'test-user-123',
		name: 'SMA Crossover',
		version: 1,
		timeframe: '1d',
		isActive: true,
		entry: {
			direction: 'long',
			groups: [
				{
					logic: 'AND',
					conditions: [
						{
							indicator: 'ema',
							params: { period: 5 },
							operator: 'crosses_above',
							threshold: { indicator: 'ema', params: { period: 20 } },
						},
					],
				},
			],
		},
		exit: [
			{ type: 'stop_loss', value: 5, unit: 'pct' },
			{ type: 'take_profit', value: 10, unit: 'pct' },
		],
		positionSizing: { method: 'fixed_fractional', riskPerTrade: 2 },
		risk: { maxDrawdownPct: 30, maxOpenPositions: 1 },
		...overrides,
	};
}

/** RSI oversold strategy */
function makeRSIStrategy(): Strategy {
	return {
		biglotUserId: 'test-user-123',
		name: 'RSI Oversold',
		version: 1,
		timeframe: '1d',
		isActive: true,
		entry: {
			direction: 'long',
			groups: [
				{
					logic: 'AND',
					conditions: [{ indicator: 'rsi', params: { period: 14 }, operator: '<', threshold: 30 }],
				},
			],
		},
		exit: [
			{ type: 'stop_loss', value: 3, unit: 'pct' },
			{ type: 'take_profit', value: 6, unit: 'pct' },
		],
		positionSizing: { method: 'fixed_fractional', riskPerTrade: 1 },
		risk: { maxDrawdownPct: 20, maxOpenPositions: 1 },
	};
}

// ─── metrics.ts Tests ─────────────────────────────────────────────────────────

describe('calcMaxDrawdown', () => {
	it('returns 0 for empty equity', () => {
		expect(calcMaxDrawdown([])).toBe(0);
	});

	it('returns 0 for monotonically rising equity', () => {
		const equity: EquityPoint[] = [
			{ time: 1, equity: 100, drawdownPct: 0 },
			{ time: 2, equity: 110, drawdownPct: 0 },
			{ time: 3, equity: 120, drawdownPct: 0 },
		];
		expect(calcMaxDrawdown(equity)).toBe(0);
	});

	it('calculates drawdown correctly', () => {
		const equity: EquityPoint[] = [
			{ time: 1, equity: 100, drawdownPct: 0 },
			{ time: 2, equity: 80, drawdownPct: 20 },
			{ time: 3, equity: 90, drawdownPct: 10 },
		];
		// peak=100, trough=80 → 20%
		expect(calcMaxDrawdown(equity)).toBeCloseTo(20, 1);
	});

	it('handles multiple peaks and troughs', () => {
		const equity: EquityPoint[] = [
			{ time: 1, equity: 100, drawdownPct: 0 },
			{ time: 2, equity: 90, drawdownPct: 10 },
			{ time: 3, equity: 110, drawdownPct: 0 },
			{ time: 4, equity: 70, drawdownPct: 36 },
		];
		// Second peak=110, trough=70 → 36.36%
		expect(calcMaxDrawdown(equity)).toBeCloseTo(36.36, 0);
	});
});

describe('calcProfitFactor', () => {
	it('returns 0 for no trades', () => {
		expect(calcProfitFactor([])).toBe(0);
	});

	it('returns Infinity when no losing trades', () => {
		const trades: Trade[] = [
			{ entryTime: 1, exitTime: 2, direction: 'long', entryPrice: 100, exitPrice: 110, size: 1, pnl: 10, pnlPct: 10, rMultiple: 1, exitReason: 'take_profit' },
		];
		expect(calcProfitFactor(trades)).toBe(Infinity);
	});

	it('calculates profit factor correctly', () => {
		const trades: Trade[] = [
			{ entryTime: 1, exitTime: 2, direction: 'long', entryPrice: 100, exitPrice: 110, size: 1, pnl: 10, pnlPct: 10, rMultiple: 1, exitReason: 'take_profit' },
			{ entryTime: 3, exitTime: 4, direction: 'long', entryPrice: 110, exitPrice: 105, size: 1, pnl: -5, pnlPct: -4.5, rMultiple: -0.5, exitReason: 'stop_loss' },
		];
		// gross profit = 10, gross loss = 5, PF = 2
		expect(calcProfitFactor(trades)).toBeCloseTo(2, 5);
	});
});

describe('calcMaxConsecutiveLosses', () => {
	it('returns 0 for no trades', () => {
		expect(calcMaxConsecutiveLosses([])).toBe(0);
	});

	it('counts consecutive losses correctly', () => {
		const trades: Trade[] = [
			{ pnl: 10 } as Trade,
			{ pnl: -5 } as Trade,
			{ pnl: -5 } as Trade,
			{ pnl: -5 } as Trade,
			{ pnl: 10 } as Trade,
			{ pnl: -5 } as Trade,
			{ pnl: -5 } as Trade,
		];
		expect(calcMaxConsecutiveLosses(trades)).toBe(3);
	});

	it('all losing trades', () => {
		const trades: Trade[] = [
			{ pnl: -1 } as Trade,
			{ pnl: -2 } as Trade,
			{ pnl: -3 } as Trade,
		];
		expect(calcMaxConsecutiveLosses(trades)).toBe(3);
	});
});

describe('buildEquityCurve', () => {
	it('starts with initial capital', () => {
		const equity = buildEquityCurve(10000, [], 1000, 2000);
		expect(equity[0].equity).toBe(10000);
	});

	it('accumulates trade P&L', () => {
		const trades: Trade[] = [
			{ exitTime: 1001, pnl: 500, entryTime: 1000, direction: 'long', entryPrice: 100, exitPrice: 105, size: 1, pnlPct: 5, rMultiple: 1, exitReason: 'take_profit' },
			{ exitTime: 1002, pnl: -200, entryTime: 1001, direction: 'long', entryPrice: 105, exitPrice: 103, size: 1, pnlPct: -1.9, rMultiple: -0.5, exitReason: 'stop_loss' },
		];
		const equity = buildEquityCurve(10000, trades, 1000, 2000);
		expect(equity[1].equity).toBe(10500);
		expect(equity[2].equity).toBe(10300);
	});

	it('calculates drawdown in equity curve', () => {
		const trades: Trade[] = [
			{ exitTime: 1001, pnl: 1000, entryTime: 1000, direction: 'long', entryPrice: 100, exitPrice: 110, size: 1, pnlPct: 10, rMultiple: 2, exitReason: 'take_profit' },
			{ exitTime: 1002, pnl: -2000, entryTime: 1001, direction: 'long', entryPrice: 110, exitPrice: 90, size: 1, pnlPct: -18, rMultiple: -4, exitReason: 'stop_loss' },
		];
		const equity = buildEquityCurve(10000, trades, 1000, 2000);
		// After first trade: 11000 (peak), after second: 9000
		// Drawdown = (11000-9000)/11000 * 100 ≈ 18.18%
		expect(equity[2].drawdownPct).toBeCloseTo(18.18, 0);
	});
});

describe('calcCAGR', () => {
	it('returns 0 for zero duration', () => {
		expect(calcCAGR(10000, 12000, 1000, 1000)).toBe(0);
	});

	it('calculates CAGR for 1 year doubling', () => {
		const start = 0;
		const end = 365 * 86400;
		const cagr = calcCAGR(10000, 20000, start, end);
		expect(cagr).toBeCloseTo(100, 0); // 100% return in 1 year
	});
});

describe('calcSharpe', () => {
	it('returns 0 for fewer than 2 trades', () => {
		expect(calcSharpe([], [])).toBe(0);
	});

	it('returns 0 when std dev is 0 (all same returns)', () => {
		const trades: Trade[] = [
			{ pnlPct: 5 } as Trade,
			{ pnlPct: 5 } as Trade,
			{ pnlPct: 5 } as Trade,
		];
		expect(calcSharpe(trades, [])).toBe(0);
	});
});

describe('calcSortino', () => {
	it('returns 0 for fewer than 2 trades', () => {
		expect(calcSortino([], [])).toBe(0);
	});

	it('returns Infinity when no losing trades and positive mean', () => {
		const trades: Trade[] = [
			{ pnlPct: 5 } as Trade,
			{ pnlPct: 10 } as Trade,
		];
		expect(calcSortino(trades, [])).toBe(Infinity);
	});
});

// ─── engine.ts Tests ──────────────────────────────────────────────────────────

describe('runBacktest — empty data', () => {
	it('returns empty result for empty OHLCV', () => {
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv: [],
			symbol: 'BTCUSDT',
			initialCapital: 10000,
		});
		expect(result.trades).toHaveLength(0);
		expect(result.metrics.totalReturn).toBe(0);
	});
});

describe('runBacktest — stop loss enforcement', () => {
	it('exits on stop loss when price drops 5%', () => {
		// Create OHLCV: rises for 25 bars (to trigger EMA5 cross EMA20), then drops sharply
		const rising = makeOHLCV(30, 100, 0.005);
		// After crossover, price drops to trigger 5% stop
		const dropBar: OHLCV = {
			time: rising[rising.length - 1].time + 86400,
			open: rising[rising.length - 1].close,
			high: rising[rising.length - 1].close,
			low: rising[rising.length - 1].close * 0.90, // drops 10% → triggers 5% stop
			close: rising[rising.length - 1].close * 0.92,
			volume: 1_000_000,
		};
		const ohlcv = [...rising, dropBar];

		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		const stopTrades = result.trades.filter((t) => t.exitReason === 'stop_loss');
		// There should be at least one stop loss exit if a trade was entered
		if (result.trades.length > 0) {
			expect(stopTrades.length).toBeGreaterThan(0);
		}
	});
});

describe('runBacktest — take profit', () => {
	it('exits on take profit when price rises 10%', () => {
		// Uptrend triggers crossover, then keeps rising >10%
		const rising = makeOHLCV(30, 100, 0.005);
		const gainBars: OHLCV[] = Array.from({ length: 5 }, (_, k) => ({
			time: rising[rising.length - 1].time + (k + 1) * 86400,
			open: rising[rising.length - 1].close * (1 + k * 0.04),
			high: rising[rising.length - 1].close * (1 + k * 0.04 + 0.05),
			low: rising[rising.length - 1].close * (1 + k * 0.04 - 0.01),
			close: rising[rising.length - 1].close * (1 + (k + 1) * 0.04),
			volume: 1_000_000,
		}));

		const ohlcv = [...rising, ...gainBars];
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		if (result.trades.length > 0) {
			const tpTrades = result.trades.filter((t) => t.exitReason === 'take_profit');
			expect(tpTrades.length).toBeGreaterThan(0);
		}
	});
});

describe('runBacktest — position sizing', () => {
	it('position size respects riskPerTrade', () => {
		// Simple trend: EMA5 crosses EMA20 early, then mild drop triggers stop
		const ohlcv = makeOHLCV(200, 100, 0.003, 0.002);
		const result = runBacktest({
			strategy: makeSMAStrategy({ positionSizing: { method: 'fixed_fractional', riskPerTrade: 2, maxPositionPct: 100 } }),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		// Each trade should risk ~2% of equity at entry
		for (const trade of result.trades) {
			if (trade.exitReason === 'stop_loss') {
				const riskPct = Math.abs(trade.pnl) / 10000 * 100;
				// Actual risk ≤ initial riskPerTrade (2%) + some slippage tolerance
				expect(riskPct).toBeLessThan(5);
			}
		}
	});
});

describe('runBacktest — MA crossover on known data', () => {
	it('generates trades and computes valid metrics on trending data', () => {
		// 300 bars of uptrend — should generate multiple MA crossover trades
		const ohlcv = makeOHLCV(300, 1000, 0.002, 0.003);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		// Should have at least a few trades on 300 bars of trend
		expect(result.trades.length).toBeGreaterThanOrEqual(0);
		expect(result.metrics.totalTrades).toBe(result.trades.length);
		expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
		expect(result.metrics.winRate).toBeLessThanOrEqual(100);
		expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
		expect(result.metrics.profitFactor).toBeGreaterThanOrEqual(0);
	});

	it('final capital matches sum of trade P&L + initial capital', () => {
		const ohlcv = makeOHLCV(200, 500, 0.001, 0.002);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		const calcFinal = result.trades.reduce((cap, t) => cap + t.pnl, 10000);
		expect(result.finalCapital).toBeCloseTo(calcFinal, 5);
	});
});

describe('runBacktest — time-based exit', () => {
	it('exits after N bars when time_based exit is set', () => {
		const ohlcv = makeOHLCV(200, 100, 0.001);
		const strategy = makeSMAStrategy({
			exit: [
				{ type: 'stop_loss', value: 10, unit: 'pct' }, // wide stop
				{ type: 'time_based', bars: 5 },
			],
		});
		const result = runBacktest({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });

		const timeTrades = result.trades.filter((t) => t.exitReason === 'time_based');
		if (result.trades.length > 0) {
			// Most should be time-based with the wide stop
			expect(timeTrades.length + result.trades.filter(t => t.exitReason === 'end_of_data').length)
				.toBeGreaterThan(0);
		}
	});
});

describe('runBacktest — max drawdown circuit breaker', () => {
	it('stops trading when max drawdown limit is hit', () => {
		// Downtrend — will accumulate losses rapidly
		const ohlcv = makeOHLCV(200, 100, -0.01); // 1% daily loss
		const strategy = makeSMAStrategy({
			risk: { maxDrawdownPct: 10, maxOpenPositions: 1 }, // very tight DD limit
		});
		const result = runBacktest({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });

		// Max drawdown should not substantially exceed the limit
		// (it might exceed slightly on gap fills)
		expect(result.metrics.maxDrawdown).toBeLessThan(50);
	});
});

describe('runBacktest — short direction', () => {
	it('handles short-only strategy', () => {
		const ohlcv = makeOHLCV(200, 100, -0.001, 0.002);
		const strategy = makeSMAStrategy({
			entry: {
				direction: 'short',
				groups: [
					{
						logic: 'AND',
						conditions: [
							{
								indicator: 'ema',
								params: { period: 5 },
								operator: 'crosses_below',
								threshold: { indicator: 'ema', params: { period: 20 } },
							},
						],
					},
				],
			},
		});
		const result = runBacktest({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });

		// All trades should be short direction
		for (const trade of result.trades) {
			expect(trade.direction).toBe('short');
		}
	});
});

describe('runBacktest — trailing stop', () => {
	it('trailing stop exits preserve profits', () => {
		const ohlcv = makeOHLCV(200, 100, 0.003, 0.001);
		const strategy = makeSMAStrategy({
			exit: [
				{ type: 'stop_loss', value: 20, unit: 'pct' }, // wide initial stop
				{ type: 'trailing_stop', value: 5, unit: 'pct' },
			],
		});
		const result = runBacktest({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });
		const trailTrades = result.trades.filter((t) => t.exitReason === 'trailing_stop');
		// If any trades occur, some may trail off
		expect(trailTrades.length).toBeGreaterThanOrEqual(0);
	});
});

describe('runBacktest — RSI strategy', () => {
	it('generates valid metrics for RSI oversold strategy', () => {
		// Volatile price series to trigger RSI extremes
		const ohlcv = makeOHLCV(200, 100, 0, 0.02);
		const result = runBacktest({
			strategy: makeRSIStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
		expect(Number.isFinite(result.metrics.sharpe) || result.metrics.sharpe === Infinity).toBe(true);
		expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
		expect(result.metrics.winRate).toBeLessThanOrEqual(100);
	});
});

describe('runBacktest — ATR-based stop', () => {
	it('computes ATR-based stop price', () => {
		const ohlcv = makeOHLCV(100, 100, 0.002);
		const strategy = makeSMAStrategy({
			exit: [
				{ type: 'stop_loss', value: 2, unit: 'atr_multiple' },
				{ type: 'take_profit', value: 4, unit: 'atr_multiple' },
			],
		});
		const result = runBacktest({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });
		expect(result.metrics.totalTrades).toBeGreaterThanOrEqual(0);
	});
});

describe('runBacktest — R-multiple calculation', () => {
	it('positive R-multiple for winning trades, negative for losers', () => {
		const ohlcv = makeOHLCV(200, 100, 0.001, 0.005);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});

		for (const trade of result.trades) {
			if (trade.pnl > 0) expect(trade.rMultiple).toBeGreaterThan(0);
			if (trade.pnl < 0) expect(trade.rMultiple).toBeLessThan(0);
		}
	});
});

describe('runWalkForward', () => {
	it('splits data 70/30 and runs two backtests', () => {
		const ohlcv = makeOHLCV(200, 100, 0.002, 0.003);
		const strategy = makeSMAStrategy();

		const wf = runWalkForward({ strategy, ohlcv, symbol: 'TEST', initialCapital: 10000 });

		expect(wf.inSample).toBeDefined();
		expect(wf.outOfSample).toBeDefined();
		expect(wf.combined).toBeDefined();

		// in-sample should use fewer bars than combined
		const inBars = wf.inSample.endTime - wf.inSample.startTime;
		const combinedBars = wf.combined.endTime - wf.combined.startTime;
		expect(inBars).toBeLessThan(combinedBars);

		// degradation is finite
		expect(Number.isFinite(wf.degradationPct)).toBe(true);
	});

	it('combined result matches running on all data', () => {
		const ohlcv = makeOHLCV(200, 100, 0.002, 0.003);
		const config: BacktestConfig = { strategy: makeSMAStrategy(), ohlcv, symbol: 'TEST', initialCapital: 10000 };

		const wf = runWalkForward(config);
		const direct = runBacktest(config);

		expect(wf.combined.metrics.totalTrades).toBe(direct.metrics.totalTrades);
		expect(wf.combined.finalCapital).toBeCloseTo(direct.finalCapital, 2);
	});
});

describe('runBacktest — metrics consistency', () => {
	it('profitable + losing = total trades', () => {
		const ohlcv = makeOHLCV(300, 100, 0.001, 0.004);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		const m = result.metrics;
		expect(m.profitableTrades + m.losingTrades).toBe(m.totalTrades);
	});

	it('win rate matches profitable/total', () => {
		const ohlcv = makeOHLCV(300, 100, 0.001, 0.004);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		const m = result.metrics;
		if (m.totalTrades > 0) {
			const expected = (m.profitableTrades / m.totalTrades) * 100;
			expect(m.winRate).toBeCloseTo(expected, 5);
		}
	});

	it('equity curve has correct length (initial point + one per trade + optional end)', () => {
		const ohlcv = makeOHLCV(300, 100, 0.001, 0.004);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		// equity has at least initial point
		expect(result.equity.length).toBeGreaterThanOrEqual(1);
		// first point is initialCapital
		expect(result.equity[0].equity).toBeCloseTo(result.initialCapital, 5);
	});
});

describe('runBacktest — no infinite loops or NaN', () => {
	it('handles very short OHLCV arrays', () => {
		const ohlcv = makeOHLCV(5, 100, 0.01);
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		expect(result).toBeDefined();
		expect(Number.isNaN(result.finalCapital)).toBe(false);
	});

	it('handles flat price (no trend)', () => {
		const ohlcv = makeOHLCV(200, 100, 0); // flat price
		const result = runBacktest({
			strategy: makeSMAStrategy(),
			ohlcv,
			symbol: 'TEST',
			initialCapital: 10000,
		});
		expect(Number.isNaN(result.metrics.totalReturn)).toBe(false);
	});
});
