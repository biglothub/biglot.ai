// Daily Briefing Tool — T-605
// Tool: get_daily_briefing
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { assembleDailyBriefing, formatBriefingTelegram } from '../briefing/dailyBriefing';
import type { MetricCardBlock } from '$lib/types/contentBlock';

function fmtPnL(n: number): string {
	const sign = n >= 0 ? '+' : '';
	if (Math.abs(n) >= 1_000_000) return `${sign}$${(n / 1_000_000).toFixed(2)}M`;
	if (Math.abs(n) >= 1_000)     return `${sign}$${(n / 1_000).toFixed(2)}K`;
	return `${sign}$${n.toFixed(2)}`;
}

function fmtPct(pct: number): string {
	return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

registerTool({
	name: 'get_daily_briefing',
	description:
		'Generate a daily market briefing: top crypto gainers and losers (24h), paper portfolio PnL summary. Use when the user asks for a market summary, morning briefing, daily update, or wants to know how the market is doing today.',
	parameters: {
		type: 'object',
		properties: {
			limit: {
				type: 'number',
				description: 'Number of top movers to include (default: 5, max: 10)',
			},
			user_id: {
				type: 'string',
				description: 'User ID for portfolio lookup (default: "default")',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const limit  = Math.min(10, Math.max(1, typeof args.limit   === 'number' ? args.limit   : 5));
		const userId = typeof args.user_id === 'string' && args.user_id ? args.user_id : 'default';

		const cacheKey = toolCache.generateKey('get_daily_briefing', { limit, userId });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const briefing = await assembleDailyBriefing(userId, limit);

		// ── Movers metric card ────────────────────────────────────────────────
		const moversCard: MetricCardBlock = {
			type:  'metric_card',
			title: `Top Movers — ${briefing.date}`,
			metrics: [
				...briefing.topGainers.map(m => ({
					label:     m.symbol.replace('USDT', '/USDT'),
					value:     fmtPct(m.priceChangePct),
					direction: 'up' as const,
				})),
				...briefing.topLosers.map(m => ({
					label:     m.symbol.replace('USDT', '/USDT'),
					value:     fmtPct(m.priceChangePct),
					direction: 'down' as const,
				})),
			],
		};

		// ── Portfolio summary card ────────────────────────────────────────────
		const portfolioCard: MetricCardBlock = {
			type:  'metric_card',
			title: 'Paper Portfolio Summary',
			metrics: [
				{
					label:     'Open Trades',
					value:     String(briefing.openTradeCount),
					direction: 'neutral',
				},
				{
					label:     'Closed Trades',
					value:     String(briefing.closedTradeCount),
					direction: 'neutral',
				},
				{
					label:     'Unrealised PnL',
					value:     fmtPnL(briefing.totalUnrealisedPnL),
					direction: briefing.totalUnrealisedPnL >= 0 ? 'up' : 'down',
				},
				{
					label:     'Realised PnL',
					value:     fmtPnL(briefing.totalRealisedPnL),
					direction: briefing.totalRealisedPnL >= 0 ? 'up' : 'down',
				},
				...(briefing.winRate !== null ? [{
					label:     'Win Rate',
					value:     `${(briefing.winRate * 100).toFixed(1)}%`,
					direction: briefing.winRate >= 0.5 ? 'up' as const : 'down' as const,
				}] : []),
			],
		};

		const telegramText = formatBriefingTelegram(briefing);

		const result: ToolResult = {
			success:       true,
			contentBlocks: [moversCard, portfolioCard],
			textSummary:   telegramText,
			sources: [
				{ name: 'Binance 24h Ticker', url: 'https://api.binance.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
