// Backtest Types - T-104
// Result types for the backtesting engine

import type { Strategy } from './strategy';

// ─── Trade ────────────────────────────────────────────────────────────────────

export type ExitReason =
	| 'stop_loss'
	| 'take_profit'
	| 'trailing_stop'
	| 'indicator'
	| 'time_based'
	| 'end_of_data'
	| 'max_drawdown';

export type Trade = {
	entryTime: number; // Unix timestamp seconds
	exitTime: number;
	direction: 'long' | 'short';
	entryPrice: number;
	exitPrice: number;
	size: number; // units (e.g. BTC)
	pnl: number; // absolute P&L in account currency
	pnlPct: number; // % return on the trade
	rMultiple: number; // profit in terms of initial risk (1R = risked amount)
	exitReason: ExitReason;
};

// ─── Equity Curve ─────────────────────────────────────────────────────────────

export type EquityPoint = {
	time: number;
	equity: number;
	drawdownPct: number; // drawdown from peak at this point (0–100)
};

// ─── Performance Metrics ──────────────────────────────────────────────────────

export type BacktestMetrics = {
	totalReturn: number; // % return over the full period
	cagr: number; // compound annual growth rate %
	maxDrawdown: number; // max peak-to-trough drawdown %
	sharpe: number; // annualised Sharpe (rf = 0)
	sortino: number; // annualised Sortino (downside only)
	winRate: number; // % of trades that were profitable
	avgRMultiple: number; // average R-multiple across all trades
	profitFactor: number; // gross profit / gross loss
	maxConsecutiveLosses: number; // longest losing streak
	totalTrades: number;
	profitableTrades: number;
	losingTrades: number;
	avgWin: number; // average winning trade % return
	avgLoss: number; // average losing trade % return (negative)
	expectancy: number; // expected $ per trade (winRate * avgWin + lossRate * avgLoss)
};

// ─── Backtest Result ──────────────────────────────────────────────────────────

export type BacktestResult = {
	strategy: Strategy;
	symbol: string;
	startTime: number;
	endTime: number;
	initialCapital: number;
	finalCapital: number;
	trades: Trade[];
	equity: EquityPoint[];
	metrics: BacktestMetrics;
};

// ─── Walk-Forward Result ──────────────────────────────────────────────────────

export type WalkForwardResult = {
	inSample: BacktestResult; // first 70% of data
	outOfSample: BacktestResult; // last 30% of data
	combined: BacktestResult; // full dataset
	degradationPct: number; // how much worse out-of-sample is (positive = worse)
};

// ─── Engine Config ────────────────────────────────────────────────────────────

export type BacktestConfig = {
	strategy: Strategy;
	ohlcv: import('./contentBlock').OHLCV[];
	symbol: string;
	initialCapital?: number; // default 10000
	walkForward?: boolean; // run walk-forward validation (default false)
};
