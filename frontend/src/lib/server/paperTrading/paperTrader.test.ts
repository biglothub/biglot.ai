// Tests for paperTrader.ts — T-603
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	calcUnrealisedPnL,
	calcUnrealisedPct,
	buildPaperPortfolio,
	openPaperTrade,
	closePaperTrade,
	listOpenTrades,
	listClosedTrades,
	getOpenTradeBySymbol,
	type PaperTrade,
} from './paperTrader';

// ─── Supabase mock ────────────────────────────────────────────────────────────

const mockSingle = vi.fn();
const mockLimit  = vi.fn(() => ({ single: mockSingle }));
const mockOrder  = vi.fn(() => ({ single: mockSingle, limit: mockLimit }));
const mockSelect = vi.fn(() => ({ eq: mockEq, order: mockOrder, single: mockSingle }));
const mockUpdate = vi.fn(() => ({ eq: mockEq }));
const mockInsert = vi.fn(() => ({ select: mockSelect }));

// eq chains back to itself (supports multiple .eq() calls)
const mockEq: ReturnType<typeof vi.fn> = vi.fn(function (this: unknown) {
	return { eq: mockEq, select: mockSelect, order: mockOrder, single: mockSingle, limit: mockLimit, update: mockUpdate };
});

// Stable from fn — same instance used by all getSupabaseAdminClient() calls
const mockFrom = vi.fn(() => ({
	insert: mockInsert,
	select: mockSelect,
	update: mockUpdate,
	eq:     mockEq,
}));

