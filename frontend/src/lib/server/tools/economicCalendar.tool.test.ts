// T-201: Economic Calendar Tool tests
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	parseFFDate,
	formatEventDate,
	impactEmoji,
	isHighPriority,
	filterByDaysAhead,
} from './economicCalendar.tool';

// Always cache-miss so tests don't bleed into each other
vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_name: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// ─── Mock data ─────────────────────────────────────────────────────────────────

const NOW_MS = new Date('2026-03-22T12:00:00Z').getTime();

function makeEvent(overrides: Partial<{
	title: string;
	country: string;
	date: string;
	impact: 'High' | 'Medium' | 'Low' | 'Non-Economic' | 'Holiday';
	forecast: string;
	previous: string;
	actual: string;
}> = {}) {
	return {
		title: 'Non-Farm Payrolls',
		country: 'USD',
		date: '2026-03-22T13:30:00-0500',
		impact: 'High' as const,
		forecast: '200K',
		previous: '175K',
		actual: '',
		...overrides,
	};
}

// ─── parseFFDate ───────────────────────────────────────────────────────────────

describe('parseFFDate', () => {
	it('parses ISO date with timezone offset', () => {
		const d = parseFFDate('2026-03-22T13:30:00-0500');
		// 13:30 EST = 18:30 UTC
		expect(d.getUTCHours()).toBe(18);
		expect(d.getUTCMinutes()).toBe(30);
	});

	it('parses ISO date with UTC', () => {
		const d = parseFFDate('2026-03-22T18:30:00Z');
		expect(d.getUTCHours()).toBe(18);
	});

	it('returns a Date instance', () => {
		expect(parseFFDate('2026-03-22T13:30:00Z')).toBeInstanceOf(Date);
	});
});

// ─── formatEventDate ──────────────────────────────────────────────────────────

describe('formatEventDate', () => {
	it('formats date in UTC', () => {
		const d = new Date('2026-03-22T18:30:00Z');
		const result = formatEventDate(d, 'UTC');
		expect(result).toContain('18:30');
		expect(result).toContain('Mar');
	});

	it('formats date in Bangkok timezone', () => {
		const d = new Date('2026-03-22T18:30:00Z');
		// Bangkok is UTC+7, so 18:30 UTC = 01:30 next day
		const result = formatEventDate(d, 'Asia/Bangkok');
		expect(result).toContain('01:30');
	});

	it('handles midnight correctly', () => {
		const d = new Date('2026-03-22T00:00:00Z');
		const result = formatEventDate(d, 'UTC');
		expect(result).toContain('00:00');
	});
});

// ─── impactEmoji ──────────────────────────────────────────────────────────────

describe('impactEmoji', () => {
	it('returns red for High impact', () => {
		expect(impactEmoji('High')).toBe('🔴 High');
	});

	it('returns yellow for Medium impact', () => {
		expect(impactEmoji('Medium')).toBe('🟡 Med');
	});

	it('returns white for Low impact', () => {
		expect(impactEmoji('Low')).toBe('⚪ Low');
	});

	it('returns the raw value for unknown impact', () => {
		expect(impactEmoji('Holiday')).toBe('Holiday');
	});
});

// ─── isHighPriority ───────────────────────────────────────────────────────────

describe('isHighPriority', () => {
	it('returns true for High impact', () => {
		expect(isHighPriority(makeEvent({ impact: 'High' }))).toBe(true);
	});

	it('returns false for Medium impact', () => {
		expect(isHighPriority(makeEvent({ impact: 'Medium' }))).toBe(false);
	});

	it('returns false for Low impact', () => {
		expect(isHighPriority(makeEvent({ impact: 'Low' }))).toBe(false);
	});
});

// ─── filterByDaysAhead ────────────────────────────────────────────────────────

describe('filterByDaysAhead', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('includes events within daysAhead window', () => {
		const events = [
			makeEvent({ date: new Date(NOW_MS + 86_400_000).toISOString() }), // +1 day
			makeEvent({ date: new Date(NOW_MS + 3 * 86_400_000).toISOString() }), // +3 days
		];
		const result = filterByDaysAhead(events, 7);
		expect(result).toHaveLength(2);
	});

	it('excludes events beyond daysAhead window', () => {
		const events = [
			makeEvent({ date: new Date(NOW_MS + 8 * 86_400_000).toISOString() }), // +8 days
		];
		const result = filterByDaysAhead(events, 7);
		expect(result).toHaveLength(0);
	});

	it('excludes events more than 1h in the past', () => {
		const events = [
			makeEvent({ date: new Date(NOW_MS - 2 * 3_600_000).toISOString() }), // -2 hours
		];
		const result = filterByDaysAhead(events, 7);
		expect(result).toHaveLength(0);
	});

	it('includes events up to 1h in the past', () => {
		const events = [
			makeEvent({ date: new Date(NOW_MS - 30 * 60_000).toISOString() }), // -30 min
		];
		const result = filterByDaysAhead(events, 7);
		expect(result).toHaveLength(1);
	});

	it('returns empty array when no events', () => {
		expect(filterByDaysAhead([], 7)).toHaveLength(0);
	});

	it('respects shorter window', () => {
		const events = [
			makeEvent({ date: new Date(NOW_MS + 1 * 86_400_000).toISOString() }), // +1 day — included
			makeEvent({ date: new Date(NOW_MS + 3 * 86_400_000).toISOString() }), // +3 days — excluded
		];
		const result = filterByDaysAhead(events, 2);
		expect(result).toHaveLength(1);
	});
});

