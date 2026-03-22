// /api/briefing/cron — Scheduled Briefing Delivery — T-1208
// POST: Check all active scheduled briefings and deliver those due now.
// Called by an external cron job (e.g. Vercel Cron Jobs, GitHub Actions, cron-job.org)
// at every 5 minutes to ensure timely delivery.
//
// Authentication: Bearer token via BRIEFING_CRON_SECRET env var.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';
import { assembleDailyBriefing, formatBriefingTelegram } from '$lib/server/briefing/dailyBriefing';
import { sendTelegramMessage } from '$lib/server/telegram.server';
import {
	mapScheduledBriefingRow,
	isBriefingDue,
	type ScheduledBriefingRow,
} from '$lib/server/data/scheduledBriefing.data';

type DeliveryResult = {
	userId:       string;
	delivered:    boolean;
	telegramSent: boolean;
	error?:       string;
};

async function fetchAllActiveBriefings() {
	const db = getSupabaseAdminClient();
	const { data, error: dbErr } = await db
		.from('scheduled_briefings')
		.select()
		.eq('active', true);
	if (dbErr || !data) return [];
	return (data as ScheduledBriefingRow[]).map(mapScheduledBriefingRow);
}

async function markSent(userId: string): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('scheduled_briefings')
		.update({ last_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
		.eq('user_id', userId);
}

async function getTelegramChatId(userId: string): Promise<number | null> {
	try {
		const db = getSupabaseAdminClient();
		const { data } = await db
			.from('telegram_links')
			.select('telegram_chat_id')
			.eq('biglot_user_id', userId)
			.eq('is_active', true)
			.limit(1);
		const chatId = (data as { telegram_chat_id: number }[] | null)?.[0]?.telegram_chat_id;
		return typeof chatId === 'number' ? chatId : null;
	} catch {
		return null;
	}
}

// ── POST: cron trigger ────────────────────────────────────────────────────────

export const POST: RequestHandler = async ({ request }) => {
	// Authenticate with BRIEFING_CRON_SECRET
	const secret = env.BRIEFING_CRON_SECRET?.trim();
	if (secret) {
		const authHeader = request.headers.get('authorization') ?? '';
		const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
		if (token !== secret) {
			throw error(401, 'Unauthorized');
		}
	}

	const now       = new Date();
	const briefings = await fetchAllActiveBriefings();
	const due       = briefings.filter(b => isBriefingDue(b, now));

	if (due.length === 0) {
		return json({ ok: true, checked: briefings.length, delivered: 0, results: [] });
	}

	const results: DeliveryResult[] = await Promise.all(
		due.map(async (briefing): Promise<DeliveryResult> => {
			try {
				const dailyBriefing = await assembleDailyBriefing(briefing.userId, 5);
				const message       = formatBriefingTelegram(dailyBriefing);

				let telegramSent = false;
				const shouldSendTelegram = briefing.channel === 'telegram' || briefing.channel === 'both';
				if (shouldSendTelegram) {
					const chatId = await getTelegramChatId(briefing.userId);
					if (chatId) {
						try {
							await sendTelegramMessage(chatId, message, { parseMode: 'HTML' });
							telegramSent = true;
						} catch (tgErr: unknown) {
							// Telegram failed — still mark as sent to avoid retrying in the same window
							console.error(`Telegram send failed for user ${briefing.userId}:`, tgErr);
						}
					}
				}

				await markSent(briefing.userId);
				return { userId: briefing.userId, delivered: true, telegramSent };
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : 'Unknown error';
				return { userId: briefing.userId, delivered: false, telegramSent: false, error: msg };
			}
		})
	);

	const deliveredCount  = results.filter(r => r.delivered).length;
	const telegramCount   = results.filter(r => r.telegramSent).length;

	return json({
		ok:        true,
		checked:   briefings.length,
		due:       due.length,
		delivered: deliveredCount,
		telegram:  telegramCount,
		results,
	});
};
