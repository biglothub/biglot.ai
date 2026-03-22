// Monte Carlo Portfolio Simulation Tool — T-904
// Tool: simulate_portfolio

import { registerTool, type ToolResult } from './registry';
import { runMonteCarlo } from '../risk/monteCarlo';
import { listClosedTrades } from '../portfolio/tracker';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'simulate_portfolio',
	description:
		'Monte Carlo Portfolio Simulation — runs 1000 simulated paths using bootstrap resampling of your historical trade PnL values. Computes: median projected equity, probability of reaching your target return, probability of ruin (drawdown exceeding threshold), expected max drawdown, and percentile outcomes (5th/25th/50th/75th/95th) at key trade horizons. Requires at least 5 closed trades in the portfolio. Returns MetricCard (key stats) + TableBlock (percentile outcomes). Use when asked about portfolio risk, probability of profit, ruin risk, or long-term performance projections.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID for portfolio lookup. Required.',
			},
			initial_capital: {
				type: 'number',
				description: 'Starting equity in USD for the simulation (default: derived from total realised PnL + 10000).',
			},
			target_return: {
				type: 'number',
				description: 'Target return % to measure probability of hitting (default: 20 = 20%).',
			},
			ruin_threshold: {
				type: 'number',
				description: 'Drawdown % from peak to classify as ruin (default: 30 = 30%).',
			},
			paths: {
				type: 'number',
				description: 'Number of simulation paths (default: 1000, max: 5000).',
			},
			horizon: {
				type: 'number',
				description: 'Number of trades to simulate forward (default: max of 50 or number of historical trades).',
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
				contentBlocks: [{ type: 'error', message: 'user_id is required', tool: 'simulate_portfolio' }],
				textSummary: 'Error: user_id is required.',
			};
		}

		// ── Fetch closed trades ─────────────────────────────────────────────────
		let closedTrades;
		try {
			closedTrades = await listClosedTrades(userId, 200);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to fetch trade history';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'simulate_portfolio' }],
				textSummary: `Error: ${msg}`,
			};
		}

		if (closedTrades.length < 5) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `Need at least 5 closed trades for Monte Carlo simulation. You have ${closedTrades.length}.`,
					tool: 'simulate_portfolio',
				}],
				textSummary: `Error: insufficient trade history (${closedTrades.length} trades). Need ≥5.`,
			};
		}

		// ── Extract returns ─────────────────────────────────────────────────────
		const returns = closedTrades.map(t => t.pnlUSD);

		// ── Config ──────────────────────────────────────────────────────────────
		const totalRealised = returns.reduce((s, r) => s + r, 0);
		const initialCapital = typeof args.initial_capital === 'number' && args.initial_capital > 0
			? args.initial_capital
			: Math.max(1000, 10_000 + totalRealised);

		const targetReturn  = typeof args.target_return  === 'number' ? args.target_return / 100  : 0.20;
		const ruinThreshold = typeof args.ruin_threshold === 'number' ? args.ruin_threshold / 100 : 0.30;
		const paths         = Math.min(5000, Math.max(100, typeof args.paths   === 'number' ? args.paths   : 1000));
		const horizon       = typeof args.horizon === 'number' && args.horizon > 0
			? args.horizon
			: undefined; // let runMonteCarlo choose

		// ── Run simulation ──────────────────────────────────────────────────────
		let sim;
		try {
			sim = runMonteCarlo(returns, { paths, initialCapital, targetReturn, ruinThreshold, horizon });
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Simulation failed';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'simulate_portfolio' }],
				textSummary: `Error: ${msg}`,
			};
		}

		const fmtUSD = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
		const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

		// ── MetricCard ──────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Monte Carlo Simulation — ${sim.paths} paths, ${sim.returnsUsed} trades`,
			metrics: [
				{
					label:     'Median Final Equity',
					value:     fmtUSD(sim.medianFinalValue),
					change:    `from ${fmtUSD(sim.initialCapital)} initial (${fmtPct(sim.medianReturn)})`,
					direction: sim.medianReturn >= 0 ? 'up' : 'down',
				},
				{
					label:     `Probability of Reaching +${(targetReturn * 100).toFixed(0)}%`,
					value:     `${sim.targetProbability.toFixed(1)}%`,
					change:    sim.targetProbability >= 60 ? 'Favorable odds' : sim.targetProbability >= 40 ? 'Moderate odds' : 'Low probability',
					direction: sim.targetProbability >= 50 ? 'up' : 'neutral',
				},
				{
					label:     `Risk of Ruin (>${(ruinThreshold * 100).toFixed(0)}% drawdown)`,
					value:     `${sim.ruinProbability.toFixed(1)}%`,
					change:    sim.ruinProbability < 5 ? 'Very low risk' : sim.ruinProbability < 15 ? 'Manageable risk' : 'High risk — reduce position sizes',
					direction: sim.ruinProbability < 10 ? 'up' : 'down',
				},
				{
					label:     'Expected Max Drawdown',
					value:     `${sim.expectedMaxDrawdown.toFixed(1)}%`,
					change:    'Median across all simulated paths',
					direction: sim.expectedMaxDrawdown < 20 ? 'up' : 'down',
				},
			],
		};

		// ── Percentile outcomes table ────────────────────────────────────────────
		const tableRows = sim.horizonOutcomes.map(h => [
			h.label,
			fmtUSD(h.p5),
			fmtUSD(h.p25),
			fmtUSD(h.p50),
			fmtUSD(h.p75),
			fmtUSD(h.p95),
			fmtPct(((h.p50 - sim.initialCapital) / sim.initialCapital) * 100),
		]);

		const tableBlock: TableBlock = {
			type:    'table',
			title:   `Percentile Outcomes by Horizon`,
			headers: ['Horizon', 'P5 (Bear)', 'P25', 'P50 (Median)', 'P75', 'P95 (Bull)', 'Median Return'],
			rows:    tableRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Monte Carlo simulation (${sim.paths} paths, ${sim.returnsUsed} historical trades): starting from ${fmtUSD(sim.initialCapital)}, median final equity ${fmtUSD(sim.medianFinalValue)} (${fmtPct(sim.medianReturn)}). Probability of reaching +${(targetReturn * 100).toFixed(0)}%: ${sim.targetProbability.toFixed(1)}%. Risk of ruin (>${(ruinThreshold * 100).toFixed(0)}% DD): ${sim.ruinProbability.toFixed(1)}%. Expected max drawdown: ${sim.expectedMaxDrawdown.toFixed(1)}%.`,
			sources: [{ name: 'Monte Carlo Simulation', accessedAt: Date.now() }],
		};

		return result;
	},
});