vi.mock('../supabaseAdmin.server', () => ({
	getSupabaseAdminClient: () => ({ from: mockFrom }),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
	return {
		id:         'trade-1',
		userId:     'user-1',
		symbol:     'BTCUSDT',
		side:       'long',
		qty:        0.1,
		entryPrice: 50000,
		exitPrice:  null,
		pnl:        null,
		isOpen:     true,
		openedAt:   '2026-03-22T10:00:00Z',
		closedAt:   null,
		notes:      null,
		...overrides,
	};
}

// ─── calcUnrealisedPnL ────────────────────────────────────────────────────────

describe('calcUnrealisedPnL', () => {
	it('returns positive PnL for long when price rises', () => {
		expect(calcUnrealisedPnL('long', 50000, 55000, 0.1)).toBeCloseTo(500);
	});

	it('returns negative PnL for long when price falls', () => {
		expect(calcUnrealisedPnL('long', 50000, 45000, 0.1)).toBeCloseTo(-500);
	});

	it('returns positive PnL for short when price falls', () => {
		expect(calcUnrealisedPnL('short', 50000, 45000, 0.1)).toBeCloseTo(500);
	});

	it('returns negative PnL for short when price rises', () => {
		expect(calcUnrealisedPnL('short', 50000, 55000, 0.1)).toBeCloseTo(-500);
	});

	it('returns 0 when price equals entry', () => {
		expect(calcUnrealisedPnL('long', 50000, 50000, 0.5)).toBe(0);
	});

	it('scales with quantity', () => {
		const small = calcUnrealisedPnL('long', 100, 110, 1);
		const large = calcUnrealisedPnL('long', 100, 110, 2);
		expect(large).toBeCloseTo(small * 2);
	});
});

// ─── calcUnrealisedPct ────────────────────────────────────────────────────────

describe('calcUnrealisedPct', () => {
	it('returns +10% for long with 10% price rise', () => {
		expect(calcUnrealisedPct('long', 100, 110)).toBeCloseTo(10);
	});

	it('returns -10% for long with 10% price fall', () => {
		expect(calcUnrealisedPct('long', 100, 90)).toBeCloseTo(-10);
	});

	it('returns +10% for short with 10% price fall', () => {
		expect(calcUnrealisedPct('short', 100, 90)).toBeCloseTo(10);
	});

	it('returns 0 when entryPrice is 0', () => {
		expect(calcUnrealisedPct('long', 0, 100)).toBe(0);
	});

	it('returns 0 when price equals entry', () => {
		expect(calcUnrealisedPct('long', 50000, 50000)).toBe(0);
	});
});

// ─── buildPaperPortfolio ──────────────────────────────────────────────────────

describe('buildPaperPortfolio', () => {
	it('computes unrealised PnL from price map', () => {
		const openTrades = [makeTrade({ side: 'long', entryPrice: 50000, qty: 0.1 })];
		const priceMap = new Map([['BTCUSDT', 55000]]);
		const snap = buildPaperPortfolio(openTrades, priceMap, []);
		expect(snap.openTrades[0].unrealisedPnL).toBeCloseTo(500);
		expect(snap.totalUnrealisedPnL).toBeCloseTo(500);
	});

	it('falls back to entryPrice when symbol not in priceMap', () => {
		const openTrades = [makeTrade({ side: 'long', entryPrice: 50000, qty: 0.1 })];
		const snap = buildPaperPortfolio(openTrades, new Map(), []);
		expect(snap.openTrades[0].unrealisedPnL).toBe(0);
	});

	it('sums totalRealisedPnL from closed trades', () => {
		const closed = [
			makeTrade({ isOpen: false, pnl: 500,  closedAt: '2026-03-22T11:00:00Z' }),
			makeTrade({ isOpen: false, pnl: -200, closedAt: '2026-03-22T12:00:00Z' }),
		];
		const snap = buildPaperPortfolio([], new Map(), closed);
		expect(snap.totalRealisedPnL).toBeCloseTo(300);
	});

	it('calculates win rate correctly', () => {
		const closed = [
			makeTrade({ isOpen: false, pnl: 400  }),
			makeTrade({ isOpen: false, pnl: 300  }),
			makeTrade({ isOpen: false, pnl: -100 }),
		];
		const snap = buildPaperPortfolio([], new Map(), closed);
		expect(snap.winRate).toBeCloseTo(2 / 3);
	});

	it('winRate is null when no closed trades', () => {
		const snap = buildPaperPortfolio([], new Map(), []);
		expect(snap.winRate).toBeNull();
	});

	it('counts open and closed trades correctly', () => {
		const open   = [makeTrade(), makeTrade({ id: 'trade-2' })];
		const closed = [makeTrade({ id: 'trade-3', isOpen: false, pnl: 100 })];
		const snap = buildPaperPortfolio(open, new Map(), closed);
		expect(snap.openCount).toBe(2);
		expect(snap.tradeCount).toBe(1);
	});

	it('includes unrealisedPct on open trades', () => {
		const openTrades = [makeTrade({ side: 'long', entryPrice: 100, qty: 1 })];
		const priceMap = new Map([['BTCUSDT', 110]]);
		const snap = buildPaperPortfolio(openTrades, priceMap, []);
		expect(snap.openTrades[0].unrealisedPct).toBeCloseTo(10);
	});
});

// ─── CRUD (Supabase mocked) ───────────────────────────────────────────────────

describe('openPaperTrade', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('inserts and returns a PaperTrade on success', async () => {
		const dbRow = {
			id: 'new-id', user_id: 'u1', symbol: 'BTCUSDT', side: 'long',
			qty: 0.1, entry_price: 50000, exit_price: null, pnl: null,
			is_open: true, opened_at: '2026-03-22T10:00:00Z', closed_at: null, notes: null,
		};
		mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });
		mockSelect.mockReturnValueOnce({ single: mockSingle } as never);
		mockInsert.mockReturnValueOnce({ select: vi.fn(() => ({ single: mockSingle })) } as never);

		const result = await openPaperTrade('u1', 'BTCUSDT', 'long', 0.1, 50000);
		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(result!.side).toBe('long');
		expect(result!.entryPrice).toBe(50000);
		expect(result!.isOpen).toBe(true);
	});

	it('returns null on Supabase error', async () => {
		mockSingle.mockResolvedValueOnce({ data: null, error: new Error('DB error') });
		mockInsert.mockReturnValueOnce({ select: vi.fn(() => ({ single: mockSingle })) } as never);

		const result = await openPaperTrade('u1', 'BTCUSDT', 'long', 0.1, 50000);
		expect(result).toBeNull();
	});

	it('uppercases the symbol', async () => {
		const dbRow = {
			id: 'id1', user_id: 'u1', symbol: 'ETHUSDT', side: 'long',
			qty: 1, entry_price: 3000, exit_price: null, pnl: null,
			is_open: true, opened_at: '2026-03-22T10:00:00Z', closed_at: null, notes: null,
		};
		mockSingle.mockResolvedValueOnce({ data: dbRow, error: null });

		await openPaperTrade('u1', 'ethusdt', 'long', 1, 3000);
		expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'ETHUSDT' }));
	});
});

