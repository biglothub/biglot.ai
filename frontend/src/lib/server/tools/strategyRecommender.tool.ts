// Adaptive Strategy Recommender Tool — T-1304
// Tool: recommend_strategy — match current market conditions to strategy library

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getClientWithFallback } from '../aiProvider.server';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';
import {
	gatherStrategyConditions,
	rankStrategies,
	buildStrategyPrompt,
	parseStrategyExplanation,
	classifyVolatility,
} from '../data/strategyRecommender.data';
import type { ContentBlock, MetricCardBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

registerTool({
	name: 'recommend_strategy',
	description:
		'Adaptive Strategy Recommender — matches current market conditions to the optimal trading strategy. Analyses regime (trending/ranging/volatile), ADX, macro environment, and volatility to rank 8 strategies: trend following, mean reversion, breakout, range trading, momentum, carry trade, pairs/spread, volatility. Returns MetricCard (top strategy, current regime) + TableBlock (ranked strategies with match score and historical win rate) + TextBlock (AI explanation). Use when user asks which strategy to use, what approach fits current conditions, or wants strategy recommendations for a market.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT, SOLUSDT). Default: BTCUSDT',
			},
			timeframe: {
				type: 'string',
				description: 'Analysis timeframe: 1h, 4h, 1d. Default: 1d',
			},
		},
		required: [],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol = typeof args.symbol === 'string' && args.symbol ? args.symbol : 'BTCUSDT';
		const timeframe = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : '1d';
		const symbol = normalizeBinanceSymbol(rawSymbol);

		const cacheKey = toolCache.generateKey('recommend_strategy', { symbol, timeframe });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Gather conditions + rank strategies ───────────────────────────────
		const conditions = await gatherStrategyConditions(symbol, timeframe);
		const ranked = rankStrategies(conditions);

		const topMatch = ranked[0];
		const currentRegimeLabel = conditions.regime
			? conditions.regime.replace(/_/g, ' ')
			: 'Unknown';

		// ── LLM explanation ───────────────────────────────────────────────────
		let explanation = '';
		try {
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.4,
				max_tokens: 600,
				messages: [
					{ role: 'user', content: buildStrategyPrompt(conditions, ranked, symbol) },
				],
			});
			const raw = completion.choices[0]?.message?.content ?? '';
			explanation = parseStrategyExplanation(raw);
		} catch {
			// fallback — build explanation from ranked data
		}

		if (!explanation) {
			explanation = buildFallbackExplanation(symbol, currentRegimeLabel, ranked);
		}

		// ── MetricCard ────────────────────────────────────────────────────────
		const volLevel = classifyVolatility(conditions.atrRatio);
		const metricDir = topMatch.matchScore >= 70 ? 'up' : topMatch.matchScore >= 50 ? 'neutral' : 'down';

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `Strategy Recommendation — ${symbol} (${timeframe})`,
			metrics: [
				{
					label: 'Top Strategy',
					value: topMatch.strategy.name,
					change: `Match score: ${topMatch.matchScore}/100`,
					direction: metricDir,
				},
				{
					label: 'Current Regime',
					value: currentRegimeLabel.charAt(0).toUpperCase() + currentRegimeLabel.slice(1),
					change: `Confidence: ${conditions.regimeConfidence}%`,
					direction: conditions.regime === 'trending_up' ? 'up'
						: conditions.regime === 'trending_down' ? 'down'
						: 'neutral',
				},
				{
					label: 'Win Rate (Current Regime)',
					value: `${topMatch.winRateInCurrentRegime}%`,
					change: topMatch.winRateInCurrentRegime >= 60 ? 'Favorable' : topMatch.winRateInCurrentRegime >= 45 ? 'Moderate' : 'Challenging',
					direction: topMatch.winRateInCurrentRegime >= 60 ? 'up'
						: topMatch.winRateInCurrentRegime < 45 ? 'down'
						: 'neutral',
				},
				{
					label: 'Market Volatility',
					value: volLevel.charAt(0).toUpperCase() + volLevel.slice(1),
					change: `ATR ratio: ${conditions.atrRatio.toFixed(2)}%`,
					direction: volLevel === 'high' ? 'down' : volLevel === 'low' ? 'up' : 'neutral',
				},
			],
		};

		// ── TableBlock ────────────────────────────────────────────────────────
		const tableBlock: TableBlock = {
			type: 'table',
			title: 'Ranked Strategies by Current Market Fit',
			headers: ['#', 'Strategy', 'Match Score', 'Win Rate*', 'Ideal Regime', 'Key Reason'],
			rows: ranked.map((m, i) => [
				i + 1,
				m.strategy.name,
				`${m.matchScore}/100`,
				`${m.winRateInCurrentRegime}%`,
				m.strategy.idealRegimes.map(r => r.replace(/_/g, ' ')).join(', '),
				m.matchReasons[0] ?? '—',
			]),
		};

		// ── TextBlock ─────────────────────────────────────────────────────────
		const textBlock: TextBlock = {
			type: 'text',
			content: `## Strategy Analysis\n\n${explanation}\n\n*\\* Win rate based on historical regime data. Past performance does not guarantee future results.*`,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock, textBlock];

		const textSummary =
			`${symbol} strategy recommendation: ${topMatch.strategy.name} (score ${topMatch.matchScore}/100) ` +
			`in ${currentRegimeLabel} regime. ` +
			`Historical win rate in current regime: ${topMatch.winRateInCurrentRegime}%.`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{ name: 'Binance OHLCV', accessedAt: Date.now() },
				{ name: 'Yahoo Finance (Macro)', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 15 * 60_000); // 15 min cache
		return result;
	},
});

// ─── Fallback ─────────────────────────────────────────────────────────────────

function buildFallbackExplanation(
	symbol: string,
	regimeLabel: string,
	ranked: ReturnType<typeof rankStrategies>,
): string {
	const top = ranked[0];
	const second = ranked[1];
	const worst = ranked[ranked.length - 1];

	return [
		`## ${symbol} Strategy Analysis`,
		'',
		`**Current regime:** ${regimeLabel.charAt(0).toUpperCase() + regimeLabel.slice(1)}`,
		'',
		`**Top pick: ${top.strategy.name}** (match score: ${top.matchScore}/100)`,
		top.strategy.description,
		'',
		`**Runner-up: ${second.strategy.name}** (match score: ${second.matchScore}/100)`,
		second.strategy.description,
		'',
		`**Avoid: ${worst.strategy.name}** (match score: ${worst.matchScore}/100) — conditions are unfavorable.`,
	].join('\n');
}
