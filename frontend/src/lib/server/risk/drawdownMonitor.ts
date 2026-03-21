// Drawdown Monitor — T-303
// Real-time risk monitoring: drawdown %, daily loss, open risk, alerts

import type { PortfolioSnapshot } from '$lib/types/portfolio';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'safe' | 'warning' | 'danger' | 'critical';

export type DrawdownMetrics = {
	currentDrawdownPct: number;   // % from peak equity (0–100)
	peakEquity: number;
	currentEquity: number;
	riskLevel: RiskLevel;
};

export type DailyLossMetrics = {
	dailyPnL: number;             // today's realised + unrealised PnL
	limitUSD: number;             // configured daily loss limit in USD
	usedPct: number;              // how much of limit consumed (0–100+)
	breached: boolean;
};

export type OpenRiskMetrics = {
	totalOpenRiskUSD: number;     // sum of risk per position that has a stop
	accountRiskPct: number;       // totalOpenRisk as % of account
	positionsWithoutStop: number; // positions with no stop (uncapped risk)
	maxPositionRiskPct: number;   // largest single-position risk as % of account
};

export type RiskSnapshot = {
	drawdown: DrawdownMetrics;
	dailyLoss: DailyLossMetrics;
	openRisk: OpenRiskMetrics;
	overallRiskScore: number;     // 0–100 composite score
	overallRiskLevel: RiskLevel;
	alerts: string[];
};

export type RiskLimits = {
	maxDrawdownPct: number;       // e.g. 20 → alert if drawdown > 20%
	dailyLossLimitPct: number;    // e.g. 5 → daily loss limit = 5% of account
	maxOpenRiskPct: number;       // e.g. 10 → warn if open risk > 10% of account
};

