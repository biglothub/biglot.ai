// Tests for Strategy Marketplace — T-504
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	computeAvgRating,
	normaliseTags,
	publishStrategy,
	listPublished,
	getPublished,
	forkStrategy,
	unpublishStrategy,
	rateStrategy,
	listRatings,
} from './marketplace';
import type { Strategy } from '$lib/types/strategy';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../supabaseAdmin.server', () => ({
	getSupabaseAdminClient: vi.fn(),
}));

vi.mock('../strategy.server', () => ({
	getStrategy: vi.fn(),
	createStrategy: vi.fn(),
}));

import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { getStrategy, createStrategy } from '../strategy.server';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockStrategy: Strategy = {
	id: 'strat-1',
	biglotUserId: 'user-1',
	name: 'RSI Reversal',
	description: 'Mean reversion using RSI',
	version: 1,
	isActive: true,
	timeframe: '1h',
	entry: {
		direction: 'both',
		groups: [{
			logic: 'AND',
			conditions: [{ indicator: 'rsi', operator: '<', threshold: 30 }],
		}],
	},
	exit: [{ type: 'stop_loss', value: 2, unit: 'pct' }],
	positionSizing: { method: 'fixed_fractional', riskPerTrade: 1 },
	risk: { maxDrawdownPct: 20, maxOpenPositions: 3 },
};

const mockPublishedRow = {
	id: 'pub-1',
	strategy_id: 'strat-1',
	author_user_id: 'user-1',
	title: 'RSI Reversal',
	description: 'Mean reversion using RSI',
	tags: ['rsi', 'mean-reversion'],
	fork_count: 5,
	avg_rating: '4.20',
	rating_count: 10,
	definition: mockStrategy,
	created_at: '2024-01-01T00:00:00Z',
};

function makeSupabaseMock(options: {
	selectData?: unknown;
	insertData?: unknown;
	updateOk?: boolean;
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
	const limit = vi.fn().mockResolvedValue(resolved);
	// order is both awaitable (resolves with resolved) AND chainable (.limit, .single)
	const orderResult = Object.assign(Promise.resolve(resolved), { limit, single });
	const order = vi.fn().mockReturnValue(orderResult);
	const eq = vi.fn().mockReturnValue({ single, order, eq: vi.fn().mockReturnValue({ single }) });
	const ilike = vi.fn().mockReturnValue({ eq, order, limit });
	const contains = vi.fn().mockReturnValue({ eq, order, ilike, limit });
	const select = vi.fn().mockReturnValue({ eq, order, ilike, contains, single, limit });
	const upsert = vi.fn().mockReturnValue({ select: () => ({ single }) });
	const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
	const update = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: null }),
		}),
	});
	const del = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: options.deleteOk === false ? { message: 'error' } : null }),
		}),
	});
	return {
		from: vi.fn().mockReturnValue({ select, insert, upsert, update, delete: del }),
	};
}

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('computeAvgRating', () => {
	it('returns null for empty array', () => {
		expect(computeAvgRating([])).toBeNull();
	});

	it('calculates average correctly', () => {
		expect(computeAvgRating([4, 5, 3])).toBeCloseTo(4.0);
	});

	it('handles single rating', () => {
		expect(computeAvgRating([5])).toBe(5);
	});
});

describe('normaliseTags', () => {
	it('lowercases and trims tags', () => {
		expect(normaliseTags(['  RSI ', 'Mean-Reversion'])).toEqual(['rsi', 'mean-reversion']);
	});

	it('filters empty tags', () => {
		expect(normaliseTags(['rsi', '', '  '])).toEqual(['rsi']);
	});

	it('limits to 10 tags', () => {
		const many = Array.from({ length: 15 }, (_, i) => `tag${i}`);
		expect(normaliseTags(many)).toHaveLength(10);
	});

	it('truncates tags to 32 chars', () => {
		const long = 'a'.repeat(50);
		expect(normaliseTags([long])[0]).toHaveLength(32);
	});
});

// ─── publishStrategy ──────────────────────────────────────────────────────────

