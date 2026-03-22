// Narrative Market Explainer Data — T-1305
// Gathers multi-source market data for AI narrative synthesis ("Why is BTC dropping?")

import { fetchOHLCV, normalizeBinanceSymbol } from './ohlcvProvider';
import { analyzeRegime, regimeLabel } from '../indicators/regime';
import { detectConfluence } from '../indicators/confluence';
import { scanDivergences } from '../indicators/divergence';
import { fetchNewsFeed } from './newsFeed.data';
import { fetchMacroData } from './macro.data';
import { fetchOnChainData } from './onchain.data';
import { fetchDerivativesSnapshot } from './derivatives.data';
import type { ResearchReportBlock, ResearchSection } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NarrativeData {
	symbol: string;
	question: string;
	currentPrice: number;
	regimeSummary: string;
	confluenceSummary: string;
	divergenceSummary: string;
	sentimentSummary: string;
	topHeadlines: string[];
	macroSummary: string;
	onChainSummary: string;
	derivativesSummary: string;
}

export interface NarrativeSectionsOutput {
	priceActionSummary: string;
	keyDrivers: string;
	supportingData: string;
	whatToWatchNext: string;
	thaiSummary: string;
}

// ─── Data Gathering ───────────────────────────────────────────────────────────

/**
 * Gather multi-source market data for narrative synthesis.
 * Fetches regime, sentiment, macro, on-chain, and derivatives in parallel.
 */
