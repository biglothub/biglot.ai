import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$lib/__mocks__/$env.dynamic.private';
import { getWebSearchProvider, resetWebSearchProviderCache } from './index';

describe('TavilyWebSearchProvider', () => {
	beforeEach(() => {
		resetWebSearchProviderCache();
		env.WEB_SEARCH_PROVIDER = 'tavily';
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		resetWebSearchProviderCache();
	});

	it('returns normalized results from Tavily', async () => {
		env.TAVILY_API_KEY = 'secret';
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				query: 'gold news',
				answer: 'Gold is firm.',
				results: [
					{
						title: 'Gold Rally',
						url: 'https://example.com/gold',
						content: 'Gold rallied after CPI.',
						raw_content: 'Full article',
						score: 0.9,
						published_date: '2026-04-13T00:00:00.000Z'
					}
				]
			})
		});
		vi.stubGlobal('fetch', fetchMock);

		const provider = getWebSearchProvider();
		const response = await provider.search({
			query: 'gold news',
			searchType: 'news',
			maxResults: 5,
			searchDepth: 'advanced',
			includeRawContent: true,
			timeRange: 'd'
		});

		expect(response.provider).toBe('tavily');
		expect(response.answer).toBe('Gold is firm.');
		expect(response.results[0]).toMatchObject({
			title: 'Gold Rally',
			source: 'example.com',
			snippet: 'Gold rallied after CPI.',
			rawContent: 'Full article'
		});
	});

	it('fails cleanly when Tavily is not configured', async () => {
		delete env.TAVILY_API_KEY;
		const provider = getWebSearchProvider();

		await expect(
			provider.search({
				query: 'btc',
				searchType: 'general',
				maxResults: 3,
				searchDepth: 'basic',
				includeRawContent: false
			})
		).rejects.toThrow(/missing TAVILY_API_KEY/i);
	});

	it('rejects unsupported providers before execution', () => {
		env.WEB_SEARCH_PROVIDER = 'exa';
		resetWebSearchProviderCache();
		expect(() => getWebSearchProvider()).toThrow(/not implemented yet/i);
	});
});
