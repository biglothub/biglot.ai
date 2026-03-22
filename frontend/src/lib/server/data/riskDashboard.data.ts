// Risk Dashboard Data — T-1401
// Pure computation logic for unified risk dashboard

import type { Position } from '$lib/types/portfolio';
import { classifyRiskLevel, type RiskLevel } from '../risk/drawdownMonitor';
import { runStressTest } from '../risk/stressTest';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PositionRiskBreakdown {
	symbol: string;
	direction: 'long' | 'short';
	positionValueUsd: number;
	concentrationPct: number;    // % of total portfolio value
	unrealisedPnlUsd: number;
	unrealisedPnlPct: number;
	dailyVolPct: number;         // estimated 1-day volatility %
	varUsd95: number;            // 95% 1-day VaR in USD (position level)
	openRiskUsd: number;         // risk to stop (|entry - stop| * size); falls back to VaR
	openRiskPct: number;         // openRiskUsd / accountSize * 100
	betaVsBtc: number;           // estimated beta vs BTC
	riskContributionPct: number; // % of total portfolio VaR
}

export interface RiskDashboardData {
	totalPortfolioValue: number;
	concentrationRisk: number;    // largest single position %
	topConcentrationSymbol: string;
	portfolioVaR95Usd: number;    // sum of position VaRs at 95% confidence
	portfolioVaR95Pct: number;    // as % of account
	maxDrawdownPct: number;
	betaAdjustedExposure: number; // beta-weighted exposure % of account
	stressWorstCasePct: number;   // worst-case scenario portfolio loss % (e.g. -35)
	stressScenarioName: string;
	overallRiskScore: number;     // 0-100 composite
	riskLevel: RiskLevel;
	positions: PositionRiskBreakdown[];
	heatmapAssets: string[];
	heatmapRows: string[];
	heatmapData: number[][];      // [row][col] — 0-100 normalized risk scores
	commentary: string;           // markdown risk commentary
}

// ─── Default tables ───────────────────────────────────────────────────────────

/** Estimated 1-day volatility % by base symbol */
const DEFAULT_VOL: Record<string, number> = {
	BTC: 4.5, ETH: 5.5, SOL: 7.0, BNB: 5.0, ADA: 7.0, XRP: 6.0,
	AVAX: 8.0, DOT: 7.0, MATIC: 8.0, LINK: 7.0, DOGE: 9.0, SHIB: 10.0,
	LTC: 5.0, ATOM: 7.0, UNI: 7.0, SPY: 1.2, QQQ: 1.5, GLD: 0.8,
	TLT: 1.0, DXY: 0.4,
};

/** Estimated beta vs BTC by base symbol */
const DEFAULT_BETA: Record<string, number> = {
	BTC: 1.0, ETH: 1.2, SOL: 1.5, BNB: 0.9, ADA: 1.3, XRP: 1.0,
	AVAX: 1.6, DOT: 1.4, MATIC: 1.6, LINK: 1.4, DOGE: 1.3, SHIB: 1.5,
	LTC: 0.9, ATOM: 1.4, UNI: 1.3, SPY: 0.3, QQQ: 0.4, GLD: 0.1,
	TLT: -0.2, DXY: -0.3,
};

// Z-score for 95% one-tailed VaR
const Z_95 = 1.645;

// ─── Symbol helpers ───────────────────────────────────────────────────────────

/**
 * Strip common quote suffixes to get base symbol.
 * e.g. "BTCUSDT" → "BTC", "ETHBTC" → "ETH", "SPY" → "SPY"
 */
export function getBaseSymbol(symbol: string): string {
	const clean = symbol.toUpperCase().replace(/(USDT|USDC|USD|BUSD|BTC|ETH)$/, '');
	return clean || symbol.toUpperCase();
}

/** Estimate 1-day daily volatility % for a symbol */
export function estimateDailyVol(symbol: string): number {
	const base = getBaseSymbol(symbol);
	return DEFAULT_VOL[base] ?? DEFAULT_VOL[symbol.toUpperCase()] ?? 6.0;
}

