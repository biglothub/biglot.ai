// Tests for strategySharing data layer — T-1404
// Tests pure functions: validators, mapSharedStrategyRow, inferAssetClass,
//   formatStrategyTableRow, strategyToBacktestBlock, sortByToColumn

import { describe, it, expect } from 'vitest';
import {
	isValidAssetClass,
	isValidStrategyType,
	isValidSortBy,
	isPositiveNumber,
	isNonNegativeInt,
	mapSharedStrategyRow,
	formatStrategyTableRow,
	inferAssetClass,
	strategyToBacktestBlock,
	sortByToColumn,
	VALID_ASSET_CLASSES,
	VALID_STRATEGY_TYPES,
	VALID_SORT_BY,
	STRATEGY_TYPE_LABELS,
	ASSET_CLASS_LABELS,
	type SharedStrategy,
	type SharedStrategyRow,
} from '../data/strategySharing.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockRow: SharedStrategyRow = {
	id: 'abc-123',
	user_id: 'default',
	strategy_name: 'EMA Crossover',
	description: 'Simple EMA 20/50 crossover strategy on BTC daily',
	symbol: 'BTCUSDT',
	timeframe: '1d',
	asset_class: 'crypto',
	strategy_type: 'trend_following',
	sharpe: 1.85,
	win_rate: 58.3,
	max_drawdown: 22.1,
	total_return: 142.5,
	total_trades: 87,
	profit_factor: 2.1,
	is_clone: false,
	source_id: null,
	created_at: '2026-01-15T10:00:00Z',
};

const mockStrategy: SharedStrategy = {
	id: 'abc-123',
	userId: 'default',
	strategyName: 'EMA Crossover',
	description: 'Simple EMA 20/50 crossover strategy on BTC daily',
	symbol: 'BTCUSDT',
	timeframe: '1d',
	assetClass: 'crypto',
	strategyType: 'trend_following',
	sharpe: 1.85,
	winRate: 58.3,
	maxDrawdown: 22.1,
	totalReturn: 142.5,
	totalTrades: 87,
	profitFactor: 2.1,
	isClone: false,
	sourceId: null,
	createdAt: '2026-01-15T10:00:00Z',
};

// ─── isValidAssetClass ────────────────────────────────────────────────────────

describe('isValidAssetClass', () => {
	it('returns true for all valid asset classes', () => {
		for (const ac of VALID_ASSET_CLASSES) {
			expect(isValidAssetClass(ac)).toBe(true);
		}
	});

	it('returns false for invalid strings', () => {
		expect(isValidAssetClass('nft')).toBe(false);
		expect(isValidAssetClass('stock')).toBe(false);
		expect(isValidAssetClass('')).toBe(false);
	});

	it('returns false for non-strings', () => {
		expect(isValidAssetClass(42)).toBe(false);
		expect(isValidAssetClass(null)).toBe(false);
		expect(isValidAssetClass(undefined)).toBe(false);
	});
});

// ─── isValidStrategyType ──────────────────────────────────────────────────────

describe('isValidStrategyType', () => {
	it('returns true for all valid strategy types', () => {
		for (const st of VALID_STRATEGY_TYPES) {
			expect(isValidStrategyType(st)).toBe(true);
		}
	});

	it('returns false for invalid strings', () => {
		expect(isValidStrategyType('scalping')).toBe(false);
		expect(isValidStrategyType('TREND_FOLLOWING')).toBe(false);
		expect(isValidStrategyType('')).toBe(false);
	});

	it('returns false for non-strings', () => {
		expect(isValidStrategyType(null)).toBe(false);
		expect(isValidStrategyType({})).toBe(false);
	});
});

// ─── isValidSortBy ────────────────────────────────────────────────────────────

describe('isValidSortBy', () => {
	it('returns true for all valid sort options', () => {
		for (const s of VALID_SORT_BY) {
			expect(isValidSortBy(s)).toBe(true);
		}
	});

	it('returns false for invalid values', () => {
		expect(isValidSortBy('profit')).toBe(false);
		expect(isValidSortBy('asc')).toBe(false);
		expect(isValidSortBy(null)).toBe(false);
	});
});

// ─── isPositiveNumber ─────────────────────────────────────────────────────────

describe('isPositiveNumber', () => {
	it('returns true for finite numbers', () => {
		expect(isPositiveNumber(1.85)).toBe(true);
		expect(isPositiveNumber(0)).toBe(true);
		expect(isPositiveNumber(-5)).toBe(true);
	});

	it('returns false for non-finite or non-numbers', () => {
		expect(isPositiveNumber(NaN)).toBe(false);
		expect(isPositiveNumber(Infinity)).toBe(false);
		expect(isPositiveNumber('1.5')).toBe(false);
		expect(isPositiveNumber(null)).toBe(false);
	});
});