export const DEFAULT_LIMITS: RiskLimits = {
	maxDrawdownPct: 20,
	dailyLossLimitPct: 5,
	maxOpenRiskPct: 10,
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Classify a 0–100 percentage into a risk level using supplied thresholds. */
export function classifyRiskLevel(pct: number, thresholds = { warning: 50, danger: 75, critical: 90 }): RiskLevel {
	if (pct >= thresholds.critical) return 'critical';
	if (pct >= thresholds.danger) return 'danger';
	if (pct >= thresholds.warning) return 'warning';
	return 'safe';
}

/**
 * Calculate the current drawdown from the equity curve.
 * Returns 0 if there is no equity history.
 */
export function calcCurrentDrawdown(
	equityCurve: { date: string; equity: number }[],
	startingEquity: number
): DrawdownMetrics {
	if (equityCurve.length === 0) {
		return {
			currentDrawdownPct: 0,
			peakEquity: startingEquity,
			currentEquity: startingEquity,
			riskLevel: 'safe',
		};
	}

	// Peak is the maximum equity across the curve or starting capital
	let peak = startingEquity;
	for (const point of equityCurve) {
		if (point.equity > peak) peak = point.equity;
	}

	const current = equityCurve[equityCurve.length - 1].equity;
	const drawdownPct = peak > 0 ? Math.max(0, (peak - current) / peak * 100) : 0;

	return {
		currentDrawdownPct: drawdownPct,
		peakEquity: peak,
		currentEquity: current,
		riskLevel: classifyRiskLevel(drawdownPct),
	};
}

/**
 * Calculate daily PnL for today (UTC date).
 * Includes today's closed trades + current unrealised PnL from open positions.
 */
export function calcDailyPnL(snapshot: PortfolioSnapshot, todayUtc: string): number {
	// Realised: closed trades with closedAt on today
	const realisedToday = snapshot.closedTrades
		.filter(t => t.closedAt.startsWith(todayUtc))
		.reduce((sum, t) => sum + t.pnlUSD, 0);

	// Unrealised: sum of all open positions
	const unrealised = snapshot.totalUnrealisedPnL;

	return realisedToday + unrealised;
}

/**
 * Calculate open risk from positions that have a stop price.
 * For positions without a stop, they are flagged but not measured.
 */
export function calcOpenRisk(
	snapshot: PortfolioSnapshot,
	accountSize: number
): OpenRiskMetrics {
	let totalOpenRiskUSD = 0;
	let positionsWithoutStop = 0;
	let maxPositionRiskUSD = 0;

	for (const pos of snapshot.positions) {
		if (pos.stopPrice === null) {
			positionsWithoutStop++;
			continue;
		}
		const posRisk = Math.abs(pos.entryPrice - pos.stopPrice) * pos.size;
		totalOpenRiskUSD += posRisk;
		if (posRisk > maxPositionRiskUSD) maxPositionRiskUSD = posRisk;
	}

	const accountRiskPct = accountSize > 0 ? (totalOpenRiskUSD / accountSize) * 100 : 0;
	const maxPositionRiskPct = accountSize > 0 ? (maxPositionRiskUSD / accountSize) * 100 : 0;

	return {
		totalOpenRiskUSD,
		accountRiskPct,
		positionsWithoutStop,
		maxPositionRiskPct,
	};
}

/**
 * Compute a composite risk score (0–100) from the three risk dimensions.
 * Weights: drawdown 40%, daily loss 35%, open risk 25%.
 */
export function calcOverallRiskScore(
	drawdownPct: number,
	maxDrawdownPct: number,
	dailyLossUsedPct: number,
	openRiskPct: number,
	maxOpenRiskPct: number
): number {
	const drawdownScore = Math.min(100, (drawdownPct / maxDrawdownPct) * 100);
	const dailyLossScore = Math.min(100, dailyLossUsedPct);
	const openRiskScore = Math.min(100, (openRiskPct / maxOpenRiskPct) * 100);

	return drawdownScore * 0.4 + dailyLossScore * 0.35 + openRiskScore * 0.25;
}

/**
 * Build a full risk snapshot from portfolio data and configured limits.
 */
export function buildRiskSnapshot(
	snapshot: PortfolioSnapshot,
	accountSize: number,
	limits: RiskLimits = DEFAULT_LIMITS
): RiskSnapshot {
	const todayUtc = new Date().toISOString().slice(0, 10);

	// Drawdown — equity curve starts at accountSize as baseline
	const drawdown = calcCurrentDrawdown(snapshot.equityCurve, accountSize);

	// Daily loss
	const dailyPnL = calcDailyPnL(snapshot, todayUtc);
	const dailyLimitUSD = accountSize * (limits.dailyLossLimitPct / 100);
	const dailyLossUSD = Math.max(0, -dailyPnL);  // only loss counts
	const dailyLossUsedPct = dailyLimitUSD > 0 ? (dailyLossUSD / dailyLimitUSD) * 100 : 0;

	const dailyLoss: DailyLossMetrics = {
		dailyPnL,
		limitUSD: dailyLimitUSD,
		usedPct: dailyLossUsedPct,
		breached: dailyLossUsedPct >= 100,
	};

	// Open risk
	const openRisk = calcOpenRisk(snapshot, accountSize);

	// Overall risk score
	const drawdownScore = Math.min(100, (drawdown.currentDrawdownPct / limits.maxDrawdownPct) * 100);
	const overallRiskScore = calcOverallRiskScore(
		drawdown.currentDrawdownPct,
		limits.maxDrawdownPct,
		dailyLossUsedPct,
		openRisk.accountRiskPct,
		limits.maxOpenRiskPct
	);
	const overallRiskLevel = classifyRiskLevel(overallRiskScore);

	// Build alerts
	const alerts: string[] = [];

	if (drawdown.currentDrawdownPct >= limits.maxDrawdownPct) {
		alerts.push(`CRITICAL: Drawdown ${drawdown.currentDrawdownPct.toFixed(1)}% exceeds limit of ${limits.maxDrawdownPct}%.`);
	} else if (drawdown.currentDrawdownPct >= limits.maxDrawdownPct * 0.75) {
		alerts.push(`WARNING: Drawdown ${drawdown.currentDrawdownPct.toFixed(1)}% approaching limit of ${limits.maxDrawdownPct}%.`);
	}

	if (dailyLoss.breached) {
		alerts.push(`CRITICAL: Daily loss limit breached — lost $${dailyLossUSD.toFixed(2)} of $${dailyLimitUSD.toFixed(2)} limit.`);
	} else if (dailyLossUsedPct >= 75) {
		alerts.push(`WARNING: ${dailyLossUsedPct.toFixed(1)}% of daily loss limit used ($${dailyLossUSD.toFixed(2)} of $${dailyLimitUSD.toFixed(2)}).`);
	}

	if (openRisk.accountRiskPct >= limits.maxOpenRiskPct) {
		alerts.push(`WARNING: Open risk ${openRisk.accountRiskPct.toFixed(1)}% of account exceeds limit of ${limits.maxOpenRiskPct}%.`);
	}

	if (openRisk.positionsWithoutStop > 0) {
		alerts.push(`INFO: ${openRisk.positionsWithoutStop} position${openRisk.positionsWithoutStop > 1 ? 's' : ''} have no stop-loss set.`);
	}

	if (drawdownScore >= 100) {
		// already alerted above
	}

	return {
		drawdown,
		dailyLoss,
		openRisk,
		overallRiskScore,
		overallRiskLevel,
		alerts,
	};
}
