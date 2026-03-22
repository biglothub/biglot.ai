// Multi-Exchange Price Aggregator — T-1205
// Tool: compare_exchanges
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	buildMultiExchangeSnapshot,
	extractBaseSymbol,
} from '../data/multiExchange.data';

const CACHE_TTL_MS = 30_000; // 30s — price data should be fresh

registerTool({
	name: 'compare_exchanges',
	description:
		'Compare spot price and volume for a crypto symbol across Binance, Bybit, OKX, and Coinbase. Shows price spread between exchanges, volume distribution, best buy/sell venue, and flags arbitrage opportunities when spread exceeds the 0.1% fee threshold. Use when the user asks about exchange price differences, best exchange to buy/sell, or arbitrage opportunities.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description:
					'Crypto symbol to compare (e.g. BTC, ETH, SOL, BTCUSDT, BTC/USDT)'
			}
		},
		required: ['symbol']
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol = String(args.symbol || '').trim();
		if (!rawSymbol) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'compare_exchanges' }],
				textSummary: 'Error: symbol is required.'
			};
		}

		const base = extractBaseSymbol(rawSymbol);
		if (!base) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not parse symbol: "${rawSymbol}"`, tool: 'compare_exchanges' }],
				textSummary: `Error: invalid symbol "${rawSymbol}".`
			};
		}

		const cacheKey = toolCache.generateKey('compare_exchanges', { base });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await buildMultiExchangeSnapshot(rawSymbol);

		const validQuotes = snap.quotes.filter((q) => !q.error && q.price > 0);
		const failedQuotes = snap.quotes.filter((q) => q.error);

		if (validQuotes.length === 0) {
			const errors = failedQuotes.map((q) => `${q.exchange}: ${q.error}`).join('; ');
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Failed to fetch ${base} prices from any exchange. ${errors}`,
					tool: 'compare_exchanges'
				}],
				textSummary: `Error: No exchange data available for ${base}.`
			};
		}

		// ─── Format helpers ───────────────────────────────────────────────────

		const fmtPrice = (p: number): string =>
			p >= 1000
				? p.toLocaleString('en-US', { maximumFractionDigits: 2 })
				: p.toFixed(p >= 1 ? 4 : 8);

		const fmtVol = (v: number): string => {
			if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
			if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
			if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
			return `$${v.toFixed(2)}`;
		};

		const fmtPct = (p: number): string => `${p >= 0 ? '+' : ''}${p.toFixed(4)}%`;

		// ─── MetricCard ───────────────────────────────────────────────────────

		const arbDirection: 'up' | 'down' | 'neutral' = snap.arbOpportunity
			? 'up'
			: snap.arbPct < 0
				? 'down'
				: 'neutral';

		const metricCard: ToolResult['contentBlocks'][number] = {
			type: 'metric_card',
			title: `${base} — Multi-Exchange Comparison`,
			metrics: [
				{
					label: 'Best Buy Venue',
					value: snap.bestBuyVenue,
					change: 'Lowest ask',
					direction: 'up'
				},
				{
					label: 'Best Sell Venue',
					value: snap.bestSellVenue,
					change: 'Highest bid',
					direction: 'up'
				},
				{
					label: 'Max Price Spread',
					value: `${snap.maxSpreadPct.toFixed(4)}%`,
					direction: snap.maxSpreadPct > 0.1 ? 'up' : 'neutral'
				},
				{
					label: 'Cross-Exchange Arb',
					value: fmtPct(snap.arbPct),
					change: snap.arbOpportunity ? 'Opportunity!' : 'Below fee threshold',
					direction: arbDirection
				},
				{
					label: 'Total 24h Volume',
					value: fmtVol(snap.totalVolume24hUsd),
					direction: 'neutral'
				},
				...(validQuotes.length < snap.quotes.length
					? [{
						label: 'Data Issues',
						value: `${failedQuotes.map((q) => q.exchange).join(', ')}`,
						change: 'Fetch failed',
						direction: 'down' as const
					}]
					: [])
			]
		};

		// ─── TableBlock: per-exchange breakdown ───────────────────────────────

		const tableHeaders = ['Exchange', 'Price', 'Bid', 'Ask', 'Spread', '24h Volume', 'Vol %'];
		const tableRows: (string | number)[][] = validQuotes
			.sort((a, b) => a.ask - b.ask) // sort by ask ascending (best buy first)
			.map((q) => {
				const volShare = snap.volumeDistribution.find((v) => v.exchange === q.exchange);
				return [
					q.exchange,
					fmtPrice(q.price),
					fmtPrice(q.bid),
					fmtPrice(q.ask),
					`${q.spreadPct.toFixed(4)}%`,
					fmtVol(q.volume24hUsd),
					volShare ? `${volShare.pct.toFixed(1)}%` : 'N/A'
				];
			});

		const tableBlock: ToolResult['contentBlocks'][number] = {
			type: 'table',
			title: `${base} Spot Price Comparison`,
			headers: tableHeaders,
			rows: tableRows
		};

		// ─── TextBlock: arb analysis ──────────────────────────────────────────

		let arbText: string;
		if (snap.arbOpportunity) {
			arbText =
				`**Arbitrage Opportunity Detected** — ${base}\n\n` +
				`Cross-exchange spread: **${fmtPct(snap.arbPct)}** (above 0.1% fee threshold)\n\n` +
				`Strategy: Buy ${base} on **${snap.bestBuyVenue}** (ask: $${fmtPrice(validQuotes.find((q) => q.exchange === snap.bestBuyVenue)?.ask ?? 0)}), ` +
				`sell on **${snap.bestSellVenue}** (bid: $${fmtPrice(validQuotes.find((q) => q.exchange === snap.bestSellVenue)?.bid ?? 0)}).\n\n` +
				`⚠️ Real arb requires accounting for withdrawal fees, transfer time, and execution risk. ` +
				`This is a theoretical spread — act quickly as it closes fast.`;
		} else if (snap.arbPct > 0) {
			arbText =
				`**No actionable arbitrage** — spread of **${fmtPct(snap.arbPct)}** is below the 0.1% typical taker fee threshold. ` +
				`${snap.bestBuyVenue} offers the best buy price and ${snap.bestSellVenue} the best sell price, ` +
				`but after fees the trade would be unprofitable.`;
		} else {
			arbText =
				`**No arbitrage** — prices are aligned across exchanges. ` +
				`Max spread: **${snap.maxSpreadPct.toFixed(4)}%**. ` +
				`${snap.bestBuyVenue} has the best buy price and ${snap.bestSellVenue} has the best sell price.`;
		}

		const textBlock: ToolResult['contentBlocks'][number] = {
			type: 'text',
			content: arbText
		};

		// ─── Build summary ────────────────────────────────────────────────────

		const priceRange = validQuotes.map((q) => `${q.exchange}: $${fmtPrice(q.price)}`).join(', ');
		const textSummary =
			`${base} prices — ${priceRange}. ` +
			`Max spread: ${snap.maxSpreadPct.toFixed(4)}%. ` +
			`Best buy: ${snap.bestBuyVenue}, Best sell: ${snap.bestSellVenue}. ` +
			`Arb: ${fmtPct(snap.arbPct)} (${snap.arbOpportunity ? 'OPPORTUNITY' : 'no opportunity'}). ` +
			`Total 24h volume: ${fmtVol(snap.totalVolume24hUsd)}.`;

		const result: ToolResult = {
			success: true,
			contentBlocks: [metricCard, tableBlock, textBlock],
			textSummary,
			sources: [
				{ name: 'Binance API', url: 'https://api.binance.com', accessedAt: Date.now() },
				{ name: 'Bybit API', url: 'https://api.bybit.com', accessedAt: Date.now() },
				{ name: 'OKX API', url: 'https://www.okx.com', accessedAt: Date.now() },
				{ name: 'Coinbase Exchange API', url: 'https://api.exchange.coinbase.com', accessedAt: Date.now() }
			]
		};

		toolCache.set(cacheKey, result, CACHE_TTL_MS);
		return result;
	}
});
