import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$lib/__mocks__/$env.dynamic.private';

const { listChatsMock, fromMock, saveMemoryMock } = vi.hoisted(() => ({
	listChatsMock: vi.fn(),
	fromMock: vi.fn(),
	saveMemoryMock: vi.fn()
}));

vi.mock('./chatPersistence.server', () => ({
	listChats: listChatsMock
}));

vi.mock('./supabaseAdmin.server', () => ({
	getSupabaseAdminClient: () => ({
		from: fromMock
	})
}));

describe('memorySearch service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns no hits when memory search is disabled', async () => {
		env.BIGLOT_MEMORY_SEARCH_ENABLED = '0';
		const { createMemorySearchService } = await import('./memorySearch.server');
		const service = createMemorySearchService({ saveMemory: saveMemoryMock });

		await expect(
			service.searchContext({
				biglotUserId: 'user-1',
				query: 'gold portfolio'
			})
		).resolves.toEqual([]);
	});

	it('blends user memory and session messages when enabled', async () => {
		env.BIGLOT_MEMORY_SEARCH_ENABLED = '1';
		listChatsMock.mockResolvedValue([{ id: 'chat-1' }]);

		fromMock.mockImplementation((table: string) => {
			if (table === 'user_memory') {
				return {
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockReturnThis(),
					limit: vi.fn().mockResolvedValue({
						data: [
							{
								id: 'm1',
								biglot_user_id: 'user-1',
								memory_type: 'preference',
								key: 'risk_per_trade',
								value: { pct: 1 },
								created_at: '2026-04-10T00:00:00.000Z',
								updated_at: new Date().toISOString()
							}
						],
						error: null
					})
				};
			}

			if (table === 'messages') {
				return {
					select: vi.fn().mockReturnThis(),
					in: vi.fn().mockReturnThis(),
					order: vi.fn().mockReturnThis(),
					limit: vi.fn().mockResolvedValue({
						data: [
							{
								chat_id: 'chat-1',
								content: 'User asked for gold portfolio risk management plan',
								created_at: new Date().toISOString()
							}
						],
						error: null
					})
				};
			}

			throw new Error(`Unexpected table ${table}`);
		});

		const { createMemorySearchService } = await import('./memorySearch.server');
		const service = createMemorySearchService({ saveMemory: saveMemoryMock });
		const hits = await service.searchContext({
			biglotUserId: 'user-1',
			query: 'gold risk'
		});

		expect(hits.length).toBeGreaterThan(0);
		expect(hits.some((hit) => hit.sourceType === 'memory')).toBe(true);
		expect(hits.some((hit) => hit.sourceType === 'session')).toBe(true);
	});

	it('routes preference writes through savePreference', async () => {
		saveMemoryMock.mockResolvedValue({ success: true });
		const { createMemorySearchService } = await import('./memorySearch.server');
		const service = createMemorySearchService({ saveMemory: saveMemoryMock });

		await expect(
			service.savePreference({
				biglotUserId: 'user-1',
				key: 'risk_per_trade',
				value: { pct: 1 }
			})
		).resolves.toEqual({ success: true });
		expect(saveMemoryMock).toHaveBeenCalledWith('user-1', 'preference', 'risk_per_trade', { pct: 1 });
	});
});