describe('publishStrategy', () => {
	it('publishes a strategy and returns mapped result', async () => {
		vi.mocked(getStrategy).mockResolvedValue(mockStrategy);
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockPublishedRow }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await publishStrategy('user-1', {
			strategyId: 'strat-1',
			title: 'RSI Reversal',
			tags: ['rsi', 'Mean-Reversion'],
		});

		expect(result.title).toBe('RSI Reversal');
		expect(result.authorUserId).toBe('user-1');
		expect(result.avgRating).toBe(4.2);
	});

	it('throws when strategy not found', async () => {
		vi.mocked(getStrategy).mockResolvedValue(null);
		await expect(publishStrategy('user-1', { strategyId: 'unknown' }))
			.rejects.toThrow('Strategy not found or access denied');
	});

	it('throws on DB error', async () => {
		vi.mocked(getStrategy).mockResolvedValue(mockStrategy);
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		await expect(publishStrategy('user-1', { strategyId: 'strat-1' }))
			.rejects.toThrow('Failed to publish strategy');
	});
});

// ─── listPublished ────────────────────────────────────────────────────────────

describe('listPublished', () => {
	it('returns list of published strategies', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockPublishedRow] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const results = await listPublished();
		expect(results).toHaveLength(1);
		expect(results[0].forkCount).toBe(5);
		expect(results[0].ratingCount).toBe(10);
	});

	it('returns empty array on error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		await expect(listPublished()).rejects.toThrow('Failed to list published strategies');
	});
});

// ─── getPublished ─────────────────────────────────────────────────────────────

describe('getPublished', () => {
	it('returns a published strategy by id', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockPublishedRow }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await getPublished('pub-1');
		expect(result?.id).toBe('pub-1');
		expect(result?.tags).toEqual(['rsi', 'mean-reversion']);
	});

	it('returns null when not found', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await getPublished('missing');
		expect(result).toBeNull();
	});
});

// ─── forkStrategy ─────────────────────────────────────────────────────────────

describe('forkStrategy', () => {
	it('creates a forked private strategy', async () => {
		// getPublished mock
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockPublishedRow }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const forkedStrategy: Strategy = {
			...mockStrategy,
			id: 'strat-fork',
			biglotUserId: 'user-2',
			name: 'RSI Reversal (fork)',
		};
		vi.mocked(createStrategy).mockResolvedValue(forkedStrategy);

		const result = await forkStrategy('user-2', 'pub-1');
		expect(result.name).toBe('RSI Reversal (fork)');
		expect(result.biglotUserId).toBe('user-2');
		expect(createStrategy).toHaveBeenCalledWith(
			expect.objectContaining({ biglotUserId: 'user-2', name: 'RSI Reversal (fork)' })
		);
	});

	it('throws when published strategy not found', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		await expect(forkStrategy('user-2', 'missing'))
			.rejects.toThrow('Published strategy not found');
	});
});

// ─── unpublishStrategy ────────────────────────────────────────────────────────

describe('unpublishStrategy', () => {
	it('deletes the published strategy', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ deleteOk: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		await expect(unpublishStrategy('user-1', 'pub-1')).resolves.toBeUndefined();
	});
});

// ─── rateStrategy ─────────────────────────────────────────────────────────────

describe('rateStrategy', () => {
	it('throws for invalid rating', async () => {
		await expect(rateStrategy('user-1', 'pub-1', 6)).rejects.toThrow('Rating must be');
		await expect(rateStrategy('user-1', 'pub-1', 0)).rejects.toThrow('Rating must be');
	});

	it('saves rating and returns result', async () => {
		const mockRatingRow = {
			id: 'rating-1',
			published_strategy_id: 'pub-1',
			user_id: 'user-1',
			rating: 4,
			review: 'Good strategy',
			created_at: '2024-01-01T00:00:00Z',
		};

		const mockDb = makeSupabaseMock({ insertData: mockRatingRow, selectData: [{ rating: 4 }] });
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			mockDb as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await rateStrategy('user-1', 'pub-1', 4, 'Good strategy');
		expect(result.rating).toBe(4);
		expect(result.review).toBe('Good strategy');
	});
});

// ─── listRatings ──────────────────────────────────────────────────────────────

describe('listRatings', () => {
	it('returns ratings for a published strategy', async () => {
		const mockRatingRow = {
			id: 'rating-1',
			published_strategy_id: 'pub-1',
			user_id: 'user-1',
			rating: 5,
			review: null,
			created_at: '2024-01-01T00:00:00Z',
		};
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockRatingRow] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await listRatings('pub-1');
		expect(result).toHaveLength(1);
		expect(result[0].rating).toBe(5);
	});
});
