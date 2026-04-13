import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';
import { getOrCreateChannelConversation, hasHandledExternalMessage, listChannelChatIds } from '$lib/server/channelConversations.server';
import { runChannelChatRuntime } from '$lib/server/chatRuntime.server';
import {
	getTelegramWebhookSecret,
	hashLinkToken,
	sendTelegramMessage,
	toDisplayName,
	type TelegramLinkRecord
} from '$lib/server/telegram.server';
import {
	parseTelegramUpdate,
	sendTelegramAssistantReply,
	startTelegramProgress,
	type TelegramMessage,
	type TelegramUpdate,
	type TelegramUser,
	verifyTelegramWebhookRequest
} from '$lib/server/channels/telegram/adapter';

type LinkTokenRecord = {
	id: string;
	biglot_user_id: string;
	expires_at: string;
	used_at: string | null;
};

const DEFAULT_TELEGRAM_RATE_LIMIT_PER_MINUTE = 15;
const TELEGRAM_RATE_LIMIT_PER_MINUTE = parsePositiveInt(
	env.TELEGRAM_RATE_LIMIT_PER_MINUTE,
	DEFAULT_TELEGRAM_RATE_LIMIT_PER_MINUTE
);

export const GET: RequestHandler = async () => {
	return json({ ok: true });
};

