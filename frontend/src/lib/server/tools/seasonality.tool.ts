// Seasonality Analysis Tool — T-704
// Tool: get_seasonality

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildSeasonalityData, MONTH_NAMES } from '../data/seasonality.data';
import type { ContentBlock, MetricCardBlock, HeatmapBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_seasonality',
	description:
		'Seasonality analysis — computes monthly average returns and day-of-week effects from multi-year historical data. Shows which months are statistically strongest/weakest, current month\'s seasonal outlook, and win rates. Returns HeatmapBlock (monthly heatmap) + MetricCard (best/worst months) + tables. Use when user asks about seasonal patterns, best time to buy, monthly trends, or "sell in May".',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Yahoo Finance symbol (e.g. BTC-USD, AAPL, SPY, GLD). Default: BTC-USD',
			},
			years: {
				type: 'number',
				description: 'Years of history (default: 5, min: 2, max: 10)',
			},
		},
		required: [],
	},
	timeout: 35_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol = typeof args.symbol === 'string' && args.symbol ? args.symbol.toUpperCase() : 'BTC-USD';
		const years  = Math.min(10, Math.max(2, typeof args.years === 'number' ? args.years : 5));

		const cacheKey = toolCache.generateKey('get_seasonality', { symbol, years });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const data = await buildSeasonalityData(symbol, years);

		if (data.monthlyScores.every(s => s.totalYears === 0)) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `No historical data available for ${symbol}.`, tool: 'get_seasonality' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const { monthlyScores, dowScores, bestMonths, worstMonths, currentMonthScore } = data;

		// ── Monthly Heatmap ────────────────────────────────────────────────────
		// HeatmapBlock: assets = months, timeframes = ['Avg Return %', 'Win Rate %', 'Score']
		const heatmap: HeatmapBlock = {
			type:       'heatmap',
			title:      `Monthly Seasonality — ${symbol} (${years}y)`,
			assets:     MONTH_NAMES,
			timeframes: ['Avg Return %', 'Win Rate %'],
			data:       [
				monthlyScores.map(s => parseFloat(s.avgReturnPct.toFixed(2))),
				monthlyScores.map(s => parseFloat(s.winRate.toFixed(1))),
			],
			colorScale: 'redgreen',
		};

		// ── MetricCard ─────────────────────────────────────────────────────────
		const bestLabels  = bestMonths.map(m => MONTH_NAMES[m - 1]).join(', ');
		const worstLabels = worstMonths.map(m => MONTH_NAMES[m - 1]).join(', ');

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Seasonal Outlook — ${symbol}`,
			metrics: [
				{
					label:     'Current Month',
					value:     currentMonthScore ? MONTH_NAMES[currentMonthScore.month - 1] : 'Unknown',
					change:    currentMonthScore
						? `Avg: ${currentMonthScore.avgReturnPct >= 0 ? '+' : ''}${currentMonthScore.avgReturnPct.toFixed(2)}% | Win rate: ${currentMonthScore.winRate.toFixed(0)}%`
						: 'No data',
					direction: currentMonthScore && currentMonthScore.score > 0 ? 'up' : 'down',
				},
				{
					label:     'Best Months (historical)',
					value:     bestLabels,
					change:    `Avg returns: ${bestMonths.map(m => `${MONTH_NAMES[m - 1]} ${monthlyScores[m - 1].avgReturnPct >= 0 ? '+' : ''}${monthlyScores[m - 1].avgReturnPct.toFixed(1)}%`).join(', ')}`,
					direction: 'up',
				},
				{
					label:     'Worst Months (historical)',
					value:     worstLabels,
					change:    `Avg returns: ${worstMonths.map(m => `${MONTH_NAMES[m - 1]} ${monthlyScores[m - 1].avgReturnPct >= 0 ? '+' : ''}${monthlyScores[m - 1].avgReturnPct.toFixed(1)}%`).join(', ')}`,
					direction: 'down',
				},
				{
					label:     'Data Period',
					value:     `${years} years`,
					change:    `${monthlyScores.reduce((s, m) => s + m.totalYears, 0)} monthly observations`,
					direction: 'neutral',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [heatmap, metricBlock];

		// ── Monthly Detail Table ───────────────────────────────────────────────
		const monthTable: TableBlock = {
			type:    'table',
			title:   `Monthly Stats — ${symbol}`,
			headers: ['Month', 'Avg Return', 'Median', 'Win Rate', 'Years', 'Score'],
			rows:    monthlyScores.map(s => [
				s.monthName,
				`${s.avgReturnPct >= 0 ? '+' : ''}${s.avgReturnPct.toFixed(2)}%`,
				`${s.medianReturn >= 0 ? '+' : ''}${s.medianReturn.toFixed(2)}%`,
				`${s.winRate.toFixed(0)}%`,
				s.totalYears.toString(),
				`${s.score > 0 ? '+' : ''}${s.score}`,
			]),
		};
		contentBlocks.push(monthTable);

		// ── Day-of-Week Table ──────────────────────────────────────────────────
		if (dowScores.length > 0) {
			const dowTable: TableBlock = {
				type:    'table',
				title:   `Day-of-Week Effect — ${symbol}`,
				headers: ['Day', 'Avg Daily %', 'Samples'],
				rows:    dowScores
					.filter(d => d.dayIndex >= 1 && d.dayIndex <= 5) // Mon–Fri
					.map(d => [
						d.dayName,
						`${d.avgReturnPct >= 0 ? '+' : ''}${d.avgReturnPct.toFixed(3)}%`,
						d.sampleCount.toString(),
					]),
			};
			contentBlocks.push(dowTable);
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} seasonality (${years}y): Best months: ${bestLabels}. Worst: ${worstLabels}. Current month (${currentMonthScore?.monthName ?? 'N/A'}): avg ${currentMonthScore?.avgReturnPct.toFixed(2) ?? '?'}%, win rate ${currentMonthScore?.winRate.toFixed(0) ?? '?'}%.`,
			sources: [
				{ name: 'Yahoo Finance', url: 'https://finance.yahoo.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 4 * 60 * 60_000); // 4 hour cache (data doesn't change intraday)
		return result;
	},
});
