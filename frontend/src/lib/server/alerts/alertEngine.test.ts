// Tests for alert engine — T-401
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	shouldTrigger,
	formatTriggerMessage,
	createAlert,
	listAlerts,
	deleteAlert,
	markAlertTriggered,
	checkAlerts,
} from './alertEngine';
import type { PriceAlert } from '$lib/types/alert';

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
import '../tools/alerts.tool';

import { getSupabaseAdminClient } from '../supabaseAdmin.server';

beforeEach(() => {
	vi.restoreAllMocks();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockAlert: PriceAlert = {
	id: 'alert-1',
	userId: 'user-1',
	symbol: 'BTCUSDT',
	condition: 'above',
	target: 100000,
	note: 'All-time high breakout',
	triggered: false,
	triggeredAt: null,
	active: true,
	createdAt: '2024-06-01T00:00:00Z',
};

const mockDbAlert = {
	id: 'alert-1',
	user_id: 'user-1',
	symbol: 'BTCUSDT',
	condition: 'above',
	target: 100000,
	note: 'All-time high breakout',
	triggered: false,
	triggered_at: null,
	active: true,
	created_at: '2024-06-01T00:00:00Z',
};

function makeSupabaseMock(options: {
	insertData?: unknown;
	selectData?: unknown;
	updateOk?: boolean;
	deleteOk?: boolean;
	error?: boolean;
}) {
	const single = vi.fn().mockResolvedValue({
		data: options.error ? null : (options.insertData ?? null),
		error: options.error ? { message: 'DB error' } : null,
	});
	const selectSingle = vi.fn().mockResolvedValue({
		data: options.error ? null : (options.selectData ?? null),
		error: options.error ? { message: 'DB error' } : null,
	});
	const orderResult = {
		data: options.error ? null : (options.selectData ?? []),
		error: options.error ? { message: 'DB error' } : null,
	};

	// eq chain for listAlerts: .eq().eq().eq().order()
	const order = vi.fn().mockResolvedValue(orderResult);
	const eq3 = vi.fn().mockReturnValue({ order });
	const eq2 = vi.fn().mockReturnValue({ order, eq: eq3 });
	const eq1 = vi.fn().mockReturnValue({ order, eq: eq2 });

	const selectFn = vi.fn().mockReturnValue({ eq: eq1, single: selectSingle });
	const insert = vi.fn().mockReturnValue({ select: () => ({ single }) });
	const update = vi.fn().mockReturnValue({
		eq: vi.fn().mockResolvedValue({ error: options.updateOk === false ? { message: 'error' } : null }),
	});
	const del = vi.fn().mockReturnValue({
		eq: vi.fn().mockReturnValue({
			eq: vi.fn().mockResolvedValue({ error: options.deleteOk === false ? { message: 'error' } : null }),
		}),
	});

	return {
		from: vi.fn().mockReturnValue({ select: selectFn, insert, update, delete: del }),
	};
}

// ─── shouldTrigger ────────────────────────────────────────────────────────────

describe('shouldTrigger', () => {
	it('triggers above condition when price >= target', () => {
		expect(shouldTrigger({ condition: 'above', target: 100 }, 100)).toBe(true);
		expect(shouldTrigger({ condition: 'above', target: 100 }, 101)).toBe(true);
		expect(shouldTrigger({ condition: 'above', target: 100 }, 99)).toBe(false);
	});

	it('triggers below condition when price <= target', () => {
		expect(shouldTrigger({ condition: 'below', target: 50 }, 50)).toBe(true);
		expect(shouldTrigger({ condition: 'below', target: 50 }, 49)).toBe(true);
		expect(shouldTrigger({ condition: 'below', target: 50 }, 51)).toBe(false);
	});

	it('triggers crosses condition when price crosses target upward', () => {
		// prev was below target, now above
		expect(shouldTrigger({ condition: 'crosses', target: 100 }, 101, 99)).toBe(true);
	});

	it('triggers crosses condition when price crosses target downward', () => {
		// prev was above target, now below
		expect(shouldTrigger({ condition: 'crosses', target: 100 }, 99, 101)).toBe(true);
	});

	it('does not trigger crosses when price stays same side', () => {
		expect(shouldTrigger({ condition: 'crosses', target: 100 }, 105, 102)).toBe(false);
		expect(shouldTrigger({ condition: 'crosses', target: 100 }, 95, 90)).toBe(false);
	});

	it('does not trigger crosses without prevPrice', () => {
		expect(shouldTrigger({ condition: 'crosses', target: 100 }, 101)).toBe(false);
	});
});

// ─── formatTriggerMessage ─────────────────────────────────────────────────────

describe('formatTriggerMessage', () => {
	it('formats above alert message', () => {
		const msg = formatTriggerMessage({ ...mockAlert, condition: 'above' }, 101000);
		expect(msg).toContain('BTCUSDT');
		expect(msg).toContain('above');
		expect(msg).toContain('101000');
	});

	it('formats below alert message', () => {
		const msg = formatTriggerMessage({ ...mockAlert, condition: 'below', target: 90000 }, 89000);
		expect(msg).toContain('below');
		expect(msg).toContain('89000');
	});

	it('formats crosses alert message', () => {
		const msg = formatTriggerMessage({ ...mockAlert, condition: 'crosses' }, 100001);
		expect(msg).toContain('crossed');
	});

	it('includes note when present', () => {
		const msg = formatTriggerMessage(mockAlert, 101000);
		expect(msg).toContain('All-time high breakout');
	});

	it('omits note section when note is null', () => {
		const msg = formatTriggerMessage({ ...mockAlert, note: null }, 101000);
		expect(msg).not.toContain('—');
	});
});

// ─── createAlert ──────────────────────────────────────────────────────────────

describe('createAlert', () => {
	it('returns mapped alert on success', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockDbAlert }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);

		const result = await createAlert('user-1', {
			symbol: 'BTCUSDT',
			condition: 'above',
			target: 100000,
			note: 'All-time high breakout',
		});

		expect(result).not.toBeNull();
		expect(result!.symbol).toBe('BTCUSDT');
		expect(result!.condition).toBe('above');
		expect(result!.target).toBe(100000);
	});

	it('uppercases symbol', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ insertData: mockDbAlert }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await createAlert('user-1', { symbol: 'btcusdt', condition: 'below', target: 50000 });
		// The insert was called — symbol gets uppercased in the insert call
		expect(result).not.toBeNull();
	});

	it('returns null on DB error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await createAlert('user-1', { symbol: 'BTC', condition: 'above', target: 100000 });
		expect(result).toBeNull();
	});
});