/** Estimate beta vs BTC for a symbol */
export function estimateBeta(symbol: string): number {
	const base = getBaseSymbol(symbol);
	return DEFAULT_BETA[base] ?? DEFAULT_BETA[symbol.toUpperCase()] ?? 1.0;
}

// ─── Core computations ────────────────────────────────────────────────────────

/**
 * Compute per-position risk breakdowns.
 * All inputs are pure values — no I/O.
 */
export function computePositionRiskBreakdowns(
	positions: Position[],
	priceMap: Map<string, number>,
	accountSize: number,
	totalPortfolioValue: number,
): PositionRiskBreakdown[] {
	if (positions.length === 0) return [];

	// First pass: compute individual metrics
	const raw = positions.map((pos) => {
		const currentPrice = priceMap.get(pos.symbol.toUpperCase()) ?? pos.entryPrice;
		const positionValueUsd = currentPrice * pos.size;
		const concentrationPct = totalPortfolioValue > 0
			? (positionValueUsd / totalPortfolioValue) * 100
			: 0;

		const unrealisedPnlUsd = pos.direction === 'long'
			? (currentPrice - pos.entryPrice) * pos.size
			: (pos.entryPrice - currentPrice) * pos.size;
		const unrealisedPnlPct = pos.entryPrice > 0
			? (unrealisedPnlUsd / (pos.entryPrice * pos.size)) * 100
			: 0;

		const dailyVolPct = estimateDailyVol(pos.symbol);
		const varUsd95 = positionValueUsd * (dailyVolPct / 100) * Z_95;

		const openRiskUsd = pos.stopPrice !== null
			? Math.abs(pos.entryPrice - pos.stopPrice) * pos.size
			: varUsd95; // no stop: use VaR as proxy
		const openRiskPct = accountSize > 0 ? (openRiskUsd / accountSize) * 100 : 0;

		const betaVsBtc = estimateBeta(pos.symbol);

		return {
			symbol: pos.symbol,
			direction: pos.direction,
			positionValueUsd,
			concentrationPct,
			unrealisedPnlUsd,
			unrealisedPnlPct,
			dailyVolPct,
			varUsd95,
			openRiskUsd,
			openRiskPct,
			betaVsBtc,
			riskContributionPct: 0, // filled in second pass
		};
	});

	// Second pass: fill risk contribution %
	const totalVaR = raw.reduce((s, b) => s + b.varUsd95, 0);
	return raw.map((b) => ({
		...b,
		riskContributionPct: totalVaR > 0 ? (b.varUsd95 / totalVaR) * 100 : 0,
	}));
}

/**
 * Compute unified risk score 0-100 and risk level.
 * Weights: drawdown 30%, VaR 25%, concentration 20%, open risk 15%, stress 10%.
 */
export function computeRiskScore(
	maxDrawdownPct: number,
	portfolioVaR95Pct: number,
	concentrationRisk: number,
	openRiskPct: number,
	stressWorstCasePct: number,  // absolute % (e.g. 35 for -35% scenario)
): { score: number; level: RiskLevel } {
	const drawdownScore   = Math.min(100, (maxDrawdownPct / 20) * 100);
	const varScore        = Math.min(100, (portfolioVaR95Pct / 5) * 100);
	const concentScore    = Math.min(100, (concentrationRisk / 50) * 100);
	const openRiskScore   = Math.min(100, (openRiskPct / 10) * 100);
	const stressScore     = Math.min(100, (Math.abs(stressWorstCasePct) / 50) * 100);

	const score = Math.round(
		drawdownScore * 0.30 +
		varScore      * 0.25 +
		concentScore  * 0.20 +
		openRiskScore * 0.15 +
		stressScore   * 0.10,
	);

	return { score, level: classifyRiskLevel(score) };
}

/**
 * Build the risk heatmap grid.
 * Rows = risk dimensions; columns = top-8 assets.
 * Values are 0-100 normalized risk scores.
 */
