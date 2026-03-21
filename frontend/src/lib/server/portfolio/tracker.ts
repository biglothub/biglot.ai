// Portfolio Tracker — T-302
// CRUD operations via Supabase for open positions and closed trades

import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import type { Position, ClosedTrade, PortfolioSnapshot, PositionWithPnL } from '$lib/types/portfolio';

// ─── Type helpers ─────────────────────────────────────────────────────────────

type DbPosition = {
	id: string;
	user_id: string;
	symbol: string;
	direction: 'long' | 'short';
	entry_price: number;
	size: number;
	stop_price: number | null;
	target_price: number | null;
	notes: string | null;
	opened_at: string;
};

type DbClosedTrade = {
	id: string;
	user_id: string;
	symbol: string;
	direction: 'long' | 'short';
	entry_price: number;
	exit_price: number;
	size: number;
	pnl_usd: number;
	r_multiple: number | null;
	notes: string | null;
	opened_at: string;
	closed_at: string;
};

function mapPosition(row: DbPosition): Position {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		direction: row.direction,
		entryPrice: Number(row.entry_price),
		size: Number(row.size),
		stopPrice: row.stop_price !== null ? Number(row.stop_price) : null,
		targetPrice: row.target_price !== null ? Number(row.target_price) : null,
		notes: row.notes,
		openedAt: row.opened_at,
	};
}

function mapClosedTrade(row: DbClosedTrade): ClosedTrade {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		direction: row.direction,
		entryPrice: Number(row.entry_price),
		exitPrice: Number(row.exit_price),
		size: Number(row.size),
		pnlUSD: Number(row.pnl_usd),
		rMultiple: row.r_multiple !== null ? Number(row.r_multiple) : null,
		notes: row.notes,
		openedAt: row.opened_at,
		closedAt: row.closed_at,
	};
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calculate P&L for a position given current price.
 */
export function calcUnrealisedPnL(
	direction: 'long' | 'short',
	entryPrice: number,
	currentPrice: number,
	size: number
): number {
	const priceDiff = direction === 'long'
		? currentPrice - entryPrice
		: entryPrice - currentPrice;
	return priceDiff * size;
}

/**
 * Calculate R-multiple: pnl / riskAmount (|entry - stop| * size).
 */
export function calcRMultiple(
	pnlUSD: number,
	entryPrice: number,
	stopPrice: number | null,
	size: number
): number | null {
	if (stopPrice === null) return null;
	const riskAmount = Math.abs(entryPrice - stopPrice) * size;
	if (riskAmount === 0) return null;
	return pnlUSD / riskAmount;
}

/**
 * Compute win rate from closed trades.
 */
export function calcWinRate(trades: ClosedTrade[]): number | null {
	if (trades.length === 0) return null;
	const wins = trades.filter(t => t.pnlUSD > 0).length;
	return wins / trades.length;
}

/**
 * Compute average R-multiple from closed trades that have a stop.
 */
