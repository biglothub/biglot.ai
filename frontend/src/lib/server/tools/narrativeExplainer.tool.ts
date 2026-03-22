// Narrative Market Explainer Tool — T-1305
// Tool: explain_market — answers "Why is BTC dropping?" style questions

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getClientWithFallback } from '../aiProvider.server';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';
import {
	gatherNarrativeData,
	buildNarrativePrompt,
	parseNarrativeResponse,
	buildFallbackSections,
	buildNarrativeReportBlock,
} from '../data/narrativeExplainer.data';

registerTool({
	name: 'explain_market',
	description:
		'Narrative Market Explainer — answers "Why is BTC dropping?" style questions. Collects recent price action, news headlines, macro events (DXY, yields, SPX), on-chain flows, sentiment, and derivatives positioning. AI synthesizes a coherent bilingual (Thai/English) narrative with 4 structured sections. Returns ResearchReportBlock (Price Action Summary, Key Drivers, Supporting Data, What to Watch Next, Thai Summary) + SourcesBlock. Use when user asks why a market is moving, wants a market narrative, or needs context for current price action.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description:
					'Trading pair symbol (e.g. BTCUSDT, ETHUSDT, SOLUSDT). Default: BTCUSDT',
			},
			question: {
				type: 'string',
				description:
					'The specific question to answer (e.g. "Why is BTC dropping?", "What is driving this rally?"). Focuses the narrative.',
			},
			timeframe: {
				type: 'string',
				description: 'Analysis timeframe: 1h, 4h, 1d. Default: 1d',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol =
			typeof args.symbol === 'string' && args.symbol ? args.symbol : 'BTCUSDT';
		const symbol = normalizeBinanceSymbol(rawSymbol);
		const question =
			typeof args.question === 'string' && args.question
				? args.question
				: `Why is ${symbol.replace(/USDT$/i, '')} moving?`;
		const timeframe =
			typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : '1d';

		const cacheKey = toolCache.generateKey('explain_market', { symbol, question, timeframe });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const startTime = Date.now();

		// ── Gather data ─────────────────────────────────────────────────────────
		const data = await gatherNarrativeData(symbol, timeframe, question);
		const prompt = buildNarrativePrompt(data);

		// ── LLM synthesis ───────────────────────────────────────────────────────
		let sections = null;
		try {
			const { client, apiModel } = getClientWithFallback('gpt-4o', [
				'claude-sonnet',
				'deepseek',
			]);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.4,
				max_tokens: 1500,
				messages: [{ role: 'user', content: prompt }],
			});
			const rawText = completion.choices[0]?.message?.content ?? '';
			sections = parseNarrativeResponse(rawText);
		} catch {
			// LLM unavailable — fallback below
		}

		if (!sections) {
			sections = buildFallbackSections(data);
		}

		const durationMs = Date.now() - startTime;

		// ── Build blocks ────────────────────────────────────────────────────────
		const reportBlock = buildNarrativeReportBlock(symbol, question, sections, durationMs);

		const firstDriver = sections.keyDrivers.split('\n')[0].replace(/^[-*]\s*/, '');
		const textSummary =
			`Market narrative for ${symbol}: ${sections.priceActionSummary.slice(0, 200)}. ` +
			`Key driver: ${firstDriver.replace(/\*\*/g, '').slice(0, 150)}`;

		const result: ToolResult = {
			success: true,
			contentBlocks: [reportBlock],
			textSummary,
			sources: [
				{ name: 'Binance OHLCV', accessedAt: Date.now() },
				{ name: 'News RSS Feeds', accessedAt: Date.now() },
				{ name: 'Yahoo Finance (Macro)', accessedAt: Date.now() },
				{ name: 'On-Chain Analytics', accessedAt: Date.now() },
				{ name: 'Binance Futures (Derivatives)', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