export const POST: RequestHandler = async ({ request }) => {
	const expectedSecret = getTelegramWebhookSecret();
	const requireSecret = isWebhookSecretRequired();
	if (requireSecret && !expectedSecret) {
		return json({ error: 'TELEGRAM_WEBHOOK_SECRET must be configured in production' }, { status: 500 });
	}

	try {
		verifyTelegramWebhookRequest(request.headers);
	} catch {
		return json({ error: 'Unauthorized webhook request' }, { status: 401 });
	}

	let update: TelegramUpdate;
	try {
		update = (await request.json()) as TelegramUpdate;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const parsed = parseTelegramUpdate(update);
	if (parsed.kind === 'ignored') {
		return json({ ok: true, ignored: true, reason: parsed.reason });
	}

	const acceptedUpdate = await registerWebhookUpdate(parsed.updateId);
	if (!acceptedUpdate) {
		return json({ ok: true, duplicate: true });
	}

	const { message, sender, incomingText, command, envelope } = parsed;

	try {
		if (message.chat.type !== 'private') {
			await markWebhookUpdateStatus(parsed.updateId, 'ignored');
			return json({ ok: true, ignored: true, reason: 'Only private chat is supported' });
		}

		if (command === 'start') {
			await handleStartCommand(message, sender, incomingText);
			await markWebhookUpdateStatus(parsed.updateId, 'processed');
			return json({ ok: true, action: 'link' });
		}

		if (command === 'unlink') {
			await handleUnlinkCommand(message, sender);
			await markWebhookUpdateStatus(parsed.updateId, 'processed');
			return json({ ok: true, action: 'unlink' });
		}

		if (command === 'help') {
			await sendTelegramMessage(
				message.chat.id,
				'BigLot.ai Telegram commands:\n/start <token> - link account\n/unlink - disconnect Telegram account\n/help - show commands'
			);
			await markWebhookUpdateStatus(parsed.updateId, 'processed');
			return json({ ok: true, action: 'help' });
		}

		await handleConversationMessage({ message, sender, incomingText, envelope });
		await markWebhookUpdateStatus(parsed.updateId, 'processed');
		return json({ ok: true, action: 'chat' });
	} catch (error) {
		console.error('[Telegram Webhook Error]', error);
		const messageText = error instanceof Error ? error.message : 'Unknown webhook error';
		await markWebhookUpdateStatus(parsed.updateId, 'failed', messageText);
		try {
			await sendTelegramMessage(message.chat.id, 'BigLot.ai มีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้งในอีกสักครู่');
		} catch (sendError) {
			console.error('[Telegram send fallback error]', sendError);
		}
		return json({ ok: false }, { status: 500 });
	}
};

async function handleStartCommand(message: TelegramMessage, sender: TelegramUser, incomingText: string): Promise<void> {
	const token = parseStartToken(incomingText);
	if (!token) {
		await sendTelegramMessage(
			message.chat.id,
			'ยังไม่มี token สำหรับเชื่อมบัญชี BigLot.ai\n\nให้กด Add Telegram Bot จากหน้าเว็บก่อน แล้วค่อยกลับมาที่นี่'
		);
		return;
	}

	const supabase = getSupabaseAdminClient();
	const tokenHash = hashLinkToken(token);
	const nowIso = new Date().toISOString();

	const { data: tokenRecord, error: tokenError } = await supabase
		.from('telegram_link_tokens')
		.select('id, biglot_user_id, expires_at, used_at')
		.eq('token_hash', tokenHash)
		.is('used_at', null)
		.gt('expires_at', nowIso)
		.maybeSingle();

	if (tokenError) throw new Error(tokenError.message);
	if (!tokenRecord) {
		await sendTelegramMessage(
			message.chat.id,
			'ลิงก์เชื่อมบัญชีหมดอายุหรือไม่ถูกต้อง\n\nกลับไปหน้าเว็บแล้วกด Add Telegram Bot ใหม่อีกครั้ง'
		);
		return;
	}

	const safeToken = tokenRecord as LinkTokenRecord;

	const { error: deactivateError } = await supabase
		.from('telegram_links')
		.update({ is_active: false, unlinked_at: nowIso, updated_at: nowIso })
		.eq('biglot_user_id', safeToken.biglot_user_id)
		.eq('is_active', true)
		.neq('telegram_user_id', sender.id);

	if (deactivateError) throw new Error(deactivateError.message);

	const { error: linkError } = await supabase.from('telegram_links').upsert(
		{
			biglot_user_id: safeToken.biglot_user_id,
			telegram_user_id: sender.id,
			telegram_chat_id: message.chat.id,
			telegram_username: sender.username ?? null,
			telegram_first_name: sender.first_name ?? null,
			telegram_last_name: sender.last_name ?? null,
			is_active: true,
			linked_at: nowIso,
			unlinked_at: null,
			updated_at: nowIso
		},
		{ onConflict: 'telegram_user_id' }
	);

	if (linkError) throw new Error(linkError.message);

	const { error: markUsedError } = await supabase
		.from('telegram_link_tokens')
		.update({ used_at: nowIso })
		.eq('id', safeToken.id);

	if (markUsedError) throw new Error(markUsedError.message);

	await sendTelegramMessage(
		message.chat.id,
		'เชื่อมบัญชีสำเร็จแล้ว\n\nจากนี้ข้อความที่ส่งใน Telegram จะคุยผ่าน BigLot.ai ได้ทันที'
	);
}

async function handleConversationMessage(input: {
	message: TelegramMessage;
	sender: TelegramUser;
	incomingText: string;
	envelope: Parameters<typeof runChannelChatRuntime>[0]['envelope'];
}): Promise<void> {
	if (!input.incomingText) {
		await sendTelegramMessage(input.message.chat.id, 'พิมพ์ข้อความที่ต้องการถาม BigLot.ai ได้เลย');
		return;
	}

	const supabase = getSupabaseAdminClient();
	const { data: linkData, error: linkError } = await supabase
		.from('telegram_links')
		.select('*')
		.eq('telegram_user_id', input.sender.id)
		.eq('is_active', true)
		.limit(1)
		.maybeSingle();

	if (linkError) throw new Error(linkError.message);

	const link = linkData as TelegramLinkRecord | null;
	if (!link) {
		await sendTelegramMessage(
			input.message.chat.id,
			'บัญชีนี้ยังไม่เชื่อมกับ BigLot.ai\n\nเข้าเว็บ BigLot.ai แล้วกด Add Telegram Bot ก่อน'
		);
		return;
	}

	const isRateLimited = await isTelegramUserRateLimited(link.biglot_user_id);
	if (isRateLimited) {
		await sendTelegramMessage(
			input.message.chat.id,
			`ตอนนี้ส่งข้อความเร็วเกินไป กรุณารอสักครู่แล้วลองใหม่อีกครั้ง (limit ${TELEGRAM_RATE_LIMIT_PER_MINUTE} msg/min)`
		);
		return;
	}

	const chatId = await getOrCreateChannelConversation({
		biglotUserId: link.biglot_user_id,
		channel: 'telegram',
		externalConversationId: input.envelope.conversationId,
		title: `Telegram • ${toDisplayName(link)}`
	});

	if (input.envelope.message.externalMessageId) {
		const alreadyHandled = await hasHandledExternalMessage({
			chatId,
			channel: 'telegram',
			externalMessageId: input.envelope.message.externalMessageId
		});
		if (alreadyHandled) return;
	}

	const stopProgress = startTelegramProgress({
		chatId: input.message.chat.id,
		threadId: input.message.message_thread_id
	});

	try {
		const reply = await runChannelChatRuntime({
			biglotUserId: link.biglot_user_id,
			chatId,
			envelope: input.envelope,
			mode: 'coach'
		});

		await sendTelegramAssistantReply({
			chatId: input.message.chat.id,
			threadId: input.message.message_thread_id,
			replyToMessageId: input.message.message_id,
			reply
		});
	} finally {
		stopProgress();
	}
}

async function handleUnlinkCommand(message: TelegramMessage, sender: TelegramUser): Promise<void> {
	const supabase = getSupabaseAdminClient();
	const nowIso = new Date().toISOString();

	const { error } = await supabase
		.from('telegram_links')
		.update({
			is_active: false,
			unlinked_at: nowIso,
			updated_at: nowIso
		})
		.eq('telegram_user_id', sender.id)
		.eq('is_active', true);

	if (error) throw new Error(error.message);

	await sendTelegramMessage(
		message.chat.id,
		'ยกเลิกการเชื่อมบัญชีเรียบร้อยแล้ว\n\nหากต้องการเชื่อมใหม่ ให้กด Add Telegram Bot จากหน้าเว็บ BigLot.ai'
	);
}

async function isTelegramUserRateLimited(biglotUserId: string): Promise<boolean> {
	const supabase = getSupabaseAdminClient();
	const windowStart = new Date(Date.now() - 60_000).toISOString();
	const telegramChatIds = await listChannelChatIds({ biglotUserId, channel: 'telegram' });
	if (telegramChatIds.length === 0) return false;

	const { count, error } = await supabase
		.from('messages')
		.select('id', { count: 'exact', head: true })
		.eq('role', 'user')
		.eq('channel', 'telegram')
		.gte('created_at', windowStart)
		.in('chat_id', telegramChatIds);

	if (error) {
		if (/\bchannel\b/i.test(error.message ?? '')) return false;
		throw new Error(error.message);
	}

	return (count ?? 0) >= TELEGRAM_RATE_LIMIT_PER_MINUTE;
}

async function registerWebhookUpdate(updateId: number): Promise<boolean> {
	const supabase = getSupabaseAdminClient();
	const { error } = await supabase.from('telegram_webhook_events').insert({
		update_id: updateId,
		status: 'processing'
	});

	if (!error) return true;

	const message = error.message ?? '';
	if (error.code === '23505' || /duplicate key/i.test(message)) return false;
	if (/telegram_webhook_events/i.test(message)) return true;
	throw new Error(message || 'Failed to register webhook update');
}

async function markWebhookUpdateStatus(
	updateId: number,
	status: 'processed' | 'failed' | 'ignored',
	errorText?: string
): Promise<void> {
	const supabase = getSupabaseAdminClient();
	const { error } = await supabase
		.from('telegram_webhook_events')
		.update({
			status,
			error: errorText ?? null,
			processed_at: new Date().toISOString()
		})
		.eq('update_id', updateId);

	if (!error) return;
	if (/telegram_webhook_events/i.test(error.message ?? '')) return;
	console.warn('[Telegram webhook status update warning]', error.message ?? 'Failed to update webhook status');
}

function parseStartToken(text: string): string | null {
	const parts = text.trim().split(/\s+/);
	if (parts.length < 2) return null;
	const token = parts[1]?.trim();
	return token || null;
}

function isWebhookSecretRequired(): boolean {
	return env.NODE_ENV === 'production' || env.TELEGRAM_REQUIRE_WEBHOOK_SECRET === '1';
}

function parsePositiveInt(rawValue: string | undefined, fallback: number): number {
	if (!rawValue) return fallback;
	const parsed = Number(rawValue);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}
