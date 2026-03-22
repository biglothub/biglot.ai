// Yield Curve & Macro Regime Tool — T-803
// Tool: get_yield_curve

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildYieldCurveSnapshot } from '../data/yieldCurve.data';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_yield_curve',
	description:
		'US Treasury yield curve — fetches current yields for 3M, 2Y, 5Y, 10Y, 30Y Treasuries and computes key spreads (2s10s, 3m10y, 5s30s). Classifies curve as normal/flat/inverted and explains macro regime implications. Inverted yield curves historically precede recessions. Returns MetricCard (yields, classification) + spreads table + full curve table. Use when asked about bonds, Treasury yields, yield curve inversion, recession indicators, or macro rate environment.',
	parameters: {
		type: 'object',
		properties: {},
		required: [],
	},
	timeout: 30_000,
	execute: async (_args): Promise<ToolResult> => {
		const cacheKey = 'get_yield_curve:us_treasuries';
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const snap = await buildYieldCurveSnapshot();

		if (snap.yields.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Unable to fetch US Treasury yields. Markets may be closed or data unavailable.', tool: 'get_yield_curve' }],
				textSummary: 'Error: could not fetch Treasury yield data.',
			};
		}

		// ── MetricCard ─────────────────────────────────────────────────────────
		const y10 = snap.yields.find(y => y.maturity === '10Y');
		const y2  = snap.yields.find(y => y.maturity === '2Y');
		const y3m = snap.yields.find(y => y.maturity === '3M');
		const s2s10s = snap.spreads.find(s => s.name.includes('2s10s'));

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: 'US Treasury Yield Curve',
			metrics: [
				{
					label:     'Curve Classification',
					value:     snap.classification.toUpperCase(),
					change:    snap.classificationLabel,
					direction: snap.classification === 'inverted' ? 'down' :
					           snap.classification === 'normal'   ? 'up'   : 'neutral',
				},
				...(y10 ? [{
					label:     '10Y Treasury',
					value:     `${y10.yield.toFixed(2)}%`,
					change:    `${y10.change >= 0 ? '+' : ''}${y10.change.toFixed(1)}bps`,
					direction: (y10.change >= 0 ? 'up' : 'down') as 'up' | 'down' | 'neutral',
				}] : []),
				...(y2 ? [{
					label:     '2Y Treasury',
					value:     `${y2.yield.toFixed(2)}%`,
					change:    `${y2.change >= 0 ? '+' : ''}${y2.change.toFixed(1)}bps`,
					direction: (y2.change >= 0 ? 'up' : 'down') as 'up' | 'down' | 'neutral',
				}] : []),
				...(y3m ? [{
					label:     '3M T-Bill',
					value:     `${y3m.yield.toFixed(2)}%`,
					change:    `${y3m.change >= 0 ? '+' : ''}${y3m.change.toFixed(1)}bps`,
					direction: (y3m.change >= 0 ? 'up' : 'down') as 'up' | 'down' | 'neutral',
				}] : []),
				...(s2s10s ? [{
					label:     '2s10s Spread',
					value:     `${s2s10s.spread >= 0 ? '+' : ''}${s2s10s.spread.toFixed(0)} bps`,
					change:    s2s10s.signal,
					direction: (s2s10s.spread < 0 ? 'down' : s2s10s.spread < 50 ? 'neutral' : 'up') as 'up' | 'down' | 'neutral',
				}] : []),
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Yield Curve Table ──────────────────────────────────────────────────
		const curveTable: TableBlock = {
			type:    'table',
			title:   'US Treasury Yields',
			headers: ['Maturity', 'Yield (%)', 'Prev (%)', 'Change (bps)'],
			rows:    snap.yields.map(y => [
				y.maturity,
				y.yield.toFixed(2),
				y.prevYield.toFixed(2),
				`${y.change >= 0 ? '+' : ''}${y.change.toFixed(1)}`,
			]),
		};
		contentBlocks.push(curveTable);

		// ── Spreads Table ──────────────────────────────────────────────────────
		if (snap.spreads.length > 0) {
			const spreadsTable: TableBlock = {
				type:    'table',
				title:   'Key Yield Spreads',
				headers: ['Spread', 'Short End', 'Long End', 'Spread (bps)', 'Signal'],
				rows:    snap.spreads.map(s => [
					s.name,
					`${s.shortYield.toFixed(2)}%`,
					`${s.longYield.toFixed(2)}%`,
					`${s.spread >= 0 ? '+' : ''}${s.spread.toFixed(0)}`,
					s.signal,
				]),
			};
			contentBlocks.push(spreadsTable);
		}

		const classification2s10s = s2s10s
			? `2s10s spread: ${s2s10s.spread >= 0 ? '+' : ''}${s2s10s.spread.toFixed(0)}bps (${s2s10s.signal}). `
			: '';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `US Treasury Yield Curve: ${snap.classification.toUpperCase()} — ${snap.classificationLabel}. ${classification2s10s}10Y: ${y10?.yield.toFixed(2) ?? 'N/A'}%, 2Y: ${y2?.yield.toFixed(2) ?? 'N/A'}%, 3M: ${y3m?.yield.toFixed(2) ?? 'N/A'}%.`,
			sources: [
				{ name: 'Yahoo Finance Treasury Data', url: 'https://finance.yahoo.com', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 30 * 60_000); // 30 min cache
		return result;
	},
});
