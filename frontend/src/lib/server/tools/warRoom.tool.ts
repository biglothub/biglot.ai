// Multi-AI War Room Tool — T-1308
// Tool: start_war_room — 4 specialist AI panelists debate a trading asset

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getClientWithFallback, type AIModel } from '../aiProvider.server';
import { gatherTradeEvidence } from '../data/tradeReasoning.data';
import {
	buildPanelistPrompt,
	parsePanelistOutput,
	buildConsensus,
	buildWarRoomBlock,
	WAR_ROOM_PANELIST_ORDER,
	type WarRoomPanelistOutput,
} from '../data/warRoom.data';
import type {
	ContentBlock,
	MetricCardBlock,
	TradeSetupBlock,
	WarRoomPanelistId,
} from '$lib/types/contentBlock';

// ─── Panelist Model Config ────────────────────────────────────────────────────

const PANELIST_MODELS: Record<
	WarRoomPanelistId,
	{ primary: AIModel; fallbacks: AIModel[] }
> = {
	technical: {
		primary: 'gpt-4o',
		fallbacks: ['claude-sonnet', 'deepseek', 'gemini-2.5-flash'],
	},
	macro: {
		primary: 'deepseek',
		fallbacks: ['gpt-4o', 'claude-sonnet', 'gemini-2.5-flash'],
	},
	quant: {
		primary: 'gpt-4o-mini',
		fallbacks: ['deepseek', 'gemini-2.5-flash', 'gpt-4o'],
	},
	risk: {
		primary: 'deepseek-r1',
		fallbacks: ['gpt-4o', 'claude-sonnet', 'deepseek'],
	},
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectLanguage(text: string): 'thai' | 'english' {
	return /[\u0E00-\u0E7F]/.test(text) ? 'thai' : 'english';
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'start_war_room',
	description:
		'Multi-AI War Room — convenes 4 specialist AI panelists to debate a trading asset: Technical Analyst (charts/patterns/indicators), Macro Strategist (yields/COT/DXY/macro), Quant Analyst (correlations/regime/volatility/Kelly), and Risk Manager (position sizing/drawdown/portfolio risk — speaks last). Each specialist gets curated data for their domain. Returns WarRoomBlock (full specialist debate with data citations) + MetricCard (consensus direction, confidence, dissent count) + TradeSetupBlock (if consensus is actionable). Use when user wants a comprehensive multi-perspective analysis, "get all AI views on", "war room analysis", or "what do different specialists think".',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description:
					'Trading pair symbol (e.g. BTCUSDT, ETHUSDT, SOLUSDT, XAUUSD). Default: BTCUSDT',
			},
			timeframe: {
				type: 'string',
				description:
					'OHLCV timeframe for technical analysis (e.g. 1h, 4h, 1d). Default: 4h',
			},
		},
		required: [],
	},
	timeout: 120_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol =
			typeof args.symbol === 'string' && args.symbol.trim()
				? args.symbol.trim().toUpperCase()
				: 'BTCUSDT';

		const timeframe =
			typeof args.timeframe === 'string' && args.timeframe.trim()
				? args.timeframe.trim()
				: '4h';

		const cacheKey = toolCache.generateKey('start_war_room', { symbol, timeframe });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Gather market evidence ─────────────────────────────────────────────
		let evidence;
		try {
			evidence = await gatherTradeEvidence(symbol, timeframe);
		} catch {
			evidence = {
				symbol,
				currentPrice: 0,
				atrValue: 0,
				regimeSummary: 'Regime data unavailable.',
				confluenceSummary: 'Confluence data unavailable.',
				divergenceSummary: 'No divergence data.',
				sentimentSummary: 'Sentiment data unavailable.',
				macroSummary: 'Macro data unavailable.',
				onChainSummary: 'On-chain data unavailable.',
			};
		}

		const language = detectLanguage(symbol);
		const warRoomId = `war_room_${symbol}_${Date.now()}`;
		const outputs: WarRoomPanelistOutput[] = [];
		const modelMap: Record<WarRoomPanelistId, string> = {
			technical: '',
			macro: '',
			quant: '',
			risk: '',
		};

		// ── Run each panelist sequentially (Risk Manager last) ────────────────
		for (const panelistId of WAR_ROOM_PANELIST_ORDER) {
			const { primary, fallbacks } = PANELIST_MODELS[panelistId];
			const prompt = buildPanelistPrompt(panelistId, symbol, evidence, outputs, language);

			let output: WarRoomPanelistOutput = {
				panelistId,
				stance: 'neutral',
				confidence: 5,
				dataCitations: [],
				keyPoints: [],
				fullAnalysis: 'Analysis unavailable.',
			};

			try {
				const { client, apiModel, model } = getClientWithFallback(primary, fallbacks);
				modelMap[panelistId] = model;
				const completion = await client.chat.completions.create({
					model: apiModel,
					temperature: panelistId === 'risk' ? 0.3 : 0.6,
					max_tokens: 600,
					messages: [{ role: 'user', content: prompt }],
				});
				const raw = completion.choices[0]?.message?.content ?? '';
				output = parsePanelistOutput(panelistId, raw);
			} catch {
				modelMap[panelistId] = primary;
			}

			outputs.push(output);
		}

		// ── Build consensus ────────────────────────────────────────────────────
		const consensus = buildConsensus(outputs);

		// ── Build WarRoomBlock ─────────────────────────────────────────────────
		const warRoomBlock = buildWarRoomBlock(
			warRoomId,
			symbol,
			outputs,
			consensus,
			modelMap,
		);

		// ── MetricCard ─────────────────────────────────────────────────────────
		const dirIcon =
			consensus.direction === 'bullish'
				? '▲'
				: consensus.direction === 'bearish'
					? '▼'
					: '→';
		const directionMetric =
			consensus.direction === 'bullish' ? 'up' : consensus.direction === 'bearish' ? 'down' : 'neutral';

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `War Room: ${symbol}`,
			metrics: [
				{
					label: 'Consensus',
					value: `${dirIcon} ${consensus.direction.toUpperCase()}`,
					direction: directionMetric,
				},
				{
					label: 'Confidence',
					value: `${consensus.confidence}/10`,
				},
				{
					label: 'Dissenters',
					value: `${consensus.dissentCount} / 4`,
					direction: consensus.dissentCount >= 2 ? 'neutral' : 'up',
				},
				{
					label: 'Panelists',
					value: '4 AI Specialists',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [warRoomBlock, metricBlock];

		// ── TradeSetupBlock (if consensus is actionable) ───────────────────────
		if (
			consensus.confidence >= 6 &&
			consensus.direction !== 'neutral' &&
			evidence.currentPrice > 0 &&
			evidence.atrValue > 0
		) {
			const isLong = consensus.direction === 'bullish';
			const price = evidence.currentPrice;
			const atrVal = evidence.atrValue;

			const stopLoss = isLong ? price - 1.5 * atrVal : price + 1.5 * atrVal;
			const target1 = isLong ? price + 2 * atrVal : price - 2 * atrVal;
			const target2 = isLong ? price + 4 * atrVal : price - 4 * atrVal;
			const rrRatio = Math.abs(target1 - price) / Math.abs(stopLoss - price);

			const tradeSetup: TradeSetupBlock = {
				type: 'trade_setup',
				asset: symbol,
				direction: isLong ? 'long' : 'short',
				thesis: `War Room ${consensus.direction} consensus (${consensus.confidence}/10). ${consensus.summary}`,
				entryZone: {
					low: isLong ? price * 0.999 : price * 1.001,
					high: isLong ? price * 1.001 : price * 0.999,
				},
				stopLoss,
				targets: [
					{
						price: target1,
						label: 'Target 1 (2 ATR)',
						rMultiple: parseFloat(rrRatio.toFixed(2)),
					},
					{
						price: target2,
						label: 'Target 2 (4 ATR)',
						rMultiple: parseFloat((rrRatio * 2).toFixed(2)),
					},
				],
				riskRewardRatio: parseFloat(rrRatio.toFixed(2)),
				maxRiskPct: 1,
				invalidation: `Consensus invalidated if price violates stop (1.5 × ATR = ${atrVal.toFixed(2)})`,
				timeframe,
			};

			contentBlocks.push(tradeSetup);
		}

		// ── Text summary ───────────────────────────────────────────────────────
		const panelistSummary = WAR_ROOM_PANELIST_ORDER.map((id) => {
			const o = outputs.find((x) => x.panelistId === id);
			return `${id}=${o?.stance ?? 'n/a'}(${o?.confidence ?? '?'}/10)`;
		}).join(', ');

		const textSummary = `War Room for ${symbol}: ${consensus.direction.toUpperCase()} consensus (confidence ${consensus.confidence}/10, ${consensus.dissentCount} dissenter(s)). Panel: ${panelistSummary}. ${consensus.summary}`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
		};

		toolCache.set(cacheKey, result, 300_000); // 5 min cache
		return result;
	},
});