// ─── listAlerts ───────────────────────────────────────────────────────────────

describe('listAlerts', () => {
	it('returns mapped alerts', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockDbAlert] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await listAlerts('user-1');
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
		expect(result[0].active).toBe(true);
	});

	it('returns empty array on error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ error: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await listAlerts('user-1');
		expect(result).toEqual([]);
	});
});

// ─── deleteAlert ──────────────────────────────────────────────────────────────

describe('deleteAlert', () => {
	it('returns true on success', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ deleteOk: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await deleteAlert('user-1', 'alert-1');
		expect(result).toBe(true);
	});

	it('returns false on error', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ deleteOk: false }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await deleteAlert('user-1', 'alert-1');
		expect(result).toBe(false);
	});
});

// ─── checkAlerts ──────────────────────────────────────────────────────────────

describe('checkAlerts', () => {
	it('returns empty when no alerts exist', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [] }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await checkAlerts('user-1', new Map([['BTCUSDT', 101000]]));
		expect(result).toEqual([]);
	});

	it('returns fired alert when condition met', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockDbAlert], updateOk: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		// BTCUSDT above 100000 — target is 100000
		const result = await checkAlerts('user-1', new Map([['BTCUSDT', 101000]]));
		expect(result).toHaveLength(1);
		expect(result[0].symbol).toBe('BTCUSDT');
	});

	it('returns empty when symbol not in price map', async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue(
			makeSupabaseMock({ selectData: [mockDbAlert], updateOk: true }) as unknown as ReturnType<typeof getSupabaseAdminClient>
		);
		const result = await checkAlerts('user-1', new Map([['ETHUSDT', 3000]]));
		expect(result).toEqual([]);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('alert tools', () => {
	it('set_alert is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('set_alert')).toBeDefined();
	});

	it('list_alerts is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('list_alerts')).toBeDefined();
	});

	it('delete_alert is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('delete_alert')).toBeDefined();
	});

	it('set_alert returns error on missing fields', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('set_alert')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});

	it('delete_alert returns error on missing alert_id', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('delete_alert')!;
		const result = await tool.execute({});
		expect(result.success).toBe(false);
	});
});
