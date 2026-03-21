// Trade Journal — T-305
// CRUD + statistics for per-trade journaling

import { getSupabaseAdminClient } from '../supabaseAdmin.server';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TradeEmotion = 'calm' | 'fearful' | 'greedy' | 'impulsive' | 'disciplined' | 'other';

export type JournalEntry = {
	id: string;
	userId: string;
	symbol: string;
	direction: 'long' | 'short';
	entryPrice: number;
	exitPrice: number | null;
	size: number;
	pnlUSD: number | null;
	rMultiple: number | null;
	setupType: string | null;
	emotion: TradeEmotion | null;
	preNotes: string | null;
	postNotes: string | null;
	mistakes: string[];
	followedPlan: boolean | null;
	tradeDate: string;      // YYYY-MM-DD
	createdAt: string;
};

export type JournalStats = {
	totalTrades: number;
	winRate: number | null;
	avgPnL: number | null;
	avgRMultiple: number | null;
	bestDay: { date: string; pnl: number } | null;
	worstDay: { date: string; pnl: number } | null;
	commonMistakes: { mistake: string; count: number }[];
	emotionBreakdown: { emotion: string; count: number; winRate: number | null }[];
	planAdherenceRate: number | null;   // % of trades where followedPlan=true
	emotionalTradingPct: number | null; // % of trades with emotion in ['fearful','greedy','impulsive']
};

type DbJournalEntry = {
	id: string;
	user_id: string;
	symbol: string;
	direction: 'long' | 'short';
	entry_price: number;
	exit_price: number | null;
	size: number;
	pnl_usd: number | null;
	r_multiple: number | null;
	setup_type: string | null;
	emotion: TradeEmotion | null;
	pre_notes: string | null;
	post_notes: string | null;
	mistakes: string[];
	followed_plan: boolean | null;
	trade_date: string;
	created_at: string;
};

function mapEntry(row: DbJournalEntry): JournalEntry {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		direction: row.direction,
		entryPrice: row.entry_price,
		exitPrice: row.exit_price,
		size: row.size,
		pnlUSD: row.pnl_usd,
		rMultiple: row.r_multiple,
		setupType: row.setup_type,
		emotion: row.emotion,
		preNotes: row.pre_notes,
		postNotes: row.post_notes,
		mistakes: row.mistakes ?? [],
		followedPlan: row.followed_plan,
		tradeDate: row.trade_date,
		createdAt: row.created_at,
	};
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export type LogTradeInput = {
	symbol: string;
	direction: 'long' | 'short';
	entryPrice: number;
	exitPrice?: number | null;
	size: number;
	pnlUSD?: number | null;
	rMultiple?: number | null;
	setupType?: string | null;
	emotion?: TradeEmotion | null;
	preNotes?: string | null;
	postNotes?: string | null;
	mistakes?: string[];
	followedPlan?: boolean | null;
	tradeDate?: string | null;  // defaults to today
};

export async function logTrade(userId: string, input: LogTradeInput): Promise<JournalEntry | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('trade_journal')
		.insert({
			user_id: userId,
			symbol: input.symbol.toUpperCase(),
			direction: input.direction,
			entry_price: input.entryPrice,
			exit_price: input.exitPrice ?? null,
			size: input.size,
			pnl_usd: input.pnlUSD ?? null,
			r_multiple: input.rMultiple ?? null,
			setup_type: input.setupType ?? null,
			emotion: input.emotion ?? null,
			pre_notes: input.preNotes ?? null,
			post_notes: input.postNotes ?? null,
			mistakes: input.mistakes ?? [],
			followed_plan: input.followedPlan ?? null,
			trade_date: input.tradeDate ?? new Date().toISOString().slice(0, 10),
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapEntry(data as DbJournalEntry);
}

export async function listJournalEntries(
	userId: string,
	limit = 50
): Promise<JournalEntry[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('trade_journal')
		.select()
		.eq('user_id', userId)
		.order('trade_date', { ascending: false })
		.limit(limit);

	if (error || !data) return [];
	return (data as DbJournalEntry[]).map(mapEntry);
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export function calcJournalStats(entries: JournalEntry[]): JournalStats {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const totalTrades = entries.length;

	// Win rate from closed trades
	const wins = closed.filter(e => (e.pnlUSD ?? 0) > 0);
	const winRate = closed.length > 0 ? wins.length / closed.length : null;

	// Average PnL
	const avgPnL = closed.length > 0
		? closed.reduce((sum, e) => sum + (e.pnlUSD ?? 0), 0) / closed.length
		: null;

	// Average R-Multiple
	const withR = closed.filter(e => e.rMultiple !== null);
	const avgRMultiple = withR.length > 0
		? withR.reduce((sum, e) => sum + (e.rMultiple ?? 0), 0) / withR.length
		: null;

	// Best and worst day
	const byDate = new Map<string, number>();
	for (const e of closed) {
		byDate.set(e.tradeDate, (byDate.get(e.tradeDate) ?? 0) + (e.pnlUSD ?? 0));
	}
	let bestDay: { date: string; pnl: number } | null = null;
	let worstDay: { date: string; pnl: number } | null = null;
	for (const [date, pnl] of byDate) {
		if (bestDay === null || pnl > bestDay.pnl) bestDay = { date, pnl };
		if (worstDay === null || pnl < worstDay.pnl) worstDay = { date, pnl };
	}

	// Common mistakes
	const mistakeCounts = new Map<string, number>();
	for (const e of entries) {
		for (const m of e.mistakes) {
			mistakeCounts.set(m, (mistakeCounts.get(m) ?? 0) + 1);
		}
	}
	const commonMistakes = [...mistakeCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([mistake, count]) => ({ mistake, count }));

	// Emotion breakdown
	const emotionMap = new Map<string, { total: number; wins: number }>();
	for (const e of closed) {
		const emotion = e.emotion ?? 'unknown';
		const existing = emotionMap.get(emotion) ?? { total: 0, wins: 0 };
		existing.total++;
		if ((e.pnlUSD ?? 0) > 0) existing.wins++;
		emotionMap.set(emotion, existing);
	}
	const emotionBreakdown = [...emotionMap.entries()].map(([emotion, { total, wins }]) => ({
		emotion,
		count: total,
		winRate: total > 0 ? wins / total : null,
	}));

	// Plan adherence
	const withPlan = entries.filter(e => e.followedPlan !== null);
	const planAdherenceRate = withPlan.length > 0
		? withPlan.filter(e => e.followedPlan === true).length / withPlan.length
		: null;

	// Emotional trading: fearful, greedy, impulsive
	const emotional = entries.filter(e => ['fearful', 'greedy', 'impulsive'].includes(e.emotion ?? ''));
	const emotionalTradingPct = totalTrades > 0 ? emotional.length / totalTrades : null;

	return {
		totalTrades,
		winRate,
		avgPnL,
		avgRMultiple,
		bestDay,
		worstDay,
		commonMistakes,
		emotionBreakdown,
		planAdherenceRate,
		emotionalTradingPct,
	};
}
