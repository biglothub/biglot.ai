// Strategy Sharing Data Layer — T-1404
// Community library: share backtested strategies, browse, filter, clone

import type { BacktestBlock, BacktestMetricsSummary } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AssetClass = 'crypto' | 'forex' | 'equity' | 'commodity';

export type StrategyType =
	| 'trend_following'
	| 'mean_reversion'
	| 'breakout'
	| 'range_trading'
	| 'momentum'
	| 'carry_trade'
	| 'pairs_spread'
	| 'volatility';

export type BrowseSortBy = 'sharpe' | 'win_rate' | 'total_return' | 'newest';

export type SharedStrategyMetrics = {
	sharpe: number;
	winRate: number;
	maxDrawdown: number;
	totalReturn: number;
	totalTrades: number;
	profitFactor: number;
};

export type SharedStrategy = {
	id: string;
	userId: string;
	strategyName: string;
	description: string;
	symbol: string;
	timeframe: string;
	assetClass: AssetClass;
	strategyType: StrategyType;
	sharpe: number;
	winRate: number;
	maxDrawdown: number;
	totalReturn: number;
	totalTrades: number;
	profitFactor: number;
	isClone: boolean;
	sourceId: string | null;
	createdAt: string;
};

// ─── DB Row (mirrors Supabase table `shared_strategies`) ─────────────────────

export type SharedStrategyRow = {
	id: string;
	user_id: string;
	strategy_name: string;
	description: string;
	symbol: string;
	timeframe: string;
	asset_class: string;
	strategy_type: string;
	sharpe: number;
	win_rate: number;
	max_drawdown: number;
	total_return: number;
	total_trades: number;
	profit_factor: number;
	is_clone: boolean;
	source_id: string | null;
	created_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_ASSET_CLASSES: AssetClass[] = ['crypto', 'forex', 'equity', 'commodity'];

export const VALID_STRATEGY_TYPES: StrategyType[] = [
	'trend_following',
	'mean_reversion',
	'breakout',
	'range_trading',
	'momentum',
	'carry_trade',
	'pairs_spread',
	'volatility',
];

export const VALID_SORT_BY: BrowseSortBy[] = ['sharpe', 'win_rate', 'total_return', 'newest'];

export const STRATEGY_TYPE_LABELS: Record<StrategyType, string> = {
	trend_following: 'Trend Following',
	mean_reversion: 'Mean Reversion',
	breakout: 'Breakout',
	range_trading: 'Range Trading',
	momentum: 'Momentum',
	carry_trade: 'Carry Trade',
	pairs_spread: 'Pairs/Spread',
	volatility: 'Volatility',
};

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
	crypto: 'Crypto',
	forex: 'Forex',
	equity: 'Equity',
	commodity: 'Commodity',
};

// ─── Validators ───────────────────────────────────────────────────────────────

export function isValidAssetClass(s: unknown): s is AssetClass {
	return typeof s === 'string' && (VALID_ASSET_CLASSES as string[]).includes(s);
}

export function isValidStrategyType(s: unknown): s is StrategyType {
	return typeof s === 'string' && (VALID_STRATEGY_TYPES as string[]).includes(s);
}

export function isValidSortBy(s: unknown): s is BrowseSortBy {
	return typeof s === 'string' && (VALID_SORT_BY as string[]).includes(s);
}

export function isPositiveNumber(v: unknown): v is number {
	return typeof v === 'number' && isFinite(v);
}

export function isNonNegativeInt(v: unknown): v is number {
	return typeof v === 'number' && isFinite(v) && v >= 0 && Number.isInteger(v);
}

// ─── Row Mapper ───────────────────────────────────────────────────────────────

export function mapSharedStrategyRow(row: SharedStrategyRow): SharedStrategy {
	return {
		id: row.id,
		userId: row.user_id,
		strategyName: row.strategy_name,
		description: row.description,
		symbol: row.symbol,
		timeframe: row.timeframe,
		assetClass: row.asset_class as AssetClass,
		strategyType: row.strategy_type as StrategyType,
		sharpe: row.sharpe,
		winRate: row.win_rate,
		maxDrawdown: row.max_drawdown,
		totalReturn: row.total_return,
		totalTrades: row.total_trades,
		profitFactor: row.profit_factor,
		isClone: row.is_clone,
		sourceId: row.source_id,
		createdAt: row.created_at,
	};
}

