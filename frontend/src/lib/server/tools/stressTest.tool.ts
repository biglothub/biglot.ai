// Historical Scenario / Stress Test Tool — T-1102
// Tool: stress_test_portfolio

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { listPositions } from '../portfolio/tracker';
import { runStressTest } from '../risk/stressTest';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 1): string {
	const sign = v >= 0 ? '+' : '';
	return `${sign}${(v * 100).toFixed(decimals)}%`;
}

function fmtUsd(v: number): string {
	const sign = v >= 0 ? '+$' : '-$';
	return `${sign}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'stress_test_portfolio',
	description:
		'Historical Scenario Stress Test — applies 8 predefined historical shock scenarios (COVID crash, GFC 2008, 2022 Crypto Winter, 2018 BTC Bear, DotCom crash, 2020 BTC Halving bull, Taper Tantrum, 2013 BTC Rally) to a portfolio. Uses either the user\'s open portfolio positions or custom symbol/weight inputs. Per scenario: computes portfolio % and $ PnL given asset-specific historical shocks. Returns MetricCard (worst/best scenario, max loss) + scenarios TableBlock sorted worst to best + per-asset detail for the worst scenario. Use when asked about stress testing, scenario analysis, historical shocks, tail risk, or portfolio risk.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type:        'string',
				description: 'User ID to load positions from portfolio tracker. If omitted, uses symbols/weights.',
			},
			symbols: {
				type:        'array',
				items:       { type: 'string' },
				description: 'Custom list of symbols (e.g. ["BTCUSDT","ETHUSDT"]). Used when user_id not provided.',
			},
			weights: {
				type:        'array',
				items:       { type: 'number' },
				description: 'Fractional weights matching symbols (must sum to 1). Default: equal-weight.',
			},
			total_value: {
				type:        'number',
				description: 'Total portfolio USD value (default: 10000)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const totalValue = typeof args.total_value === 'number' && args.total_value > 0
			? args.total_value
			: 10_000;

		let symbols: string[] = [];
		let weights: number[] = [];

		// ── Load from portfolio or use custom inputs ───────────────────────────
		if (typeof args.user_id === 'string' && args.user_id) {
			const positions = await listPositions(args.user_id);
			if (positions.length === 0) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'No open positions found in portfolio.', tool: 'stress_test_portfolio' }],
					textSummary: 'No open positions to stress test.',
				};
			}
			// Build weights from positions (use entryPrice * size as USD value proportions)
			const totalQtyValue = positions.reduce((s, p) => s + p.entryPrice * p.size, 0);
			symbols = positions.map(p => p.symbol);
			weights = positions.map(p => {
				const val = p.entryPrice * p.size;
				return totalQtyValue > 0 ? val / totalQtyValue : 1 / positions.length;
			});
		} else {
			const rawSymbols = Array.isArray(args.symbols) ? (args.symbols as unknown[]) : [];
			symbols = rawSymbols.length > 0
				? rawSymbols.map(s => String(s).toUpperCase().trim()).filter(Boolean)
				: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];

			const rawWeights = Array.isArray(args.weights) ? (args.weights as unknown[]) : [];
			if (rawWeights.length === symbols.length) {
				const parsed = rawWeights.map(w => typeof w === 'number' ? w : 0);
				const sum    = parsed.reduce((a, b) => a + b, 0);
				weights      = sum > 0 ? parsed.map(w => w / sum) : symbols.map(() => 1 / symbols.length);
			} else {
				weights = symbols.map(() => 1 / symbols.length);
			}
		}

		const cacheKey = toolCache.generateKey('stress_test_portfolio', { symbols, weights, totalValue });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Run stress test ───────────────────────────────────────────────────
		const stressResult = runStressTest(symbols, weights, totalValue);
		const { worstScenario, bestScenario, results } = stressResult;

		// ── MetricCard ────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Stress Test — ${symbols.length} Assets | $${totalValue.toLocaleString()} Portfolio`,
			metrics: [
				{
					label:     'Worst Scenario',
					value:     worstScenario.scenario,
					change:    `${fmtPct(worstScenario.portfolioPnlPct)} (${fmtUsd(worstScenario.portfolioPnlUsd)}) · ${worstScenario.period}`,
					direction: 'down',
				},
				{
					label:     'Max Portfolio Loss',
					value:     fmtPct(stressResult.maxSingleLossPct),
					change:    `In "${worstScenario.scenario}" scenario`,
					direction: stressResult.maxSingleLossPct < -0.30 ? 'down' : 'neutral',
				},
				{
					label:     'Best Scenario',
					value:     bestScenario.scenario,
					change:    `${fmtPct(bestScenario.portfolioPnlPct)} (${fmtUsd(bestScenario.portfolioPnlUsd)}) · ${bestScenario.period}`,
					direction: 'up',
				},
				{
					label:     'Portfolio',
					value:     symbols.slice(0, 4).join(' · ') + (symbols.length > 4 ? ' …' : ''),
					change:    weights.slice(0, 4).map((w, i) => `${symbols[i]} ${(w * 100).toFixed(0)}%`).join(' | '),
					direction: 'neutral',
				},
			],
		};

		// ── Scenarios table (sorted worst→best) ───────────────────────────────
		const scenarioRows = results.map(r => [
			r.scenario,
			r.period,
			fmtPct(r.portfolioPnlPct, 1),
			fmtUsd(r.portfolioPnlUsd),
		]);

		const scenariosTable: TableBlock = {
			type:    'table',
			title:   'Scenario Results (worst to best)',
			headers: ['Scenario', 'Period', 'Portfolio PnL%', 'Portfolio PnL $'],
			rows:    scenarioRows,
		};

		// ── Per-asset detail for worst scenario ───────────────────────────────
		const assetRows = worstScenario.assetPnl.map(a => [
			a.symbol,
			`${(a.weight * 100).toFixed(1)}%`,
			fmtPct(a.shock, 0),
			fmtPct(a.pnlPct, 1),
			fmtUsd(a.pnlUsd),
		]);

		const assetTable: TableBlock = {
			type:    'table',
			title:   `Worst Scenario Detail — "${worstScenario.scenario}"`,
			headers: ['Asset', 'Weight', 'Asset Shock', 'Portfolio Impact', 'PnL $'],
			rows:    assetRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, scenariosTable, assetTable];

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Stress test (${symbols.length} assets, $${totalValue.toLocaleString()}): Worst="${worstScenario.scenario}" at ${fmtPct(worstScenario.portfolioPnlPct)} (${fmtUsd(worstScenario.portfolioPnlUsd)}). Best="${bestScenario.scenario}" at ${fmtPct(bestScenario.portfolioPnlPct)}. Max single loss: ${fmtPct(stressResult.maxSingleLossPct)}.`,
			sources: [{ name: 'Historical Scenario Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 60 * 60_000); // 1h cache
		return toolResult;
	},
});
