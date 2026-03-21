// Trade Journal Tool — T-305
// Tools: log_trade, review_trades
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { logTrade, listJournalEntries, calcJournalStats } from '../portfolio/journal';

const DEFAULT_USER = 'default';

function fmt(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
	if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
	return `$${n.toFixed(2)}`;
}

// ─── log_trade ────────────────────────────────────────────────────────────────

registerTool({
	name: 'log_trade',
	description:
		'Log a trade to the journal with notes, emotion, setup type, and plan adherence. Use when user wants to record a trade, add trading notes, or log their thought process.',
	parameters: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT)' },
			direction: { type: 'string', enum: ['long', 'short'], description: 'Trade direction' },
			entry_price: { type: 'number', description: 'Entry price' },
			size: { type: 'number', description: 'Position size in units' },
			exit_price: { type: 'number', description: 'Exit price (if trade is closed)' },
			pnl_usd: { type: 'number', description: 'Realised PnL in USD (if closed)' },
			r_multiple: { type: 'number', description: 'R-multiple outcome (e.g. 2.5 = 2.5R win)' },
			setup_type: { type: 'string', description: 'Setup type (e.g. breakout, pullback, reversal, range)' },
			emotion: {
				type: 'string',
				enum: ['calm', 'fearful', 'greedy', 'impulsive', 'disciplined', 'other'],
				description: 'Emotional state when taking the trade'
			},
			pre_notes: { type: 'string', description: 'Pre-trade analysis / rationale' },
			post_notes: { type: 'string', description: 'Post-trade review / lessons learned' },
			mistakes: { type: 'string', description: 'Comma-separated mistake tags (e.g. "moved stop,sized too large")' },
			followed_plan: { type: 'boolean', description: 'Whether the trade followed the original plan' },
			trade_date: { type: 'string', description: 'Trade date YYYY-MM-DD (defaults to today)' },
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: ['symbol', 'direction', 'entry_price', 'size']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol || !args.direction || args.entry_price === undefined || args.size === undefined) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Missing required fields: symbol, direction, entry_price, size.', tool: 'log_trade' }],
				textSummary: 'Error: Missing required trade fields.'
			};
		}

		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const mistakesArr = typeof args.mistakes === 'string'
			? args.mistakes.split(',').map((m: string) => m.trim()).filter(Boolean)
			: [];

		const entry = await logTrade(userId, {
			symbol: String(args.symbol),
			direction: args.direction as 'long' | 'short',
			entryPrice: Number(args.entry_price),
			size: Number(args.size),
			exitPrice: args.exit_price !== undefined ? Number(args.exit_price) : null,
			pnlUSD: args.pnl_usd !== undefined ? Number(args.pnl_usd) : null,
			rMultiple: args.r_multiple !== undefined ? Number(args.r_multiple) : null,
			setupType: typeof args.setup_type === 'string' ? args.setup_type : null,
			emotion: typeof args.emotion === 'string' ? args.emotion as never : null,
			preNotes: typeof args.pre_notes === 'string' ? args.pre_notes : null,
			postNotes: typeof args.post_notes === 'string' ? args.post_notes : null,
			mistakes: mistakesArr,
			followedPlan: typeof args.followed_plan === 'boolean' ? args.followed_plan : null,
			tradeDate: typeof args.trade_date === 'string' ? args.trade_date : null,
		});

		if (!entry) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to save journal entry.', tool: 'log_trade' }],
				textSummary: 'Error: Could not save trade journal entry.'
			};
		}

		// Invalidate review cache
		toolCache.set(toolCache.generateKey('review_trades', { userId }), null as unknown as ToolResult, 0);

		const metrics: { label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[] = [
			{ label: 'Symbol', value: entry.symbol, direction: 'neutral' },
			{ label: 'Direction', value: entry.direction.toUpperCase(), direction: entry.direction === 'long' ? 'up' : 'down' },
			{ label: 'Entry', value: String(entry.entryPrice), direction: 'neutral' },
			{ label: 'Size', value: String(entry.size), direction: 'neutral' },
			{ label: 'Date', value: entry.tradeDate, direction: 'neutral' },
		];
		if (entry.pnlUSD !== null) metrics.push({ label: 'PnL', value: fmt(entry.pnlUSD), direction: entry.pnlUSD >= 0 ? 'up' : 'down' });
		if (entry.rMultiple !== null) metrics.push({ label: 'R-Multiple', value: entry.rMultiple.toFixed(2), direction: entry.rMultiple >= 0 ? 'up' : 'down' });
		if (entry.emotion) metrics.push({ label: 'Emotion', value: entry.emotion, direction: 'neutral' });
		if (entry.setupType) metrics.push({ label: 'Setup', value: entry.setupType, direction: 'neutral' });
		if (entry.followedPlan !== null) metrics.push({ label: 'Followed Plan', value: entry.followedPlan ? 'Yes' : 'No', direction: entry.followedPlan ? 'up' : 'down' });

		const pnlStr = entry.pnlUSD !== null ? `, PnL: ${fmt(entry.pnlUSD)}` : '';
		const rStr = entry.rMultiple !== null ? ` (${entry.rMultiple.toFixed(2)}R)` : '';

		return {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `Trade Logged — ${entry.symbol} ${entry.direction.toUpperCase()}`,
				metrics
			}],
			textSummary: `Logged ${entry.direction.toUpperCase()} ${entry.symbol} @ ${entry.entryPrice}${pnlStr}${rStr} on ${entry.tradeDate}. ID: ${entry.id.slice(0, 8)}.`
		};
	}
});

