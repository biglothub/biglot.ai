export type WebSearchRequest = {
	query: string;
	searchType: 'news' | 'general';
	maxResults: number;
	searchDepth: 'basic' | 'advanced';
	timeRange?: 'd' | 'w' | 'm' | 'y';
	includeRawContent: boolean;
};

export type WebSearchResultItem = {
	title: string;
	url: string;
	snippet: string;
	rawContent?: string;
	score?: number;
	publishedAt?: string;
	source: string;
};

export type WebSearchResponse = {
	provider: string;
	query: string;
	answer?: string;
	results: WebSearchResultItem[];
};

export interface WebSearchProvider {
	readonly name: string;
	search(request: WebSearchRequest): Promise<WebSearchResponse>;
}
