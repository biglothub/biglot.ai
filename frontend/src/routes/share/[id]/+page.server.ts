// Share page server load — T-405
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';

export const load: PageServerLoad = async ({ params }) => {
	const chatId = params.id;
	const supabase = getSupabaseAdminClient();

	const chatResult = await supabase
		.from('chats')
		.select('id, title, created_at')
		.eq('id', chatId)
		.single();

	if (chatResult.error || !chatResult.data) {
		throw error(404, 'Chat not found');
	}

	const msgsResult = await supabase
		.from('messages')
		.select('role, content, content_blocks, created_at')
		.eq('chat_id', chatId)
		.order('created_at', { ascending: true });

	if (msgsResult.error) {
		throw error(500, 'Failed to load messages');
	}

	return {
		chatId,
		title: chatResult.data.title ?? 'BigLot.ai Chat',
		createdAt: chatResult.data.created_at as string | null,
		messages: (msgsResult.data ?? []).map(m => ({
			role: m.role as 'user' | 'assistant' | 'system',
			content: (m.content ?? '') as string,
			contentBlocks: (m.content_blocks ?? null) as Array<{ type: string; [key: string]: unknown }> | null,
		})),
	};
};
