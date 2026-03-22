// Crypto Market Dominance Tool — T-902
// Tool: get_market_dominance

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	buildDominanceSnapshot,
	fmtMarketCap,
	type GlobalFetcher,
} from '../data/dominance.data';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Exported for testing ─────────────────────────────────────────────────────

export let _fetcherOverride: GlobalFetcher | undefined;

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_market_dominance',
	description:
		'Crypto market dominance & global stats — fetches BTC dominance %, ETH dominance %, altcoin dominance %, total market cap, 24h volume, and market cap change from CoinGecko. Classifies current market sentiment: BTC-led, ETH-led, Alt Season, or Risk-Off (high BTC dominance). 30 min cache. Use when asked about Bitcoin dominance, crypto market structure, alt season, or whether BTC or alts are leading.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	timeout: 15_000,
	execute: async (): Promise<ToolResult> => {
		const cacheKey = 'get_market_dominance:global';
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		let snapshot;
		try {
			snapshot = await buildDominanceSnapshot(_fetcherOverride);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to fetch market dominance data';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'get_market_dominance' }],
				textSummary: `Error: ${msg}`,
			};
		}

		// ── MetricCard ──────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Crypto Market Dominance — Global Overview`,
			metrics: [
				{
					label:     'BTC Dominance',
					value:     `${snapshot.btcDominance.toFixed(2)}%`,
					change:    snapshot.btcDominance > 50 ? 'Majority of market cap' : 'Below 50% threshold',
					direction: snapshot.btcDominance > 50 ? 'up' : 'neutral',
				},
				{
					label:     'ETH Dominance',
					value:     `${snapshot.ethDominance.toFixed(2)}%`,
					change:    snapshot.ethDominance > 20 ? 'Strong ETH presence' : 'ETH following BTC',
					direction: snapshot.ethDominance > 20 ? 'up' : 'neutral',
				},
				{
					label:     'Altcoin Dominance',
					value:     `${snapshot.altDominance.toFixed(2)}%`,
					change:    snapshot.altDominance > 40 ? 'Alt season territory' : 'Alts subdued',
					direction: snapshot.altDominance > 40 ? 'up' : 'down',
				},
				{
					label:     'Total Market Cap',
					value:     fmtMarketCap(snapshot.totalMarketCapUsd),
					change:    `${snapshot.marketCapChangePercent24h >= 0 ? '+' : ''}${snapshot.marketCapChangePercent24h.toFixed(2)}% (24h)`,
					direction: snapshot.marketCapChangePercent24h >= 0 ? 'up' : 'down',
				},
				{
					label:     '24h Volume',
					value:     fmtMarketCap(snapshot.totalVolume24hUsd),
					change:    `${snapshot.activeCryptocurrencies.toLocaleString()} active cryptocurrencies`,
					direction: 'neutral',
				},
				{
					label:     'Market Sentiment',
					value:     snapshot.sentimentLabel,
					change:    snapshot.sentimentDescription,
					direction: snapshot.sentiment === 'alt_season' ? 'up' : snapshot.sentiment === 'risk_off' ? 'down' : 'neutral',
				},
			],
		};

		// ── Dominance breakdown table ───────────────────────────────────────────
		const rows: string[][] = [
			['Bitcoin (BTC)',  `${snapshot.btcDominance.toFixed(2)}%`,  snapshot.btcDominance > 55 ? 'Risk-off dominance' : snapshot.btcDominance > 50 ? 'Majority hold' : 'Below majority'],
			['Ethereum (ETH)', `${snapshot.ethDominance.toFixed(2)}%`,  snapshot.ethDominance > 20 ? 'ETH-led rotation' : 'Following BTC'],
			['Altcoins',       `${snapshot.altDominance.toFixed(2)}%`,  snapshot.altDominance > 40 ? 'Alt season active' : 'Alt season threshold: 40%'],
		];

		const regimes: Array<[string, string, string]> = [
			['BTC-Led',    'BTC dom 40–55%, stable',    snapshot.sentiment === 'btc_led'    ? '← Current' : ''],
			['ETH-Led',    'ETH dom > 20%, BTC < 48%', snapshot.sentiment === 'eth_led'    ? '← Current' : ''],
			['Alt Season', 'Alt dom > 40% (BTC < 40%)', snapshot.sentiment === 'alt_season' ? '← Current' : ''],
			['Risk-Off',   'BTC dom > 55%',             snapshot.sentiment === 'risk_off'   ? '← Current' : ''],
		];

		const tableBlock: TableBlock = {
			type:    'table',
			title:   'Market Dominance Breakdown',
			headers: ['Asset', 'Dominance', 'Signal'],
			rows,
		};

		const regimeTable: TableBlock = {
			type:    'table',
			title:   'Market Regime Classification',
			headers: ['Regime', 'Condition', 'Status'],
			rows:    regimes,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock, regimeTable];

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Global crypto market: BTC dominance ${snapshot.btcDominance.toFixed(1)}%, ETH ${snapshot.ethDominance.toFixed(1)}%, alts ${snapshot.altDominance.toFixed(1)}%. Total market cap: ${fmtMarketCap(snapshot.totalMarketCapUsd)} (${snapshot.marketCapChangePercent24h >= 0 ? '+' : ''}${snapshot.marketCapChangePercent24h.toFixed(2)}% 24h). Sentiment: ${snapshot.sentimentLabel}. ${snapshot.sentimentDescription}`,
			sources: [{
				name: 'CoinGecko Global',
				url:  'https://api.coingecko.com/api/v3/global',
				accessedAt: Date.now(),
			}],
		};

		toolCache.set(cacheKey, result, 30 * 60_000); // 30 min cache
		return result;
	},
});