export function buildRiskHeatmap(
	positions: PositionRiskBreakdown[],
	accountSize: number,
): { assets: string[]; rows: string[]; data: number[][] } {
	const slice = positions.slice(0, 8);
	const assets = slice.map((p) => getBaseSymbol(p.symbol));
	const rows = ['Concentration %', 'Open Risk %', 'Daily VaR %', 'Beta Adj'];

	if (assets.length === 0) {
		return { assets: [], rows, data: [] };
	}

	// Row 0: Concentration (0-100 direct)
	const concentrationRow = slice.map((p) => Math.min(100, p.concentrationPct));

	// Row 1: Open Risk scaled — 10% of account = 100
	const openRiskRow = slice.map((p) => Math.min(100, (p.openRiskPct / 10) * 100));

	// Row 2: Daily VaR scaled — 5% of account = 100
	const varRow = slice.map((p) =>
		accountSize > 0 ? Math.min(100, (p.varUsd95 / accountSize) * 2000) : 0
	);

	// Row 3: Beta-adjusted — beta=2 = 100
	const betaRow = slice.map((p) => Math.min(100, Math.abs(p.betaVsBtc) * 50));

	return { assets, rows, data: [concentrationRow, openRiskRow, varRow, betaRow] };
}

/**
 * Generate markdown AI commentary from risk dashboard data.
 */