// ─── isNonNegativeInt ─────────────────────────────────────────────────────────

describe('isNonNegativeInt', () => {
	it('returns true for non-negative integers', () => {
		expect(isNonNegativeInt(0)).toBe(true);
		expect(isNonNegativeInt(87)).toBe(true);
		expect(isNonNegativeInt(1000)).toBe(true);
	});

	it('returns false for floats', () => {
		expect(isNonNegativeInt(1.5)).toBe(false);
	});

	it('returns false for negatives', () => {
		expect(isNonNegativeInt(-1)).toBe(false);
	});

	it('returns false for non-numbers', () => {
		expect(isNonNegativeInt('5')).toBe(false);
		expect(isNonNegativeInt(null)).toBe(false);
	});
});

// ─── mapSharedStrategyRow ─────────────────────────────────────────────────────

describe('mapSharedStrategyRow', () => {
	it('maps all fields correctly', () => {
		const s = mapSharedStrategyRow(mockRow);
		expect(s.id).toBe('abc-123');
		expect(s.userId).toBe('default');
		expect(s.strategyName).toBe('EMA Crossover');
		expect(s.description).toBe('Simple EMA 20/50 crossover strategy on BTC daily');
		expect(s.symbol).toBe('BTCUSDT');
		expect(s.timeframe).toBe('1d');
		expect(s.assetClass).toBe('crypto');
		expect(s.strategyType).toBe('trend_following');
		expect(s.sharpe).toBe(1.85);
		expect(s.winRate).toBe(58.3);
		expect(s.maxDrawdown).toBe(22.1);
		expect(s.totalReturn).toBe(142.5);
		expect(s.totalTrades).toBe(87);
		expect(s.profitFactor).toBe(2.1);
		expect(s.isClone).toBe(false);
		expect(s.sourceId).toBeNull();
		expect(s.createdAt).toBe('2026-01-15T10:00:00Z');
	});

	it('maps clone fields correctly', () => {
		const cloneRow: SharedStrategyRow = {
			...mockRow,
			id: 'clone-456',
			is_clone: true,
			source_id: 'abc-123',
		};
		const s = mapSharedStrategyRow(cloneRow);
		expect(s.isClone).toBe(true);
		expect(s.sourceId).toBe('abc-123');
	});
});

// ─── inferAssetClass ──────────────────────────────────────────────────────────

describe('inferAssetClass', () => {
	it('detects crypto from USDT suffix', () => {
		expect(inferAssetClass('BTCUSDT')).toBe('crypto');
		expect(inferAssetClass('ETHUSDT')).toBe('crypto');
		expect(inferAssetClass('SOLUSDT')).toBe('crypto');
	});

	it('detects crypto from known tokens', () => {
		expect(inferAssetClass('BTC')).toBe('crypto');
		expect(inferAssetClass('ETHBTC')).toBe('crypto');
		expect(inferAssetClass('BNBUSDC')).toBe('crypto');
	});

	it('detects commodities', () => {
		expect(inferAssetClass('XAUUSD')).toBe('commodity');
		expect(inferAssetClass('XAGUSD')).toBe('commodity');
		expect(inferAssetClass('GOLD')).toBe('commodity');
	});

	it('detects forex pairs', () => {
		expect(inferAssetClass('EURUSD')).toBe('forex');
		expect(inferAssetClass('GBPJPY')).toBe('forex');
		expect(inferAssetClass('AUDUSD')).toBe('forex');
	});

	it('defaults to equity for unknown symbols', () => {
		expect(inferAssetClass('AAPL')).toBe('equity');
		expect(inferAssetClass('TSLA')).toBe('equity');
		expect(inferAssetClass('SPY')).toBe('equity');
	});

	it('handles lowercase input', () => {
		expect(inferAssetClass('btcusdt')).toBe('crypto');
		expect(inferAssetClass('xauusd')).toBe('commodity');
	});
});

// ─── formatStrategyTableRow ───────────────────────────────────────────────────

