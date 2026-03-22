// News Feed Data — T-602
// Aggregates RSS feeds from crypto/financial news sources, scores sentiment via keywords.

// ─── Types ────────────────────────────────────────────────────────────────────

export type NewsItem = {
	title: string;
	description: string;
	url: string;
	pubDate: string;
	source: string;
	sentiment: 'positive' | 'negative' | 'neutral';
	sentimentScore: number; // -1 (bearish) to +1 (bullish)
};

export type NewsFeedSnapshot = {
	items: NewsItem[];
	positiveCount: number;
	negativeCount: number;
	neutralCount: number;
	compositeScore: number; // 0–100 (50 = neutral)
	sentimentLabel: string;
};

// ─── RSS sources ──────────────────────────────────────────────────────────────

export const RSS_SOURCES: { name: string; url: string; category: 'crypto' | 'macro' | 'general' }[] = [
	{ name: 'CoinDesk',        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',         category: 'crypto'   },
	{ name: 'CoinTelegraph',   url: 'https://cointelegraph.com/rss',                            category: 'crypto'   },
	{ name: 'Reuters Business',url: 'https://feeds.reuters.com/reuters/businessNews',           category: 'macro'    },
	{ name: 'Yahoo Finance',   url: 'https://finance.yahoo.com/news/rssindex',                  category: 'general'  },
];

// ─── Sentiment keyword lists ───────────────────────────────────────────────────

const POSITIVE_WORDS = [
	'bullish', 'surge', 'rally', 'gains', 'rises', 'risen', 'soars', 'jumps',
	'breakthrough', 'positive', 'growth', 'profits', 'success', 'adoption',
	'partnership', 'upgrade', 'breakout', 'momentum', 'rebound', 'recovery',
	'optimistic', 'approval', 'milestone', 'inflows', 'outperforms', 'strong',
	'record high', 'all-time high', 'bull', 'launch', 'expanding',
];

const NEGATIVE_WORDS = [
	'bearish', 'crash', 'drops', 'falls', 'plunges', 'declines', 'losses',
	'ban', 'hacked', 'hack', 'fraud', 'lawsuit', 'dumps', 'capitulation',
	'fear', 'panic', 'collapse', 'liquidation', 'outflows', 'underperforms',
	'concern', 'risk', 'volatility', 'warning', 'probe', 'investigation',
	'exploit', 'scam', 'crackdown', 'fail', 'bear', 'downgrade', 'selloff',
];

// ─── Symbol aliases ────────────────────────────────────────────────────────────

const SYMBOL_ALIASES: Record<string, string[]> = {
	BTC:     ['bitcoin', 'btc'],
	ETH:     ['ethereum', 'eth', 'ether'],
	SOL:     ['solana', 'sol'],
	BNB:     ['bnb', 'binance coin', 'binance'],
	XRP:     ['xrp', 'ripple'],
	DOGE:    ['doge', 'dogecoin'],
	ADA:     ['ada', 'cardano'],
	AVAX:    ['avax', 'avalanche'],
	LINK:    ['link', 'chainlink'],
	DOT:     ['dot', 'polkadot'],
	MATIC:   ['matic', 'polygon'],
	UNI:     ['uni', 'uniswap'],
	GOLD:    ['gold', 'xau'],
	SILVER:  ['silver', 'xag'],
	SPY:     ['spy', 's&p 500', 's&p500', 'sp500'],
	OIL:     ['oil', 'crude', 'wti', 'brent'],
	USD:     ['dollar', 'usd', 'dxy'],
};

// ─── RSS parsing ──────────────────────────────────────────────────────────────

/** Extract tag content from RSS XML, supporting CDATA. */
function extractTag(xml: string, tag: string): string {
	const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
	const m = xml.match(re);
	if (!m) return '';
	return m[1].trim();
}

/** Strip HTML tags and decode common HTML entities from a string. */
function stripHtml(text: string): string {
	return text
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Parse RSS XML string into an array of raw news items for a given source.
 * Exported for testing.
 */
export function parseRSSXml(xml: string, sourceName: string): NewsItem[] {
	const items: NewsItem[] = [];
	const itemRe = /<item>([\s\S]*?)<\/item>/g;
	let match: RegExpExecArray | null;

	while ((match = itemRe.exec(xml)) !== null) {
		const itemXml = match[1];
		const title = stripHtml(extractTag(itemXml, 'title'));
		if (!title) continue;

		const description = stripHtml(extractTag(itemXml, 'description')).slice(0, 300);
		const url = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
		const pubDate = extractTag(itemXml, 'pubDate');

		const text = `${title} ${description}`.toLowerCase();
		const sentimentScore = scoreText(text);
		const sentiment: NewsItem['sentiment'] =
			sentimentScore > 0.1 ? 'positive' :
			sentimentScore < -0.1 ? 'negative' :
			'neutral';

		items.push({ title, description, url, pubDate, source: sourceName, sentiment, sentimentScore });
	}

	return items;
}

// ─── Sentiment scoring ────────────────────────────────────────────────────────

/**
 * Score text sentiment from -1 (bearish) to +1 (bullish) using keyword counting.
 * Exported for testing.
 */
export function scoreText(text: string): number {
	const lower = text.toLowerCase();
	let positive = 0;
	let negative = 0;

	for (const word of POSITIVE_WORDS) {
		if (lower.includes(word)) positive++;
	}
	for (const word of NEGATIVE_WORDS) {
		if (lower.includes(word)) negative++;
	}

	const total = positive + negative;
	if (total === 0) return 0;
	return (positive - negative) / total;
}

// ─── Symbol filtering ─────────────────────────────────────────────────────────

/**
 * Get aliases for a symbol. Normalises USDT pairs (BTCUSDT → BTC).
 * Exported for testing.
 */
export function getSymbolAliases(symbol: string): string[] {
	// Normalise: strip USDT/USD suffix
	const normalized = symbol.toUpperCase().replace(/USDT?$/, '');
	return SYMBOL_ALIASES[normalized] ?? [normalized.toLowerCase()];
}

/**
 * Filter news items to those relevant to a given trading symbol.
 * Returns all items if symbol is empty/undefined.
 * Exported for testing.
 */
export function filterBySymbol(items: NewsItem[], symbol?: string): NewsItem[] {
	if (!symbol) return items;
	const aliases = getSymbolAliases(symbol);
	return items.filter(item => {
		const text = `${item.title} ${item.description}`.toLowerCase();
		return aliases.some(alias => text.includes(alias));
	});
}

// ─── Composite sentiment ──────────────────────────────────────────────────────

/**
 * Compute composite sentiment from a list of news items.
 * compositeScore: 0–100 (0=max bearish, 50=neutral, 100=max bullish).
 * Exported for testing.
 */
export function computeNewsSentiment(items: NewsItem[]): NewsFeedSnapshot {
	const positiveCount = items.filter(i => i.sentiment === 'positive').length;
	const negativeCount = items.filter(i => i.sentiment === 'negative').length;
	const neutralCount  = items.filter(i => i.sentiment === 'neutral').length;

	let compositeScore = 50;
	if (items.length > 0) {
		const avgScore = items.reduce((s, i) => s + i.sentimentScore, 0) / items.length;
		compositeScore = Math.round(((avgScore + 1) / 2) * 100);
	}

	const sentimentLabel =
		compositeScore >= 75 ? 'Very Bullish' :
		compositeScore >= 60 ? 'Bullish' :
		compositeScore >= 40 ? 'Neutral' :
		compositeScore >= 25 ? 'Bearish' :
		'Very Bearish';

	return { items, positiveCount, negativeCount, neutralCount, compositeScore, sentimentLabel };
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

/** Fetch a single RSS feed URL and return raw XML or null on failure. */
async function fetchRSSFeed(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			headers: { 'Accept': 'application/rss+xml, application/xml, text/xml, */*', 'User-Agent': 'BigLot.ai/1.0' },
			signal: AbortSignal.timeout(8_000),
		});
		if (!response.ok) return null;
		return await response.text();
	} catch {
		return null;
	}
}

/**
 * Fetch news from all configured RSS sources, optionally filtered by symbol.
 * maxItems: maximum total items to return (sorted by newest first).
 */
export async function fetchNewsFeed(symbol?: string, maxItems = 30): Promise<NewsFeedSnapshot> {
	const fetches = RSS_SOURCES.map(src =>
		fetchRSSFeed(src.url).then(xml => {
			if (!xml) return [] as NewsItem[];
			return parseRSSXml(xml, src.name);
		})
	);

	const results = await Promise.allSettled(fetches);
	const allItems: NewsItem[] = [];

	for (const result of results) {
		if (result.status === 'fulfilled') {
			allItems.push(...result.value);
		}
	}

	// Filter by symbol, sort newest first, limit
	const filtered = filterBySymbol(allItems, symbol);

	// Sort by pubDate descending (newest first), best-effort parse
	filtered.sort((a, b) => {
		const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
		const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
		return db - da;
	});

	return computeNewsSentiment(filtered.slice(0, maxItems));
}
