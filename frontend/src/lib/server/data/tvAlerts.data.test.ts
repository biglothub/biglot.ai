// TradingView Alerts Tests — T-805
import { describe, it, expect, vi } from 'vitest';
import {
	parseTVPayload,
	isValidAction,
	saveAlert,
	listAlerts,
	formatTelegramAlert,
	type TVAlertPayload,
	type SupabaseClient,
} from './tvAlerts.data';

// ─── isValidAction ────────────────────────────────────────────────────────────

describe('isValidAction', () => {
	it('accepts valid actions', () => {
		expect(isValidAction('buy')).toBe(true);
		expect(isValidAction('sell')).toBe(true);
		expect(isValidAction('close')).toBe(true);
		expect(isValidAction('alert')).toBe(true);
	});

	it('rejects invalid strings', () => {
		expect(isValidAction('BUY')).toBe(false);
		expect(isValidAction('short')).toBe(false);
		expect(isValidAction('')).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidAction(null)).toBe(false);
		expect(isValidAction(123)).toBe(false);
		expect(isValidAction(undefined)).toBe(false);
	});
});

// ─── parseTVPayload ───────────────────────────────────────────────────────────

describe('parseTVPayload', () => {
	it('parses valid payload', () => {
		const p = parseTVPayload({ symbol: 'btcusdt', action: 'buy', price: 65000, message: 'EMA cross' });
		expect(p).not.toBeNull();
		expect(p!.symbol).toBe('BTCUSDT');
		expect(p!.action).toBe('buy');
		expect(p!.price).toBe(65000);
		expect(p!.message).toBe('EMA cross');
	});

	it('parses price from string', () => {
		const p = parseTVPayload({ symbol: 'AAPL', action: 'sell', price: '185.50', message: '' });
		expect(p).not.toBeNull();
		expect(p!.price).toBeCloseTo(185.5);
	});

	it('uppercases symbol', () => {
		const p = parseTVPayload({ symbol: 'spy', action: 'alert', price: 450, message: '' });
		expect(p!.symbol).toBe('SPY');
	});

	it('returns null for missing symbol', () => {
		expect(parseTVPayload({ action: 'buy', price: 100, message: '' })).toBeNull();
	});

	it('returns null for invalid action', () => {
		expect(parseTVPayload({ symbol: 'BTC', action: 'long', price: 100, message: '' })).toBeNull();
	});

	it('returns null for missing price', () => {
		expect(parseTVPayload({ symbol: 'BTC', action: 'buy', message: '' })).toBeNull();
	});

	it('returns null for NaN price', () => {
		expect(parseTVPayload({ symbol: 'BTC', action: 'buy', price: 'abc', message: '' })).toBeNull();
	});

	it('returns null for null input', () => {
		expect(parseTVPayload(null)).toBeNull();
	});

	it('returns null for non-object', () => {
		expect(parseTVPayload('string')).toBeNull();
	});

	it('defaults message to empty string', () => {
		const p = parseTVPayload({ symbol: 'BTC', action: 'buy', price: 100 });
		expect(p!.message).toBe('');
	});

	it('parses auto_paper_trade boolean', () => {
		const p = parseTVPayload({ symbol: 'BTC', action: 'buy', price: 100, message: '', auto_paper_trade: true });
		expect(p!.auto_paper_trade).toBe(true);
	});

	it('parses auto_paper_trade string true', () => {
		const p = parseTVPayload({ symbol: 'BTC', action: 'buy', price: 100, message: '', auto_paper_trade: 'true' });
		expect(p!.auto_paper_trade).toBe(true);
	});
});

// ─── saveAlert ────────────────────────────────────────────────────────────────

function makeMockSupabase(insertError: unknown = null, selectData: Record<string, unknown>[] = []): SupabaseClient {
	return {
		from: () => ({
			insert: vi.fn(() => ({ error: insertError })),
			select: () => ({
				order: () => ({
					limit: async () => ({ data: selectData, error: null }),
				}),
			}),
		}),
	};
}