describe('formatStrategyTableRow', () => {
	it('has correct length (12 columns)', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(row).toHaveLength(12);
	});

	it('first column is the rank', () => {
		const row = formatStrategyTableRow(mockStrategy, 3);
		expect(row[0]).toBe(3);
	});

	it('second column is strategy name', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(row[1]).toBe('EMA Crossover');
	});

	it('symbol is in correct position', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(row[2]).toBe('BTCUSDT');
	});

	it('formats sharpe as 2 decimal places', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(row[6]).toBe('1.85');
	});

	it('formats win rate with % sign', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(String(row[7])).toContain('%');
	});

	it('formats positive total return with + sign', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(String(row[8])).toContain('+');
	});

	it('formats negative total return without + sign', () => {
		const negStrategy = { ...mockStrategy, totalReturn: -15.3 };
		const row = formatStrategyTableRow(negStrategy, 1);
		expect(String(row[8])).toContain('-');
		expect(String(row[8])).not.toContain('+');
	});

	it('Source column shows "Clone" for clones', () => {
		const clonedStrategy = { ...mockStrategy, isClone: true };
		const row = formatStrategyTableRow(clonedStrategy, 1);
		expect(row[11]).toBe('Clone');
	});

	it('Source column shows "Original" for originals', () => {
		const row = formatStrategyTableRow(mockStrategy, 1);
		expect(row[11]).toBe('Original');
	});
});

// ─── strategyToBacktestBlock ──────────────────────────────────────────────────

describe('strategyToBacktestBlock', () => {
	it('returns a BacktestBlock with type "backtest"', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.type).toBe('backtest');
	});

	it('uses strategy symbol and timeframe', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.symbol).toBe('BTCUSDT');
		expect(block.timeframe).toBe('1d');
	});

	it('initialCapital is 10000', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.initialCapital).toBe(10_000);
	});

	it('finalCapital reflects total return', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		// 142.5% return → finalCapital = 10000 * 2.425 = 24250
		expect(block.finalCapital).toBeCloseTo(24_250, 0);
	});

	it('metrics match strategy fields', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.metrics.sharpe).toBe(1.85);
		expect(block.metrics.winRate).toBe(58.3);
		expect(block.metrics.maxDrawdown).toBe(22.1);
		expect(block.metrics.totalReturn).toBe(142.5);
		expect(block.metrics.totalTrades).toBe(87);
		expect(block.metrics.profitFactor).toBe(2.1);
	});

	it('trades and equity are empty arrays', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.trades).toEqual([]);
		expect(block.equity).toEqual([]);
	});

	it('startTime < endTime', () => {
		const block = strategyToBacktestBlock(mockStrategy);
		expect(block.startTime).toBeLessThan(block.endTime);
	});

	it('handles negative total return correctly', () => {
		const losingStrategy = { ...mockStrategy, totalReturn: -30 };
		const block = strategyToBacktestBlock(losingStrategy);
		// -30% → 10000 * 0.7 = 7000
		expect(block.finalCapital).toBeCloseTo(7_000, 0);
	});
});

// ─── sortByToColumn ───────────────────────────────────────────────────────────

describe('sortByToColumn', () => {
	it('maps sharpe to "sharpe"', () => {
		expect(sortByToColumn('sharpe')).toBe('sharpe');
	});

	it('maps win_rate to "win_rate"', () => {
		expect(sortByToColumn('win_rate')).toBe('win_rate');
	});

	it('maps total_return to "total_return"', () => {
		expect(sortByToColumn('total_return')).toBe('total_return');
	});

	it('maps newest to "created_at"', () => {
		expect(sortByToColumn('newest')).toBe('created_at');
	});
});

// ─── Constants integrity ──────────────────────────────────────────────────────

describe('STRATEGY_TYPE_LABELS', () => {
	it('has a label for every valid strategy type', () => {
		for (const st of VALID_STRATEGY_TYPES) {
			expect(STRATEGY_TYPE_LABELS[st]).toBeTruthy();
		}
	});
});

describe('ASSET_CLASS_LABELS', () => {
	it('has a label for every valid asset class', () => {
		for (const ac of VALID_ASSET_CLASSES) {
			expect(ASSET_CLASS_LABELS[ac]).toBeTruthy();
		}
	});
});

describe('VALID_STRATEGY_TYPES', () => {
	it('has 8 strategy types', () => {
		expect(VALID_STRATEGY_TYPES).toHaveLength(8);
	});

	it('all entries are unique', () => {
		const unique = new Set(VALID_STRATEGY_TYPES);
		expect(unique.size).toBe(VALID_STRATEGY_TYPES.length);
	});
});

describe('VALID_ASSET_CLASSES', () => {
	it('has 4 asset classes', () => {
		expect(VALID_ASSET_CLASSES).toHaveLength(4);
	});
});
