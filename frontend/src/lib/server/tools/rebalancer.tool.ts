// Portfolio Rebalancer Tool — T-705
// Tool: rebalance_portfolio

import { registerTool, type ToolResult } from './registry';
import { listPositions } from '../portfolio/tracker';
import { rebalance, type CurrentHolding, type TargetAllocation } from '../risk/rebalancer';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

async function fetchCurrentPrice(symbol: string): Promise<number> {
	try {
		const result = await fetchBinanceOHLCV(symbol.toUpperCase(), '1d', 1);
		if ('error' in result || result.ohlcv.length === 0) return 0;
		return result.ohlcv[result.ohlcv.length - 1].close;
	} catch {
		return 0;
	}
}

registerTool({
	name: 'rebalance_portfolio',
	description:
		'Portfolio rebalancer — given target allocations (%), compares to current portfolio holdings (from portfolio tracker), and computes required buy/sell trades. Supports fixed-weight (user-provided targets) and risk-parity (inverse-volatility weighting) methods. Returns MetricCard showing portfolio drift and a trades table. Use when user asks to rebalance, optimize allocations, or compute required trades.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID to fetch portfolio from',
			},
			targets: {
				type: 'array',
				description: 'Target allocations as array of {symbol, targetPct} objects. Required for fixed_weight method.',
				items: {
					type: 'object',
					properties: {
						symbol:    { type: 'string' },
						targetPct: { type: 'number' },
					},
					required: ['symbol', 'targetPct'],
				},
			},
			method: {
				type: 'string',
				enum: ['fixed_weight', 'risk_parity'],
				description: 'Rebalancing method: fixed_weight (use provided targets) or risk_parity (inverse-volatility weights). Default: fixed_weight',
			},
		},
		required: ['user_id'],
	},
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : '';
		const method: 'fixed_weight' | 'risk_parity' =
			args.method === 'risk_parity' ? 'risk_parity' : 'fixed_weight';

		// Parse target allocations
		const targets: TargetAllocation[] = [];
		if (Array.isArray(args.targets)) {
			for (const t of args.targets) {
				if (typeof t === 'object' && t !== null &&
					typeof (t as Record<string, unknown>).symbol    === 'string' &&
					typeof (t as Record<string, unknown>).targetPct === 'number') {
					targets.push({
						symbol:    (t as { symbol: string; targetPct: number }).symbol.toUpperCase(),
						targetPct: (t as { symbol: string; targetPct: number }).targetPct,
					});
				}
			}
		}

		if (method === 'fixed_weight' && targets.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Provide target allocations for fixed_weight method, e.g. [{symbol:"BTC",targetPct:50},{symbol:"ETH",targetPct:50}]', tool: 'rebalance_portfolio' }],
				textSummary: 'No target allocations provided.',
			};
		}

		// Fetch current positions
		const positions = await listPositions(userId);
		if (positions.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'No open positions found in portfolio. Add positions first with the add_position tool.', tool: 'rebalance_portfolio' }],
				textSummary: 'Portfolio is empty.',
			};
		}

		// Build holdings with current market values
		const holdings: CurrentHolding[] = [];
		for (const pos of positions) {
			const price = (await fetchCurrentPrice(pos.symbol)) || pos.entryPrice;
			const valueUSD = price * pos.size;
			holdings.push({ symbol: pos.symbol, valueUSD });
		}

		const result = rebalance(holdings, targets, method);

		// ── MetricCard ────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Portfolio Rebalance — ${method === 'risk_parity' ? 'Risk Parity' : 'Fixed Weight'}`,
			metrics: [
				{
					label:     'Total Portfolio Value',
					value:     `$${result.totalValueUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
					change:    `${positions.length} positions`,
					direction: 'neutral',
				},
				{
					label:     'Max Drift',
					value:     `${result.maxDriftPct.toFixed(2)}%`,
					change:    result.maxDriftPct > 10 ? 'Rebalancing recommended' : result.maxDriftPct > 5 ? 'Minor drift' : 'Well balanced',
					direction: result.maxDriftPct > 10 ? 'down' : result.maxDriftPct > 5 ? 'neutral' : 'up',
				},
				{
					label:     'Method',
					value:     method === 'risk_parity' ? 'Risk Parity' : 'Fixed Weight',
					change:    method === 'risk_parity' ? 'Inverse volatility weighting' : 'User-defined targets',
					direction: 'neutral',
				},
				{
					label:     'Trades Required',
					value:     result.trades.length.toString(),
					change:    result.trades.length === 0 ? 'Portfolio already balanced' : `${result.trades.filter(t => t.action === 'buy').length} buys, ${result.trades.filter(t => t.action === 'sell').length} sells`,
					direction: result.trades.length === 0 ? 'up' : 'neutral',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Trades table ──────────────────────────────────────────────────────
		if (result.trades.length > 0) {
			const tradesTable: TableBlock = {
				type:    'table',
				title:   'Required Trades',
				headers: ['Symbol', 'Action', 'Amount (USD)', 'Current %', 'Target %', 'Drift'],
				rows:    result.trades.map(t => [
					t.symbol,
					t.action.toUpperCase(),
					`$${t.valueUSD.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
					`${t.currentPct.toFixed(2)}%`,
					`${t.targetPct.toFixed(2)}%`,
					`${t.driftPct > 0 ? '+' : ''}${t.driftPct.toFixed(2)}%`,
				]),
			};
			contentBlocks.push(tradesTable);
		}

		// ── Target weights table ──────────────────────────────────────────────
		if (result.effectiveTargets.length > 0) {
			const targetsTable: TableBlock = {
				type:    'table',
				title:   'Effective Target Weights',
				headers: ['Symbol', 'Target %'],
				rows:    result.effectiveTargets
					.sort((a, b) => b.targetPct - a.targetPct)
					.map(t => [t.symbol, `${t.targetPct.toFixed(2)}%`]),
			};
			contentBlocks.push(targetsTable);
		}

		const summary = result.trades.length === 0
			? `Portfolio is already balanced (max drift: ${result.maxDriftPct.toFixed(2)}%).`
			: `${result.trades.length} trades needed. Max drift: ${result.maxDriftPct.toFixed(2)}%. Total value: $${result.totalValueUSD.toLocaleString()}.`;

		return { success: true, contentBlocks, textSummary: summary };
	},
});