// ─── Asset Class Inference ───────────────────────────────────────────────────

const CRYPTO_TOKENS = [
	'BTC', 'ETH', 'BNB', 'SOL', 'ADA', 'XRP', 'DOGE', 'DOT', 'LINK',
	'MATIC', 'AVAX', 'LTC', 'UNI', 'ATOM', 'NEAR', 'FIL', 'ARB', 'OP',
];
const FOREX_CURRENCIES = ['EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SGD', 'HKD'];
const COMMODITY_PATTERNS = ['XAUUSD', 'XAGUSD', 'GOLD', 'SILVER', 'OIL', 'WTI', 'BRENT', 'GAS', 'WHEAT', 'CORN'];

export function inferAssetClass(symbol: string): AssetClass {
	const s = symbol.toUpperCase().replace(/[^A-Z]/g, '');

	if (COMMODITY_PATTERNS.some((p) => s.includes(p))) return 'commodity';

	if (CRYPTO_TOKENS.some((tok) => s.startsWith(tok) || s === tok + 'USDT' || s === tok + 'BTC')) {
		return 'crypto';
	}
	if (s.endsWith('USDT') || s.endsWith('BUSD') || s.endsWith('USDC')) return 'crypto';

	if (s.length === 6) {
		const first3 = s.slice(0, 3);
		const last3 = s.slice(3);
		const currencies = [...FOREX_CURRENCIES, 'USD'];
		if (currencies.includes(first3) && currencies.includes(last3)) return 'forex';
	}

	return 'equity';
}

// ─── Table Formatting ─────────────────────────────────────────────────────────

export function formatStrategyTableRow(s: SharedStrategy, rank: number): (string | number)[] {
	const sign = s.totalReturn >= 0 ? '+' : '';
	return [
		rank,
		s.strategyName,
		s.symbol,
		ASSET_CLASS_LABELS[s.assetClass],
		STRATEGY_TYPE_LABELS[s.strategyType],
		s.timeframe,
		s.sharpe.toFixed(2),
		`${s.winRate.toFixed(1)}%`,
		`${sign}${s.totalReturn.toFixed(1)}%`,
		`${s.maxDrawdown.toFixed(1)}%`,
		s.totalTrades,
		s.isClone ? 'Clone' : 'Original',
	];
}

// ─── BacktestBlock Builder ────────────────────────────────────────────────────

/**
 * Build a minimal BacktestBlock from stored strategy metrics.
 * trades/equity are empty since we store only summary metrics.
 */
export function strategyToBacktestBlock(s: SharedStrategy): BacktestBlock {
	const initialCapital = 10_000;
	const finalCapital = initialCapital * (1 + s.totalReturn / 100);
	const now = Math.floor(Date.now() / 1000);
	const oneYearAgo = now - 365 * 24 * 3600;

	const metrics: BacktestMetricsSummary = {
		totalReturn: s.totalReturn,
		maxDrawdown: s.maxDrawdown,
		sharpe: s.sharpe,
		winRate: s.winRate,
		totalTrades: s.totalTrades,
		profitFactor: s.profitFactor,
		avgRMultiple: 0,
		expectancy: 0,
		maxConsecutiveLosses: 0,
	};

	return {
		type: 'backtest',
		symbol: s.symbol,
		timeframe: s.timeframe,
		initialCapital,
		finalCapital,
		startTime: oneYearAgo,
		endTime: now,
		trades: [],
		equity: [],
		metrics,
	};
}

// ─── Sort Column Mapping ──────────────────────────────────────────────────────

export function sortByToColumn(sortBy: BrowseSortBy): string {
	switch (sortBy) {
		case 'win_rate':    return 'win_rate';
		case 'total_return': return 'total_return';
		case 'newest':      return 'created_at';
		case 'sharpe':
		default:            return 'sharpe';
	}
}
