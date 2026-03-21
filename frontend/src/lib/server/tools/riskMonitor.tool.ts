// Risk Monitor Tool — T-303
// Monitors drawdown, daily loss, and open risk. Returns GaugeBlock + alerts.
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { buildRiskSnapshot, DEFAULT_LIMITS, type RiskLimits } from '../risk/drawdownMonitor';
import { listPositions } from '../portfolio/tracker';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';

const DEFAULT_USER = 'default';

async function fetchPriceMap(symbols: string[]): Promise<Map<string, number>> {
	const priceMap = new Map<string, number>();
	await Promise.all(symbols.map(async (symbol) => {
		try {
			const result = await fetchBinanceOHLCV(symbol, '1d', 1);
			if (!('error' in result) && result.ohlcv.length > 0) {
				priceMap.set(symbol.toUpperCase(), result.ohlcv[result.ohlcv.length - 1].close);
			}
		} catch {
			// skip
		}
	}));
	return priceMap;
}

function riskLevelColor(level: string): string {
	if (level === 'critical') return '#ef4444';
	if (level === 'danger') return '#f97316';
	if (level === 'warning') return '#eab308';
	return '#22c55e';
}

function fmt(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
	if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
	return `$${n.toFixed(2)}`;
}

registerTool({
	name: 'monitor_portfolio_risk',
	description:
		'Monitor real-time portfolio risk: current drawdown from peak equity, daily loss vs limit, total open risk from stops. Returns risk gauge, alerts on threshold breaches. Use when user asks about portfolio risk, drawdown, daily limits, or position risk.',
	parameters: {
		type: 'object',
		properties: {
			account_size: {
				type: 'number',
				description: 'Total account size in USD (e.g. 10000)'
			},
			max_drawdown_pct: {
				type: 'number',
				description: 'Max allowed drawdown % before alert (default: 20)'
			},
			daily_loss_limit_pct: {
				type: 'number',
				description: 'Max allowed daily loss as % of account (default: 5)'
			},
			max_open_risk_pct: {
				type: 'number',
				description: 'Max allowed open risk as % of account (default: 10)'
			},
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")'
			}
		},
		required: ['account_size']
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.account_size || Number(args.account_size) <= 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'account_size must be a positive number.', tool: 'monitor_portfolio_risk' }],
				textSummary: 'Error: account_size required.'
			};
		}

		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const accountSize = Number(args.account_size);

		const limits: RiskLimits = {
			maxDrawdownPct: typeof args.max_drawdown_pct === 'number' ? args.max_drawdown_pct : DEFAULT_LIMITS.maxDrawdownPct,
			dailyLossLimitPct: typeof args.daily_loss_limit_pct === 'number' ? args.daily_loss_limit_pct : DEFAULT_LIMITS.dailyLossLimitPct,
			maxOpenRiskPct: typeof args.max_open_risk_pct === 'number' ? args.max_open_risk_pct : DEFAULT_LIMITS.maxOpenRiskPct,
		};

		const cacheKey = toolCache.generateKey('monitor_portfolio_risk', { userId, accountSize, limits });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Build portfolio snapshot with live prices
		let snapshot;
		try {
			const { buildPortfolioSnapshot } = await import('../portfolio/tracker');
			const positions = await listPositions(userId);
			const symbols = [...new Set(positions.map(p => p.symbol))];
			const priceMap = symbols.length > 0 ? await fetchPriceMap(symbols) : new Map();
			snapshot = await buildPortfolioSnapshot(userId, priceMap);
		} catch {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to fetch portfolio data.', tool: 'monitor_portfolio_risk' }],
				textSummary: 'Error: Could not fetch portfolio for risk monitoring.'
			};
		}

		const risk = buildRiskSnapshot(snapshot, accountSize, limits);

		// GaugeBlock — overall risk score
		const gaugeBlock: ToolResult['contentBlocks'][number] = {
			type: 'gauge',
			title: 'Portfolio Risk Score',
			value: Math.round(risk.overallRiskScore),
			label: risk.overallRiskLevel.toUpperCase(),
			thresholds: [
				{ value: 0, color: '#22c55e', label: 'Safe' },
				{ value: 50, color: '#eab308', label: 'Warning' },
				{ value: 75, color: '#f97316', label: 'Danger' },
				{ value: 90, color: '#ef4444', label: 'Critical' },
			],
		};

		// MetricCard — individual metrics
		const dailyLossSign = risk.dailyLoss.dailyPnL < 0 ? 'down' : 'up';
		const metricsBlock: ToolResult['contentBlocks'][number] = {
			type: 'metric_card',
			title: 'Risk Metrics',
			metrics: [
				{
					label: 'Drawdown',
					value: `${risk.drawdown.currentDrawdownPct.toFixed(2)}% / ${limits.maxDrawdownPct}%`,
					direction: risk.drawdown.riskLevel === 'safe' ? 'neutral' : 'down',
				},
				{
					label: 'Daily PnL',
					value: fmt(risk.dailyLoss.dailyPnL),
					direction: risk.dailyLoss.dailyPnL >= 0 ? 'up' : 'down',
				},
				{
					label: 'Daily Loss Limit Used',
					value: `${risk.dailyLoss.usedPct.toFixed(1)}%`,
					direction: risk.dailyLoss.breached ? 'down' : risk.dailyLoss.usedPct >= 75 ? 'down' : 'neutral',
				},
				{
					label: 'Open Risk',
					value: `${fmt(risk.openRisk.totalOpenRiskUSD)} (${risk.openRisk.accountRiskPct.toFixed(1)}% of account)`,
					direction: risk.openRisk.accountRiskPct >= limits.maxOpenRiskPct ? 'down' : 'neutral',
				},
				{
					label: 'Positions Without Stop',
					value: String(risk.openRisk.positionsWithoutStop),
					direction: risk.openRisk.positionsWithoutStop > 0 ? 'down' : 'neutral',
				},
				{
					label: 'Peak Equity',
					value: fmt(risk.drawdown.peakEquity),
					direction: 'neutral',
				},
			],
		};

		const contentBlocks: ToolResult['contentBlocks'] = [gaugeBlock, metricsBlock];

		// Alert rows table if there are alerts
		if (risk.alerts.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Active Alerts',
				headers: ['Alert'],
				rows: risk.alerts.map(a => [a]),
			});
		}

		const alertSummary = risk.alerts.length > 0
			? ` Alerts: ${risk.alerts.join(' | ')}`
			: ' No active alerts.';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Risk score: ${Math.round(risk.overallRiskScore)}/100 (${risk.overallRiskLevel}). Drawdown: ${risk.drawdown.currentDrawdownPct.toFixed(2)}%, daily PnL: ${fmt(risk.dailyLoss.dailyPnL)}, open risk: ${fmt(risk.openRisk.totalOpenRiskUSD)} (${risk.openRisk.accountRiskPct.toFixed(1)}%).${alertSummary}`
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});
