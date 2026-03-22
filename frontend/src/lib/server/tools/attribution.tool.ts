// Strategy Performance Attribution Tool — T-905
// Tool: attribute_performance

import { registerTool, type ToolResult } from './registry';
import { listJournalEntries } from '../portfolio/journal';
import { attributePerformance, type AttributionRow } from '../portfolio/attribution';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPnl(usd: number): string {
	return `${usd >= 0 ? '+' : ''}$${Math.abs(usd).toFixed(2)}`;
}

function fmtR(r: number): string {
	return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

function rowsToTable(rows: AttributionRow[]): (string | number)[][] {
	return rows.map(r => [
		r.label,
		r.tradeCount,
		`${r.winRate.toFixed(1)}%`,
		fmtPnl(r.avgPnl),
		fmtR(r.avgR),
		fmtPnl(r.totalPnl),
	]);
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'attribute_performance',
	description:
		'Strategy performance attribution — analyses closed trade journal entries and breaks down performance by: day of week (Mon–Sun), setup type, emotion at entry, and plan adherence (followed plan vs broke plan). Identifies best/worst conditions by average R-multiple. Returns MetricCard (best/worst conditions, overall stats) + breakdown TableBlocks. Use when asked about performance patterns, best/worst trading days, emotion impact on trading, or which setups work best.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID to fetch trade journal for (required).',
			},
			limit: {
				type: 'number',
				description: 'Max trades to analyse (default: 200, max: 500).',
			},
		},
		required: ['user_id'],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : '';
		if (!userId) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'user_id is required for attribution.', tool: 'attribute_performance' }],
				textSummary: 'Error: user_id is required.',
			};
		}

		const limit   = Math.min(500, Math.max(10, typeof args.limit === 'number' ? args.limit : 200));
		const entries = await listJournalEntries(userId, limit);

		if (entries.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'No journal entries found. Log some trades first.', tool: 'attribute_performance' }],
				textSummary: 'No trade journal entries found.',
			};
		}

		const result   = attributePerformance(entries);
		const content: ContentBlock[] = [];

		// ── MetricCard — overview ──────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Performance Attribution — ${result.totalTrades} trades`,
			metrics: [
				{
					label:     'Overall Win Rate',
					value:     `${result.overallWinRate.toFixed(1)}%`,
					change:    `${result.totalTrades} trades analysed`,
					direction: result.overallWinRate >= 50 ? 'up' : 'down',
				},
				{
					label:     'Overall Avg R',
					value:     fmtR(result.overallAvgR),
					change:    result.overallAvgR > 0 ? 'Positive expectancy' : 'Negative expectancy',
					direction: result.overallAvgR > 0 ? 'up' : 'down',
				},
				...(result.bestCondition ? [{
					label:     'Best Condition',
					value:     result.bestCondition.label,
					change:    `${fmtR(result.bestCondition.avgR)} avg R (${result.bestCondition.tradeCount} trades)`,
					direction: 'up' as const,
				}] : []),
				...(result.worstCondition ? [{
					label:     'Worst Condition',
					value:     result.worstCondition.label,
					change:    `${fmtR(result.worstCondition.avgR)} avg R (${result.worstCondition.tradeCount} trades)`,
					direction: 'down' as const,
				}] : []),
			],
		};
		content.push(metricBlock);

		// ── Table: Day of week ─────────────────────────────────────────────────
		if (result.byDayOfWeek.length > 0) {
			content.push({
				type:    'table',
				title:   'Performance by Day of Week',
				headers: ['Day', 'Trades', 'Win Rate', 'Avg PnL', 'Avg R', 'Total PnL'],
				rows:    rowsToTable(result.byDayOfWeek),
			} as TableBlock);
		}

		// ── Table: Setup type ─────────────────────────────────────────────────
		if (result.bySetupType.length > 0) {
			content.push({
				type:    'table',
				title:   'Performance by Setup Type',
				headers: ['Setup', 'Trades', 'Win Rate', 'Avg PnL', 'Avg R', 'Total PnL'],
				rows:    rowsToTable(result.bySetupType),
			} as TableBlock);
		}

		// ── Table: Emotion ────────────────────────────────────────────────────
		if (result.byEmotion.length > 0) {
			content.push({
				type:    'table',
				title:   'Performance by Emotion',
				headers: ['Emotion', 'Trades', 'Win Rate', 'Avg PnL', 'Avg R', 'Total PnL'],
				rows:    rowsToTable(result.byEmotion),
			} as TableBlock);
		}

		// ── Table: Plan adherence ─────────────────────────────────────────────
		if (result.byPlanAdhere.length > 0) {
			content.push({
				type:    'table',
				title:   'Performance by Plan Adherence',
				headers: ['Condition', 'Trades', 'Win Rate', 'Avg PnL', 'Avg R', 'Total PnL'],
				rows:    rowsToTable(result.byPlanAdhere),
			} as TableBlock);
		}

		const bestText  = result.bestCondition  ? `Best: ${result.bestCondition.label} (${fmtR(result.bestCondition.avgR)}).` : '';
		const worstText = result.worstCondition ? `Worst: ${result.worstCondition.label} (${fmtR(result.worstCondition.avgR)}).` : '';

		return {
			success: true,
			contentBlocks: content,
			textSummary: `Performance attribution (${result.totalTrades} trades): Win rate ${result.overallWinRate.toFixed(1)}%, avg R ${fmtR(result.overallAvgR)}. ${bestText} ${worstText}`,
		};
	},
});
