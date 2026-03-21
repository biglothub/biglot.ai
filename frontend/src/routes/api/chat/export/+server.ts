// Chat Export API — T-405
// GET /api/chat/export?chatId=<uuid>
// Returns the chat title + messages for public sharing.
// Security: chat UUIDs are 128-bit tokens — anyone with the ID can view.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';

export const GET: RequestHandler = async ({ url }) => {
	const chatId = url.searchParams.get('chatId') ?? '';
	if (!chatId) {
		return json({ error: 'chatId is required' }, { status: 400 });
	}

	const supabase = getSupabaseAdminClient();

	// Fetch chat record (title)
	const chatResult = await supabase
		.from('chats')
		.select('id, title, created_at')
		.eq('id', chatId)
		.single();

	if (chatResult.error || !chatResult.data) {
		return json({ error: 'Chat not found' }, { status: 404 });
	}

	// Fetch messages
	const msgsResult = await supabase
		.from('messages')
		.select('role, content, content_blocks, created_at')
		.eq('chat_id', chatId)
		.order('created_at', { ascending: true });

	if (msgsResult.error) {
		return json({ error: 'Failed to load messages' }, { status: 500 });
	}

	return json({
		chatId,
		title: chatResult.data.title ?? 'BigLot.ai Chat',
		createdAt: chatResult.data.created_at,
		exportedAt: new Date().toISOString(),
		messages: (msgsResult.data ?? []).map(m => ({
			role: m.role,
			content: m.content ?? '',
			contentBlocks: m.content_blocks ?? null,
		})),
	});
};
