// Risk Scenario Simulator (What-If) Tool — T-1306
// Tool: simulate_scenario — NL "What if" scenario → quantitative portfolio impact

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getClientWithFallback } from '../aiProvider.server';
import { listPositions } from '../portfolio/tracker';
import {
	buildScenarioParsePrompt,
	buildImplicationsPrompt,
	parseScenarioAssumptions,
	fallbackParseScenario,
	simulateScenario,
} from '../data/scenarioSimulator.data';
import type { ContentBlock, MetricCardBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 1): string {
	const sign = v >= 0 ? '+' : '';
	return `${sign}${v.toFixed(decimals)}%`;
}

function fmtUsd(v: number): string {
	const abs = Math.abs(v);
	const sign = v >= 0 ? '+$' : '-$';
	return `${sign}${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'simulate_scenario',
	description:
		'Risk Scenario Simulator (What-If) — takes a natural-language scenario (e.g. "What if Fed cuts 50bps and BTC breaks $100k?", "What happens to my portfolio in a recession?") and simulates quantitative portfolio impact. LLM parses the scenario into asset shocks, applies them to the portfolio, and returns projected PnL + hedging suggestions. Returns MetricCard (projected PnL, most exposed position) + TableBlock (per-asset impact) + TextBlock (implications + hedging suggestions). Use when user asks "what if", "what happens if", "how would my portfolio react to", or any hypothetical scenario question.',
	parameters: {
		type: 'object',
		properties: {
			scenario: {
				type: 'string',
				description: 'Natural-language scenario description, e.g. "What if Fed cuts 50bps and BTC breaks $100k?"',
			},
			user_id: {
				type: 'string',
				description: 'User ID to load positions from portfolio tracker. If omitted, uses symbols/weights.',
			},
			symbols: {
				type: 'array',
				items: { type: 'string' },
				description: 'Custom list of symbols (e.g. ["BTCUSDT","ETHUSDT"]). Used when user_id not provided.',
			},
			weights: {
				type: 'array',
				items: { type: 'number' },
				description: 'Fractional weights matching symbols (must sum to 1). Default: equal-weight.',
			},
			total_value: {
				type: 'number',
				description: 'Total portfolio USD value (default: 10000)',
			},
		},
		required: ['scenario'],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		const scenarioText = typeof args.scenario === 'string' && args.scenario.trim()
			? args.scenario.trim()
			: 'What if BTC pumps 50% and the Fed cuts rates?';

		const totalValue = typeof args.total_value === 'number' && args.total_value > 0
			? args.total_value
			: 10_000;

		// ── Build portfolio ───────────────────────────────────────────────────
		let symbols: string[] = [];
		let weights: number[] = [];

		if (typeof args.user_id === 'string' && args.user_id) {
			const positions = await listPositions(args.user_id);
			if (positions.length === 0) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'No open positions found in portfolio. Add positions first or provide custom symbols.',
						tool: 'simulate_scenario',
					}],
					textSummary: 'No portfolio positions to simulate.',
				};
			}
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
				const sum = parsed.reduce((a, b) => a + b, 0);
				weights = sum > 0 ? parsed.map(w => w / sum) : symbols.map(() => 1 / symbols.length);
			} else {
				weights = symbols.map(() => 1 / symbols.length);
			}
		}

		// ── Cache check ───────────────────────────────────────────────────────
		const cacheKey = toolCache.generateKey('simulate_scenario', { scenarioText, symbols, weights, totalValue });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── LLM: Parse scenario → quantitative assumptions ────────────────────
		let assumptions = fallbackParseScenario(scenarioText);

		try {
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.2,
				max_tokens: 400,
				messages: [
					{ role: 'user', content: buildScenarioParsePrompt(scenarioText) },
				],
			});
			const raw = completion.choices[0]?.message?.content ?? '';
			const parsed = parseScenarioAssumptions(raw);
			if (parsed) assumptions = parsed;
		} catch {
			// use keyword fallback (already set above)
		}

		// ── Simulate ──────────────────────────────────────────────────────────
		const result = simulateScenario(assumptions, symbols, weights, totalValue);

		// ── LLM: Implications + hedging suggestions ───────────────────────────
		let implications = '';

		try {
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.4,
				max_tokens: 600,
				messages: [
					{ role: 'user', content: buildImplicationsPrompt(result, scenarioText) },
				],
			});
			implications = completion.choices[0]?.message?.content?.trim() ?? '';
		} catch {
			// build fallback implications
		}

		if (!implications) {
			implications = buildFallbackImplications(result, scenarioText);
		}

		// ── MetricCard ────────────────────────────────────────────────────────
		const pnlDirection = result.portfolioPnlPct >= 0.02 ? 'up'
			: result.portfolioPnlPct <= -0.02 ? 'down'
			: 'neutral';

		const confidenceLabelMap = {
			high: 'High — specific quantitative scenario',
			medium: 'Medium — qualitative scenario',
			low: 'Low — vague scenario',
		};

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `What-If: ${assumptions.scenarioTitle}`,
			metrics: [
				{
					label: 'Projected Portfolio PnL',
					value: fmtPct(result.portfolioPnlPct * 100, 1),
					change: fmtUsd(result.portfolioPnlUsd),
					direction: pnlDirection,
				},
				{
					label: 'Most Exposed Position',
					value: result.mostExposedSymbol,
					change: fmtUsd(result.mostExposedPnlUsd),
					direction: result.mostExposedPnlUsd >= 0 ? 'up' : 'down',
				},
				{
					label: 'Portfolio Value',
					value: `$${totalValue.toLocaleString()}`,
					change: `After: $${(totalValue + result.portfolioPnlUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
					direction: pnlDirection,
				},
				{
					label: 'Estimate Confidence',
					value: assumptions.confidence.charAt(0).toUpperCase() + assumptions.confidence.slice(1),
					change: confidenceLabelMap[assumptions.confidence],
					direction: assumptions.confidence === 'high' ? 'up' : assumptions.confidence === 'low' ? 'down' : 'neutral',
				},
			],
		};

		// ── TableBlock — per-asset impact ─────────────────────────────────────
		const tableBlock: TableBlock = {
			type: 'table',
			title: `Per-Asset Impact — "${assumptions.scenarioTitle}"`,
			headers: ['Asset', 'Weight', 'Shock', 'Portfolio Impact', 'PnL $'],
			rows: result.perAsset.map(a => [
				a.symbol,
				`${a.weightPct.toFixed(1)}%`,
				fmtPct(a.shockPct, 1),
				fmtPct(a.portfolioImpactPct, 2),
				fmtUsd(a.pnlUsd),
			]),
		};

		// ── TextBlock — implications ──────────────────────────────────────────
		const textBlock: TextBlock = {
			type: 'text',
			content: `## Scenario Analysis\n\n**Scenario:** ${assumptions.description}\n\n${implications}\n\n*Disclaimer: This is a hypothetical simulation based on estimated asset shocks. Actual market outcomes may differ significantly. This is not financial advice.*`,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock, textBlock];

		const textSummary =
			`Scenario "${assumptions.scenarioTitle}": portfolio ${fmtPct(result.portfolioPnlPct * 100, 1)} ` +
			`(${fmtUsd(result.portfolioPnlUsd)}) on $${totalValue.toLocaleString()} portfolio. ` +
			`Most exposed: ${result.mostExposedSymbol} (${fmtUsd(result.mostExposedPnlUsd)}). ` +
			`Confidence: ${assumptions.confidence}.`;

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{ name: 'LLM Scenario Analysis', accessedAt: Date.now() },
				{ name: 'Historical Stress Test Patterns', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, toolResult, 15 * 60_000); // 15 min cache
		return toolResult;
	},
});

