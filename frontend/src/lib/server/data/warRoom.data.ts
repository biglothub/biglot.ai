// War Room Data — T-1308
// Multi-AI War Room: 4 specialist AI panelists debate a trading asset

import type {
	WarRoomBlock,
	WarRoomPanelist,
	WarRoomPanelistId,
	WarRoomTurn,
} from '$lib/types/contentBlock';
import type { TradeEvidenceData } from './tradeReasoning.data';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WarRoomPanelistOutput {
	panelistId: WarRoomPanelistId;
	stance: 'bullish' | 'bearish' | 'neutral';
	confidence: number;        // 1-10
	dataCitations: string[];   // specific data points cited
	keyPoints: string[];       // 2-4 bullet points
	fullAnalysis: string;      // markdown analysis
}

export interface WarRoomConsensus {
	direction: 'bullish' | 'bearish' | 'neutral';
	confidence: number;
	dissentCount: number;
	summary: string;
}

// ─── Panelist Metadata ────────────────────────────────────────────────────────

const PANELIST_META: Record<WarRoomPanelistId, Omit<WarRoomPanelist, 'model'>> = {
	technical: {
		id: 'technical',
		name: 'Technical Analyst',
		color: 'blue',
		emoji: '📊',
		specialty: 'Chart patterns, technical indicators, trend analysis',
	},
	macro: {
		id: 'macro',
		name: 'Macro Strategist',
		color: 'purple',
		emoji: '🌍',
		specialty: 'Macro indicators, COT data, DXY, yields, central bank policy',
	},
	quant: {
		id: 'quant',
		name: 'Quant Analyst',
		color: 'amber',
		emoji: '📐',
		specialty: 'Correlations, regime statistics, volatility, Kelly criterion',
	},
	risk: {
		id: 'risk',
		name: 'Risk Manager',
		color: 'red',
		emoji: '🛡',
		specialty: 'Position sizing, drawdown control, portfolio risk, hedging',
	},
};

export const WAR_ROOM_PANELIST_ORDER: WarRoomPanelistId[] = [
	'technical',
	'macro',
	'quant',
	'risk',
];

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildSpecialtyContext(
	panelistId: WarRoomPanelistId,
	evidence: TradeEvidenceData,
): string {
	switch (panelistId) {
		case 'technical':
			return [
				'TECHNICAL DATA:',
				`- Current Price: ${evidence.currentPrice > 0 ? evidence.currentPrice.toFixed(2) : 'N/A'}`,
				`- ATR(14): ${evidence.atrValue > 0 ? evidence.atrValue.toFixed(2) : 'N/A'}`,
				`- Regime: ${evidence.regimeSummary}`,
				`- Confluence: ${evidence.confluenceSummary}`,
				`- Divergences: ${evidence.divergenceSummary}`,
			].join('\n');

		case 'macro':
			return [
				'MACRO & SENTIMENT DATA:',
				`- ${evidence.macroSummary}`,
				`- Sentiment: ${evidence.sentimentSummary}`,
			].join('\n');

		case 'quant':
			return [
				'QUANTITATIVE DATA:',
				`- Current Price: ${evidence.currentPrice > 0 ? evidence.currentPrice.toFixed(2) : 'N/A'}`,
				`- ATR(14): ${evidence.atrValue > 0 ? evidence.atrValue.toFixed(2) : 'N/A'}`,
				`- Regime: ${evidence.regimeSummary}`,
				`- Macro: ${evidence.macroSummary}`,
				`- On-chain: ${evidence.onChainSummary}`,
			].join('\n');

		case 'risk':
			return [
				'RISK DATA:',
				`- Current Price: ${evidence.currentPrice > 0 ? evidence.currentPrice.toFixed(2) : 'N/A'}`,
				`- ATR(14): ${evidence.atrValue > 0 ? evidence.atrValue.toFixed(2) : 'N/A'}`,
				`- Regime: ${evidence.regimeSummary}`,
				'(You have access to all previous panelist analyses above)',
			].join('\n');
	}
}

function buildPriorContext(priorOutputs: WarRoomPanelistOutput[]): string {
	if (priorOutputs.length === 0) return '';
	const lines = priorOutputs.map((o) => {
		const meta = PANELIST_META[o.panelistId];
		return `[${meta.emoji} ${meta.name}] Stance: ${o.stance.toUpperCase()} (${o.confidence}/10)\n${o.fullAnalysis}`;
	});
	return `\n\nPREVIOUS PANELIST ANALYSES:\n${lines.join('\n\n')}`;
}

/**
 * Build the LLM prompt for a war room panelist.
 */
