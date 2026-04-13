import { getSupabaseAdminClient } from './supabaseAdmin.server';
import { createChatRecord } from './chatPersistence.server';

type ExternalMessageLookupInput = {
	chatId: string;
	channel: string;
	externalMessageId: string;
};

function hasMissingTable(message: string, table: string): boolean {
	return new RegExp(table, 'i').test(message);
}

export async function getOrCreateChannelConversation(input: {
	biglotUserId: string;
	channel: string;
	externalConversationId: string;
	title: string;
}): Promise<string> {
	const supabase = getSupabaseAdminClient();

	const { data: mapping, error: mappingError } = await supabase
		.from('chat_channels')
		.select('chat_id')
		.eq('biglot_user_id', input.biglotUserId)
		.eq('channel', input.channel)
		.eq('external_chat_id', input.externalConversationId)
		.limit(1)
		.maybeSingle();

	if (mappingError && !hasMissingTable(mappingError.message ?? '', 'chat_channels')) {
		throw new Error(mappingError.message);
	}

	const mappedChatId = mapping?.chat_id;
	if (typeof mappedChatId === 'string' && mappedChatId.length > 0) {
		return mappedChatId;
	}

	const chat = await createChatRecord({
		biglotUserId: input.biglotUserId,
		title: input.title
	});

	if (mappingError && hasMissingTable(mappingError.message ?? '', 'chat_channels')) {
		return chat.id;
	}

	const { error: channelError } = await supabase.from('chat_channels').upsert(
		{
			chat_id: chat.id,
			biglot_user_id: input.biglotUserId,
			channel: input.channel,
			external_chat_id: input.externalConversationId,
			updated_at: new Date().toISOString()
		},
		{ onConflict: 'channel,external_chat_id' }
	);

	if (channelError) {
		throw new Error(channelError.message);
	}

	return chat.id;
}

export async function listChannelChatIds(input: {
	biglotUserId: string;
	channel: string;
}): Promise<string[]> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('chat_channels')
		.select('chat_id')
		.eq('biglot_user_id', input.biglotUserId)
		.eq('channel', input.channel);

	if (error) {
		if (hasMissingTable(error.message ?? '', 'chat_channels')) return [];
		throw new Error(error.message);
	}

	return (data ?? [])
		.map((row) => row.chat_id)
		.filter((chatId): chatId is string => typeof chatId === 'string' && chatId.length > 0);
}

export async function hasHandledExternalMessage(input: ExternalMessageLookupInput): Promise<boolean> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('messages')
		.select('id')
		.eq('chat_id', input.chatId)
		.eq('channel', input.channel)
		.eq('external_message_id', input.externalMessageId)
		.limit(1)
		.maybeSingle();

	if (error) {
		const message = error.message ?? '';
		if (/\bchannel\b/i.test(message) || /external_message_id/i.test(message)) {
			return false;
		}
		throw new Error(message);
	}

	return !!data;
}
