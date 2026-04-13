// Memory Tools - save_memory, recall_memory for persistent user context
import { AsyncLocalStorage } from 'node:async_hooks';
import { registerTool, type ToolResult } from './registry';
import { saveMemory, recallMemory, deleteMemory, getMemorySearchService, type MemoryType } from '../memory.server';

const VALID_TYPES: MemoryType[] = ['portfolio', 'preference', 'watchlist', 'trade_history', 'note'];
const memoryToolUserStore = new AsyncLocalStorage<string | null>();

export async function runWithMemoryToolUserId<T>(
	userId: string | null,
	callback: () => Promise<T>
): Promise<T> {
	return memoryToolUserStore.run(userId, callback);
}

function getCurrentUserId(): string | null {
	return memoryToolUserStore.getStore() ?? null;
}

registerTool({
	name: 'save_memory',
	description:
		'Save information to the user\'s persistent memory so it can be recalled in future conversations. Use this to remember: portfolio positions (e.g. "holds 2 BTC"), preferences (e.g. "risk per trade 1%"), watchlist assets, trade history notes, or any important context the user shares. The memory persists across sessions.',
	parameters: {
		type: 'object',
		properties: {
			memory_type: {
				type: 'string',
				enum: ['portfolio', 'preference', 'watchlist', 'trade_history', 'note'],
				description:
					'Type of memory: "portfolio" for holdings/positions, "preference" for risk settings/style, "watchlist" for tracked assets, "trade_history" for past trades, "note" for general notes'
			},
			key: {
				type: 'string',
				description:
					'A short identifier for this memory entry (e.g. "btc_position", "risk_per_trade", "gold", "2024-03-loss")'
			},
			value: {
				type: 'object',
				description:
					'The data to remember as a JSON object (e.g. {"amount": 2, "entry_price": 65000, "currency": "USD"})'
			}
		},
		required: ['memory_type', 'key', 'value']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const memoryType = String(args.memory_type || '') as MemoryType;
		const key = String(args.key || '').trim();
		const value = (args.value as Record<string, unknown>) || {};

		if (!VALID_TYPES.includes(memoryType)) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Invalid memory type: "${memoryType}". Use: ${VALID_TYPES.join(', ')}`, tool: 'save_memory' }],
				textSummary: `Error: Invalid memory type "${memoryType}"`
			};
		}

		if (!key) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Memory key is required', tool: 'save_memory' }],
				textSummary: 'Error: Memory key is required'
			};
		}

		const currentUserId = getCurrentUserId();
		if (!currentUserId || currentUserId === 'anonymous') {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Cannot save memory: user not identified', tool: 'save_memory' }],
				textSummary: 'Error: Cannot save memory without user identification'
			};
		}

		const result =
			memoryType === 'preference'
				? await getMemorySearchService().savePreference({
						biglotUserId: currentUserId,
						key,
						value
					})
				: await saveMemory(currentUserId, memoryType, key, value);

		if (!result.success) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: result.error || 'Failed to save memory', tool: 'save_memory' }],
				textSummary: `Error saving memory: ${result.error}`
			};
		}

		return {
			success: true,
			contentBlocks: [
				{
					type: 'text',
					content: `Saved to memory: **${memoryType}/${key}**`
				}
			],
			textSummary: `Memory saved: ${memoryType}/${key} = ${JSON.stringify(value)}`
		};
	}
});

registerTool({
	name: 'recall_memory',
	description:
		'Recall information from the user\'s persistent memory. Use this to retrieve portfolio positions, preferences, watchlist, trade history, or notes that the user previously shared. Always recall memory when the user asks about "my portfolio", "my settings", "what do I hold", etc.',
	parameters: {
		type: 'object',
		properties: {
			memory_type: {
				type: 'string',
				enum: ['portfolio', 'preference', 'watchlist', 'trade_history', 'note'],
				description: 'Filter by memory type (optional — omit to get all types)'
			},
			key: {
				type: 'string',
				description: 'Filter by specific key (optional — omit to get all entries of this type)'
			}
		}
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const memoryType = args.memory_type ? (String(args.memory_type) as MemoryType) : undefined;
		const key = args.key ? String(args.key).trim() : undefined;

		if (memoryType && !VALID_TYPES.includes(memoryType)) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Invalid memory type: "${memoryType}"`, tool: 'recall_memory' }],
				textSummary: `Error: Invalid memory type "${memoryType}"`
			};
		}

		const currentUserId = getCurrentUserId();
		if (!currentUserId || currentUserId === 'anonymous') {
			return {
				success: true,
				contentBlocks: [{ type: 'text', content: 'No user memory available (anonymous user).' }],
				textSummary: 'No memory available for anonymous user.'
			};
		}

		const result = await recallMemory(currentUserId, memoryType, key);

		if (result.error) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: result.error, tool: 'recall_memory' }],
				textSummary: `Error recalling memory: ${result.error}`
			};
		}

		if (result.entries.length === 0) {
			const typeHint = memoryType ? ` of type "${memoryType}"` : '';
			return {
				success: true,
				contentBlocks: [{ type: 'text', content: `No memories found${typeHint}.` }],
				textSummary: `No memories found${typeHint}.`
			};
		}

		// Build table of memories
		const rows = result.entries.map((e) => [
			e.memory_type,
			e.key,
			JSON.stringify(e.value),
			new Date(e.updated_at).toLocaleDateString()
		]);

		return {
			success: true,
			contentBlocks: [
				{
					type: 'table',
					title: 'User Memory',
					headers: ['Type', 'Key', 'Value', 'Updated'],
					rows
				}
			],
			textSummary: result.entries
				.map((e) => `[${e.memory_type}] ${e.key}: ${JSON.stringify(e.value)}`)
				.join('\n')
		};
	}
});

registerTool({
	name: 'delete_memory',
	description:
		'Delete a specific entry from the user\'s persistent memory. Use when the user asks to forget something or when information is outdated.',
	parameters: {
		type: 'object',
		properties: {
			memory_type: {
				type: 'string',
				enum: ['portfolio', 'preference', 'watchlist', 'trade_history', 'note'],
				description: 'Type of memory to delete'
			},
			key: {
				type: 'string',
				description: 'Key of the memory entry to delete'
			}
		},
		required: ['memory_type', 'key']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const memoryType = String(args.memory_type || '') as MemoryType;
		const key = String(args.key || '').trim();

		const currentUserId = getCurrentUserId();
		if (!currentUserId || currentUserId === 'anonymous') {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Cannot delete memory: user not identified', tool: 'delete_memory' }],
				textSummary: 'Error: Cannot delete memory without user identification'
			};
		}

		const result = await deleteMemory(currentUserId, memoryType, key);

		if (!result.success) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: result.error || 'Failed to delete memory', tool: 'delete_memory' }],
				textSummary: `Error deleting memory: ${result.error}`
			};
		}

		return {
			success: true,
			contentBlocks: [{ type: 'text', content: `Deleted memory: **${memoryType}/${key}**` }],
			textSummary: `Memory deleted: ${memoryType}/${key}`
		};
	}
});
