// Tests for trade journal — T-305
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	logTrade,
	listJournalEntries,
	calcJournalStats,
} from './journal';
import type { JournalEntry } from './journal';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

vi.mock('../supabaseAdmin.server', () => ({
	getSupabaseAdminClient: vi.fn(),
}));

// Import tools to register them
import '../tools/tradeJournal.tool';

import { getSupabaseAdminClient } from '../supabaseAdmin.server';

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Mock helpers ─────────────────────────────────────────────────────────────

const mockDbEntry = {
	id: 'jrn-1',
	user_id: 'user-1',
	symbol: 'BTCUSDT',
	direction: 'long' as const,
	entry_price: 50000,
	exit_price: 52000,
	size: 0.1,
	pnl_usd: 200,
	r_multiple: 1.5,
	setup_type: 'breakout',
	emotion: 'calm' as const,
	pre_notes: 'Strong breakout',
	post_notes: 'Held plan well',
	mistakes: [],
	followed_plan: true,
	trade_date: '2024-06-01',
	created_at: '2024-06-01T10:00:00Z',
};

function makeSupabaseMock(options: { insertData?: unknown; selectData?: unknown; error?: boolean }) {
	const single = vi.fn().mockResolvedValue({
		data: options.error ? null : (options.insertData ?? options.selectData ?? null),
		error: options.error ? { message: 'DB error' } : null,
	});
	const limit = vi.fn().mockResolvedValue({
		data: options.error ? null : (options.selectData ?? []),
		error: options.error ? { message: 'DB error' } : null,
	});
	const order = vi.fn().mockReturnValue({ limit });
	const eq = vi.fn().mockReturnValue({ order });
	const select = vi.fn().mockReturnValue({ eq, single });
	const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });

	return {
		from: vi.fn().mockReturnValue({ insert, select }),
	};
}

// ─── logTrade ─────────────────────────────────────────────────────────────────

describe('logTrade', () => {
	it('returns mapped entry on success', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockDbEntry }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await logTrade('user-1', {
			symbol: 'btcusdt',
			direction: 'long',
			entryPrice: 50000,
			size: 0.1,
			exitPrice: 52000,
			pnlUSD: 200,
			rMultiple: 1.5,
			setupType: 'breakout',
			emotion: 'calm',
			preNotes: 'Strong breakout',
			followedPlan: true,
		});

		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(result!.pnlUSD).toBe(200);
		expect(result!.emotion).toBe('calm');
		expect(result!.followedPlan).toBe(true);
	});

	it('returns null on DB error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await logTrade('user-1', {
			symbol: 'BTCUSDT',
			direction: 'long',
			entryPrice: 50000,
			size: 0.1,
		});

		expect(result).toBeNull();
	});
});

// ─── listJournalEntries ───────────────────────────────────────────────────────

describe('listJournalEntries', () => {
	it('returns mapped entries', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockDbEntry] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await listJournalEntries('user-1');
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].mistakes).toEqual([]);
	});

	it('returns empty array on error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await listJournalEntries('user-1');
		expect(result).toEqual([]);
	});
});

// ─── calcJournalStats ─────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id: 'jrn-1',
		userId: 'user-1',
		symbol: 'BTCUSDT',
		direction: 'long',
		entryPrice: 50000,
		exitPrice: 52000,
		size: 0.1,
		pnlUSD: 200,
		rMultiple: 1.0,
		setupType: 'breakout',
		emotion: 'calm',
		preNotes: null,
		postNotes: null,
		mistakes: [],
		followedPlan: true,
		tradeDate: '2024-06-01',
		createdAt: '2024-06-01T10:00:00Z',
		...overrides,
	};
}