export function buildRiskCommentary(data: Omit<RiskDashboardData, 'commentary'>): string {
	const levelEmoji: Record<RiskLevel, string> = {
		safe: '🟢', warning: '🟡', danger: '🟠', critical: '🔴',
	};

	const lines: string[] = [
		`## Risk Dashboard`,
		`**Overall Risk: ${levelEmoji[data.riskLevel]} ${data.riskLevel.toUpperCase()} (${data.overallRiskScore}/100)**`,
		'',
		'### Key Findings',
	];

	if (data.positions.length === 0) {
		lines.push('No open positions detected. Portfolio risk is minimal.');
		return lines.join('\n');
	}

	if (data.concentrationRisk > 40) {
		lines.push(`- Concentration risk: ${data.topConcentrationSymbol} is ${data.concentrationRisk.toFixed(1)}% of portfolio — consider diversifying.`);
	} else {
		lines.push(`- Concentration healthy — top position (${data.topConcentrationSymbol}) at ${data.concentrationRisk.toFixed(1)}%.`);
	}

	if (data.portfolioVaR95Pct > 3) {
		lines.push(`- 95% daily VaR: ${data.portfolioVaR95Pct.toFixed(1)}% ($${data.portfolioVaR95Usd.toFixed(0)}) — above 3% caution threshold.`);
	} else {
		lines.push(`- 95% daily VaR: ${data.portfolioVaR95Pct.toFixed(1)}% ($${data.portfolioVaR95Usd.toFixed(0)}) — within acceptable range.`);
	}

	if (data.maxDrawdownPct > 15) {
		lines.push(`- Drawdown: ${data.maxDrawdownPct.toFixed(1)}% from peak — approaching risk limits.`);
	} else if (data.maxDrawdownPct > 0) {
		lines.push(`- Current drawdown from peak: ${data.maxDrawdownPct.toFixed(1)}%.`);
	} else {
		lines.push('- No current drawdown from peak equity.');
	}

	if (data.stressScenarioName !== 'N/A') {
		lines.push(`- Worst stress scenario ("${data.stressScenarioName}"): ${data.stressWorstCasePct.toFixed(1)}% portfolio impact.`);
	}

	lines.push(`- Beta-adjusted exposure: ${data.betaAdjustedExposure.toFixed(1)}% of account in BTC-equivalent risk.`);

	lines.push('', '### Recommendation');
	if (data.overallRiskScore >= 75) {
		lines.push('Reduce position sizes, add stops, or hedge high-beta exposures immediately.');
	} else if (data.overallRiskScore >= 50) {
		lines.push('Monitor closely. Consider tightening stops on largest positions.');
	} else {
		lines.push('Portfolio risk is within normal bounds. Continue monitoring.');
	}

	return lines.join('\n');
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build the complete unified risk dashboard.
 * Pure computation — no I/O. All data sourced from parameters.
 */
export function buildRiskDashboard(
	positions: Position[],
	priceMap: Map<string, number>,
	accountSize: number,
	maxDrawdownPct: number,
): RiskDashboardData {
	// Total portfolio value
	const totalPortfolioValue = positions.reduce((sum, pos) => {
		const price = priceMap.get(pos.symbol.toUpperCase()) ?? pos.entryPrice;
		return sum + price * pos.size;
	}, 0);

	// Per-position breakdowns
	const positionBreakdowns = computePositionRiskBreakdowns(
		positions, priceMap, accountSize, totalPortfolioValue,
	);

	// Portfolio VaR (conservative sum of individual VaRs)
	const portfolioVaR95Usd = positionBreakdowns.reduce((s, p) => s + p.varUsd95, 0);
	const portfolioVaR95Pct = accountSize > 0 ? (portfolioVaR95Usd / accountSize) * 100 : 0;

	// Concentration risk
	const maxConc = positionBreakdowns.reduce(
		(max, p) => p.concentrationPct > max.value ? { symbol: p.symbol, value: p.concentrationPct } : max,
		{ symbol: '', value: 0 },
	);

	// Total open risk
	const totalOpenRiskUsd = positionBreakdowns.reduce((s, p) => s + p.openRiskUsd, 0);
	const totalOpenRiskPct = accountSize > 0 ? (totalOpenRiskUsd / accountSize) * 100 : 0;

	// Beta-adjusted exposure: Σ(weight_i × beta_i) × (portfolioValue / accountSize)
	const betaAdjustedExposure = totalPortfolioValue > 0 && accountSize > 0
		? positionBreakdowns.reduce((sum, p) => {
			const weight = p.positionValueUsd / totalPortfolioValue;
			return sum + weight * p.betaVsBtc;
		}, 0) * (totalPortfolioValue / accountSize) * 100
		: 0;

	// Stress test
	let stressWorstCasePct = 0;
	let stressScenarioName = 'N/A';
	if (positions.length > 0) {
		const symbols = positions.map((p) => p.symbol.toUpperCase());
		const weights = positions.map((p) => {
			const val = (priceMap.get(p.symbol.toUpperCase()) ?? p.entryPrice) * p.size;
			return totalPortfolioValue > 0 ? val / totalPortfolioValue : 1 / positions.length;
		});
		try {
			const stressResult = runStressTest(symbols, weights, totalPortfolioValue);
			stressWorstCasePct = stressResult.worstScenario.portfolioPnlPct * 100; // fractional → %
			stressScenarioName = stressResult.worstScenario.scenario;
		} catch {
			// non-fatal: leave defaults
		}
	}

	// Overall risk score
	const { score: overallRiskScore, level: riskLevel } = computeRiskScore(
		maxDrawdownPct,
		portfolioVaR95Pct,
		maxConc.value,
		totalOpenRiskPct,
		Math.abs(stressWorstCasePct),
	);

	// Heatmap
	const heatmap = buildRiskHeatmap(positionBreakdowns, accountSize);

	const dataWithoutCommentary = {
		totalPortfolioValue,
		concentrationRisk: maxConc.value,
		topConcentrationSymbol: maxConc.symbol || 'N/A',
		portfolioVaR95Usd,
		portfolioVaR95Pct,
		maxDrawdownPct,
		betaAdjustedExposure,
		stressWorstCasePct,
		stressScenarioName,
		overallRiskScore,
		riskLevel,
		positions: positionBreakdowns,
		heatmapAssets: heatmap.assets,
		heatmapRows: heatmap.rows,
		heatmapData: heatmap.data,
	};

	return { ...dataWithoutCommentary, commentary: buildRiskCommentary(dataWithoutCommentary) };
}
