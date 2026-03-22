// Paper Trader — T-603
// Virtual trading sandbox backed by Supabase paper_trades table.

import { getSupabaseAdminClient } from '../supabaseAdmin.server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PaperTrade = {
	id: string;
	userId: string;
	symbol: string;
	side: 'long' | 'short';
	qty: number;          // quantity in base asset
	entryPrice: number;
	exitPrice: number | null;
	pnl: number | null;   // realised PnL in quote currency (null when open)
	isOpen: boolean;
	openedAt: string;
	closedAt: string | null;
	notes: string | null;
};

export type PaperTradeWithPnL = PaperTrade & {
	currentPrice: number;
	unrealisedPnL: number;
	unrealisedPct: number; // %
};

export type PaperPortfolioSnapshot = {
	openTrades: PaperTradeWithPnL[];
	closedTrades: PaperTrade[];
	totalUnrealisedPnL: number;
	totalRealisedPnL: number;
	winRate: number | null; // 0–1
	openCount: number;
	tradeCount: number; // total closed trades
};

// ─── DB row type ──────────────────────────────────────────────────────────────

type DbPaperTrade = {
	id: string;
	user_id: string;
	symbol: string;
	side: 'long' | 'short';
	qty: number;
	entry_price: number;
	exit_price: number | null;
	pnl: number | null;
	is_open: boolean;
	opened_at: string;
	closed_at: string | null;
	notes: string | null;
};

function mapTrade(row: DbPaperTrade): PaperTrade {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		side: row.side,
		qty: Number(row.qty),
		entryPrice: Number(row.entry_price),
		exitPrice: row.exit_price !== null ? Number(row.exit_price) : null,
		pnl: row.pnl !== null ? Number(row.pnl) : null,
		isOpen: row.is_open,
		openedAt: row.opened_at,
		closedAt: row.closed_at,
		notes: row.notes,
	};
}

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/** Unrealised P&L in quote currency. */
export function calcUnrealisedPnL(
	side: 'long' | 'short',
	entryPrice: number,
	currentPrice: number,
	qty: number
): number {
	const priceDiff = side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
	return priceDiff * qty;
}

/** Unrealised return as percentage of entry price. */
export function calcUnrealisedPct(
	side: 'long' | 'short',
	entryPrice: number,
	currentPrice: number
): number {
	if (entryPrice === 0) return 0;
	const priceDiff = side === 'long' ? currentPrice - entryPrice : entryPrice - currentPrice;
	return (priceDiff / entryPrice) * 100;
}

/**
 * Build a PaperPortfolioSnapshot from open/closed trades and a live price map.
 */
export function buildPaperPortfolio(
	openTrades: PaperTrade[],
	priceMap: Map<string, number>,
	closedTrades: PaperTrade[]
): PaperPortfolioSnapshot {
	const openWithPnL: PaperTradeWithPnL[] = openTrades.map(trade => {
		const currentPrice = priceMap.get(trade.symbol) ?? trade.entryPrice;
		const unrealisedPnL = calcUnrealisedPnL(trade.side, trade.entryPrice, currentPrice, trade.qty);
		const unrealisedPct = calcUnrealisedPct(trade.side, trade.entryPrice, currentPrice);
		return { ...trade, currentPrice, unrealisedPnL, unrealisedPct };
	});

	const totalUnrealisedPnL = openWithPnL.reduce((s, t) => s + t.unrealisedPnL, 0);
	const totalRealisedPnL   = closedTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
	const wins = closedTrades.filter(t => (t.pnl ?? 0) > 0).length;
	const winRate = closedTrades.length > 0 ? wins / closedTrades.length : null;

	return {
		openTrades: openWithPnL,
		closedTrades,
		totalUnrealisedPnL,
		totalRealisedPnL,
		winRate,
		openCount: openTrades.length,
		tradeCount: closedTrades.length,
	};
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Open a new paper trade (virtual buy/sell). */
export async function openPaperTrade(
	userId: string,
	symbol: string,
	side: 'long' | 'short',
	qty: number,
	entryPrice: number,
	notes?: string
): Promise<PaperTrade | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('paper_trades')
		.insert({
			user_id:     userId,
			symbol:      symbol.toUpperCase(),
			side,
			qty,
			entry_price: entryPrice,
			exit_price:  null,
			pnl:         null,
			is_open:     true,
			notes:       notes ?? null,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapTrade(data as DbPaperTrade);
}

/** Close an open paper trade by ID at the given exit price, computing realised PnL. */
export async function closePaperTrade(
	userId: string,
	tradeId: string,
	exitPrice: number
): Promise<PaperTrade | null> {
	const db = getSupabaseAdminClient();

	// Fetch open trade first
	const { data: existing, error: fetchErr } = await db
		.from('paper_trades')
		.select()
		.eq('id', tradeId)
		.eq('user_id', userId)
		.eq('is_open', true)
		.single();

	if (fetchErr || !existing) return null;

	const trade = mapTrade(existing as DbPaperTrade);
	const pnl = calcUnrealisedPnL(trade.side, trade.entryPrice, exitPrice, trade.qty);

	const { data, error } = await db
		.from('paper_trades')
		.update({
			exit_price: exitPrice,
			pnl,
			is_open:    false,
			closed_at:  new Date().toISOString(),
		})
		.eq('id', tradeId)
		.eq('user_id', userId)
		.select()
		.single();

	if (error || !data) return null;
	return mapTrade(data as DbPaperTrade);
}

/** List all open paper trades for a user. */
export async function listOpenTrades(userId: string): Promise<PaperTrade[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('paper_trades')
		.select('*')
		.eq('user_id', userId)
		.eq('is_open', true)
		.order('opened_at', { ascending: false });

	if (error || !data) return [];
	return (data as DbPaperTrade[]).map(mapTrade);
}

/** List closed paper trades for a user (most recent 50). */
export async function listClosedTrades(userId: string): Promise<PaperTrade[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('paper_trades')
		.select('*')
		.eq('user_id', userId)
		.eq('is_open', false)
		.order('closed_at', { ascending: false })
		.limit(50);

	if (error || !data) return [];
	return (data as DbPaperTrade[]).map(mapTrade);
}

/** Get the most recent open trade for a symbol. Returns null if none. */
export async function getOpenTradeBySymbol(userId: string, symbol: string): Promise<PaperTrade | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('paper_trades')
		.select('*')
		.eq('user_id', userId)
		.eq('symbol', symbol.toUpperCase())
		.eq('is_open', true)
		.order('opened_at', { ascending: false })
		.limit(1)
		.single();

	if (error || !data) return null;
	return mapTrade(data as DbPaperTrade);
}