// ─── Tool registration / mock API ─────────────────────────────────────────────

describe('get_economic_calendar tool', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW_MS);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('tool is registered', async () => {
		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		expect(tool).toBeDefined();
		expect(tool?.name).toBe('get_economic_calendar');
	});

	it('returns TableBlock on success', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		const mockEvents = [
			makeEvent({ title: 'Non-Farm Payrolls', date: FUTURE, impact: 'High' }),
			makeEvent({ title: 'FOMC Statement', country: 'USD', date: FUTURE, impact: 'High' }),
		];

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		expect(result.success).toBe(true);
		expect(result.contentBlocks).toHaveLength(1);
		expect(result.contentBlocks[0].type).toBe('table');

		const table = result.contentBlocks[0] as import('$lib/types/contentBlock').TableBlock;
		expect(table.headers).toContain('Event');
		expect(table.headers).toContain('Impact');
		expect(table.headers).toContain('Forecast');
		expect(table.headers).toContain('Previous');
		expect(table.rows.length).toBeGreaterThan(0);
	});

	it('returns error block when fetch fails', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockRejectedValueOnce(new Error('Network error'))
			.mockRejectedValueOnce(new Error('Network error'))
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		expect(result.success).toBe(false);
		expect(result.contentBlocks[0].type).toBe('error');
	});

	it('filters by impact level — medium_and_high includes Medium events', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		const mockEvents = [
			makeEvent({ title: 'High Event', date: FUTURE, impact: 'High' }),
			makeEvent({ title: 'Medium Event', date: FUTURE, impact: 'Medium' }),
			makeEvent({ title: 'Low Event', date: FUTURE, impact: 'Low' }),
		];

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({ impact_filter: 'medium_and_high' });

		expect(result.success).toBe(true);
		const table = result.contentBlocks[0] as import('$lib/types/contentBlock').TableBlock;
		// Should have 2 rows (High + Medium), not Low
		expect(table.rows).toHaveLength(2);
	});

	it('filters by currency', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		const mockEvents = [
			makeEvent({ title: 'USD Event', country: 'USD', date: FUTURE, impact: 'High' }),
			makeEvent({ title: 'EUR Event', country: 'EUR', date: FUTURE, impact: 'High' }),
			makeEvent({ title: 'JPY Event', country: 'JPY', date: FUTURE, impact: 'High' }),
		];

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({ currency_filter: 'USD,EUR' });

		expect(result.success).toBe(true);
		const table = result.contentBlocks[0] as import('$lib/types/contentBlock').TableBlock;
		expect(table.rows).toHaveLength(2);
		// Rows should only contain USD and EUR events
		const countries = table.rows.map((r) => r[1]);
		expect(countries).not.toContain('JPY');
	});

	it('returns empty message when no events match filter', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		const mockEvents = [
			makeEvent({ title: 'Low Event', date: FUTURE, impact: 'Low' }),
		];

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({ impact_filter: 'high' });

		// No high-impact events, should get error block with message
		expect(result.success).toBe(true);
		expect(result.contentBlocks[0].type).toBe('error');
	});

	it('sorts events by date ascending', async () => {
		const FUTURE_1 = new Date(NOW_MS + 3 * 86_400_000).toISOString();
		const FUTURE_2 = new Date(NOW_MS + 1 * 86_400_000).toISOString();
		const mockEvents = [
			makeEvent({ title: 'Later Event', date: FUTURE_1, impact: 'High' }),
			makeEvent({ title: 'Earlier Event', date: FUTURE_2, impact: 'High' }),
		];

		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => mockEvents })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		const table = result.contentBlocks[0] as import('$lib/types/contentBlock').TableBlock;
		expect(table.rows[0][2]).toBe('Earlier Event');
		expect(table.rows[1][2]).toBe('Later Event');
	});

	it('caps days_ahead at 14', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		// Should not throw even with large value
		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({ days_ahead: 999 });
		expect(result).toBeDefined();
	});

	it('handles HTTP error from Forex Factory', async () => {
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('not json'); } })
			.mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('not json'); } })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		expect(result.success).toBe(false);
	});

	it('succeeds with only thisWeek available (nextWeek fails)', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		let callCount = 0;
		vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return { ok: true, json: async () => [makeEvent({ date: FUTURE, impact: 'High' })] };
			}
			throw new Error('Next week fetch failed');
		}));

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		// Should still succeed with data from this week
		expect(result.success).toBe(true);
	});

	it('includes sources in successful response', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => [makeEvent({ date: FUTURE, impact: 'High' })] })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		expect(result.sources).toBeDefined();
		expect(result.sources!.length).toBeGreaterThan(0);
		expect(result.sources![0].name).toContain('Forex Factory');
	});

	it('table has correct column headers', async () => {
		const FUTURE = new Date(NOW_MS + 86_400_000).toISOString();
		vi.stubGlobal('fetch', vi.fn()
			.mockResolvedValueOnce({ ok: true, json: async () => [makeEvent({ date: FUTURE, impact: 'High' })] })
			.mockResolvedValueOnce({ ok: true, json: async () => [] })
		);

		const { getTool } = await import('./registry');
		const tool = getTool('get_economic_calendar');
		const result = await tool!.execute({});

		const table = result.contentBlocks[0] as import('$lib/types/contentBlock').TableBlock;
		expect(table.headers).toEqual(['Date/Time', 'CCY', 'Event', 'Impact', 'Forecast', 'Previous', 'Actual']);
	});
});
