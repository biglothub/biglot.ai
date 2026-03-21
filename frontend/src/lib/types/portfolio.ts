// Portfolio types — T-302

export type TradeDirection = 'long' | 'short';

export type Position = {
	id: string;
	userId: string;
	symbol: string;
	direction: TradeDirection;
	entryPrice: number;
	size: number;          // units/lots
	stopPrice: number | null;
	targetPrice: number | null;
	notes: string | null;
	openedAt: string;      // ISO timestamp
};

export type ClosedTrade = {
	id: string;
	userId: string;
	symbol: string;
	direction: TradeDirection;
	entryPrice: number;
	exitPrice: number;
	size: number;
	pnlUSD: number;
	rMultiple: number | null;  // pnl / risk (if stop was set)
	openedAt: string;
	closedAt: string;
	notes: string | null;
};

export type PositionWithPnL = Position & {
	currentPrice: number | null;
	unrealisedPnLUSD: number | null;
	unrealisedPnLPct: number | null;
};

export type PortfolioSnapshot = {
	positions: PositionWithPnL[];
	closedTrades: ClosedTrade[];
	totalUnrealisedPnL: number;
	totalRealised: number;
	winRate: number | null;       // from closed trades
	avgRMultiple: number | null;  // from closed trades with stop
	equityCurve: { date: string; equity: number }[];
};