describe('closePaperTrade', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('closes trade and returns updated PaperTrade', async () => {
		const existing = {
			id: 'trade-1', user_id: 'u1', symbol: 'BTCUSDT', side: 'long',
			qty: 0.1, entry_price: 50000, exit_price: null, pnl: null,
			is_open: true, opened_at: '2026-03-22T10:00:00Z', closed_at: null, notes: null,
		};
		const updated = {
			...existing, exit_price: 55000, pnl: 500, is_open: false, closed_at: '2026-03-22T12:00:00Z',
		};

		// Step 1: fetch uses .single() → existing
		mockSingle.mockResolvedValueOnce({ data: existing, error: null });
		// Step 2: update result uses .single() → updated
		mockSingle.mockResolvedValueOnce({ data: updated, error: null });

		const result = await closePaperTrade('u1', 'trade-1', 55000);
		expect(result).not.toBeNull();
		expect(result!.isOpen).toBe(false);
		expect(result!.exitPrice).toBe(55000);
		expect(result!.pnl).toBeCloseTo(500);
	});

	it('returns null if trade not found', async () => {
		mockSingle.mockResolvedValueOnce({ data: null, error: new Error('not found') });

		const result = await closePaperTrade('u1', 'nonexistent', 55000);
		expect(result).toBeNull();
	});
});

describe('listOpenTrades', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns mapped trades on success', async () => {
		const rows = [
			{
				id: 't1', user_id: 'u1', symbol: 'BTCUSDT', side: 'long',
				qty: 0.1, entry_price: 50000, exit_price: null, pnl: null,
				is_open: true, opened_at: '2026-01-01', closed_at: null, notes: null,
			},
		];
		// .order() is the terminal call for listOpenTrades
		mockOrder.mockReturnValueOnce({ data: rows, error: null } as never);

		const result = await listOpenTrades('u1');
		expect(result.length).toBe(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].isOpen).toBe(true);
	});

	it('returns empty array on error', async () => {
		mockOrder.mockReturnValueOnce({ data: null, error: new Error() } as never);

		const result = await listOpenTrades('u1');
		expect(result).toEqual([]);
	});
});

describe('listClosedTrades', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns closed trades on success', async () => {
		const rows = [
			{
				id: 't2', user_id: 'u1', symbol: 'ETHUSDT', side: 'short',
				qty: 1, entry_price: 3000, exit_price: 2800, pnl: 200,
				is_open: false, opened_at: '2026-01-01', closed_at: '2026-01-02', notes: null,
			},
		];
		// listClosedTrades uses .order().limit(50) — mock limit as terminal
		mockLimit.mockReturnValueOnce({ data: rows, error: null } as never);

		const result = await listClosedTrades('u1');
		expect(result.length).toBe(1);
		expect(result[0].isOpen).toBe(false);
		expect(result[0].pnl).toBe(200);
	});
});

describe('getOpenTradeBySymbol', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns a trade when found', async () => {
		const row = {
			id: 't1', user_id: 'u1', symbol: 'BTCUSDT', side: 'long', qty: 0.1, entry_price: 50000,
			exit_price: null, pnl: null, is_open: true, opened_at: '2026-01-01', closed_at: null, notes: null,
		};
		mockSingle.mockResolvedValueOnce({ data: row, error: null });

		const result = await getOpenTradeBySymbol('u1', 'BTCUSDT');
		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
	});

	it('returns null when not found', async () => {
		mockSingle.mockResolvedValueOnce({ data: null, error: new Error() });

		const result = await getOpenTradeBySymbol('u1', 'NONEXISTENT');
		expect(result).toBeNull();
	});
});
