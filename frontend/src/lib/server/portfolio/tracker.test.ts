// Tests for portfolio tracker — T-302
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	calcUnrealisedPnL,
	calcRMultiple,
	calcWinRate,
	calcAvgRMultiple,
	buildPortfolioSnapshot,
	addPosition,
	listPositions,
	closePosition,
	deletePosition,
} from './tracker';
import type { ClosedTrade } from '$lib/types/portfolio';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// ─── Mock Supabase ────────────────────────────────────────────────────────────

const mockPosition = {
	id: 'pos-1',
	user_id: 'user-1',
	symbol: 'BTCUSDT',
	direction: 'long' as const,
	entry_price: 50000,
	size: 0.1,
	stop_price: 48000,
	target_price: 55000,
	notes: 'BTC breakout play',
	opened_at: '2024-01-01T00:00:00Z',
};

const mockTrade = {
	id: 'trade-1',
	user_id: 'user-1',
	symbol: 'BTCUSDT',
	direction: 'long' as const,
	entry_price: 50000,
	exit_price: 55000,
	size: 0.1,
	pnl_usd: 500,
	r_multiple: 2.5,
	notes: null,
	opened_at: '2024-01-01T00:00:00Z',
	closed_at: '2024-01-10T00:00:00Z',
};

// Build a thenable that also has a .limit() method — handles both:
// - await db.from(t).select().eq().order()  (listPositions)
// - await db.from(t).select().eq().order().limit(n)  (listClosedTrades)
function makeThenableLimitResult(resolvedValue: unknown) {
	const result: { then: (resolve: (v: unknown) => void) => void; limit: ReturnType<typeof vi.fn> } = {
		then(resolve) { resolve(resolvedValue); },
		limit: vi.fn().mockResolvedValue(resolvedValue),
	};
	return result;
}

function makeSupabaseMock(options: {
	selectData?: unknown;
	insertData?: unknown;
	deleteOk?: boolean;
	error?: boolean;
}) {
	const resolved = {
		data: options.error ? null : (options.selectData ?? []),
		error: options.error ? { message: 'DB error' } : null,
	};
	const single = vi.fn().mockResolvedValue({
		data: options.error ? null : (options.insertData ?? options.selectData ?? null),
		error: options.error ? { message: 'DB error' } : null,
	});
	const order = vi.fn().mockReturnValue(makeThenableLimitResult(resolved));
	const select = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			eq: vi.fn().mockReturnValue({ single }),
			order,
			single,
		}),
		order,
	});
	const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
	const del = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: options.deleteOk === false ? { message: 'error' } : null }),
		}),
	});

	return {
		from: vi.fn().mockReturnValue({ select, insert, delete: del }),
	};
}

vi.mock('../supabaseAdmin.server', () => ({
	getSupabaseAdminClient: vi.fn(),
}));

import { getSupabaseAdminClient } from '../supabaseAdmin.server';

// Import tool to register it
import '../tools/portfolio.tool';

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('calcUnrealisedPnL', () => {
	it('calculates long PnL correctly', () => {
		// Long 0.1 BTC at 50000, now at 55000
		expect(calcUnrealisedPnL('long', 50000, 55000, 0.1)).toBeCloseTo(500);
	});

	it('calculates short PnL correctly', () => {
		// Short 0.1 BTC at 55000, now at 50000
		expect(calcUnrealisedPnL('short', 55000, 50000, 0.1)).toBeCloseTo(500);
	});

	it('returns negative PnL for losing long', () => {
		expect(calcUnrealisedPnL('long', 50000, 45000, 0.1)).toBeCloseTo(-500);
	});

	it('returns 0 when price unchanged', () => {
		expect(calcUnrealisedPnL('long', 50000, 50000, 1)).toBe(0);
	});
});

describe('calcRMultiple', () => {
	it('calculates R-multiple correctly', () => {
		// PnL=$500, entry=50000, stop=48000, size=0.1 → risk=200, R=500/200=2.5
		expect(calcRMultiple(500, 50000, 48000, 0.1)).toBeCloseTo(2.5);
	});

	it('returns null when stopPrice is null', () => {
		expect(calcRMultiple(500, 50000, null, 0.1)).toBeNull();
	});

	it('returns null when risk is zero', () => {
		expect(calcRMultiple(500, 50000, 50000, 0.1)).toBeNull();
	});

	it('handles negative R-multiple (loss)', () => {
		expect(calcRMultiple(-200, 50000, 48000, 0.1)).toBeCloseTo(-1.0);
	});
});

