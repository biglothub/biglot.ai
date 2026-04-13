// Web Search Tool - search the web for news, analysis, and market events
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getWebSearchProvider } from '../search/providers';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

registerTool({
	name: 'web_search',
	description:
		'Search the web for real-time news, market analysis, economic events, and any information not available through other tools. Use this when the user asks about news, events (FOMC, NFP, CPI), market sentiment from articles, or any question requiring up-to-date web information.',
	parameters: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description:
					'Search query. Be specific for better results (e.g. "gold price FOMC impact March 2026" instead of just "gold news")'
			},
			search_type: {
				type: 'string',
				enum: ['news', 'general'],
				description: 'Type of search: "news" for recent news articles, "general" for broader web results (default: general)'
			},
			max_results: {
				type: 'number',
				description: 'Maximum number of results to return (default: 5, max: 10)'
			},
			search_depth: {
				type: 'string',
				enum: ['basic', 'advanced'],
				description: 'Search depth: "basic" (1 credit) or "advanced" for higher relevance with multiple semantic snippets per URL (2 credits). Use "advanced" for deep research. (default: basic)'
			},
			time_range: {
				type: 'string',
				enum: ['d', 'w', 'm', 'y'],
				description: 'Filter results by recency: "d" (past day), "w" (past week), "m" (past month), "y" (past year). Useful for finding recent news/events.'
			},
			include_raw_content: {
				type: 'boolean',
				description: 'If true, returns full article content in markdown format (not just snippets). Use for deep research when you need complete article text. (default: false)'
			}
		},
		required: ['query']
	},
	timeout: 15_000,
	execute: async (args): Promise<ToolResult> => {
		const query = String(args.query || '').trim();
		const searchType = String(args.search_type || 'general');
		const maxResults = Math.min(Math.max(Number(args.max_results) || 5, 1), 10);
		const searchDepth = args.search_depth === 'advanced' ? 'advanced' : 'basic';
		const timeRange = ['d', 'w', 'm', 'y'].includes(String(args.time_range)) ? String(args.time_range) : undefined;
		const includeRawContent = Boolean(args.include_raw_content);

		if (!query) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Search query is required', tool: 'web_search' }],
				textSummary: 'Error: Search query is required'
			};
		}

		const cacheKey = toolCache.generateKey('web_search', { query, searchType, maxResults, searchDepth, timeRange, includeRawContent });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		try {
			const provider = getWebSearchProvider();
			const data = await provider.search({
				query,
				searchType: searchType === 'news' ? 'news' : 'general',
				maxResults,
				searchDepth,
				timeRange: timeRange as 'd' | 'w' | 'm' | 'y' | undefined,
				includeRawContent
			});
			const results = data.results || [];

			if (results.length === 0) {
				return {
					success: true,
					contentBlocks: [{ type: 'text', content: `No results found for "${query}".` }],
					textSummary: `No web results found for "${query}".`
				};
			}

			// Build news_list block for news searches, table for general
			if (searchType === 'news') {
				const result: ToolResult = {
					success: true,
					contentBlocks: [
						{
							type: 'news_list',
							items: results.map((r) => ({
								title: r.title,
								url: r.url,
								source: r.source,
								publishedAt: r.publishedAt || new Date().toISOString(),
								sentiment: undefined
							}))
						}
					],
					textSummary: buildTextSummary(query, results, data.answer),
					sources: results.map((r) => ({
						name: r.source,
						url: r.url,
						accessedAt: Date.now()
					}))
				};
				toolCache.set(cacheKey, result, CACHE_TTL);
				return result;
			}

			// General search: table with title + source + snippet
			const result: ToolResult = {
				success: true,
				contentBlocks: [
					{
						type: 'table',
						title: `Web Results: "${query}"`,
						headers: ['Title', 'Source', 'Snippet'],
						rows: results.map((r) => [
							r.title,
							r.source,
							truncate(r.snippet, 150)
						])
					}
				],
				textSummary: buildTextSummary(query, results, data.answer),
				sources: results.map((r) => ({
					name: r.source,
					url: r.url,
					accessedAt: Date.now()
				}))
			};
			toolCache.set(cacheKey, result, CACHE_TTL);
			return result;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : 'Web search failed';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message, tool: 'web_search' }],
				textSummary: `Error: ${message}`
			};
		}
	}
});

function extractDomain(url: string): string {
	try {
		const hostname = new URL(url).hostname;
		return hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

function truncate(text: string, maxLen: number): string {
	if (!text) return '';
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen).trimEnd() + '...';
}

function buildTextSummary(
	query: string,
	results: Array<{ title: string; url: string; snippet: string; rawContent?: string; source: string }>,
	answer?: string
): string {
	const lines: string[] = [];

	if (answer) {
		lines.push(`Summary for "${query}": ${answer}`);
		lines.push('');
	}

	lines.push(`Found ${results.length} results:`);
	for (const r of results) {
		if (r.rawContent) {
			lines.push(`\n--- ${r.title} (${r.source}) ---`);
			lines.push(truncate(r.rawContent, 2000));
		} else {
			lines.push(`- ${r.title} (${r.source}): ${truncate(r.snippet, 200)}`);
		}
	}

	return lines.join('\n');
}