export async function gatherNarrativeData(
	symbol: string,
	timeframe: string,
	question: string
): Promise<NarrativeData> {
	const normalized = normalizeBinanceSymbol(symbol);
	const baseAsset = normalized.replace(/USDT$/i, '').toLowerCase();
	const isOnChainSupported = baseAsset === 'btc' || baseAsset === 'eth';
	const isBtc = baseAsset === 'btc';

	const [ohlcvResult, newsResult, macroResult, onChainResult, derivativesResult] =
		await Promise.allSettled([
			fetchOHLCV(normalized, timeframe, 150),
			fetchNewsFeed(symbol, 15),
			fetchMacroData(),
			isOnChainSupported
				? fetchOnChainData(baseAsset as 'btc' | 'eth')
				: Promise.resolve(null),
			fetchDerivativesSnapshot(isBtc ? ['BTCUSDT'] : [normalized, 'BTCUSDT']),
		]);

	// ── Price + Technicals ─────────────────────────────────────────────────────
	let currentPrice = 0;
	let regimeSummary = 'Regime data unavailable.';
	let confluenceSummary = 'Confluence data unavailable.';
	let divergenceSummary = 'No divergences detected.';

	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		if (ohlcv.length > 0) {
			currentPrice = ohlcv[ohlcv.length - 1].close;
		}
		if (ohlcv.length >= 40) {
			const regime = analyzeRegime(ohlcv);
			if (regime) {
				const label = regimeLabel(regime.regime);
				regimeSummary =
					`${label} (confidence ${regime.confidence}%). ` +
					`ADX=${regime.adxValue.toFixed(1)}, RSI=${regime.rsiValue.toFixed(0)}. ` +
					regime.description;
			}
		}
		if (ohlcv.length >= 50) {
			const conf = detectConfluence(ohlcv);
			if (conf.signals.length > 0) {
				const topSignals = conf.signals
					.slice(0, 4)
					.map((s) => s.description)
					.join('; ');
				confluenceSummary =
					`Bullish=${conf.bullishScore}, Bearish=${conf.bearishScore}. ` +
					`Signals: ${topSignals}.`;
			} else {
				confluenceSummary = 'No confluence signals detected.';
			}

			const divResult = scanDivergences(ohlcv, { lookback: 5 });
			if (divResult.signals.length > 0) {
				divergenceSummary =
					`${divResult.bullCount} bullish, ${divResult.bearCount} bearish divergences detected.`;
			}
		}
	}

	// ── News / Sentiment ───────────────────────────────────────────────────────
	let sentimentSummary = 'Sentiment data unavailable.';
	let topHeadlines: string[] = [];

	if (newsResult.status === 'fulfilled' && newsResult.value) {
		const snap = newsResult.value;
		topHeadlines = snap.items.slice(0, 5).map((n) => n.title);
		sentimentSummary =
			`${snap.sentimentLabel} (${snap.compositeScore}/100). ` +
			`${snap.positiveCount} bullish, ${snap.negativeCount} bearish news items.`;
	}

	// ── Macro ──────────────────────────────────────────────────────────────────
	let macroSummary = 'Macro data unavailable.';

	if (macroResult.status === 'fulfilled') {
		const { dxy, tnx, spx, goldSignal } = macroResult.value;
		const parts: string[] = [];
		if (dxy)
			parts.push(
				`DXY=${dxy.price.toFixed(2)} (${dxy.change >= 0 ? '+' : ''}${dxy.change.toFixed(2)}%)`
			);
		if (tnx)
			parts.push(
				`10Y Yield=${tnx.price.toFixed(2)}% (${tnx.change >= 0 ? '+' : ''}${tnx.change.toFixed(2)}%)`
			);
		if (spx)
			parts.push(
				`SPX=${spx.price.toFixed(0)} (${spx.change >= 0 ? '+' : ''}${spx.change.toFixed(2)}%)`
			);
		if (goldSignal) parts.push(`Gold signal: ${goldSignal}`);
		if (parts.length > 0) macroSummary = parts.join(', ');
	}

	// ── On-Chain ───────────────────────────────────────────────────────────────
	let onChainSummary = isOnChainSupported
		? 'On-chain data unavailable.'
		: 'On-chain data not applicable for this asset.';

	if (onChainResult.status === 'fulfilled' && onChainResult.value) {
		const oc = onChainResult.value;
		if (oc.source !== 'unavailable') {
			const parts: string[] = [];
			if (oc.mvrv !== null) parts.push(`MVRV=${oc.mvrv.toFixed(2)}`);
			if (oc.nvtRatio !== null) parts.push(`NVT=${oc.nvtRatio.toFixed(1)}`);
			if (oc.activeAddresses !== null)
				parts.push(`Active Addrs=${oc.activeAddresses.toLocaleString()}`);
			if (oc.supplyOnExchanges !== null)
				parts.push(`Exchange Supply=${oc.supplyOnExchanges.toFixed(2)}%`);
			onChainSummary =
				parts.length > 0
					? `${oc.asset.toUpperCase()}: ${parts.join(', ')}.`
					: 'On-chain data available but sparse.';
		}
	}

	// ── Derivatives ────────────────────────────────────────────────────────────
	let derivativesSummary = 'Derivatives data unavailable.';

	if (derivativesResult.status === 'fulfilled') {
		const der = derivativesResult.value;
		const parts: string[] = [];

		const targetFunding = der.fundingRates.find((f) => f.symbol === normalized);
		if (targetFunding) {
			const annPct = (targetFunding.annualised * 100).toFixed(1);
			const bias = targetFunding.rate > 0 ? 'long-biased' : 'short-biased';
			parts.push(
				`Funding=${(targetFunding.rate * 100).toFixed(4)}% (${annPct}% ann, ${bias})`
			);
		}

		const targetOI = der.openInterest.find((oi) => oi.symbol === normalized);
		if (targetOI) {
			const oiM = (targetOI.openInterestUSD / 1_000_000).toFixed(1);
			parts.push(`OI=$${oiM}M`);
		}

		const targetLS = der.longShortRatios.find((ls) => ls.symbol === normalized);
		if (targetLS) {
			parts.push(
				`L/S=${(targetLS.longPct * 100).toFixed(0)}%/${(targetLS.shortPct * 100).toFixed(0)}%`
			);
		}

		const targetLiq = der.liquidations.find((l) => l.symbol === normalized);
		if (targetLiq) {
			const longM = (targetLiq.longLiqUSD / 1_000_000).toFixed(2);
			const shortM = (targetLiq.shortLiqUSD / 1_000_000).toFixed(2);
			parts.push(`Liquidations: Longs=$${longM}M, Shorts=$${shortM}M`);
		}

		if (der.options && isBtc) {
			if (der.options.putCallRatio !== null) {
				const pcBias = der.options.putCallRatio > 1 ? 'bearish options bias' : 'bullish options bias';
				parts.push(`Put/Call=${der.options.putCallRatio.toFixed(2)} (${pcBias})`);
			}
		}

		if (parts.length > 0) derivativesSummary = parts.join('; ');
	}

	return {
		symbol: normalized,
		question,
		currentPrice,
		regimeSummary,
		confluenceSummary,
		divergenceSummary,
		sentimentSummary,
		topHeadlines,
		macroSummary,
		onChainSummary,
		derivativesSummary,
	};
}

// ─── Prompt Builder ───────────────────────────────────────────────────────────

/**
 * Build the LLM prompt from gathered narrative data.
 * Pure function — safe to unit test.
 */
export function buildNarrativePrompt(data: NarrativeData): string {
	const headlinesSection =
		data.topHeadlines.length > 0
			? data.topHeadlines.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
			: '  No recent headlines available.';

	return `You are a senior market analyst. A trader is asking: "${data.question}"

CURRENT MARKET DATA for ${data.symbol} (Price: ${data.currentPrice > 0 ? data.currentPrice.toFixed(4) : 'unknown'}):

1. Market Regime: ${data.regimeSummary}
2. Technical Signals: ${data.confluenceSummary}
3. Divergences: ${data.divergenceSummary}
4. News Sentiment: ${data.sentimentSummary}
5. Recent Headlines:
${headlinesSection}
6. Macro Environment: ${data.macroSummary}
7. On-Chain: ${data.onChainSummary}
8. Derivatives/Positioning: ${data.derivativesSummary}

Write a comprehensive but concise narrative explaining the current market behavior. Respond ONLY with valid JSON using these exact keys:

{
  "priceActionSummary": "2-4 sentences on recent price action, key levels, and dominant pattern. Use specific numbers from the data.",
  "keyDrivers": "4-6 bullet points (markdown, use - prefix) identifying primary catalysts. Rank by significance. Mix technical + fundamental.",
  "supportingData": "3-5 bullet points (markdown, use - prefix) citing specific data from above (derivatives, on-chain, macro correlations).",
  "whatToWatchNext": "3-4 bullet points (markdown, use - prefix) with specific triggers, levels, or events to monitor.",
  "thaiSummary": "2-3 sentences in Thai summarizing the key message. ภาษาไทยล้วน ไม่มีภาษาอังกฤษ"
}

Rules:
- Be data-driven: cite specific numbers (prices, percentages, indicator values)
- thaiSummary must be Thai only — no English words
- Avoid vague statements; every claim needs evidence from the data above
- Keep each section focused and actionable`;
}