describe('calcWinRate', () => {
	it('returns null for empty trades', () => {
		expect(calcWinRate([])).toBeNull();
	});

	it('calculates correct win rate', () => {
		const trades = [
			{ pnlUSD: 100 },
			{ pnlUSD: -50 },
			{ pnlUSD: 200 },
			{ pnlUSD: -30 },
		] as ClosedTrade[];
		expect(calcWinRate(trades)).toBeCloseTo(0.5);
	});

	it('returns 1 when all trades win', () => {
		const trades = [{ pnlUSD: 100 }, { pnlUSD: 200 }] as ClosedTrade[];
		expect(calcWinRate(trades)).toBe(1);
	});
});

describe('calcAvgRMultiple', () => {
	it('returns null for empty trades', () => {
		expect(calcAvgRMultiple([])).toBeNull();
	});

	it('skips trades without R-multiple', () => {
		const trades = [
			{ rMultiple: 2.0 },
			{ rMultiple: null },
			{ rMultiple: 1.0 },
		] as ClosedTrade[];
		expect(calcAvgRMultiple(trades)).toBeCloseTo(1.5);
	});

	it('returns null when all trades have no R-multiple', () => {
		const trades = [{ rMultiple: null }] as ClosedTrade[];
		expect(calcAvgRMultiple(trades)).toBeNull();
	});
});

// ─── addPosition ──────────────────────────────────────────────────────────────

describe('addPosition', () => {
	it('returns mapped position on success', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockPosition }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await addPosition('user-1', {
			symbol: 'btcusdt',
			direction: 'long',
			entryPrice: 50000,
			size: 0.1,
			stopPrice: 48000,
			targetPrice: 55000,
			notes: 'BTC breakout play',
		});

		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(result!.entryPrice).toBe(50000);
	});

	it('returns null on DB error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await addPosition('user-1', {
			symbol: 'BTCUSDT',
			direction: 'long',
			entryPrice: 50000,
			size: 0.1,
			stopPrice: null,
			targetPrice: null,
			notes: null,
		});

		expect(result).toBeNull();
	});
});

// ─── listPositions ────────────────────────────────────────────────────────────

describe('listPositions', () => {
	it('returns mapped positions', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockPosition] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await listPositions('user-1');
		expect(result).toHaveLength(1);
		expect(result[0].direction).toBe('long');
	});

	it('returns empty array on error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await listPositions('user-1');
		expect(result).toEqual([]);
	});
});

// ─── buildPortfolioSnapshot ───────────────────────────────────────────────────

describe('buildPortfolioSnapshot', () => {
	it('builds snapshot with correct PnL when price is known', async () => {
		// Mock supabase: listPositions returns [mockPosition], listClosedTrades returns [mockTrade]
		const mockDb = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'portfolio_positions') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								order: vi.fn().mockReturnValue(
									makeThenableLimitResult({ data: [mockPosition], error: null })
								),
							}),
						}),
					};
				}
				// closed_trades
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							order: vi.fn().mockReturnValue(
								makeThenableLimitResult({ data: [mockTrade], error: null })
							),
						}),
					}),
				};
			}),
		};
		vi.mocked(getSupabaseAdminClient).mockReturnValue(mockDb as unknown as ReturnType<typeof getSupabaseAdminClient>);

		const priceMap = new Map([['BTCUSDT', 52000]]);
		const snap = await buildPortfolioSnapshot('user-1', priceMap);

		expect(snap.positions).toHaveLength(1);
		expect(snap.positions[0].currentPrice).toBe(52000);
		expect(snap.positions[0].unrealisedPnLUSD).toBeCloseTo(200); // (52000-50000)*0.1
		expect(snap.totalRealised).toBe(500);
		expect(snap.closedTrades).toHaveLength(1);
		expect(snap.winRate).toBe(1);
	});

	it('sets unrealisedPnLUSD to null when price missing', async () => {
		const mockDb = {
			from: vi.fn().mockImplementation((table: string) => {
				if (table === 'portfolio_positions') {
					return {
						select: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								order: vi.fn().mockReturnValue(
									makeThenableLimitResult({ data: [mockPosition], error: null })
								),
							}),
						}),
					};
				}
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							order: vi.fn().mockReturnValue(
								makeThenableLimitResult({ data: [], error: null })
							),
						}),
					}),
				};
			}),
		};
		vi.mocked(getSupabaseAdminClient).mockReturnValue(mockDb as unknown as ReturnType<typeof getSupabaseAdminClient>);

		const snap = await buildPortfolioSnapshot('user-1', new Map());
		expect(snap.positions[0].unrealisedPnLUSD).toBeNull();
		expect(snap.positions[0].currentPrice).toBeNull();
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('portfolio tools', () => {
	it('portfolio_snapshot is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('portfolio_snapshot')).toBeDefined();
	});

	it('add_position is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('add_position')).toBeDefined();
	});

	it('close_position is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('close_position')).toBeDefined();
	});

	it('delete_position is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('delete_position')).toBeDefined();
	});

	it('add_position returns error on missing fields', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('add_position')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
