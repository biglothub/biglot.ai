// /api/briefing — Daily market briefing endpoint — T-605
// GET:  Trigger briefing manually, returns JSON
// POST: Cron webhook (protected by BRIEFING_CRON_SECRET env var)

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { assembleDailyBriefing, formatBriefingTelegram } from '$lib/server/briefing/dailyBriefing';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';
import { sendTelegramMessage } from '$lib/server/telegram.server';

async function getLinkedChatIds(): Promise<number[]> {
	try {
		const db = getSupabaseAdminClient();
		const { data } = await db
			.from('telegram_links')
			.select('telegram_chat_id')
			.eq('is_active', true);
		if (!data) return [];
		return data.map((row: { telegram_chat_id: number }) => row.telegram_chat_id);
	} catch {
		return [];
	}
}

async function runBriefing(userId = 'default', limit = 5) {
	const briefing  = await assembleDailyBriefing(userId, limit);
	const message   = formatBriefingTelegram(briefing);
	const chatIds   = await getLinkedChatIds();

	await Promise.allSettled(
		chatIds.map(chatId => sendTelegramMessage(chatId, message, { parseMode: 'HTML' }))
	);

	return { briefing, message, sent: chatIds.length };
}

// ── GET: manual trigger ───────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ url }) => {
	const userId = url.searchParams.get('user_id') ?? 'default';
	const limit  = Math.min(10, parseInt(url.searchParams.get('limit') ?? '5', 10) || 5);

	const { briefing, message, sent } = await runBriefing(userId, limit);
	return json({ ok: true, briefing, message, sent });
};

// ── POST: cron webhook ────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	const secret = env.BRIEFING_CRON_SECRET?.trim();
	if (secret) {
		const authHeader = request.headers.get('authorization') ?? '';
		const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
		if (token !== secret) {
			throw error(401, 'Unauthorized');
		}
	}

	const body   = await request.json().catch(() => ({})) as Record<string, unknown>;
	const userId = typeof body.user_id === 'string' ? body.user_id : 'default';
	const limit  = typeof body.limit   === 'number' ? Math.min(10, body.limit) : 5;

	const { briefing, sent } = await runBriefing(userId, limit);
	return json({ ok: true, date: briefing.date, sent });
};
