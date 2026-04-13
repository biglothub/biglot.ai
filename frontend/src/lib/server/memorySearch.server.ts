import { env } from '$env/dynamic/private';
import { listChats } from './chatPersistence.server';
import { getSupabaseAdminClient } from './supabaseAdmin.server';
import type { MemoryEntry } from './memory.server';

export type MemorySearchHit = {
	sourceType: 'memory' | 'session';
	label: string;
	snippet: string;
	score: number;
	updatedAt?: string | null;
};

export type MemorySearchService = {
	indexSession: (input: { biglotUserId: string; chatId: string }) => Promise<{ indexedMessages: number }>;
	searchContext: (input: {
		biglotUserId: string;
		query: string;
		maxResults?: number;
	}) => Promise<MemorySearchHit[]>;
	savePreference: (input: {
		biglotUserId: string;
		key: string;
		value: Record<string, unknown>;
	}) => Promise<{ success: boolean; error?: string }>;
};

type SearchableSessionMessage = {
	content: string;
	updatedAt?: string | null;
	chatId: string;
};

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9\u0E00-\u0E7F]+/i)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function scoreMatch(text: string, queryTokens: string[], recencyScore = 0): number {
	if (queryTokens.length === 0) return 0;
	const haystack = text.toLowerCase();
	let matches = 0;
	for (const token of queryTokens) {
		if (haystack.includes(token)) matches += 1;
	}
	return matches / queryTokens.length + recencyScore;
}

function computeRecencyBoost(updatedAt?: string | null): number {
	if (!updatedAt) return 0;
	const timestamp = Date.parse(updatedAt);
	if (!Number.isFinite(timestamp)) return 0;
	const ageHours = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
	if (ageHours <= 24) return 0.25;
	if (ageHours <= 24 * 7) return 0.12;
	return 0;
}

async function fetchUserMemory(biglotUserId: string): Promise<MemoryEntry[]> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('user_memory')
		.select('*')
		.eq('biglot_user_id', biglotUserId)
		.order('updated_at', { ascending: false })
		.limit(100);

	if (error) {
		if (/user_memory/i.test(error.message ?? '')) return [];
		throw new Error(error.message);
	}

	return (data ?? []) as MemoryEntry[];
}

async function fetchSessionMessages(biglotUserId: string): Promise<SearchableSessionMessage[]> {
	const chats = await listChats(biglotUserId);
	const chatIds = chats.map((chat) => chat.id).filter(Boolean);
	if (chatIds.length === 0) return [];

	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('messages')
		.select('chat_id, content, created_at')
		.in('chat_id', chatIds)
		.in('role', ['user', 'assistant'])
		.order('created_at', { ascending: false })
		.limit(200);

	if (error) {
		return [];
	}

	return (data ?? [])
		.map((row) => ({
			content: typeof row.content === 'string' ? row.content : '',
			updatedAt: typeof row.created_at === 'string' ? row.created_at : null,
			chatId: typeof row.chat_id === 'string' ? row.chat_id : ''
		}))
		.filter((row) => row.content.trim().length > 0 && row.chatId.length > 0);
}

export function isMemorySearchEnabled(): boolean {
	return env.BIGLOT_MEMORY_SEARCH_ENABLED === '1';
}

export function createMemorySearchService(deps: {
	saveMemory: (userId: string, type: 'preference', key: string, value: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
}): MemorySearchService {
	return {
		async indexSession(input) {
			const sessionMessages = await fetchSessionMessages(input.biglotUserId);
			return {
				indexedMessages: sessionMessages.filter((message) => message.chatId === input.chatId).length
			};
		},
		async searchContext(input) {
			if (!isMemorySearchEnabled()) return [];

			const queryTokens = tokenize(input.query);
			if (queryTokens.length === 0) return [];

			const [memoryEntries, sessionMessages] = await Promise.all([
				fetchUserMemory(input.biglotUserId),
				fetchSessionMessages(input.biglotUserId)
			]);

			const memoryHits: MemorySearchHit[] = memoryEntries
				.map((entry) => {
					const body = `${entry.memory_type} ${entry.key} ${JSON.stringify(entry.value)}`;
					const score = scoreMatch(body, queryTokens, computeRecencyBoost(entry.updated_at) + 0.1);
					return {
						sourceType: 'memory' as const,
						label: `${entry.memory_type}/${entry.key}`,
						snippet: JSON.stringify(entry.value),
						score,
						updatedAt: entry.updated_at
					};
				})
				.filter((hit) => hit.score > 0);

			const sessionHits: MemorySearchHit[] = sessionMessages
				.map((message) => {
					const snippet = message.content.slice(0, 280);
					return {
						sourceType: 'session' as const,
						label: `chat:${message.chatId}`,
						snippet,
						score: scoreMatch(message.content, queryTokens, computeRecencyBoost(message.updatedAt)),
						updatedAt: message.updatedAt
					};
				})
				.filter((hit) => hit.score >= 0.2);

			return [...memoryHits, ...sessionHits]
				.sort((a, b) => b.score - a.score)
				.slice(0, input.maxResults ?? 6);
		},
		async savePreference(input) {
			return deps.saveMemory(input.biglotUserId, 'preference', input.key, input.value);
		}
	};
}
