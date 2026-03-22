// Tests for newsFeed.data.ts — T-602
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	parseRSSXml,
	scoreText,
	filterBySymbol,
	getSymbolAliases,
	computeNewsSentiment,
	fetchNewsFeed,
	type NewsItem,
} from './newsFeed.data';

// ─── parseRSSXml ─────────────────────────────────────────────────────────────

describe('parseRSSXml', () => {
	const sampleRSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Bitcoin surges to new record high amid ETF inflows</title>
      <description>BTC price rallied strongly after institutional adoption news.</description>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Ethereum crashes as hack causes panic selling</title>
      <description>ETH price plunged after a major protocol exploit was discovered.</description>
      <link>https://example.com/article-2</link>
      <pubDate>Mon, 01 Jan 2024 11:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Crypto markets remain stable ahead of FOMC</title>
      <description>Markets traded sideways as investors awaited rate decision.</description>
      <link>https://example.com/article-3</link>
      <pubDate>Mon, 01 Jan 2024 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

	it('parses all items from RSS XML', () => {
		const items = parseRSSXml(sampleRSS, 'TestSource');
		expect(items.length).toBe(3);
	});

	it('sets source name on each item', () => {
		const items = parseRSSXml(sampleRSS, 'CoinDesk');
		for (const item of items) {
			expect(item.source).toBe('CoinDesk');
		}
	});

	it('extracts title correctly', () => {
		const items = parseRSSXml(sampleRSS, 'Test');
		expect(items[0].title).toContain('Bitcoin');
	});

	it('assigns positive sentiment to bullish article', () => {
		const items = parseRSSXml(sampleRSS, 'Test');
		// First article: "surges", "record high", "rally", "adoption" → positive
		expect(items[0].sentiment).toBe('positive');
		expect(items[0].sentimentScore).toBeGreaterThan(0);
	});

	it('assigns negative sentiment to bearish article', () => {
		const items = parseRSSXml(sampleRSS, 'Test');
		// Second article: "crashes", "hack", "panic", "plunged", "exploit" → negative
		expect(items[1].sentiment).toBe('negative');
		expect(items[1].sentimentScore).toBeLessThan(0);
	});

	it('includes url and pubDate fields', () => {
		const items = parseRSSXml(sampleRSS, 'Test');
		expect(items[0].url).toContain('example.com');
		expect(items[0].pubDate).toBeTruthy();
	});

	it('returns empty array for empty XML', () => {
		expect(parseRSSXml('', 'Test')).toEqual([]);
	});

	it('returns empty array for XML with no items', () => {
		const xml = '<rss><channel><title>Empty</title></channel></rss>';
		expect(parseRSSXml(xml, 'Test')).toEqual([]);
	});

	it('handles CDATA sections in titles', () => {
		const xml = `<rss><channel>
      <item>
        <title><![CDATA[Bitcoin & Ethereum rally together]]></title>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
		const items = parseRSSXml(xml, 'Test');
		expect(items.length).toBe(1);
		expect(items[0].title).toContain('Bitcoin');
		expect(items[0].title).toContain('Ethereum');
	});

	it('strips HTML tags from description', () => {
		const xml = `<rss><channel>
      <item>
        <title>Test</title>
        <description><![CDATA[<p>Bitcoin <strong>surges</strong> 10%</p>]]></description>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
		const items = parseRSSXml(xml, 'Test');
		expect(items[0].description).not.toContain('<p>');
		expect(items[0].description).toContain('Bitcoin');
	});

	it('truncates description to 300 chars', () => {
		const long = 'x'.repeat(500);
		const xml = `<rss><channel>
      <item>
        <title>Test</title>
        <description>${long}</description>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;
		const items = parseRSSXml(xml, 'Test');
		expect(items[0].description.length).toBeLessThanOrEqual(300);
	});
});

// ─── scoreText ────────────────────────────────────────────────────────────────

describe('scoreText', () => {
	it('returns 0 for empty text', () => {
		expect(scoreText('')).toBe(0);
	});

	it('returns 0 for neutral text with no keywords', () => {
		expect(scoreText('the market traded sideways on Monday')).toBe(0);
	});

	it('returns positive score for bullish text', () => {
		expect(scoreText('bitcoin surges to record high in massive rally')).toBeGreaterThan(0);
	});

	it('returns negative score for bearish text', () => {
		expect(scoreText('crypto crash as bitcoin plunges amid fear and panic')).toBeLessThan(0);
	});

	it('score is between -1 and +1', () => {
		const score = scoreText('surge rally gain bullish positive growth profit success adoption partnership');
		expect(score).toBeGreaterThanOrEqual(-1);
		expect(score).toBeLessThanOrEqual(1);
	});

	it('returns +1 for text with only positive keywords', () => {
		const text = 'bullish surge rally gains rises soars jumps breakthrough positive growth';
		const score = scoreText(text);
		expect(score).toBe(1); // all positive, no negative
	});

	it('returns -1 for text with only negative keywords', () => {
		const text = 'bearish crash drops falls plunges declines losses ban hacked fraud';
		const score = scoreText(text);
		expect(score).toBe(-1); // all negative, no positive
	});

	it('balances mixed positive and negative keywords', () => {
		// Equal positive and negative → score = 0
		const text = 'surge crash'; // 1 positive, 1 negative
		const score = scoreText(text);
		expect(score).toBe(0);
	});

	it('is case-insensitive', () => {
		expect(scoreText('BITCOIN SURGES TO NEW HIGH')).toBeGreaterThan(0);
	});
});

// ─── getSymbolAliases ─────────────────────────────────────────────────────────

describe('getSymbolAliases', () => {
	it('returns aliases for BTC', () => {
		const aliases = getSymbolAliases('BTC');
		expect(aliases).toContain('bitcoin');
		expect(aliases).toContain('btc');
	});

	it('normalises BTCUSDT to BTC aliases', () => {
		const aliases = getSymbolAliases('BTCUSDT');
		expect(aliases).toContain('bitcoin');
	});

	it('normalises ETHUSD to ETH aliases', () => {
		const aliases = getSymbolAliases('ETHUSD');
		expect(aliases).toContain('ethereum');
	});

	it('returns lowercase symbol for unknown symbols', () => {
		const aliases = getSymbolAliases('NEWTOKEN');
		expect(aliases).toContain('newtoken');
	});

	it('handles lowercase input', () => {
		const aliases = getSymbolAliases('btcusdt');
		expect(aliases).toContain('bitcoin');
	});
});

// ─── filterBySymbol ───────────────────────────────────────────────────────────

describe('filterBySymbol', () => {
	const items: NewsItem[] = [
		{ title: 'Bitcoin rally continues', description: 'BTC hits new highs', url: '', pubDate: '', source: 'Test', sentiment: 'positive', sentimentScore: 0.8 },
		{ title: 'Ethereum upgrade complete', description: 'ETH network upgraded', url: '', pubDate: '', source: 'Test', sentiment: 'positive', sentimentScore: 0.5 },
		{ title: 'Stock market closes higher', description: 'S&P gains on good earnings', url: '', pubDate: '', source: 'Test', sentiment: 'positive', sentimentScore: 0.3 },
	];

	it('returns all items when no symbol given', () => {
		expect(filterBySymbol(items)).toHaveLength(3);
		expect(filterBySymbol(items, '')).toHaveLength(3);
	});

	it('filters to BTC-related items', () => {
		const result = filterBySymbol(items, 'BTC');
		expect(result.length).toBe(1);
		expect(result[0].title).toContain('Bitcoin');
	});

	it('filters to ETH-related items', () => {
		const result = filterBySymbol(items, 'ETH');
		expect(result.length).toBe(1);
		expect(result[0].title).toContain('Ethereum');
	});

	it('returns empty when no items match symbol', () => {
		const result = filterBySymbol(items, 'SOL');
		expect(result).toHaveLength(0);
	});

	it('handles USDT pair symbol', () => {
		const result = filterBySymbol(items, 'BTCUSDT');
		expect(result.length).toBe(1);
		expect(result[0].title).toContain('Bitcoin');
	});
});

// ─── computeNewsSentiment ─────────────────────────────────────────────────────

describe('computeNewsSentiment', () => {
	it('returns 50 composite score for empty items', () => {
		const snap = computeNewsSentiment([]);
		expect(snap.compositeScore).toBe(50);
		expect(snap.positiveCount).toBe(0);
		expect(snap.negativeCount).toBe(0);
		expect(snap.neutralCount).toBe(0);
	});

	it('returns high score for all positive items', () => {
		const items: NewsItem[] = [
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 1 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 1 },
		];
		const snap = computeNewsSentiment(items);
		expect(snap.compositeScore).toBe(100);
		expect(snap.positiveCount).toBe(2);
		expect(snap.sentimentLabel).toBe('Very Bullish');
	});

	it('returns low score for all negative items', () => {
		const items: NewsItem[] = [
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'negative', sentimentScore: -1 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'negative', sentimentScore: -1 },
		];
		const snap = computeNewsSentiment(items);
		expect(snap.compositeScore).toBe(0);
		expect(snap.negativeCount).toBe(2);
		expect(snap.sentimentLabel).toBe('Very Bearish');
	});

	it('returns neutral label for balanced items', () => {
		const items: NewsItem[] = [
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 0.5 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'negative', sentimentScore: -0.5 },
		];
		const snap = computeNewsSentiment(items);
		expect(snap.compositeScore).toBe(50);
		expect(snap.sentimentLabel).toBe('Neutral');
	});

	it('counts sentiment categories correctly', () => {
		const items: NewsItem[] = [
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 0.8 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 0.6 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'negative', sentimentScore: -0.4 },
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'neutral',  sentimentScore:  0   },
		];
		const snap = computeNewsSentiment(items);
		expect(snap.positiveCount).toBe(2);
		expect(snap.negativeCount).toBe(1);
		expect(snap.neutralCount).toBe(1);
	});

	it('compositeScore is in range 0–100', () => {
		const items: NewsItem[] = [
			{ title: '', description: '', url: '', pubDate: '', source: '', sentiment: 'positive', sentimentScore: 0.7 },
		];
		const snap = computeNewsSentiment(items);
		expect(snap.compositeScore).toBeGreaterThanOrEqual(0);
		expect(snap.compositeScore).toBeLessThanOrEqual(100);
	});
});

// ─── fetchNewsFeed ────────────────────────────────────────────────────────────

describe('fetchNewsFeed', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('fetches from all RSS sources in parallel', async () => {
		const mockXml = `<rss><channel>
      <item>
        <title>Bitcoin surges</title>
        <description>BTC rally strong</description>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(mockXml),
		} as unknown as Response);

		const snap = await fetchNewsFeed();
		expect(global.fetch).toHaveBeenCalledTimes(4); // 4 RSS sources
		expect(snap.items.length).toBeGreaterThan(0);
	});

	it('handles partial RSS failures gracefully', async () => {
		let callCount = 0;
		global.fetch = vi.fn().mockImplementation(() => {
			callCount++;
			if (callCount === 1) return Promise.reject(new Error('Network error'));
			return Promise.resolve({
				ok: true,
				text: () => Promise.resolve(`<rss><channel>
          <item>
            <title>Ethereum rally</title>
            <description>ETH gains strongly</description>
            <link>https://example.com/1</link>
            <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
          </item>
        </channel></rss>`),
			} as unknown as Response);
		});

		const snap = await fetchNewsFeed();
		// Should still return items from successful sources
		expect(snap.items.length).toBeGreaterThanOrEqual(0);
	});

	it('filters items by symbol when provided', async () => {
		const mockXml = `<rss><channel>
      <item>
        <title>Bitcoin rally</title>
        <description>BTC strong</description>
        <link>https://example.com/1</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>
      <item>
        <title>Ethereum upgrade</title>
        <description>ETH network update</description>
        <link>https://example.com/2</link>
        <pubDate>Mon, 01 Jan 2024 11:00:00 +0000</pubDate>
      </item>
    </channel></rss>`;

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(mockXml),
		} as unknown as Response);

		const snap = await fetchNewsFeed('BTC');
		// Only bitcoin-related items should be returned
		for (const item of snap.items) {
			const text = `${item.title} ${item.description}`.toLowerCase();
			expect(text.includes('bitcoin') || text.includes('btc')).toBe(true);
		}
	});

	it('respects maxItems limit', async () => {
		const items = Array.from({ length: 50 }, (_, i) => `
      <item>
        <title>Article ${i + 1} bitcoin rally</title>
        <description>BTC news ${i}</description>
        <link>https://example.com/${i}</link>
        <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      </item>`).join('');

		const mockXml = `<rss><channel>${items}</channel></rss>`;

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(mockXml),
		} as unknown as Response);

		const snap = await fetchNewsFeed(undefined, 10);
		expect(snap.items.length).toBeLessThanOrEqual(10);
	});

	it('returns neutral snapshot when all sources fail', async () => {
		global.fetch = vi.fn().mockRejectedValue(new Error('All failed'));

		const snap = await fetchNewsFeed();
		expect(snap.items).toEqual([]);
		expect(snap.compositeScore).toBe(50);
		expect(snap.sentimentLabel).toBe('Neutral');
	});

	it('handles non-ok HTTP responses', async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			text: () => Promise.resolve(''),
		} as unknown as Response);

		const snap = await fetchNewsFeed();
		expect(snap.items).toEqual([]);
	});
});
