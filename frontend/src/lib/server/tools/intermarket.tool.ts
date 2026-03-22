// Intermarket Analysis Tool — T-703
// Tool: get_intermarket_analysis

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildIntermarketSnapshot, riskLabel } from '../data/intermarket.data';
import type { ContentBlock, MetricCardBlock, HeatmapBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_intermarket_analysis',
	description:
		'Intermarket analysis — computes risk-on/risk-off signal from cross-asset relationships: SPY (equities), QQQ (NASDAQ), TLT (long bonds), GLD (gold), USO (oil), BTC (crypto). Identifies whether markets are in risk-on or risk-off mode based on 20-day returns and rolling correlations. Returns risk gauge MetricCard, correlation HeatmapBlock, and divergence table. Use when user asks about risk appetite, macro environment, whether to buy risk assets or safe havens, or intermarket analysis.',
	parameters: {
		type: 'object',
		properties: {
			window_days: {
				type: 'number',
				description: 'Rolling correlation window in days (default: 30, min: 10, max: 60)',
			},
		},
		required: [],
	},
	timeout: 35_000,
	execute: async (args): Promise<ToolResult> => {
		const windowDays = Math.min(60, Math.max(10, typeof args.window_days === 'number' ? args.window_days : 30));

		const cacheKey = toolCache.generateKey('get_intermarket_analysis', { windowDays });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await buildIntermarketSnapshot(windowDays);

		if (snap.assets.length < 3) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Insufficient market data — unable to fetch enough assets.', tool: 'get_intermarket_analysis' }],
				textSummary: 'Error: could not fetch intermarket data.',
			};
		}

		const { riskScore, assets, correlationMatrix, labels, divergences } = snap;
		const label = riskLabel(riskScore);
		const dir: 'up' | 'down' | 'neutral' =
			riskScore >= 25 ? 'up' : riskScore <= -25 ? 'down' : 'neutral';

		// ── MetricCard ─────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: 'Intermarket Risk Signal',
			metrics: [
				{
					label:     'Risk Environment',
					value:     label,
					change:    `Score: ${riskScore > 0 ? '+' : ''}${riskScore} / 100`,
					direction: dir,
				},
				...assets.map(a => ({
					label:     a.label,
					value:     a.latestClose > 0 ? a.latestClose.toFixed(2) : 'N/A',
					change:    `20d: ${a.change20d >= 0 ? '+' : ''}${a.change20d.toFixed(2)}%  1d: ${a.change1d >= 0 ? '+' : ''}${a.change1d.toFixed(2)}%`,
					direction: (a.change20d > 0 ? 'up' : a.change20d < 0 ? 'down' : 'neutral') as 'up' | 'down' | 'neutral',
				})),
			],
		};

		// ── Correlation Heatmap ────────────────────────────────────────────────
		const heatmap: HeatmapBlock = {
			type:       'heatmap',
			title:      `Correlation Matrix (${windowDays}d rolling)`,
			assets:     labels,
			timeframes: labels,
			data:       correlationMatrix,
			colorScale: 'redgreen',
		};

		const contentBlocks: ContentBlock[] = [metricBlock, heatmap];

		// ── Divergence Table ───────────────────────────────────────────────────
		if (divergences.length > 0) {
			const divTable: TableBlock = {
				type:    'table',
				title:   'Key Intermarket Relationships',
				headers: ['Pair', 'Correlation', 'Interpretation'],
				rows:    divergences.map(d => [
					d.pair,
					d.correlation.toFixed(3),
					d.interpretation,
				]),
			};
			contentBlocks.push(divTable);
		}

		// ── 20-day Returns Table ───────────────────────────────────────────────
		const returnsTable: TableBlock = {
			type:    'table',
			title:   '20-Day Performance',
			headers: ['Asset', 'Category', 'Latest Price', '1-Day %', '20-Day %'],
			rows:    assets.map(a => [
				a.label,
				a.category,
				a.latestClose > 0 ? a.latestClose.toFixed(2) : 'N/A',
				`${a.change1d >= 0 ? '+' : ''}${a.change1d.toFixed(2)}%`,
				`${a.change20d >= 0 ? '+' : ''}${a.change20d.toFixed(2)}%`,
			]),
		};
		contentBlocks.push(returnsTable);

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Intermarket signal: ${label} (score ${riskScore > 0 ? '+' : ''}${riskScore}). ${assets.length} assets analyzed. Key: SPY 20d ${assets.find(a => a.label === 'SPY')?.change20d.toFixed(2) ?? '?'}%, TLT 20d ${assets.find(a => a.label === 'TLT')?.change20d.toFixed(2) ?? '?'}%, BTC 20d ${assets.find(a => a.label === 'BTC')?.change20d.toFixed(2) ?? '?'}%.`,
			sources: [
				{ name: 'Yahoo Finance', url: 'https://finance.yahoo.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 30 * 60_000); // 30 min cache
		return result;
	},
});
