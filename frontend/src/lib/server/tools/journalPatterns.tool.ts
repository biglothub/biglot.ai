// Trading Journal Pattern Analyzer Tool — T-1307
// Tool: analyze_journal_patterns

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { listJournalEntries } from '../portfolio/journal';
import {
	analyzeJournalPatterns,
	buildPatternPrompt,
	parsePatternCoaching,
	buildFallbackPatternCoaching,
} from '../data/journalPatterns.data';
import { getClientWithFallback } from '../aiProvider.server';
import type {
	ContentBlock,
	MetricCardBlock,
	TableBlock,
	TextBlock,
	GaugeBlock,
} from '$lib/types/contentBlock';

const DEFAULT_USER = 'default';

registerTool({
	name: 'analyze_journal_patterns',
	description:
		'Trading Journal Pattern Analyzer — finds behavioral and performance patterns in your trade journal. Analyzes best/worst setup types, day-of-week performance, win rate by emotion state, streak analysis, position sizing consistency, and common mistakes. Generates AI coaching like "You win 73% on pullbacks but 31% on breakouts — consider dropping breakouts." Returns MetricCard (total trades, win rate, key insight, best setup) + TableBlock (setup type patterns) + TableBlock (emotion & day-of-week breakdown) + GaugeBlock (discipline score) + TextBlock (AI coaching). Use when user wants to find patterns in their trading, review journal statistics, improve consistency, or get personalized coaching from their trade history.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default").',
			},
			limit: {
				type: 'number',
				description: 'Number of recent journal entries to analyze (default: 200, max: 500).',
			},
		},
		required: [],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' && args.user_id ? args.user_id : DEFAULT_USER;
		const limit  = typeof args.limit  === 'number' ? Math.min(500, Math.max(10, args.limit)) : 200;

		const cacheKey = toolCache.generateKey('analyze_journal_patterns', { userId, limit });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch journal entries ─────────────────────────────────────────────
		const entries = await listJournalEntries(userId, limit);

		if (entries.length === 0) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: 'No journal entries found. Log some trades first using the trade journal tool.',
					tool: 'analyze_journal_patterns',
				}],
				textSummary: 'No journal entries found. Add trades to your journal first.',
			};
		}

		// ── Analyze patterns ──────────────────────────────────────────────────
		const bundle = analyzeJournalPatterns(entries);

		// ── LLM Coaching ──────────────────────────────────────────────────────
		let coaching = '';
		try {
			const prompt = buildPatternPrompt(bundle);
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.5,
				max_tokens: 600,
				messages: [{ role: 'user', content: prompt }],
			});
			coaching = parsePatternCoaching(completion.choices[0]?.message?.content ?? '') ?? '';
		} catch {
			// LLM unavailable — use deterministic fallback
		}
		if (!coaching) coaching = buildFallbackPatternCoaching(bundle);

		// ── MetricCard ────────────────────────────────────────────────────────
		const winRateStr = bundle.overallWinRate !== null
			? `${(bundle.overallWinRate * 100).toFixed(1)}%`
			: 'N/A';

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `Journal Pattern Analysis — ${bundle.totalTrades} Trades`,
			metrics: [
				{
					label: 'Total Trades',
					value: `${bundle.totalTrades}`,
					change: `${bundle.closedTrades} closed`,
					direction: 'neutral',
				},
				{
					label: 'Overall Win Rate',
					value: winRateStr,
					direction: bundle.overallWinRate === null ? 'neutral'
						: bundle.overallWinRate >= 0.5 ? 'up' : 'down',
				},
				{
					label: 'Key Insight',
					value: bundle.keyInsight,
					direction: 'neutral',
				},
				{
					label: 'Best Setup',
					value: bundle.topSetup ?? 'Not enough data',
					direction: bundle.topSetup ? 'up' : 'neutral',
				},
				{
					label: 'Current Streak',
					value: bundle.streak.currentStreakType === 'none'
						? 'N/A'
						: `${bundle.streak.currentStreakCount} ${bundle.streak.currentStreakType === 'win' ? 'wins' : 'losses'}`,
					direction: bundle.streak.currentStreakType === 'win' ? 'up'
						: bundle.streak.currentStreakType === 'loss' ? 'down'
						: 'neutral',
				},
				{
					label: 'Discipline Score',
					value: `${bundle.disciplineScore}/100`,
					change: bundle.disciplineScore >= 70 ? 'Good' : bundle.disciplineScore >= 50 ? 'Average' : 'Needs work',
					direction: bundle.disciplineScore >= 70 ? 'up' : bundle.disciplineScore >= 50 ? 'neutral' : 'down',
				},
			],
		};

		// ── TableBlock — Setup Patterns ───────────────────────────────────────
		const setupTable: TableBlock = {
			type: 'table',
			title: 'Performance by Setup Type',
			headers: ['Setup Type', 'Trades', 'Wins', 'Win Rate', 'Avg R', 'Total P&L'],
			rows: bundle.setupPatterns.length > 0
				? bundle.setupPatterns.map(s => [
					s.setupType,
					s.tradeCount,
					s.wins,
					`${(s.winRate * 100).toFixed(1)}%`,
					s.avgRMultiple !== null ? s.avgRMultiple.toFixed(2) : 'N/A',
					s.totalPnlUSD !== null ? `$${s.totalPnlUSD.toFixed(2)}` : 'N/A',
				])
				: [['No setup data recorded', '', '', '', '', '']],
		};

		// ── TableBlock — Emotion & Day Patterns ───────────────────────────────
		const emotionDayTable: TableBlock = {
			type: 'table',
			title: 'Performance by Emotion & Day of Week',
			headers: ['Category', 'Type', 'Trades', 'Win Rate', 'Avg P&L'],
			rows: [
				...bundle.emotionPatterns.map(e => [
					'Emotion',
					e.emotion,
					e.tradeCount,
					`${(e.winRate * 100).toFixed(1)}%`,
					e.avgPnlUSD !== null ? `$${e.avgPnlUSD.toFixed(2)}` : 'N/A',
				] as (string | number)[]),
				...bundle.dayPatterns.map(d => [
					'Day',
					d.day,
					d.tradeCount,
					`${(d.winRate * 100).toFixed(1)}%`,
					d.avgPnlUSD !== null ? `$${d.avgPnlUSD.toFixed(2)}` : 'N/A',
				] as (string | number)[]),
			],
		};

		// ── GaugeBlock — Discipline Score ─────────────────────────────────────
		const disciplineLabel =
			bundle.disciplineScore >= 80 ? 'Highly Disciplined'
			: bundle.disciplineScore >= 60 ? 'Disciplined'
			: bundle.disciplineScore >= 40 ? 'Developing'
			: 'Needs Focus';

		const gaugeBlock: GaugeBlock = {
			type: 'gauge',
			title: 'Discipline Score',
			value: bundle.disciplineScore,
			label: disciplineLabel,
			thresholds: [
				{ value: 40,  color: '#ef4444', label: 'Low' },
				{ value: 70,  color: '#f59e0b', label: 'Average' },
				{ value: 100, color: '#22c55e', label: 'High' },
			],
		};

		// ── TextBlock — AI Coaching ───────────────────────────────────────────
		const coachingBlock: TextBlock = {
			type: 'text',
			content: coaching.startsWith('##') ? coaching : `## Trading Coach Analysis\n\n${coaching}`,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, setupTable, emotionDayTable, gaugeBlock, coachingBlock];

		const streakStr = bundle.streak.currentStreakType !== 'none'
			? ` Current ${bundle.streak.currentStreakCount}-${bundle.streak.currentStreakType} streak.`
			: '';

		const textSummary =
			`Journal analysis: ${bundle.totalTrades} trades, ${winRateStr} win rate, ` +
			`discipline score ${bundle.disciplineScore}/100. ` +
			`${bundle.keyInsight}.${streakStr}` +
			(bundle.sizing.oversizedOnLoss ? ' WARNING: position sizes larger on losses than wins.' : '') +
			(bundle.topSetup ? ` Best setup: ${bundle.topSetup}.` : '');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5-min cache
		return result;
	},
});
