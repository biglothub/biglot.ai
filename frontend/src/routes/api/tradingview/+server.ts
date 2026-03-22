// /api/tradingview — TradingView Webhook Integration — T-805
// POST: Receives TradingView alert payloads (protected by TV_WEBHOOK_SECRET)
// GET:  Returns recent alerts (for manual inspection)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { parseTVPayload, saveAlert, listAlerts, formatTelegramAlert } from '$lib/server/data/tvAlerts.data';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';
import { sendTelegramMessage } from '$lib/server/telegram.server';

// ─── Telegram notification ────────────────────────────────────────────────────

async function notifyTelegram(message: string) {
	try {
		const db = getSupabaseAdminClient();
		const { data } = await db
			.from('telegram_links')
			.select('telegram_chat_id')
			.eq('is_active', true);
		if (!data) return;
		await Promise.allSettled(
			(data as { telegram_chat_id: number }[]).map(r =>
				sendTelegramMessage(r.telegram_chat_id, message, { parseMode: 'HTML' })
			)
		);
	} catch {
		// non-fatal
	}
}

// ─── Paper trade execution ────────────────────────────────────────────────────

async function executePaperTrade(symbol: string, side: 'buy' | 'sell', price: number) {
	try {
		const db = getSupabaseAdminClient();
		const row = {
			id:          crypto.randomUUID(),
			user_id:     'tradingview_bot',
			symbol,
			side:        side === 'buy' ? 'long' : 'short',
			qty:         1,
			entry_price: price,
			exit_price:  null,
			pnl:         null,
			is_open:     true,
		};
		await db.from('paper_trades').insert(row);
	} catch {
		// non-fatal
	}
}

// ─── POST: Receive TradingView alert ─────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	// ── Auth: validate shared secret ──────────────────────────────────────────
	const secret = env.TV_WEBHOOK_SECRET;
	if (secret) {
		const authHeader = request.headers.get('x-webhook-secret') ?? '';
		const urlSecret  = new URL(request.url).searchParams.get('secret') ?? '';
		if (authHeader !== secret && urlSecret !== secret) {
			throw error(401, 'Unauthorized — invalid webhook secret');
		}
	}

	// ── Parse body ─────────────────────────────────────────────────────────────
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	const payload = parseTVPayload(body);
	if (!payload) {
		throw error(400, 'Invalid payload — required: symbol, action (buy|sell|close|alert), price');
	}

	// ── Optional paper trade ───────────────────────────────────────────────────
	let paperExecuted = false;
	if (payload.auto_paper_trade && (payload.action === 'buy' || payload.action === 'sell')) {
		await executePaperTrade(payload.symbol, payload.action, payload.price);
		paperExecuted = true;
	}

	// ── Save to Supabase ───────────────────────────────────────────────────────
	let alertId: string | null = null;
	try {
		const db = getSupabaseAdminClient();
		alertId = await saveAlert(db as unknown as Parameters<typeof saveAlert>[0], payload, paperExecuted);
	} catch {
		// non-fatal — still send Telegram
	}

	// ── Telegram notification ──────────────────────────────────────────────────
	const tgMessage = formatTelegramAlert(payload);
	await notifyTelegram(tgMessage);

	return json({
		ok:          true,
		alertId,
		symbol:      payload.symbol,
		action:      payload.action,
		price:       payload.price,
		paperTrade:  paperExecuted,
	});
};

// ─── GET: List recent alerts ──────────────────────────────────────────────────

export const GET: RequestHandler = async ({ url }) => {
	const limit = Math.min(50, parseInt(url.searchParams.get('limit') ?? '20', 10) || 20);

	try {
		const db     = getSupabaseAdminClient();
		const alerts = await listAlerts(db as unknown as Parameters<typeof listAlerts>[0], limit);
		return json({ ok: true, count: alerts.length, alerts });
	} catch {
		return json({ ok: true, count: 0, alerts: [] });
	}
};