export function calcAvgRMultiple(trades: ClosedTrade[]): number | null {
	const withR = trades.filter(t => t.rMultiple !== null);
	if (withR.length === 0) return null;
	const sum = withR.reduce((acc, t) => acc + (t.rMultiple ?? 0), 0);
	return sum / withR.length;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function addPosition(
	userId: string,
	pos: Omit<Position, 'id' | 'userId' | 'openedAt'>
): Promise<Position | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('portfolio_positions')
		.insert({
			user_id:      userId,
			symbol:       pos.symbol.toUpperCase(),
			direction:    pos.direction,
			entry_price:  pos.entryPrice,
			size:         pos.size,
			stop_price:   pos.stopPrice,
			target_price: pos.targetPrice,
			notes:        pos.notes,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapPosition(data as DbPosition);
}

export async function listPositions(userId: string): Promise<Position[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('portfolio_positions')
		.select('*')
		.eq('user_id', userId)
		.order('opened_at', { ascending: false });

	if (error || !data) return [];
	return (data as DbPosition[]).map(mapPosition);
}

export async function closePosition(
	userId: string,
	positionId: string,
	exitPrice: number,
	notes?: string
): Promise<ClosedTrade | null> {
	const db = getSupabaseAdminClient();

	// Fetch the position first
	const { data: posData, error: posError } = await db
		.from('portfolio_positions')
		.select('*')
		.eq('id', positionId)
		.eq('user_id', userId)
		.single();

	if (posError || !posData) return null;
	const pos = mapPosition(posData as DbPosition);

	// Calculate PnL
	const pnlUSD = calcUnrealisedPnL(pos.direction, pos.entryPrice, exitPrice, pos.size);
	const rMultiple = calcRMultiple(pnlUSD, pos.entryPrice, pos.stopPrice, pos.size);

	// Insert into closed trades
	const { data: tradeData, error: tradeError } = await db
		.from('portfolio_closed_trades')
		.insert({
			user_id:     userId,
			symbol:      pos.symbol,
			direction:   pos.direction,
			entry_price: pos.entryPrice,
			exit_price:  exitPrice,
			size:        pos.size,
			pnl_usd:     pnlUSD,
			r_multiple:  rMultiple,
			notes:       notes ?? pos.notes,
			opened_at:   pos.openedAt,
		})
		.select()
		.single();

	if (tradeError || !tradeData) return null;

	// Delete the open position
	await db.from('portfolio_positions').delete().eq('id', positionId);

	return mapClosedTrade(tradeData as DbClosedTrade);
}

export async function listClosedTrades(userId: string, limit = 50): Promise<ClosedTrade[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('portfolio_closed_trades')
		.select('*')
		.eq('user_id', userId)
		.order('closed_at', { ascending: false })
		.limit(limit);

	if (error || !data) return [];
	return (data as DbClosedTrade[]).map(mapClosedTrade);
}

export async function deletePosition(userId: string, positionId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('portfolio_positions')
		.delete()
		.eq('id', positionId)
		.eq('user_id', userId);
	return !error;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Build a full portfolio snapshot, enriching positions with current prices.
 * Caller provides a price fetcher to avoid coupling to specific data sources.
 */
export async function buildPortfolioSnapshot(
	userId: string,
	priceMap: Map<string, number>
): Promise<PortfolioSnapshot> {
	const [positions, closedTrades] = await Promise.all([
		listPositions(userId),
		listClosedTrades(userId, 100),
	]);

	const positionsWithPnL: PositionWithPnL[] = positions.map(pos => {
		const currentPrice = priceMap.get(pos.symbol.toUpperCase()) ?? null;
		const unrealisedPnLUSD = currentPrice !== null
			? calcUnrealisedPnL(pos.direction, pos.entryPrice, currentPrice, pos.size)
			: null;
		const unrealisedPnLPct = unrealisedPnLUSD !== null && pos.entryPrice > 0
			? (unrealisedPnLUSD / (pos.entryPrice * pos.size)) * 100
			: null;

		return { ...pos, currentPrice, unrealisedPnLUSD, unrealisedPnLPct };
	});

	const totalUnrealisedPnL = positionsWithPnL.reduce(
		(sum, p) => sum + (p.unrealisedPnLUSD ?? 0), 0
	);
	const totalRealised = closedTrades.reduce((sum, t) => sum + t.pnlUSD, 0);

	// Equity curve: cumulative realised PnL over time (sorted oldest first)
	const sorted = [...closedTrades].sort(
		(a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
	);
	let cumulative = 0;
	const equityCurve = sorted.map(t => {
		cumulative += t.pnlUSD;
		return { date: t.closedAt.slice(0, 10), equity: cumulative };
	});

	return {
		positions: positionsWithPnL,
		closedTrades,
		totalUnrealisedPnL,
		totalRealised,
		winRate: calcWinRate(closedTrades),
		avgRMultiple: calcAvgRMultiple(closedTrades),
		equityCurve,
	};
}
