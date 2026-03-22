// Trade Reasoning Data — T-1301
// Gathers multi-source evidence for AI trade reasoning synthesis

import { fetchOHLCV, normalizeBinanceSymbol } from './ohlcvProvider';
import { analyzeRegime, regimeLabel } from '../indicators/regime';
import { detectConfluence } from '../indicators/confluence';
import { scanDivergences } from '../indicators/divergence';
import { fetchNewsFeed } from './newsFeed.data';
import { fetchMacroData } from './macro.data';
import { fetchOnChainData } from './onchain.data';
import { atr } from '../indicators/engine';
import type { ReasoningBlock, ReasoningEvidenceItem } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradeEvidenceData {
	symbol: string;
	currentPrice: number;
	atrValue: number;
	regimeSummary: string;
	confluenceSummary: string;
	divergenceSummary: string;
	sentimentSummary: string;
	macroSummary: string;
	onChainSummary: string;
}

export interface LLMReasoningOutput {
	evidenceFor: ReasoningEvidenceItem[];
	evidenceAgainst: ReasoningEvidenceItem[];
	keyUnknowns: string[];
	confidence: number;
	verdict: string;
	reasoning: string;
}

// ─── Evidence Gathering ───────────────────────────────────────────────────────

/**
 * Gather multi-source evidence for a symbol.
 * Returns structured summaries for each data category.
 */
export async function gatherTradeEvidence(
	symbol: string,
	timeframe: string,
): Promise<TradeEvidenceData> {
	const normalized = normalizeBinanceSymbol(symbol);
	const baseAsset  = normalized.replace(/USDT$/i, '').toLowerCase();
	const isOnChainSupported = baseAsset === 'btc' || baseAsset === 'eth';

	// Fetch OHLCV + run technical analysis
	const [ohlcvResult, newsSnapshot, macroData, onChainData] = await Promise.allSettled([
		fetchOHLCV(normalized, timeframe, 150),
		fetchNewsFeed(symbol, 20),
		fetchMacroData(),
		isOnChainSupported
			? fetchOnChainData(baseAsset as 'btc' | 'eth')
			: Promise.resolve(null),
	]);

	// ── Price + ATR ──────────────────────────────────────────────────────────
	let currentPrice = 0;
	let atrValue     = 0;
	let regimeSummary     = 'Regime data unavailable.';
	let confluenceSummary = 'Confluence data unavailable.';
	let divergenceSummary = 'Divergence data unavailable.';

	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		if (ohlcv.length > 0) {
			currentPrice = ohlcv[ohlcv.length - 1].close;
			const atrSeries = atr(ohlcv, 14);
			atrValue = atrSeries.length > 0 ? (atrSeries[atrSeries.length - 1]?.value ?? 0) : 0;
		}

		// Regime
		if (ohlcv.length >= 40) {
			const regime = analyzeRegime(ohlcv);
			if (regime) {
				const label = regimeLabel(regime.regime);
				regimeSummary =
					`Regime: ${label} (confidence ${regime.confidence}%). ` +
					`ADX=${regime.adxValue.toFixed(1)}, +DI=${regime.plusDI.toFixed(1)}, ` +
					`-DI=${regime.minusDI.toFixed(1)}, ATR/price=${regime.atrRatio.toFixed(2)}%, ` +
					`RSI=${regime.rsiValue.toFixed(0)}. ${regime.description}`;
			}
		}

		// Confluence
		if (ohlcv.length >= 50) {
			const conf = detectConfluence(ohlcv);
			if (conf.signals.length > 0) {
				const topSignals = conf.signals.slice(0, 5).map(s => s.description).join('; ');
				confluenceSummary =
					`Confluence: bullish=${conf.bullishScore}, bearish=${conf.bearishScore}. ` +
					`Dominant: ${conf.dominantDirection ?? 'none'}. Signals: ${topSignals}.`;
			} else {
				confluenceSummary = 'No confluence signals detected.';
			}
		}

		// Divergences
		if (ohlcv.length >= 50) {
			const divResult = scanDivergences(ohlcv, { lookback: 5 });
			if (divResult.signals.length > 0) {
				const topDivs = divResult.signals.slice(0, 4).map(
					s => `${s.type.replace(/_/g, ' ')} on ${s.oscillator} (strength ${s.strength.toFixed(2)})`
				).join('; ');
				divergenceSummary =
					`Divergences: ${divResult.bullCount} bullish, ${divResult.bearCount} bearish. ` +
					`Top: ${topDivs}.`;
			} else {
				divergenceSummary = 'No divergences detected.';
			}
		}
	}

	// ── Sentiment ────────────────────────────────────────────────────────────
	let sentimentSummary = 'Sentiment data unavailable.';
	if (newsSnapshot.status === 'fulfilled' && newsSnapshot.value) {
		const snap = newsSnapshot.value;
		const topHeadlines = snap.items.slice(0, 3).map(n => n.title).join('; ');
		sentimentSummary =
			`News sentiment: ${snap.sentimentLabel} (score ${snap.compositeScore}/100). ` +
			`${snap.positiveCount} bullish, ${snap.negativeCount} bearish, ${snap.neutralCount} neutral. ` +
			`Top headlines: ${topHeadlines}.`;
	}

	// ── Macro ────────────────────────────────────────────────────────────────
	let macroSummary = 'Macro data unavailable.';
	if (macroData.status === 'fulfilled') {
		const { dxy, tnx, spx, goldSignal } = macroData.value;
		const parts: string[] = [];
		if (dxy) parts.push(`DXY=${dxy.price.toFixed(2)} (${dxy.change >= 0 ? '+' : ''}${dxy.change.toFixed(2)}%)`);
		if (tnx) parts.push(`10Y Yield=${tnx.price.toFixed(2)}% (${tnx.change >= 0 ? '+' : ''}${tnx.change.toFixed(2)}%)`);
		if (spx) parts.push(`SPX=${spx.price.toFixed(0)} (${spx.change >= 0 ? '+' : ''}${spx.change.toFixed(2)}%)`);
		if (parts.length > 0) {
			macroSummary = `Macro: ${parts.join(', ')}. Gold signal: ${goldSignal ?? 'N/A'}.`;
		}
	}

	// ── On-Chain ─────────────────────────────────────────────────────────────
	let onChainSummary = isOnChainSupported ? 'On-chain data unavailable.' : 'On-chain data: not applicable for this asset.';
	if (onChainData.status === 'fulfilled' && onChainData.value) {
		const oc = onChainData.value;
		if (oc && oc.source !== 'unavailable') {
			const parts: string[] = [];
			if (oc.mvrv !== null)       parts.push(`MVRV=${oc.mvrv.toFixed(2)}`);
			if (oc.nvtRatio !== null)    parts.push(`NVT=${oc.nvtRatio.toFixed(1)}`);
			if (oc.activeAddresses !== null) parts.push(`ActiveAddrs=${oc.activeAddresses.toLocaleString()}`);
			onChainSummary = parts.length > 0
				? `On-chain (${oc.asset.toUpperCase()}): ${parts.join(', ')}.`
				: 'On-chain data available but empty.';
		}
	}

	return {
		symbol: normalized,
		currentPrice,
		atrValue,
		regimeSummary,
		confluenceSummary,
		divergenceSummary,
		sentimentSummary,
		macroSummary,
		onChainSummary,
	};
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Build a textual evidence summary for the LLM prompt.
 */
