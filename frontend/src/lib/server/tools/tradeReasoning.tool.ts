// Trade Reasoning Engine Tool — T-1301
// Tool: reason_trade — flagship AI feature, structured chain-of-thought trade analysis

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	gatherTradeEvidence,
	buildEvidenceSummary,
	parseReasoningResponse,
	buildReasoningBlock,
	type TradeEvidenceData,
} from '../data/tradeReasoning.data';
import { getClientWithFallback } from '../aiProvider.server';
import { buildIdeaSetup } from './tradeIdeas.tool';
import { fetchOHLCV, normalizeBinanceSymbol } from '../data/ohlcvProvider';
import { atr } from '../indicators/engine';
import type { ContentBlock, MetricCardBlock, ReasoningBlock } from '$lib/types/contentBlock';

// ─── LLM Prompt ───────────────────────────────────────────────────────────────

function buildReasoningPrompt(evidenceSummary: string, direction: string): string {
	return `You are an expert quantitative trading analyst. Analyse the following market evidence for a proposed ${direction.toUpperCase()} trade and produce a structured reasoning trace.

MARKET EVIDENCE:
${evidenceSummary}

Your task:
1. List evidence FOR the ${direction} thesis (bullish points for long, bearish for short)
2. List evidence AGAINST the thesis
3. Identify key unknowns or risks
4. Rate your confidence 1-10
5. Write a concise verdict (1-3 sentences)
6. Write a full chain-of-thought reasoning (step by step, ~200-400 words, markdown)

Respond ONLY with valid JSON in this exact structure:
{
  "evidenceFor": [
    {"category": "Regime", "tag": "bullish", "point": "ADX=34 trending_up with +DI dominant", "weight": 3},
    {"category": "Technicals", "tag": "bullish", "point": "MACD bullish crossover confirmed", "weight": 2}
  ],
  "evidenceAgainst": [
    {"category": "Sentiment", "tag": "bearish", "point": "News sentiment is negative (score 32/100)", "weight": 2}
  ],
  "keyUnknowns": [
    "FOMC rate decision in 2 days could invalidate setup",
    "Low on-chain data availability for this asset"
  ],
  "confidence": 7,
  "verdict": "Moderately bullish setup supported by trend regime and technical confluence. Key risk is macro uncertainty ahead of FOMC.",
  "reasoning": "**Step 1: Regime Analysis**\\nThe market is in a trending_up regime with ADX=34...\\n\\n**Step 2: Technical Confluence**\\n..."
}

Rules for evidence items:
- category: one of Regime, Technicals, Divergence, Sentiment, Macro, On-Chain, Pattern
- tag: "bullish" if it supports a long / opposes a short; "bearish" if it opposes a long / supports a short; "neutral" otherwise
- weight: 1=weak, 2=moderate, 3=strong
- point: concise, data-driven (include numbers where available)
- Aim for 3-6 items per side. Only include neutral items when truly ambiguous.`;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'reason_trade',
	description:
		'Trade Reasoning Engine ("Trading-R1") — flagship AI feature. Given a symbol and direction (long/short), orchestrates regime, confluence, divergence, sentiment, macro, and on-chain data, then uses AI to produce a structured chain-of-thought reasoning trace with evidence FOR, evidence AGAINST, key unknowns, confidence score (1-10), and final verdict. Returns ReasoningBlock (expandable chain-of-thought) + MetricCard (conviction, evidence balance) + TradeSetupBlock if conviction > 6. Use when user asks to analyse a trade, reason about a position, or wants a detailed bullish/bearish analysis.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT, SOLUSDT). Default: BTCUSDT',
			},
			direction: {
				type: 'string',
				enum: ['long', 'short', 'neutral'],
				description: 'Proposed trade direction. Default: long',
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
		const rawSymbol  = typeof args.symbol    === 'string' && args.symbol    ? args.symbol    : 'BTCUSDT';
		const direction  = (args.direction === 'short' || args.direction === 'neutral') ? args.direction : 'long';
		const timeframe  = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : '1d';
		const symbol     = normalizeBinanceSymbol(rawSymbol);

		const cacheKey = toolCache.generateKey('reason_trade', { symbol, direction, timeframe });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Gather evidence ──────────────────────────────────────────────────
		const evidenceData = await gatherTradeEvidence(symbol, timeframe);
		const evidenceSummary = buildEvidenceSummary(evidenceData, direction);

		// ── Call LLM ─────────────────────────────────────────────────────────
		let llmOutput = null;
		try {
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model:       apiModel,
				temperature: 0.3,
				max_tokens:  1500,
				messages: [
					{ role: 'user', content: buildReasoningPrompt(evidenceSummary, direction) },
				],
			});
			const rawText = completion.choices[0]?.message?.content ?? '';
			llmOutput = parseReasoningResponse(rawText);
		} catch {
			// LLM failed — build a fallback from raw data
		}

		// ── Fallback if LLM failed ────────────────────────────────────────────
		if (!llmOutput) {
			llmOutput = buildFallbackOutput(evidenceData, direction);
		}

		// ── Build ReasoningBlock ──────────────────────────────────────────────
		const reasoningBlock: ReasoningBlock = buildReasoningBlock(symbol, direction, llmOutput);

		// ── MetricCard ────────────────────────────────────────────────────────
		const forCount     = llmOutput.evidenceFor.length;
		const againstCount = llmOutput.evidenceAgainst.length;
		const forWeight    = llmOutput.evidenceFor.reduce((s, e) => s + e.weight, 0);
		const againstWeight = llmOutput.evidenceAgainst.reduce((s, e) => s + e.weight, 0);
		const balancePct   = forWeight + againstWeight > 0
			? Math.round((forWeight / (forWeight + againstWeight)) * 100)
			: 50;

		const convDir: 'up' | 'down' | 'neutral' =
			llmOutput.confidence >= 7 ? (direction === 'long' ? 'up' : 'down') :
			llmOutput.confidence <= 4 ? (direction === 'long' ? 'down' : 'up') : 'neutral';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Trade Reasoning — ${symbol} (${direction.toUpperCase()})`,
			metrics: [
				{
					label:     'Conviction Score',
					value:     `${llmOutput.confidence}/10`,
					change:    llmOutput.confidence >= 7 ? 'High conviction' : llmOutput.confidence >= 5 ? 'Moderate' : 'Low conviction',
					direction: convDir,
				},
				{
					label:     'Evidence Balance',
					value:     `${balancePct}% for / ${100 - balancePct}% against`,
					change:    `${forCount} for, ${againstCount} against`,
					direction: balancePct > 60 ? 'up' : balancePct < 40 ? 'down' : 'neutral',
				},
				{
					label:     'Key Unknowns',
					value:     String(llmOutput.keyUnknowns.length),
					change:    llmOutput.keyUnknowns.length > 2 ? 'Multiple risks' : 'Manageable',
					direction: llmOutput.keyUnknowns.length > 2 ? 'down' : 'neutral',
				},
				{
					label:     'Timeframe',
					value:     timeframe,
					direction: 'neutral',
				},
			],
		};

		// ── Optional TradeSetupBlock (confidence > 6) ─────────────────────────
		const contentBlocks: ContentBlock[] = [metricBlock, reasoningBlock];

		if (llmOutput.confidence > 6 && evidenceData.currentPrice > 0 && (direction === 'long' || direction === 'short')) {
			try {
				// Fetch OHLCV again for setup builder (already cached by ohlcvProvider)
				const ohlcvResult = await fetchOHLCV(symbol, timeframe, 150);
				let atrVal = evidenceData.atrValue;
				if (!('error' in ohlcvResult) && ohlcvResult.ohlcv.length >= 15) {
					const atrSeries = atr(ohlcvResult.ohlcv, 14);
					atrVal = atrSeries.length > 0 ? (atrSeries[atrSeries.length - 1]?.value ?? atrVal) : atrVal;
				}

				const signals = llmOutput.evidenceFor.slice(0, 3).map(e => e.point);
				const setup = buildIdeaSetup(
					symbol,
					direction as 'long' | 'short',
					evidenceData.currentPrice,
					atrVal,
					signals,
					'trending_up',
					timeframe,
				);
				contentBlocks.push(setup);
			} catch {
				// Setup builder failed — skip silently
			}
		}

		const textSummary =
			`${symbol} ${direction.toUpperCase()} analysis: confidence ${llmOutput.confidence}/10. ` +
			`${forCount} bullish signals (weight ${forWeight}), ${againstCount} bearish signals (weight ${againstWeight}). ` +
			`Verdict: ${llmOutput.verdict.slice(0, 200)}`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{ name: 'Binance OHLCV', accessedAt: Date.now() },
				{ name: 'News RSS Feeds', accessedAt: Date.now() },
				{ name: 'Yahoo Finance (Macro)', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});

// ─── Fallback output builder ──────────────────────────────────────────────────

function buildFallbackOutput(
	data: TradeEvidenceData,
	direction: 'long' | 'short' | 'neutral',
) {
	const isLong = direction !== 'short';

	const regimeFor = data.regimeSummary.toLowerCase().includes('trending_up') && isLong;
	const regimeAgainst = data.regimeSummary.toLowerCase().includes('trending_down') && isLong;
	const sentimentFor = data.sentimentSummary.toLowerCase().includes('bullish') && isLong;

	const evidenceFor = [
		...(regimeFor ? [{ category: 'Regime', tag: 'bullish' as const, point: data.regimeSummary.slice(0, 120), weight: 3 }] : []),
		...(sentimentFor ? [{ category: 'Sentiment', tag: 'bullish' as const, point: data.sentimentSummary.slice(0, 120), weight: 2 }] : []),
		{ category: 'Technicals', tag: 'neutral' as const, point: data.confluenceSummary.slice(0, 120), weight: 1 },
	];

	const evidenceAgainst = [
		...(regimeAgainst ? [{ category: 'Regime', tag: 'bearish' as const, point: data.regimeSummary.slice(0, 120), weight: 3 }] : []),
		{ category: 'Macro', tag: 'neutral' as const, point: data.macroSummary.slice(0, 120), weight: 1 },
	];

	return {
		evidenceFor,
		evidenceAgainst,
		keyUnknowns: ['AI synthesis unavailable — using rule-based fallback', 'Manual review recommended'],
		confidence: 5,
		verdict: `Data gathered for ${data.symbol} ${direction} analysis. AI synthesis unavailable. Review evidence manually.`,
		reasoning: [
			`## Evidence Summary for ${data.symbol} (${direction.toUpperCase()})`,
			'',
			`**Regime:** ${data.regimeSummary}`,
			`**Confluence:** ${data.confluenceSummary}`,
			`**Divergence:** ${data.divergenceSummary}`,
			`**Sentiment:** ${data.sentimentSummary}`,
			`**Macro:** ${data.macroSummary}`,
			`**On-Chain:** ${data.onChainSummary}`,
		].join('\n'),
	};
}