// ─── review_trades ────────────────────────────────────────────────────────────

registerTool({
	name: 'review_trades',
	description:
		'Review trade journal: win rate, average PnL, R-multiple, best/worst days, common mistakes, emotional trading patterns, plan adherence. Use when user asks about their trading performance, patterns, or wants an AI review of their trades.',
	parameters: {
		type: 'object',
		properties: {
			limit: { type: 'number', description: 'Number of recent entries to analyse (default 50, max 200)' },
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: []
	},
	timeout: 15_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const limit = Math.min(200, typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50);

		const cacheKey = toolCache.generateKey('review_trades', { userId });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const entries = await listJournalEntries(userId, limit);

		if (entries.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'metric_card',
					title: 'Trade Journal',
					metrics: [{ label: 'Entries', value: '0', direction: 'neutral' }]
				}],
				textSummary: 'No journal entries found. Use log_trade to start journaling.'
			};
		}

		const stats = calcJournalStats(entries);

		const metrics: { label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[] = [
			{ label: 'Total Trades', value: String(stats.totalTrades), direction: 'neutral' },
		];
		if (stats.winRate !== null) metrics.push({ label: 'Win Rate', value: `${(stats.winRate * 100).toFixed(1)}%`, direction: stats.winRate >= 0.5 ? 'up' : 'down' });
		if (stats.avgPnL !== null) metrics.push({ label: 'Avg PnL', value: fmt(stats.avgPnL), direction: stats.avgPnL >= 0 ? 'up' : 'down' });
		if (stats.avgRMultiple !== null) metrics.push({ label: 'Avg R', value: stats.avgRMultiple.toFixed(2), direction: stats.avgRMultiple >= 1 ? 'up' : stats.avgRMultiple >= 0 ? 'neutral' : 'down' });
		if (stats.bestDay) metrics.push({ label: 'Best Day', value: `${stats.bestDay.date}: ${fmt(stats.bestDay.pnl)}`, direction: 'up' });
		if (stats.worstDay) metrics.push({ label: 'Worst Day', value: `${stats.worstDay.date}: ${fmt(stats.worstDay.pnl)}`, direction: 'down' });
		if (stats.planAdherenceRate !== null) metrics.push({ label: 'Plan Adherence', value: `${(stats.planAdherenceRate * 100).toFixed(1)}%`, direction: stats.planAdherenceRate >= 0.7 ? 'up' : 'down' });
		if (stats.emotionalTradingPct !== null) metrics.push({ label: 'Emotional Trades', value: `${(stats.emotionalTradingPct * 100).toFixed(1)}%`, direction: stats.emotionalTradingPct > 0.3 ? 'down' : 'neutral' });

		const contentBlocks: ToolResult['contentBlocks'] = [{
			type: 'metric_card',
			title: `Trade Journal Review — Last ${entries.length} Trades`,
			metrics
		}];

		// Common mistakes table
		if (stats.commonMistakes.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Common Mistakes',
				headers: ['Mistake', 'Count'],
				rows: stats.commonMistakes.slice(0, 5).map(m => [m.mistake, m.count])
			});
		}

		// Emotion breakdown table
		if (stats.emotionBreakdown.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Performance by Emotion',
				headers: ['Emotion', 'Trades', 'Win Rate'],
				rows: stats.emotionBreakdown.map(e => [
					e.emotion,
					e.count,
					e.winRate !== null ? `${(e.winRate * 100).toFixed(0)}%` : 'N/A'
				])
			});
		}

		// Identify patterns for text summary
		const patterns: string[] = [];
		if (stats.emotionalTradingPct !== null && stats.emotionalTradingPct > 0.3) {
			patterns.push(`${(stats.emotionalTradingPct * 100).toFixed(0)}% emotional trades detected`);
		}
		if (stats.planAdherenceRate !== null && stats.planAdherenceRate < 0.7) {
			patterns.push(`low plan adherence (${(stats.planAdherenceRate * 100).toFixed(0)}%)`);
		}
		if (stats.commonMistakes.length > 0) {
			patterns.push(`top mistake: "${stats.commonMistakes[0].mistake}" (${stats.commonMistakes[0].count}×)`);
		}

		const summaryParts = [
			`${stats.totalTrades} trades`,
			stats.winRate !== null ? `win rate ${(stats.winRate * 100).toFixed(1)}%` : null,
			stats.avgPnL !== null ? `avg PnL ${fmt(stats.avgPnL)}` : null,
			stats.avgRMultiple !== null ? `avg R ${stats.avgRMultiple.toFixed(2)}` : null,
		].filter(Boolean).join(', ');

		const patternStr = patterns.length > 0 ? ` Patterns: ${patterns.join('; ')}.` : '';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Journal review (${entries.length} entries): ${summaryParts}.${patternStr}`
		};

		toolCache.set(cacheKey, result, 5 * 60_000);
		return result;
	}
});
