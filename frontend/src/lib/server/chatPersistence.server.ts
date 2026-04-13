import { getSupabaseAdminClient } from './supabaseAdmin.server';

type QueryError = { message?: string | null; code?: string | null };

export type StoredChatRow = {
	id: string;
	title: string | null;
	created_at: string | null;
	biglot_user_id?: string | null;
};

export type StoredMessageRow = {
	id?: string;
	chat_id?: string | null;
	role: 'user' | 'assistant' | 'system';
	content: string;
	image_url?: string | null;
	file_name?: string | null;
	channel?: string | null;
	run_id?: string | null;
	mode?: string | null;
	content_blocks?: unknown;
	created_at?: string | null;
};

export type PersistedMessageInput = {
	chatId: string;
	biglotUserId: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	imageUrl?: string;
	fileName?: string;
	mode?: string;
	channel?: string;
	runId?: string | null;
	contentBlocks?: unknown;
	externalMessageId?: string;
};

type ChatAccessResult =
	| { ok: true; legacy: boolean }
	| { ok: false; status: 404 | 403; message: string };

const MIN_BIGLOT_USER_ID_LENGTH = 8;

function getErrorMessage(error: unknown): string {
	if (error && typeof error === 'object' && 'message' in error) {
		return typeof error.message === 'string' ? error.message : String(error.message);
	}

	return String(error);
}

function hasMissingColumn(error: QueryError | null, column: string): boolean {
	const message = error?.message ?? '';
	return new RegExp(`\\b${column}\\b`, 'i').test(message);
}

function hasMissingRelation(error: QueryError | null): boolean {
	return /does not exist|relation .* does not exist/i.test(error?.message ?? '');
}

function isNotFoundError(error: QueryError | null): boolean {
	return /0 rows|no rows|json object requested/i.test(error?.message ?? '');
}

export function validateBiglotUserId(value: unknown): string {
	if (typeof value !== 'string' || value.trim().length < MIN_BIGLOT_USER_ID_LENGTH) {
		throw new Error('Invalid biglotUserId');
	}

	return value.trim();
}

export function buildChatTitle(input: {
	content?: string;
	fileName?: string;
	hasImage?: boolean;
}): string {
	const source = input.content?.trim() || input.fileName?.trim() || (input.hasImage ? 'Image Analysis' : 'New Chat');
	return source.slice(0, 30) + (source.length > 30 ? '...' : '');
}

async function verifyChatAccess(chatId: string, biglotUserId: string): Promise<ChatAccessResult> {
	const supabase = getSupabaseAdminClient();
	const ownedChatQuery = await supabase
		.from('chats')
		.select('id, biglot_user_id')
		.eq('id', chatId)
		.single();

	if (!ownedChatQuery.error) {
		const owner = ownedChatQuery.data?.biglot_user_id;
		if (typeof owner === 'string' && owner.length > 0 && owner !== biglotUserId) {
			return { ok: false, status: 404, message: 'Chat not found' };
		}

		if (!ownedChatQuery.data) {
			return { ok: false, status: 404, message: 'Chat not found' };
		}

		return { ok: true, legacy: false };
	}

	if (!hasMissingColumn(ownedChatQuery.error, 'biglot_user_id')) {
		if (isNotFoundError(ownedChatQuery.error)) {
			return { ok: false, status: 404, message: 'Chat not found' };
		}

		throw new Error(getErrorMessage(ownedChatQuery.error));
	}

	const legacyQuery = await supabase.from('chats').select('id').eq('id', chatId).single();
	if (legacyQuery.error || !legacyQuery.data) {
		if (isNotFoundError(legacyQuery.error)) {
			return { ok: false, status: 404, message: 'Chat not found' };
		}

		throw new Error(getErrorMessage(legacyQuery.error));
	}

	return { ok: true, legacy: true };
}

export async function listChats(biglotUserId: string): Promise<StoredChatRow[]> {
	validateBiglotUserId(biglotUserId);

	const supabase = getSupabaseAdminClient();
	let missingUserIdColumn = false;

	let result = await supabase
		.from('chats')
		.select('*')
		.eq('biglot_user_id', biglotUserId)
		.order('created_at', { ascending: false });

	if (result.error && hasMissingColumn(result.error, 'biglot_user_id')) {
		missingUserIdColumn = true;
		result = await supabase.from('chats').select('*').order('created_at', { ascending: false });
	}

	if (result.error && hasMissingColumn(result.error, 'created_at')) {
		result = missingUserIdColumn
			? await supabase.from('chats').select('*')
			: await supabase.from('chats').select('*').eq('biglot_user_id', biglotUserId);
	}

	if (result.error) {
		throw new Error(getErrorMessage(result.error));
	}

	return (result.data ?? []) as StoredChatRow[];
}

