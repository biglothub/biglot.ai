// Unified Risk Dashboard Tool — T-1401
// Tool: get_risk_dashboard

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { listPositions } from '../portfolio/tracker';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import { buildRiskDashboard } from '../data/riskDashboard.data';
import { DEFAULT_LIMITS, buildRiskSnapshot } from '../risk/drawdownMonitor';
import type { ContentBlock, GaugeBlock, MetricCardBlock, HeatmapBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchPriceMap(symbols: string[]): Promise<Map<string, number>> {
	const priceMap = new Map<string, number>();
	await Promise.all(
		symbols.map(async (symbol) => {
			try {
				const result = await fetchBinanceOHLCV(symbol, '1d', 1);
				if (!('error' in result) && result.ohlcv.length > 0) {
					priceMap.set(symbol.toUpperCase(), result.ohlcv[result.ohlcv.length - 1].close);
				}
			} catch {
				// skip — position will use entryPrice as fallback
			}
		}),
	);
	return priceMap;
}

function fmtUsd(v: number): string {
	const sign = v >= 0 ? '$' : '-$';
	return `${sign}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number, decimals = 1): string {
	const sign = v >= 0 ? '+' : '';
	return `${sign}${v.toFixed(decimals)}%`;
}

const RISK_LEVEL_COLOR: Record<string, string> = {
	safe: '#22c55e',
	warning: '#eab308',
	danger: '#f97316',
	critical: '#ef4444',
};

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_risk_dashboard',
	description:
		'Unified Risk Dashboard — consolidates all risk dimensions into one view: portfolio drawdown, position-level risk, concentration risk (largest position %), beta-adjusted exposure, 95% daily VaR (parametric), and stress test worst case. Returns a unified risk score 0-100, per-asset risk heatmap, per-position breakdown table, and AI commentary. Use when asked about overall portfolio risk, risk dashboard, or "how risky is my portfolio".',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID to load portfolio positions from (required).',
			},
			account_size: {
				type: 'number',
				description: 'Total account size in USD used to calculate risk percentages (required).',
			},
			max_drawdown_pct: {
				type: 'number',
				description: 'Max allowed drawdown % before alert (default: 20).',
			},
		},
		required: ['user_id', 'account_size'],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id.trim() : '';
		const accountSize = typeof args.account_size === 'number' ? args.account_size : 0;

		if (!userId) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'user_id is required.', tool: 'get_risk_dashboard' }],
				textSummary: 'Error: user_id is required.',
			};
		}
		if (accountSize <= 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'account_size must be a positive number.', tool: 'get_risk_dashboard' }],
				textSummary: 'Error: account_size must be a positive number.',
			};
		}

		const maxDrawdownPct =
			typeof args.max_drawdown_pct === 'number' ? args.max_drawdown_pct : DEFAULT_LIMITS.maxDrawdownPct;

		const cacheKey = toolCache.generateKey('get_risk_dashboard', { userId, accountSize, maxDrawdownPct });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch portfolio positions ──────────────────────────────────────────
		let positions;
		try {
			positions = await listPositions(userId);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to fetch portfolio positions.';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'get_risk_dashboard' }],
				textSummary: `Error: ${msg}`,
			};
		}

		// ── Fetch live prices ──────────────────────────────────────────────────
		const symbols = [...new Set(positions.map((p) => p.symbol.toUpperCase()))];
		const priceMap = symbols.length > 0 ? await fetchPriceMap(symbols) : new Map<string, number>();

		// ── Get portfolio drawdown from snapshot ───────────────────────────────
		let currentDrawdownPct = 0;
		try {
			const { buildPortfolioSnapshot } = await import('../portfolio/tracker');
			const snapshot = await buildPortfolioSnapshot(userId, priceMap);
			const riskSnapshot = buildRiskSnapshot(snapshot, accountSize, {
				maxDrawdownPct,
				dailyLossLimitPct: DEFAULT_LIMITS.dailyLossLimitPct,
				maxOpenRiskPct: DEFAULT_LIMITS.maxOpenRiskPct,
			});
			currentDrawdownPct = riskSnapshot.drawdown.currentDrawdownPct;
		} catch {
			// non-fatal — use 0 drawdown
		}

		// ── Build risk dashboard ───────────────────────────────────────────────
		const dashboard = buildRiskDashboard(positions, priceMap, accountSize, currentDrawdownPct);

		// ── GaugeBlock — overall risk score ───────────────────────────────────
		const gaugeBlock: GaugeBlock = {
			type: 'gauge',
			title: 'Portfolio Risk Score',
			value: dashboard.overallRiskScore,
			label: dashboard.riskLevel.toUpperCase(),
			thresholds: [
				{ value: 0,  color: RISK_LEVEL_COLOR.safe,     label: 'Safe' },
				{ value: 50, color: RISK_LEVEL_COLOR.warning,  label: 'Warning' },
				{ value: 75, color: RISK_LEVEL_COLOR.danger,   label: 'Danger' },
				{ value: 90, color: RISK_LEVEL_COLOR.critical, label: 'Critical' },
			],
		};

		// ── MetricCard — key risk metrics ──────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `Risk Dashboard — ${fmtUsd(accountSize)} Account`,
			metrics: [
				{
					label: '95% Daily VaR',
					value: fmtUsd(dashboard.portfolioVaR95Usd),
					change: `${fmtPct(dashboard.portfolioVaR95Pct)} of account`,
					direction: dashboard.portfolioVaR95Pct > 3 ? 'down' : 'neutral',
				},
				{
					label: 'Max Drawdown',
					value: `${dashboard.maxDrawdownPct.toFixed(1)}%`,
					change: `Limit: ${maxDrawdownPct}%`,
					direction: dashboard.maxDrawdownPct > maxDrawdownPct * 0.75 ? 'down' : 'neutral',
				},
				{
					label: 'Concentration Risk',
					value: `${dashboard.concentrationRisk.toFixed(1)}%`,
					change: dashboard.topConcentrationSymbol,
					direction: dashboard.concentrationRisk > 40 ? 'down' : 'neutral',
				},
				{
					label: 'Beta-Adj Exposure',
					value: `${dashboard.betaAdjustedExposure.toFixed(1)}%`,
					change: 'BTC-equivalent risk vs account',
					direction: dashboard.betaAdjustedExposure > 100 ? 'down' : 'neutral',
				},
				{
					label: 'Worst Stress Scenario',
					value: `${fmtPct(dashboard.stressWorstCasePct)}`,
					change: dashboard.stressScenarioName,
					direction: 'down',
				},
				{
					label: 'Portfolio Value',
					value: fmtUsd(dashboard.totalPortfolioValue),
					change: `${((dashboard.totalPortfolioValue / accountSize) * 100).toFixed(1)}% of account deployed`,
					direction: 'neutral',
				},
			],
		};

		const contentBlocks: ContentBlock[] = [gaugeBlock, metricBlock];

		// ── HeatmapBlock — per-asset risk matrix ───────────────────────────────
		if (dashboard.heatmapAssets.length > 0) {
			const heatmapBlock: HeatmapBlock = {
				type: 'heatmap',
				title: 'Risk Contribution by Asset',
				assets: dashboard.heatmapAssets,
				timeframes: dashboard.heatmapRows,
				data: dashboard.heatmapData,
				colorScale: 'redgreen',
			};
			contentBlocks.push(heatmapBlock);
		}

		// ── TableBlock — per-position breakdown ────────────────────────────────
		if (dashboard.positions.length > 0) {
			const tableBlock: TableBlock = {
				type: 'table',
				title: 'Per-Position Risk Breakdown',
				headers: ['Symbol', 'Side', 'Value', 'Alloc %', 'Unr PnL', 'VaR 95%', 'Open Risk', 'Beta', 'Risk %'],
				rows: dashboard.positions.map((p) => [
					p.symbol,
					p.direction.toUpperCase(),
					fmtUsd(p.positionValueUsd),
					`${p.concentrationPct.toFixed(1)}%`,
					`${fmtPct(p.unrealisedPnlPct)} (${fmtUsd(p.unrealisedPnlUsd)})`,
					fmtUsd(p.varUsd95),
					`${p.openRiskPct.toFixed(1)}%`,
					p.betaVsBtc.toFixed(2),
					`${p.riskContributionPct.toFixed(1)}%`,
				]),
			};
			contentBlocks.push(tableBlock);
		}

		// ── TextBlock — AI commentary ──────────────────────────────────────────
		const textBlock: TextBlock = {
			type: 'text',
			content: dashboard.commentary,
		};
		contentBlocks.push(textBlock);

		// ── Build summary ──────────────────────────────────────────────────────
		const posCount = dashboard.positions.length;
		const textSummary = [
			`Risk dashboard: ${dashboard.riskLevel.toUpperCase()} (${dashboard.overallRiskScore}/100).`,
			`${posCount} position${posCount !== 1 ? 's' : ''},`,
			`portfolio value: ${fmtUsd(dashboard.totalPortfolioValue)}.`,
			`VaR: ${fmtPct(dashboard.portfolioVaR95Pct)} ($${dashboard.portfolioVaR95Usd.toFixed(0)}).`,
			`Drawdown: ${dashboard.maxDrawdownPct.toFixed(1)}%.`,
			`Concentration: ${dashboard.topConcentrationSymbol} at ${dashboard.concentrationRisk.toFixed(1)}%.`,
			`Beta exposure: ${dashboard.betaAdjustedExposure.toFixed(1)}%.`,
			`Stress worst case: ${fmtPct(dashboard.stressWorstCasePct)} (${dashboard.stressScenarioName}).`,
		].join(' ');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [{ name: 'Portfolio Risk Analysis', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 60_000); // 1 min cache
		return result;
	},
});