// ─── Response Parsing ─────────────────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into NarrativeSectionsOutput.
 * Returns null if parsing fails.
 */
export function parseNarrativeResponse(rawText: string): NarrativeSectionsOutput | null {
	const jsonMatch =
		rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? rawText.match(/(\{[\s\S]*\})/);
	const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();

	try {
		const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
		const str = (key: string): string =>
			typeof parsed[key] === 'string' && (parsed[key] as string).trim().length > 0
				? (parsed[key] as string).trim()
				: '';

		const priceActionSummary = str('priceActionSummary');
		const keyDrivers = str('keyDrivers');
		const supportingData = str('supportingData');
		const whatToWatchNext = str('whatToWatchNext');
		const thaiSummary = str('thaiSummary');

		// Require at least the two core fields to be present
		if (!priceActionSummary || !keyDrivers) return null;

		return { priceActionSummary, keyDrivers, supportingData, whatToWatchNext, thaiSummary };
	} catch {
		return null;
	}
}

// ─── Fallback Sections ────────────────────────────────────────────────────────

/**
 * Build rule-based fallback when LLM is unavailable.
 * Pure function — safe to unit test.
 */
export function buildFallbackSections(data: NarrativeData): NarrativeSectionsOutput {
	const priceStr = data.currentPrice > 0 ? data.currentPrice.toFixed(4) : 'N/A';

	return {
		priceActionSummary:
			`${data.symbol} is currently priced at ${priceStr}. ` +
			`Market regime indicates: ${data.regimeSummary.split('.')[0]}. ` +
			`Technical analysis shows ${data.confluenceSummary.split('.')[0].toLowerCase()}.`,

		keyDrivers:
			`- **Market Regime**: ${data.regimeSummary}\n` +
			`- **News Sentiment**: ${data.sentimentSummary}\n` +
			`- **Macro Environment**: ${data.macroSummary}\n` +
			`- **Derivatives Positioning**: ${data.derivativesSummary}`,

		supportingData:
			`- **Technical Confluence**: ${data.confluenceSummary}\n` +
			`- **On-Chain Data**: ${data.onChainSummary}\n` +
			`- **Divergence Signals**: ${data.divergenceSummary}`,

		whatToWatchNext:
			`- Monitor key support and resistance levels for ${data.symbol}\n` +
			`- Track funding rate direction — shifts signal positioning changes\n` +
			`- Watch DXY and 10Y yield for macro tailwinds/headwinds\n` +
			`- Follow on-chain flows for accumulation or distribution signals`,

		thaiSummary:
			`ตลาด ${data.symbol} อยู่ที่ราคา ${priceStr} ` +
			`โดยมีสภาวะตลาด${data.regimeSummary.includes('trending_up') ? 'เป็นขาขึ้น' : data.regimeSummary.includes('trending_down') ? 'เป็นขาลง' : 'ทรงตัว'} ` +
			`ควรติดตามแนวรับแนวต้านและข่าวสารที่เกี่ยวข้องอย่างใกล้ชิด`,
	};
}

// ─── Block Builder ────────────────────────────────────────────────────────────

/**
 * Assemble a ResearchReportBlock from narrative sections.
 * Pure function — safe to unit test.
 */
export function buildNarrativeReportBlock(
	symbol: string,
	question: string,
	sections: NarrativeSectionsOutput,
	durationMs: number
): ResearchReportBlock {
	const now = Date.now();

	const reportSections: ResearchSection[] = [
		{
			id: 'price_action',
			title: 'Price Action Summary',
			content: sections.priceActionSummary,
		},
		{
			id: 'key_drivers',
			title: 'Key Drivers',
			content: sections.keyDrivers,
		},
		{
			id: 'supporting_data',
			title: 'Supporting Data',
			content: sections.supportingData,
		},
		{
			id: 'what_to_watch',
			title: 'What to Watch Next',
			content: sections.whatToWatchNext,
		},
		...(sections.thaiSummary
			? [
					{
						id: 'thai_summary',
						title: 'สรุปภาษาไทย',
						content: sections.thaiSummary,
					} as ResearchSection,
				]
			: []),
	];

	return {
		type: 'research_report',
		reportId: `narrative_${symbol}_${now}`,
		title: question || `Market Narrative — ${symbol}`,
		query: question,
		sections: reportSections,
		status: 'complete',
		toolCallCount: 5,
		totalDurationMs: durationMs,
		createdAt: now,
		updatedAt: now,
	};
}