describe('calcJournalStats', () => {
	it('returns null stats for empty array', () => {
		const stats = calcJournalStats([]);
		expect(stats.totalTrades).toBe(0);
		expect(stats.winRate).toBeNull();
		expect(stats.avgPnL).toBeNull();
		expect(stats.avgRMultiple).toBeNull();
		expect(stats.bestDay).toBeNull();
		expect(stats.worstDay).toBeNull();
	});

	it('calculates win rate correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: -50 }),
			makeEntry({ pnlUSD: 200 }),
			makeEntry({ pnlUSD: -30 }),
		];
		const stats = calcJournalStats(entries);
		expect(stats.winRate).toBeCloseTo(0.5);
	});

	it('calculates average PnL', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: 200 }),
		];
		const stats = calcJournalStats(entries);
		expect(stats.avgPnL).toBeCloseTo(150);
	});

	it('calculates average R-multiple, skipping nulls', () => {
		const entries = [
			makeEntry({ rMultiple: 2.0 }),
			makeEntry({ rMultiple: null }),
			makeEntry({ rMultiple: 1.0 }),
		];
		const stats = calcJournalStats(entries);
		expect(stats.avgRMultiple).toBeCloseTo(1.5);
	});

	it('identifies best and worst day', () => {
		const entries = [
			makeEntry({ tradeDate: '2024-06-01', pnlUSD: 500 }),
			makeEntry({ tradeDate: '2024-06-01', pnlUSD: 100 }),  // same day, sum = 600
			makeEntry({ tradeDate: '2024-06-02', pnlUSD: -200 }),
		];
		const stats = calcJournalStats(entries);
		expect(stats.bestDay?.date).toBe('2024-06-01');
		expect(stats.bestDay?.pnl).toBeCloseTo(600);
		expect(stats.worstDay?.date).toBe('2024-06-02');
		expect(stats.worstDay?.pnl).toBeCloseTo(-200);
	});

	it('counts common mistakes correctly', () => {
		const entries = [
			makeEntry({ mistakes: ['moved stop', 'sized too large'] }),
			makeEntry({ mistakes: ['moved stop'] }),
			makeEntry({ mistakes: ['chased entry'] }),
		];
		const stats = calcJournalStats(entries);
		expect(stats.commonMistakes[0].mistake).toBe('moved stop');
		expect(stats.commonMistakes[0].count).toBe(2);
	});

	it('computes emotion breakdown win rate', () => {
		const entries = [
			makeEntry({ emotion: 'calm', pnlUSD: 100 }),
			makeEntry({ emotion: 'calm', pnlUSD: 200 }),
			makeEntry({ emotion: 'fearful', pnlUSD: -50 }),
		];
		const stats = calcJournalStats(entries);
		const calmRow = stats.emotionBreakdown.find(e => e.emotion === 'calm');
		expect(calmRow?.winRate).toBe(1);
		const fearfulRow = stats.emotionBreakdown.find(e => e.emotion === 'fearful');
		expect(fearfulRow?.winRate).toBe(0);
	});

	it('calculates plan adherence rate', () => {
		const entries = [
			makeEntry({ followedPlan: true }),
			makeEntry({ followedPlan: true }),
			makeEntry({ followedPlan: false }),
			makeEntry({ followedPlan: null }),  // excluded from calculation
		];
		const stats = calcJournalStats(entries);
		// 2 out of 3 with non-null followed_plan
		expect(stats.planAdherenceRate).toBeCloseTo(2 / 3);
	});

	it('calculates emotional trading percentage', () => {
		const entries = [
			makeEntry({ emotion: 'fearful' }),
			makeEntry({ emotion: 'greedy' }),
			makeEntry({ emotion: 'calm' }),
			makeEntry({ emotion: 'disciplined' }),
		];
		const stats = calcJournalStats(entries);
		// 2 out of 4 emotional
		expect(stats.emotionalTradingPct).toBeCloseTo(0.5);
	});

	it('returns null emotionalTradingPct when no trades', () => {
		expect(calcJournalStats([]).emotionalTradingPct).toBeNull();
	});

	it('excludes open trades from win rate / avgPnL', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),   // closed
			makeEntry({ pnlUSD: null, exitPrice: null }),  // still open
		];
		const stats = calcJournalStats(entries);
		expect(stats.winRate).toBe(1);  // only the closed trade
		expect(stats.avgPnL).toBeCloseTo(100);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('trade journal tools', () => {
	it('log_trade is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('log_trade')).toBeDefined();
	});

	it('review_trades is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('review_trades')).toBeDefined();
	});

	it('log_trade returns error on missing fields', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('log_trade')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
