import { env } from '$env/dynamic/private';
import type { WebSearchProvider, WebSearchRequest, WebSearchResponse } from './types';

const TAVILY_BASE = 'https://api.tavily.com';

type TavilyResult = {
	title: string;
	url: string;
	content: string;
	raw_content?: string;
	score: number;
	published_date?: string;
};

type TavilyResponse = {
	results?: TavilyResult[];
	answer?: string;
	query?: string;
};

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

export class TavilyWebSearchProvider implements WebSearchProvider {
	readonly name = 'tavily';

	async search(request: WebSearchRequest): Promise<WebSearchResponse> {
		const apiKey = env.TAVILY_API_KEY?.trim();
		if (!apiKey) {
			throw new Error('Web search provider "tavily" is not configured (missing TAVILY_API_KEY)');
		}

		const response = await fetch(`${TAVILY_BASE}/search`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				api_key: apiKey,
				query: request.query,
				search_depth: request.searchDepth,
				topic: request.searchType === 'news' ? 'news' : 'general',
				max_results: request.maxResults,
				include_answer: request.searchDepth === 'advanced' ? 'advanced' : true,
				include_raw_content: request.includeRawContent ? 'markdown' : false,
				...(request.timeRange ? { time_range: request.timeRange } : {})
			})
		});

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error');
			throw new Error(`Web search failed: ${response.status} ${errorText}`);
		}

		const data = (await response.json()) as TavilyResponse;
		const results = (data.results ?? []).map((result) => ({
			title: result.title,
			url: result.url,
			snippet: result.content,
			rawContent: result.raw_content,
			score: result.score,
			publishedAt: result.published_date,
			source: extractDomain(result.url)
		}));

		return {
			provider: this.name,
			query: data.query ?? request.query,
			answer: data.answer,
			results
		};
	}
}