describe('saveAlert', () => {
	it('returns a UUID string', async () => {
		const sb = makeMockSupabase();
		const payload: TVAlertPayload = { symbol: 'BTCUSDT', action: 'buy', price: 65000, message: 'test' };
		const id = await saveAlert(sb, payload);
		expect(typeof id).toBe('string');
		expect(id.length).toBeGreaterThan(0);
	});

	it('calls supabase insert', async () => {
		const insertFn = vi.fn(() => ({ error: null }));
		const sb: SupabaseClient = {
			from: () => ({
				insert: insertFn,
				select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
			}),
		};
		const payload: TVAlertPayload = { symbol: 'ETH', action: 'sell', price: 3000, message: '' };
		await saveAlert(sb, payload);
		expect(insertFn).toHaveBeenCalledOnce();
	});

	it('includes paperTrade flag in insert data', async () => {
		let captured: Record<string, unknown> = {};
		const sb: SupabaseClient = {
			from: () => ({
				insert: (data: Record<string, unknown>) => { captured = data; return { error: null }; },
				select: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
			}),
		};
		const payload: TVAlertPayload = { symbol: 'BTC', action: 'buy', price: 65000, message: '' };
		await saveAlert(sb, payload, true);
		expect(captured.paper_trade).toBe(true);
	});
});

// ─── listAlerts ───────────────────────────────────────────────────────────────

describe('listAlerts', () => {
	it('returns empty array on error', async () => {
		const sb: SupabaseClient = {
			from: () => ({
				insert: vi.fn(() => ({ error: null })),
				select: () => ({ order: () => ({ limit: async () => ({ data: null, error: 'error' }) }) }),
			}),
		};
		const alerts = await listAlerts(sb);
		expect(alerts).toEqual([]);
	});

	it('maps Supabase rows to TVAlert objects', async () => {
		const rows: Record<string, unknown>[] = [
			{ id: 'abc', symbol: 'BTCUSDT', action: 'buy', price: 65000, message: 'test', triggered_at: '2026-01-01T00:00:00Z', paper_trade: false },
		];
		const sb = makeMockSupabase(null, rows);
		const alerts = await listAlerts(sb);
		expect(alerts.length).toBe(1);
		expect(alerts[0].symbol).toBe('BTCUSDT');
		expect(alerts[0].action).toBe('buy');
		expect(alerts[0].price).toBe(65000);
		expect(alerts[0].paperTrade).toBe(false);
	});

	it('converts triggered_at to unix ms', async () => {
		const isoTime = '2026-01-01T12:00:00Z';
		const rows: Record<string, unknown>[] = [
			{ id: 'xyz', symbol: 'ETH', action: 'sell', price: 3000, message: '', triggered_at: isoTime, paper_trade: false },
		];
		const sb = makeMockSupabase(null, rows);
		const alerts = await listAlerts(sb);
		expect(alerts[0].triggeredAt).toBe(new Date(isoTime).getTime());
	});
});

// ─── formatTelegramAlert ──────────────────────────────────────────────────────

describe('formatTelegramAlert', () => {
	it('includes symbol and action', () => {
		const p: TVAlertPayload = { symbol: 'BTCUSDT', action: 'buy', price: 65000, message: 'EMA cross' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('BTCUSDT');
		expect(t).toContain('BUY');
	});

	it('includes formatted price', () => {
		const p: TVAlertPayload = { symbol: 'AAPL', action: 'sell', price: 185.5, message: '' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('185.5');
	});

	it('includes message when present', () => {
		const p: TVAlertPayload = { symbol: 'BTC', action: 'alert', price: 60000, message: 'RSI oversold' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('RSI oversold');
	});

	it('shows paper trade note when auto_paper_trade is true', () => {
		const p: TVAlertPayload = { symbol: 'ETH', action: 'buy', price: 3000, message: '', auto_paper_trade: true };
		const t = formatTelegramAlert(p);
		expect(t).toContain('Paper trade');
	});

	it('uses sell emoji for sell action', () => {
		const p: TVAlertPayload = { symbol: 'BTC', action: 'sell', price: 65000, message: '' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('🔴');
	});

	it('uses buy emoji for buy action', () => {
		const p: TVAlertPayload = { symbol: 'BTC', action: 'buy', price: 65000, message: '' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('🟢');
	});

	it('is valid HTML for Telegram', () => {
		const p: TVAlertPayload = { symbol: 'ETH', action: 'close', price: 3000, message: 'exit' };
		const t = formatTelegramAlert(p);
		expect(t).toContain('<b>');
		expect(t).toContain('</b>');
	});
});