export function buildPanelistPrompt(
	panelistId: WarRoomPanelistId,
	symbol: string,
	evidence: TradeEvidenceData,
	priorOutputs: WarRoomPanelistOutput[],
	language: 'english' | 'thai',
): string {
	const meta = PANELIST_META[panelistId];
	const isRiskManager = panelistId === 'risk';

	const langInstruction =
		language === 'thai'
			? 'ตอบเป็นภาษาไทยตลอด ใช้ภาษาอังกฤษเฉพาะชื่อสินทรัพย์และคำศัพท์เฉพาะทาง'
			: 'Respond in English throughout.';

	const specialtyCtx = buildSpecialtyContext(panelistId, evidence);
	const priorCtx = buildPriorContext(priorOutputs);
	const riskNote = isRiskManager
		? '\n\nYou speak LAST and have final authority on risk. Your analysis must synthesize all prior views and deliver the ultimate risk verdict for this trade.'
		: '';

	return `You are the ${meta.name} in a Multi-AI Trading War Room. Your specialty: ${meta.specialty}.
${langInstruction}

ASSET UNDER ANALYSIS: ${symbol}

${specialtyCtx}${priorCtx}${riskNote}

Provide your specialist analysis as the ${meta.name}. Be specific, data-driven, and professional.

Respond ONLY with valid JSON in this exact structure:
{
  "stance": "bullish" | "bearish" | "neutral",
  "confidence": <integer 1-10>,
  "dataCitations": ["<specific data point with number>", ...],
  "keyPoints": ["<key point 1>", "<key point 2>", "<key point 3>"],
  "fullAnalysis": "<markdown analysis, 150-250 words>"
}

Rules:
- dataCitations: 2-4 specific data points from the provided market data (include numbers where available)
- keyPoints: 2-4 concise bullet points summarizing your view
- fullAnalysis: professional markdown analysis from your specialist perspective
- stance: your view on the asset (bullish=long bias, bearish=short bias, neutral=no clear edge)
- confidence: 1=very uncertain, 10=highly certain`;
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

/**
 * Parse LLM JSON response for a war room panelist.
 * Falls back gracefully on parse errors.
 */
export function parsePanelistOutput(
	panelistId: WarRoomPanelistId,
	raw: string,
): WarRoomPanelistOutput {
	try {
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

			const stance = (['bullish', 'bearish', 'neutral'] as const).includes(
				parsed.stance as 'bullish' | 'bearish' | 'neutral',
			)
				? (parsed.stance as 'bullish' | 'bearish' | 'neutral')
				: 'neutral';

			const confidence =
				typeof parsed.confidence === 'number'
					? Math.min(10, Math.max(1, Math.round(parsed.confidence)))
					: 5;

			const dataCitations = Array.isArray(parsed.dataCitations)
				? (parsed.dataCitations as unknown[]).slice(0, 5).map(String)
				: [];

			const keyPoints = Array.isArray(parsed.keyPoints)
				? (parsed.keyPoints as unknown[]).slice(0, 5).map(String)
				: [];

			const fullAnalysis =
				typeof parsed.fullAnalysis === 'string' ? parsed.fullAnalysis : raw.trim();

			return { panelistId, stance, confidence, dataCitations, keyPoints, fullAnalysis };
		}
	} catch {
		// fallback below
	}

	return {
		panelistId,
		stance: 'neutral',
		confidence: 5,
		dataCitations: [],
		keyPoints: ['Analysis unavailable.'],
		fullAnalysis: raw.trim() || 'Analysis could not be retrieved.',
	};
}

// ─── Consensus Builder ────────────────────────────────────────────────────────

/**
 * Determine consensus direction and confidence from all panelist outputs.
 */
export function buildConsensus(outputs: WarRoomPanelistOutput[]): WarRoomConsensus {
	if (outputs.length === 0) {
		return {
			direction: 'neutral',
			confidence: 5,
			dissentCount: 0,
			summary: 'No panelist outputs to evaluate.',
		};
	}

	const stanceCounts = { bullish: 0, bearish: 0, neutral: 0 };
	for (const o of outputs) stanceCounts[o.stance]++;

	const direction: 'bullish' | 'bearish' | 'neutral' =
		stanceCounts.bullish > stanceCounts.bearish
			? 'bullish'
			: stanceCounts.bearish > stanceCounts.bullish
				? 'bearish'
				: 'neutral';

	const avgConfidence = Math.round(
		outputs.reduce((s, o) => s + o.confidence, 0) / outputs.length,
	);

	const dissentCount = outputs.filter((o) => o.stance !== direction).length;

	const dissentNote =
		dissentCount > 0
			? `${dissentCount} dissenter(s).`
			: 'Full panel agreement.';

	const summary = `Consensus: ${direction.toUpperCase()} — ${stanceCounts.bullish} bullish / ${stanceCounts.bearish} bearish / ${stanceCounts.neutral} neutral. Avg confidence: ${avgConfidence}/10. ${dissentNote}`;

	return { direction, confidence: avgConfidence, dissentCount, summary };
}

// ─── Block Builder ────────────────────────────────────────────────────────────

/**
 * Build the WarRoomBlock from panelist outputs and consensus.
 */
export function buildWarRoomBlock(
	warRoomId: string,
	symbol: string,
	outputs: WarRoomPanelistOutput[],
	consensus: WarRoomConsensus,
	modelMap: Record<WarRoomPanelistId, string>,
): WarRoomBlock {
	const now = Date.now();

	const panelists: WarRoomPanelist[] = WAR_ROOM_PANELIST_ORDER.map((id) => ({
		...PANELIST_META[id],
		model: modelMap[id] ?? 'unknown',
	}));

	const turns: WarRoomTurn[] = outputs.map((o, i) => ({
		turnId: `${warRoomId}:${o.panelistId}`,
		panelistId: o.panelistId,
		content: o.fullAnalysis,
		model: modelMap[o.panelistId] ?? 'unknown',
		dataCitations: o.dataCitations,
		stance: o.stance,
		confidence: o.confidence,
		keyPoints: o.keyPoints,
		startedAt: now - (outputs.length - i) * 3000,
		completedAt: now - (outputs.length - i) * 3000 + 2500,
	}));

	return {
		type: 'war_room',
		warRoomId,
		topic: `${symbol} Multi-AI War Room`,
		panelists,
		turns,
		consensusDirection: consensus.direction,
		consensusConfidence: consensus.confidence,
		dissentCount: consensus.dissentCount,
		consensusSummary: consensus.summary,
		status: 'complete',
		createdAt: now,
	};
}
