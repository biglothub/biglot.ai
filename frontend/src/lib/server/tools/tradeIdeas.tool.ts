// AI Trade Idea Generator Tool — T-905
// Tool: generate_trade_ideas
// Synthesizes regime, confluence, patterns into top-3 actionable trade ideas

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchOHLCV } from '../data/ohlcvProvider';
import { detectConfluence } from '../indicators/confluence';
import { analyzeRegime } from '../indicators/regime';
import { detectPatterns, summarisePatterns } from '../indicators/candlePatterns';
import { DEFAULT_WATCHLIST } from '../data/screener.data';
import type {
	ContentBlock,
	TradeSetupBlock,
	MetricCardBlock,
	TableBlock,
	OHLCV,
} from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TradeIdea {
	symbol: string;
	direction: 'long' | 'short';
	confluenceScore: number;
	regimeAlignment: boolean;
	patternConfirmation: boolean;
	totalScore: number;
	setup: TradeSetupBlock;
	thesis: string;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score a trade idea based on confluence, regime alignment, and pattern confirmation.
 * Max score = confluenceScore + 2 (regime) + 1 (pattern)
 */
export function scoreIdea(
	confluenceScore: number,
	regimeAlignment: boolean,
	patternConfirmation: boolean,
): number {
	return confluenceScore + (regimeAlignment ? 2 : 0) + (patternConfirmation ? 1 : 0);
}

/**
 * Check if the market regime aligns with the proposed direction.
 * trending_up/ranging → bullish ideas; trending_down → bearish ideas; high_volatility → both OK.
 */
export function checkRegimeAlignment(
	regime: string,
	direction: 'long' | 'short',
): boolean {
	if (regime === 'trending_up')    return direction === 'long';
	if (regime === 'trending_down')  return direction === 'short';
	// ranging / high_volatility → no strong directional bias, consider aligned for either
	return true;
}

// ─── Trade setup builder ──────────────────────────────────────────────────────

export function buildIdeaSetup(
	symbol: string,
	direction: 'long' | 'short',
	currentPrice: number,
	atrValue: number,
	signalDescriptions: string[],
	regime: string,
	timeframe: string,
): TradeSetupBlock {
	const isLong = direction === 'long';
	const atr     = atrValue > 0 ? atrValue : currentPrice * 0.01; // fallback 1%

	const halfAtr  = atr * 0.5;
	const entryZone = {
		low:  +(currentPrice - halfAtr).toFixed(4),
		high: +(currentPrice + halfAtr).toFixed(4),
	};
	const entryMid    = (entryZone.low + entryZone.high) / 2;
	const stopDistance = atr * 1.5;
	const stopLoss     = isLong
		? +(entryMid - stopDistance).toFixed(4)
		: +(entryMid + stopDistance).toFixed(4);

	const riskPerUnit = Math.abs(entryMid - stopLoss);
	const targets = isLong
		? [
				{ price: +(entryMid + riskPerUnit * 1.5).toFixed(4), label: 'T1 (1.5R)', rMultiple: 1.5 },
				{ price: +(entryMid + riskPerUnit * 3.0).toFixed(4), label: 'T2 (3R)',   rMultiple: 3.0 },
				{ price: +(entryMid + riskPerUnit * 5.0).toFixed(4), label: 'T3 (5R)',   rMultiple: 5.0 },
			]
		: [
				{ price: +(entryMid - riskPerUnit * 1.5).toFixed(4), label: 'T1 (1.5R)', rMultiple: 1.5 },
				{ price: +(entryMid - riskPerUnit * 3.0).toFixed(4), label: 'T2 (3R)',   rMultiple: 3.0 },
				{ price: +(entryMid - riskPerUnit * 5.0).toFixed(4), label: 'T3 (5R)',   rMultiple: 5.0 },
			];

	const thesis = signalDescriptions.length > 0
		? signalDescriptions.join('; ')
		: `${direction === 'long' ? 'Bullish' : 'Bearish'} confluence in ${regime} regime`;

	const invalidation = isLong
		? `Close below ${stopLoss} invalidates setup`
		: `Close above ${stopLoss} invalidates setup`;

	return {
		type:            'trade_setup',
		asset:           symbol,
		direction,
		thesis,
		entryZone,
		stopLoss,
		targets,
		riskRewardRatio: 3.0,
		maxRiskPct:      1.0,
		invalidation,
		timeframe,
	};
}

// ─── Idea generation ──────────────────────────────────────────────────────────

export async function generateIdeasFromOHLCV(
	symbol: string,
	candles: OHLCV[],
	interval: string,
	minConfluenceScore: number,
): Promise<TradeIdea | null> {
	if (candles.length < 50) return null;

	const confluence = detectConfluence(candles);
	if (!confluence.dominantDirection) return null;
	if (confluence.confluenceScore < minConfluenceScore) return null;

	const direction = confluence.dominantDirection === 'bullish' ? 'long' : 'short';

	// Regime analysis
	const regimeResult = analyzeRegime(candles);
	const regime       = regimeResult?.regime ?? 'ranging';
	const aligned      = checkRegimeAlignment(regime, direction);

	// Candlestick pattern confirmation
	const patterns     = detectPatterns(candles.slice(-10)); // last 10 candles
	const patternSummary = summarisePatterns(patterns);
	const patternConfirms = direction === 'long'
		? patternSummary.overallSignal === 'bullish'
		: patternSummary.overallSignal === 'bearish';

	const totalScore = scoreIdea(confluence.confluenceScore, aligned, patternConfirms);

	// Build signal descriptions for thesis
	const relevantSignals = confluence.signals
		.filter(s => s.direction === confluence.dominantDirection)
		.slice(0, 4)
		.map(s => s.description);

	const setup = buildIdeaSetup(
		symbol,
		direction,
		confluence.currentPrice,
		confluence.atrValue,
		relevantSignals,
		regime,
		interval,
	);

	const patternNames = patterns.slice(0, 2).map(p => p.pattern).join(', ');
	const thesis = [
		...relevantSignals,
		patternNames ? `Pattern: ${patternNames}` : null,
		`Regime: ${regime}${aligned ? ' (aligned)' : ''}`,
	].filter(Boolean).join('; ');

	return {
		symbol,
		direction,
		confluenceScore: confluence.confluenceScore,
		regimeAlignment: aligned,
		patternConfirmation: patternConfirms,
		totalScore,
		setup:           { ...setup, thesis },
		thesis,
	};
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'generate_trade_ideas',
	description:
		'AI Trade Idea Generator — scans a watchlist of assets and synthesizes current multi-indicator confluence, market regime, and candlestick patterns into the top 3 actionable trade ideas. Each idea includes entry zone (±0.5 ATR), stop loss (1.5 ATR), three targets (T1=1.5R, T2=3R, T3=5R), thesis, and a composite confidence score. Returns TradeSetupBlocks + ranked ideas table. Use when asked for trade ideas, setups, opportunities, or what to trade now.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type: 'array',
				items: { type: 'string' },
				description: 'Symbols to scan (e.g. ["BTCUSDT","ETHUSDT"]). Defaults to top-20 watchlist.',
			},
			interval: {
				type: 'string',
				description: 'Candle interval: 1h, 4h, 1d. Default: 4h',
			},
			min_confluence_score: {
				type: 'number',
				description: 'Minimum confluence score to include an idea (default: 3).',
			},
			max_ideas: {
				type: 'number',
				description: 'Maximum number of trade ideas to return (default: 3, max: 5).',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbols = Array.isArray(args.symbols)
			? (args.symbols as unknown[]).filter(s => typeof s === 'string').map(s => (s as string).toUpperCase())
			: [];
		const symbols          = rawSymbols.length > 0 ? rawSymbols : DEFAULT_WATCHLIST.slice(0, 15);
		const interval         = typeof args.interval === 'string' && args.interval ? args.interval : '4h';
		const minConfluence    = typeof args.min_confluence_score === 'number' ? args.min_confluence_score : 3;
		const maxIdeas         = Math.min(5, Math.max(1, typeof args.max_ideas === 'number' ? args.max_ideas : 3));

		const cacheKey = toolCache.generateKey('generate_trade_ideas', {
			symbols: symbols.sort().join(','), interval, minConfluence, maxIdeas,
		});
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch + analyse all symbols in parallel ──────────────────────────────
		const fetchResults = await Promise.allSettled(
			symbols.map(async (symbol) => {
				const res = await fetchOHLCV(symbol, interval, 200);
				if ('error' in res) return null;
				return generateIdeasFromOHLCV(symbol, res.ohlcv, interval, minConfluence);
			})
		);

		const ideas: TradeIdea[] = fetchResults
			.map(r => (r.status === 'fulfilled' ? r.value : null))
			.filter((v): v is TradeIdea => v !== null)
			.sort((a, b) => b.totalScore - a.totalScore)
			.slice(0, maxIdeas);

		if (ideas.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'error',
					message: `No trade ideas found with confluence score ≥ ${minConfluence} across ${symbols.length} symbols on ${interval}. Try lowering min_confluence_score or scanning more symbols.`,
					tool: 'generate_trade_ideas',
				}],
				textSummary: `No trade ideas found on ${interval} timeframe with current filters.`,
			};
		}

		// ── MetricCard ─────────────────────────────────────────────────────────
		const topIdea = ideas[0];
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `AI Trade Ideas — ${symbols.length} symbols scanned (${interval})`,
			metrics: [
				{
					label:     'Ideas Found',
					value:     `${ideas.length} of ${symbols.length} symbols`,
					change:    `confluence ≥ ${minConfluence} required`,
					direction: 'neutral',
				},
				{
					label:     'Top Idea',
					value:     `${topIdea.direction === 'long' ? '↑ LONG' : '↓ SHORT'} ${topIdea.symbol}`,
					change:    `Score: ${topIdea.totalScore} | Regime: ${topIdea.regimeAlignment ? '✓ aligned' : '○ neutral'}`,
					direction: topIdea.direction === 'long' ? 'up' : 'down',
				},
				{
					label:     'Long Ideas',
					value:     String(ideas.filter(i => i.direction === 'long').length),
					change:    `${ideas.filter(i => i.direction === 'short').length} short ideas`,
					direction: 'neutral',
				},
			],
		};

		// ── Ideas summary table ───────────────────────────────────────────────
		const tableRows = ideas.map(idea => [
			idea.symbol.replace('USDT', ''),
			idea.direction === 'long' ? '↑ Long' : '↓ Short',
			String(idea.confluenceScore),
			idea.regimeAlignment ? '✓' : '○',
			idea.patternConfirmation ? '✓' : '—',
			String(idea.totalScore),
		]);

		const tableBlock: TableBlock = {
			type:    'table',
			title:   'Trade Ideas — Ranked by Score',
			headers: ['Symbol', 'Direction', 'Confluence', 'Regime', 'Pattern', 'Total Score'],
			rows:    tableRows,
		};

		// ── TradeSetupBlocks ────────────────────────────────────────────────────
		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock, ...ideas.map(i => i.setup)];

		const summary = ideas
			.map(i => `${i.direction === 'long' ? '↑' : '↓'} ${i.symbol} (score ${i.totalScore}: ${i.thesis.slice(0, 80)})`)
			.join(' | ');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Found ${ideas.length} trade idea(s) from ${symbols.length} symbols on ${interval}: ${summary}`,
			sources: [{ name: 'AI Trade Idea Scanner', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		return result;
	},
});