export function buildEvidenceSummary(data: TradeEvidenceData, direction: 'long' | 'short' | 'neutral'): string {
	return [
		`Asset: ${data.symbol} | Current Price: ${data.currentPrice > 0 ? data.currentPrice.toFixed(4) : 'unknown'} | ATR(14): ${data.atrValue > 0 ? data.atrValue.toFixed(4) : 'unknown'} | Proposed Direction: ${direction.toUpperCase()}`,
		'',
		`1. Market Regime: ${data.regimeSummary}`,
		`2. Technical Confluence: ${data.confluenceSummary}`,
		`3. Divergence Signals: ${data.divergenceSummary}`,
		`4. News Sentiment: ${data.sentimentSummary}`,
		`5. Macro Environment: ${data.macroSummary}`,
		`6. On-Chain Data: ${data.onChainSummary}`,
	].join('\n');
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into a structured LLMReasoningOutput.
 * Returns null if parsing fails.
 */
export function parseReasoningResponse(rawText: string): LLMReasoningOutput | null {
	// Extract JSON from markdown code blocks if present
	const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ??
	                  rawText.match(/(\{[\s\S]*\})/);
	const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

	try {
		const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

		const evidenceFor    = parseEvidenceItems(parsed.evidenceFor);
		const evidenceAgainst = parseEvidenceItems(parsed.evidenceAgainst);
		const keyUnknowns    = parseStringArray(parsed.keyUnknowns);
		const confidence     = typeof parsed.confidence === 'number'
			? Math.min(10, Math.max(1, Math.round(parsed.confidence)))
			: 5;
		const verdict        = typeof parsed.verdict === 'string' ? parsed.verdict : 'Insufficient data for verdict.';
		const reasoning      = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

		return { evidenceFor, evidenceAgainst, keyUnknowns, confidence, verdict, reasoning };
	} catch {
		return null;
	}
}

function parseEvidenceItems(raw: unknown): ReasoningEvidenceItem[] {
	if (!Array.isArray(raw)) return [];
	const items: ReasoningEvidenceItem[] = [];
	for (const item of raw) {
		if (typeof item !== 'object' || item === null) continue;
		const obj = item as Record<string, unknown>;
		const category = typeof obj.category === 'string' ? obj.category : 'General';
		const tag: ReasoningEvidenceItem['tag'] =
			obj.tag === 'bullish' ? 'bullish' :
			obj.tag === 'bearish' ? 'bearish' : 'neutral';
		const point  = typeof obj.point  === 'string' ? obj.point  : '';
		const weight = typeof obj.weight === 'number' ? Math.min(3, Math.max(1, Math.round(obj.weight))) : 2;
		if (point) items.push({ category, tag, point, weight });
	}
	return items;
}

function parseStringArray(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((s): s is string => typeof s === 'string');
}

// ─── Block Builder ────────────────────────────────────────────────────────────

/**
 * Assemble a ReasoningBlock from parsed LLM output.
 * Pure function — safe to test without mocking.
 */
export function buildReasoningBlock(
	symbol: string,
	direction: 'long' | 'short' | 'neutral',
	output: LLMReasoningOutput,
): ReasoningBlock {
	return {
		type:            'reasoning',
		symbol,
		direction,
		confidence:      output.confidence,
		verdict:         output.verdict,
		evidenceFor:     output.evidenceFor,
		evidenceAgainst: output.evidenceAgainst,
		keyUnknowns:     output.keyUnknowns,
		reasoning:       output.reasoning,
	};
}
