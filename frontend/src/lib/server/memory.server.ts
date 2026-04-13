// Persistent Memory - CRUD operations for user memory across sessions
import { getSupabaseAdminClient } from './supabaseAdmin.server';
import { createMemorySearchService, isMemorySearchEnabled } from './memorySearch.server';

export type MemoryType = 'portfolio' | 'preference' | 'watchlist' | 'trade_history' | 'note';

export type MemoryEntry = {
	id: string;
	biglot_user_id: string;
	memory_type: MemoryType;
	key: string;
	value: Record<string, unknown>;
	created_at: string;
	updated_at: string;
};

const memorySearchService = createMemorySearchService({ saveMemory });

/**
 * Save or update a memory entry (upsert by user + type + key).
 */
export async function saveMemory(
	userId: string,
	type: MemoryType,
	key: string,
	value: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
	try {
		const supabase = getSupabaseAdminClient();
		const { error } = await supabase
			.from('user_memory')
			.upsert(
				{
					biglot_user_id: userId,
					memory_type: type,
					key,
					value
				},
				{ onConflict: 'biglot_user_id,memory_type,key' }
			);

		if (error) return { success: false, error: error.message };
		return { success: true };
	} catch (err: unknown) {
		return { success: false, error: err instanceof Error ? err.message : 'Failed to save memory' };
	}
}

/**
 * Recall memory entries for a user, optionally filtered by type and/or key.
 */
export async function recallMemory(
	userId: string,
	type?: MemoryType,
	key?: string
): Promise<{ entries: MemoryEntry[]; error?: string }> {
	try {
		const supabase = getSupabaseAdminClient();
		let query = supabase
			.from('user_memory')
			.select('*')
			.eq('biglot_user_id', userId)
			.order('updated_at', { ascending: false });

		if (type) query = query.eq('memory_type', type);
		if (key) query = query.eq('key', key);

		const { data, error } = await query.limit(50);

		if (error) return { entries: [], error: error.message };
		return { entries: (data ?? []) as MemoryEntry[] };
	} catch (err: unknown) {
		return { entries: [], error: err instanceof Error ? err.message : 'Failed to recall memory' };
	}
}

/**
 * Delete a specific memory entry.
 */
export async function deleteMemory(
	userId: string,
	type: MemoryType,
	key: string
): Promise<{ success: boolean; error?: string }> {
	try {
		const supabase = getSupabaseAdminClient();
		const { error } = await supabase
			.from('user_memory')
			.delete()
			.eq('biglot_user_id', userId)
			.eq('memory_type', type)
			.eq('key', key);

		if (error) return { success: false, error: error.message };
		return { success: true };
	} catch (err: unknown) {
		return { success: false, error: err instanceof Error ? err.message : 'Failed to delete memory' };
	}
}

/**
 * Get a compact summary of user's key memories for system prompt injection.
 * Returns a short text string suitable for adding to system messages.
 */
export async function getMemoryContext(userId: string): Promise<string | null> {
	if (!userId || userId === 'anonymous') return null;

	try {
		const { entries, error } = await recallMemory(userId);
		if (error || entries.length === 0) return null;

		const sections: string[] = [];

		// Portfolio
		const portfolio = entries.filter((e) => e.memory_type === 'portfolio');
		if (portfolio.length > 0) {
			const items = portfolio.map((e) => `${e.key}: ${JSON.stringify(e.value)}`).join(', ');
			sections.push(`Portfolio: ${items}`);
		}

		// Preferences
		const prefs = entries.filter((e) => e.memory_type === 'preference');
		if (prefs.length > 0) {
			const items = prefs.map((e) => `${e.key}: ${JSON.stringify(e.value)}`).join(', ');
			sections.push(`Preferences: ${items}`);
		}

		// Watchlist
		const watchlist = entries.filter((e) => e.memory_type === 'watchlist');
		if (watchlist.length > 0) {
			const items = watchlist.map((e) => e.key).join(', ');
			sections.push(`Watchlist: ${items}`);
		}

		// Recent notes (last 3)
		const notes = entries.filter((e) => e.memory_type === 'note').slice(0, 3);
		if (notes.length > 0) {
			const items = notes.map((e) => `${e.key}: ${JSON.stringify(e.value)}`).join('; ');
			sections.push(`Notes: ${items}`);
		}

		if (sections.length === 0) return null;
		return `[User Memory]\n${sections.join('\n')}`;
	} catch {
		return null;
	}
}

export function getMemorySearchService() {
	return memorySearchService;
}

export async function getRelevantMemoryContext(input: {
	userId: string;
	query?: string | null;
	maxItems?: number;
}): Promise<string | null> {
	if (!input.userId || input.userId === 'anonymous') return null;

	if (!isMemorySearchEnabled() || !input.query?.trim()) {
		return getMemoryContext(input.userId);
	}

	try {
		const hits = await memorySearchService.searchContext({
			biglotUserId: input.userId,
			query: input.query,
			maxResults: input.maxItems ?? 6
		});

		if (hits.length === 0) {
			return getMemoryContext(input.userId);
		}

		return [
			'[Relevant Memory]',
			...hits.map((hit, index) => `${index + 1}. [${hit.sourceType}] ${hit.label}: ${hit.snippet}`)
		].join('\n');
	} catch {
		return getMemoryContext(input.userId);
	}
}