export async function createChatRecord(input: {
	biglotUserId: string;
	title: string;
}): Promise<StoredChatRow> {
	const biglotUserId = validateBiglotUserId(input.biglotUserId);
	const supabase = getSupabaseAdminClient();

	let result = await supabase
		.from('chats')
		.insert({
			title: input.title,
			biglot_user_id: biglotUserId
		})
		.select('*')
		.single();

	if (result.error && hasMissingColumn(result.error, 'biglot_user_id')) {
		result = await supabase.from('chats').insert({ title: input.title }).select('*').single();
	}

	if (result.error || !result.data) {
		throw new Error(getErrorMessage(result.error));
	}

	return result.data as StoredChatRow;
}

export async function getChatMessages(input: {
	chatId: string;
	biglotUserId: string;
}): Promise<StoredMessageRow[]> {
	validateBiglotUserId(input.biglotUserId);
	const access = await verifyChatAccess(input.chatId, input.biglotUserId);
	if (!access.ok) {
		const error = new Error(access.message);
		(error as Error & { status?: number }).status = access.status;
		throw error;
	}

	const supabase = getSupabaseAdminClient();
	let result = await supabase
		.from('messages')
		.select('*')
		.eq('chat_id', input.chatId)
		.order('created_at', { ascending: true });

	if (result.error && hasMissingColumn(result.error, 'created_at')) {
		result = await supabase.from('messages').select('*').eq('chat_id', input.chatId);
	}

	if (result.error) {
		throw new Error(getErrorMessage(result.error));
	}

	return (result.data ?? []) as StoredMessageRow[];
}

export async function getRecentChatMessages(input: {
	chatId: string;
	limit?: number;
}): Promise<StoredMessageRow[]> {
	const supabase = getSupabaseAdminClient();
	let result = await supabase
		.from('messages')
		.select('*')
		.eq('chat_id', input.chatId)
		.order('created_at', { ascending: false })
		.limit(input.limit ?? 30);

	if (result.error && hasMissingColumn(result.error, 'created_at')) {
		result = await supabase.from('messages').select('*').eq('chat_id', input.chatId).limit(input.limit ?? 30);
	}

	if (result.error) {
		throw new Error(getErrorMessage(result.error));
	}

	return [...((result.data ?? []) as StoredMessageRow[])].reverse();
}

export async function deleteChatRecord(input: {
	chatId: string;
	biglotUserId: string;
}): Promise<void> {
	validateBiglotUserId(input.biglotUserId);
	const access = await verifyChatAccess(input.chatId, input.biglotUserId);
	if (!access.ok) {
		const error = new Error(access.message);
		(error as Error & { status?: number }).status = access.status;
		throw error;
	}

	const supabase = getSupabaseAdminClient();
	const result = await supabase.from('chats').delete().eq('id', input.chatId);
	if (result.error) {
		throw new Error(getErrorMessage(result.error));
	}
}

export async function saveChatMessage(input: PersistedMessageInput): Promise<{ id?: string }> {
	validateBiglotUserId(input.biglotUserId);
	const access = await verifyChatAccess(input.chatId, input.biglotUserId);
	if (!access.ok) {
		const error = new Error(access.message);
		(error as Error & { status?: number }).status = access.status;
		throw error;
	}

	const supabase = getSupabaseAdminClient();
	const payload: Record<string, unknown> = {
		chat_id: input.chatId,
		role: input.role,
		content: input.content,
		channel: input.channel ?? 'web'
	};

	if (input.imageUrl) payload.image_url = input.imageUrl;
	if (input.fileName) payload.file_name = input.fileName;
	if (input.mode) payload.mode = input.mode;
	if (input.runId) payload.run_id = input.runId;
	if (input.contentBlocks) payload.content_blocks = input.contentBlocks;
	if (input.externalMessageId) payload.external_message_id = input.externalMessageId;

	for (let attempt = 0; attempt < 6; attempt += 1) {
		const result = await supabase.from('messages').insert(payload).select('id').single();
		if (!result.error) {
			return { id: typeof result.data?.id === 'string' ? result.data.id : undefined };
		}

		const errorMessage = getErrorMessage(result.error);
		if (/duplicate key/i.test(errorMessage) && /external_message_id/i.test(errorMessage)) {
			return {};
		}

		if (hasMissingColumn(result.error, 'image_url')) {
			delete payload.image_url;
			continue;
		}
		if (hasMissingColumn(result.error, 'file_name')) {
			delete payload.file_name;
			continue;
		}
		if (hasMissingColumn(result.error, 'mode')) {
			delete payload.mode;
			continue;
		}
		if (hasMissingColumn(result.error, 'channel')) {
			delete payload.channel;
			continue;
		}
		if (hasMissingColumn(result.error, 'run_id')) {
			delete payload.run_id;
			continue;
		}
		if (hasMissingColumn(result.error, 'content_blocks')) {
			delete payload.content_blocks;
			continue;
		}
		if (hasMissingColumn(result.error, 'external_message_id')) {
			delete payload.external_message_id;
			continue;
		}

		throw new Error(getErrorMessage(result.error));
	}

	throw new Error('Failed to save message');
}

export async function isChatTableAvailable(): Promise<boolean> {
	const supabase = getSupabaseAdminClient();
	const result = await supabase.from('chats').select('id').limit(1);
	return !hasMissingRelation(result.error);
}
