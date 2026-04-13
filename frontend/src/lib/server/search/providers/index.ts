import { env } from '$env/dynamic/private';
import { TavilyWebSearchProvider } from './tavilyProvider';
import type { WebSearchProvider } from './types';

let providerCache: WebSearchProvider | null = null;

export function resetWebSearchProviderCache(): void {
	providerCache = null;
}

export function getWebSearchProvider(): WebSearchProvider {
	if (providerCache) return providerCache;

	const providerName = env.WEB_SEARCH_PROVIDER?.trim().toLowerCase() || 'tavily';
	switch (providerName) {
		case 'tavily':
			providerCache = new TavilyWebSearchProvider();
			return providerCache;
		case 'exa':
		case 'perplexity':
		case 'firecrawl':
			throw new Error(`Web search provider "${providerName}" is not implemented yet in BigLot.ai`);
		default:
			throw new Error(`Unsupported web search provider "${providerName}"`);
	}
}