// ─── Fallback implications ────────────────────────────────────────────────────

function buildFallbackImplications(
	result: ReturnType<typeof simulateScenario>,
	scenarioText: string,
): string {
	const pnlPct = result.portfolioPnlPct * 100;
	const sign = pnlPct >= 0 ? 'gain' : 'loss';
	const topLoser = result.perAsset.find(a => a.pnlUsd < 0);
	const topGainer = result.perAsset.find(a => a.pnlUsd > 0);

	const lines = [
		`## Implications`,
		'',
		`In this scenario ("${scenarioText}"), your portfolio would experience a projected **${Math.abs(pnlPct).toFixed(1)}% ${sign}** of ${result.portfolioPnlUsd >= 0 ? '+' : ''}$${result.portfolioPnlUsd.toFixed(0)}.`,
		'',
	];

	if (topLoser) {
		lines.push(`**Key vulnerability:** ${topLoser.symbol} is your most exposed position with a projected loss of $${Math.abs(topLoser.pnlUsd).toFixed(0)}.`);
		lines.push('');
	}

	if (topGainer) {
		lines.push(`**Natural hedge:** ${topGainer.symbol} provides some offset with a projected gain of $${topGainer.pnlUsd.toFixed(0)}.`);
		lines.push('');
	}

	lines.push('**Hedging suggestions:**');
	lines.push('1. Consider reducing concentration in your most exposed positions before such a scenario materializes.');
	lines.push('2. Look at non-correlated assets (e.g., Gold/TLT) as partial hedges.');
	lines.push('3. Use position sizing to limit any single asset to <25% of portfolio in high-volatility regimes.');

	return lines.join('\n');
}
