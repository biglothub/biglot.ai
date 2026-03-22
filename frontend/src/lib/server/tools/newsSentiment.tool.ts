// News Sentiment Tool — T-602
// Tool: get_news_sentiment
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchNewsFeed } from '../data/newsFeed.data';

registerTool({
	name: 'get_news_sentiment',
	description:
		'Aggregate financial news from RSS feeds (CoinDesk, CoinTelegraph, Reuters, Yahoo Finance) and score sentiment using keyword analysis. Returns a sentiment gauge and headlines table. Optionally filter by trading symbol. Use when user asks about news, market sentiment, recent headlines, or what is in the news about a specific asset.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Filter news for a specific symbol (e.g. BTC, ETH, BTCUSDT). Omit for general market news.'
			},
			max_items: {
				type: 'number',
				description: 'Maximum number of headlines to return (default: 20, max: 50)'
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol = typeof args.symbol === 'string' && args.symbol ? args.symbol.toUpperCase() : undefined;
		const maxItems = Math.min(50, typeof args.max_items === 'number' && args.max_items > 0 ? args.max_items : 20);

		const cacheKey = toolCache.generateKey('get_news_sentiment', { symbol, maxItems });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snapshot = await fetchNewsFeed(symbol, maxItems);

		const contentBlocks: ToolResult['contentBlocks'] = [];

		const title = symbol ? `News Sentiment — ${symbol}` : 'News Sentiment — Market Overview';

		// ── Gauge block ──────────────────────────────────────────────────────
		contentBlocks.push({
			type: 'gauge',
			title,
			value: snapshot.compositeScore,
			label: snapshot.sentimentLabel,
			thresholds: [
				{ value: 0,  color: '#ef4444', label: 'Very Bearish' },
				{ value: 25, color: '#f97316', label: 'Bearish'      },
				{ value: 40, color: '#eab308', label: 'Neutral'      },
				{ value: 60, color: '#84cc16', label: 'Bullish'      },
				{ value: 75, color: '#22c55e', label: 'Very Bullish' },
			],
		});

		// ── Sentiment breakdown metric card ──────────────────────────────────
		contentBlocks.push({
			type: 'metric_card',
			title: `Sentiment Breakdown${symbol ? ` — ${symbol}` : ''}`,
			metrics: [
				{
					label: 'Articles Analysed',
					value: String(snapshot.items.length),
					direction: 'neutral',
				},
				{
					label: 'Bullish',
					value: `${snapshot.positiveCount} (${snapshot.items.length > 0 ? Math.round(snapshot.positiveCount / snapshot.items.length * 100) : 0}%)`,
					direction: 'up',
				},
				{
					label: 'Bearish',
					value: `${snapshot.negativeCount} (${snapshot.items.length > 0 ? Math.round(snapshot.negativeCount / snapshot.items.length * 100) : 0}%)`,
					direction: 'down',
				},
				{
					label: 'Neutral',
					value: `${snapshot.neutralCount} (${snapshot.items.length > 0 ? Math.round(snapshot.neutralCount / snapshot.items.length * 100) : 0}%)`,
					direction: 'neutral',
				},
			],
		});

		// ── Headlines table ──────────────────────────────────────────────────
		if (snapshot.items.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: `Recent Headlines${symbol ? ` — ${symbol}` : ''}`,
				headers: ['Sentiment', 'Headline', 'Source'],
				rows: snapshot.items.slice(0, maxItems).map(item => [
					item.sentiment === 'positive' ? '▲ Bullish' :
					item.sentiment === 'negative' ? '▼ Bearish' :
					'— Neutral',
					item.title.slice(0, 80),
					item.source,
				]),
			});
		} else {
			contentBlocks.push({
				type: 'metric_card',
				title: 'No Headlines Found',
				metrics: [{
					label: symbol ? `No recent news for ${symbol}` : 'No news available',
					value: 'RSS feeds may be unavailable',
					direction: 'neutral',
				}],
			});
		}

		const bulletSummary = snapshot.items.length > 0
			? `${snapshot.positiveCount} bullish, ${snapshot.negativeCount} bearish, ${snapshot.neutralCount} neutral articles`
			: 'No headlines fetched — RSS feeds may be temporarily unavailable';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `News sentiment${symbol ? ` for ${symbol}` : ''}: ${snapshot.sentimentLabel} (score ${snapshot.compositeScore}/100). ${bulletSummary}.`,
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
