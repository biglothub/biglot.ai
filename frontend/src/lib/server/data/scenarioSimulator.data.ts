// Scenario Simulator Data — T-1306
// NL "What-If" scenario parsing + portfolio shock application

import { applyScenario, type ScenarioResult } from '../risk/stressTest';
import type { Scenario } from '../risk/stressTest';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedAssetShock {
	symbol: string;     // e.g. "BTC", "ETH", "SPY"
	shock: number;      // fractional (e.g. -0.30 = -30%)
}

export interface ParsedScenarioAssumptions {
	scenarioTitle: string;
	description: string;
	assetShocks: ParsedAssetShock[];
	globalShock: number;   // fallback fractional shock for unspecified assets
	confidence: 'high' | 'medium' | 'low';
}

export interface AssetImpact {
	symbol: string;
	weightPct: number;      // portfolio weight as % (e.g. 33.3)
	shockPct: number;       // shock as display % (e.g. -30)
	portfolioImpactPct: number;  // weighted impact on portfolio %
	pnlUsd: number;
}

export interface ScenarioSimulationResult {
	assumptions: ParsedScenarioAssumptions;
	totalValue: number;
	portfolioPnlPct: number;   // fractional
	portfolioPnlUsd: number;
	perAsset: AssetImpact[];
	mostExposedSymbol: string;
	mostExposedPnlUsd: number;
	scenarioResult: ScenarioResult;
}

// ─── LLM Prompt builders ──────────────────────────────────────────────────────

/**
 * Build a prompt for LLM to parse a natural-language scenario into quantitative shocks.
 * Returns JSON with ParsedScenarioAssumptions structure.
 */
export function buildScenarioParsePrompt(scenarioText: string): string {
	return `You are a quantitative risk analyst. Parse the following "what-if" scenario into quantitative asset price shocks.

SCENARIO: "${scenarioText}"

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "scenarioTitle": "<short title, max 8 words>",
  "description": "<1-2 sentence description of the scenario>",
  "assetShocks": [
    { "symbol": "BTC", "shock": 0.30 },
    { "symbol": "ETH", "shock": 0.25 },
    { "symbol": "SPY", "shock": 0.05 }
  ],
  "globalShock": 0.10,
  "confidence": "medium"
}

Rules:
- shock is a fractional change: 0.30 = +30%, -0.30 = -30%
- Include shocks for all relevant assets you can reasonably estimate
- Common symbols: BTC, ETH, SOL, BNB, ADA, XRP, SPY, QQQ, GLD, TLT, DXY
- globalShock = shock for any asset NOT explicitly listed (can be 0)
- confidence: "high" if scenario is specific and quantitative, "medium" if qualitative, "low" if very vague
- For Fed rate cuts: bonds (TLT) +5-15%, USD (DXY) -2-5%, SPY +2-5%, crypto +5-20%
- For Fed rate hikes: bonds (TLT) -5-15%, USD (DXY) +2-5%, SPY -3-8%, crypto -10-20%
- For crypto-specific pumps/crashes: focus on BTC/ETH/altcoins, minimal macro impact
- For recession scenarios: SPY -20-40%, BTC -30-60%, GLD +5-15%, TLT +10-30%
- Be realistic and proportionate to the stated scenario magnitude`;
}

/**
 * Build a prompt for LLM to generate implications and hedging suggestions.
 */
export function buildImplicationsPrompt(
	result: ScenarioSimulationResult,
	scenarioText: string,
): string {
	const topLosers = result.perAsset
		.filter(a => a.pnlUsd < 0)
		.sort((a, b) => a.pnlUsd - b.pnlUsd)
		.slice(0, 3)
		.map(a => `${a.symbol}: ${a.shockPct > 0 ? '+' : ''}${a.shockPct.toFixed(1)}% shock → $${a.pnlUsd.toFixed(0)}`)
		.join(', ');

	const totalPnlPct = (result.portfolioPnlPct * 100).toFixed(1);
	const totalPnlUsd = result.portfolioPnlUsd.toFixed(0);

	return `You are a risk management expert. Analyze this what-if scenario and provide practical insights.

SCENARIO: "${scenarioText}"

SIMULATION RESULTS:
- Portfolio value: $${result.totalValue.toLocaleString()}
- Projected PnL: ${Number(totalPnlPct) >= 0 ? '+' : ''}${totalPnlPct}% ($${Number(totalPnlUsd) >= 0 ? '+' : ''}${totalPnlUsd})
- Most exposed position: ${result.mostExposedSymbol} ($${result.mostExposedPnlUsd.toFixed(0)})
- Top impacted assets: ${topLosers || 'None'}
- Scenario assumptions confidence: ${result.assumptions.confidence}

Write a concise analysis (150-220 words) covering:
1. Key portfolio vulnerabilities exposed by this scenario
2. Which positions provide natural hedges (if any)
3. 2-3 concrete hedging suggestions (options, diversification, position sizing)
4. Probability context — how likely is this scenario?

End with a brief Thai summary (2-3 sentences).
Keep it actionable and specific.`;
}

// ─── Scenario Parsing ─────────────────────────────────────────────────────────

/**
 * Parse JSON from LLM response into ParsedScenarioAssumptions.
 * Returns null if parsing fails.
 */
export function parseScenarioAssumptions(raw: string): ParsedScenarioAssumptions | null {
	try {
		const cleaned = raw
			.replace(/```json\s*/gi, '')
			.replace(/```\s*/g, '')
			.trim();

		// Extract JSON object
		const start = cleaned.indexOf('{');
		const end = cleaned.lastIndexOf('}');
		if (start === -1 || end === -1) return null;

		const jsonStr = cleaned.slice(start, end + 1);
		const parsed: unknown = JSON.parse(jsonStr);

		if (!parsed || typeof parsed !== 'object') return null;
		const obj = parsed as Record<string, unknown>;

		const scenarioTitle = typeof obj.scenarioTitle === 'string' ? obj.scenarioTitle : 'Custom Scenario';
		const description = typeof obj.description === 'string' ? obj.description : '';
		const globalShock = typeof obj.globalShock === 'number' ? obj.globalShock : 0;
		const confidence = obj.confidence === 'high' || obj.confidence === 'low'
			? obj.confidence
			: 'medium' as const;

		const rawShocks = Array.isArray(obj.assetShocks) ? obj.assetShocks : [];
		const assetShocks: ParsedAssetShock[] = rawShocks
			.filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
			.map(s => ({
				symbol: typeof s.symbol === 'string' ? s.symbol.toUpperCase().replace(/USDT$|USD$|-USD$|-USDT$/, '') : 'UNKNOWN',
				shock: typeof s.shock === 'number' ? s.shock : 0,
			}))
			.filter(s => s.symbol !== 'UNKNOWN');

		if (assetShocks.length === 0 && globalShock === 0) return null;

		return { scenarioTitle, description, assetShocks, globalShock, confidence };
	} catch {
		return null;
	}
}

/**
 * Keyword-based fallback if LLM parsing fails.
 * Detects common scenario types and returns reasonable shocks.
 */
export function fallbackParseScenario(scenarioText: string): ParsedScenarioAssumptions {
	const text = scenarioText.toLowerCase();

	// Fed rate cut
	if (/fed.*(cut|lower|ease|dovish)|rate cut|cuts.*bps/.test(text)) {
		return {
			scenarioTitle: 'Fed Rate Cut',
			description: 'Federal Reserve cuts interest rates, boosting risk assets.',
			assetShocks: [
				{ symbol: 'BTC', shock: 0.15 },
				{ symbol: 'ETH', shock: 0.12 },
				{ symbol: 'SPY', shock: 0.04 },
				{ symbol: 'QQQ', shock: 0.05 },
				{ symbol: 'GLD', shock: 0.03 },
				{ symbol: 'TLT', shock: 0.08 },
				{ symbol: 'DXY', shock: -0.02 },
			],
			globalShock: 0.08,
			confidence: 'medium',
		};
	}

	// Fed rate hike
	if (/fed.*(hike|raise|tighten|hawkish)|rate hike|hikes.*bps/.test(text)) {
		return {
			scenarioTitle: 'Fed Rate Hike',
			description: 'Federal Reserve raises interest rates, pressuring risk assets.',
			assetShocks: [
				{ symbol: 'BTC', shock: -0.15 },
				{ symbol: 'ETH', shock: -0.18 },
				{ symbol: 'SPY', shock: -0.05 },
				{ symbol: 'QQQ', shock: -0.07 },
				{ symbol: 'GLD', shock: -0.02 },
				{ symbol: 'TLT', shock: -0.08 },
				{ symbol: 'DXY', shock: 0.02 },
			],
			globalShock: -0.10,
			confidence: 'medium',
		};
	}

	// BTC crash / dump — check before pump to avoid $\d+k matching a crash price
	if (/btc.*(crash|dump|collapse|drop|bear|fall)|bitcoin.*(crash|dump|bear)/.test(text)) {
		return {
			scenarioTitle: 'BTC Crash',
			description: 'Bitcoin crashes, triggering broad crypto sell-off.',
			assetShocks: [
				{ symbol: 'BTC', shock: -0.35 },
				{ symbol: 'ETH', shock: -0.40 },
				{ symbol: 'SOL', shock: -0.50 },
				{ symbol: 'BNB', shock: -0.35 },
				{ symbol: 'ADA', shock: -0.45 },
				{ symbol: 'SPY', shock: -0.02 },
				{ symbol: 'GLD', shock: 0.01 },
			],
			globalShock: -0.30,
			confidence: 'medium',
		};
	}

	// BTC pump / break above key level
	if (/btc.*(pump|moon|break|surge|rally|bull|\$\d+k)|bitcoin.*(pump|moon|rally|bull)/.test(text)) {
		return {
			scenarioTitle: 'BTC Bull Run',
			description: 'Bitcoin breaks to new highs, triggering broad crypto rally.',
			assetShocks: [
				{ symbol: 'BTC', shock: 0.30 },
				{ symbol: 'ETH', shock: 0.25 },
				{ symbol: 'SOL', shock: 0.35 },
				{ symbol: 'BNB', shock: 0.20 },
				{ symbol: 'ADA', shock: 0.30 },
				{ symbol: 'SPY', shock: 0.02 },
				{ symbol: 'GLD', shock: 0.00 },
			],
			globalShock: 0.20,
			confidence: 'medium',
		};
	}

	// Recession / market crash
	if (/recession|market crash|bear market|financial crisis|depression/.test(text)) {
		return {
			scenarioTitle: 'Recession / Market Crash',
			description: 'Global recession triggers broad risk-off sell-off.',
			assetShocks: [
				{ symbol: 'BTC', shock: -0.50 },
				{ symbol: 'ETH', shock: -0.55 },
				{ symbol: 'SPY', shock: -0.30 },
				{ symbol: 'QQQ', shock: -0.35 },
				{ symbol: 'GLD', shock: 0.10 },
				{ symbol: 'TLT', shock: 0.20 },
			],
			globalShock: -0.40,
			confidence: 'low',
		};
	}

	// Default: mild positive scenario
	return {
		scenarioTitle: 'Custom Scenario',
		description: scenarioText.slice(0, 120),
		assetShocks: [],
		globalShock: 0.05,
		confidence: 'low',
	};
}

// ─── Simulation Engine ────────────────────────────────────────────────────────

/**
 * Apply parsed scenario assumptions to a portfolio.
 * Reuses applyScenario from risk/stressTest.ts.
 */
export function simulateScenario(
	assumptions: ParsedScenarioAssumptions,
	symbols: string[],
	weights: number[],
	totalValue: number,
): ScenarioSimulationResult {
	// Build custom Scenario object compatible with risk/stressTest applyScenario
	const customScenario: Scenario = {
		name: assumptions.scenarioTitle,
		description: assumptions.description,
		period: 'Hypothetical',
		shocks: [
			...assumptions.assetShocks.map(s => ({ symbol: s.symbol, shock: s.shock })),
			{ symbol: '*', shock: assumptions.globalShock },
		],
	};

	// Build holdings map: symbol → USD value
	const holdings = new Map<string, number>();
	for (let i = 0; i < symbols.length; i++) {
		holdings.set(symbols[i], totalValue * (weights[i] ?? 0));
	}

	const scenarioResult = applyScenario(customScenario, holdings, totalValue);

	// Build per-asset impact array with display-friendly fields
	const perAsset: AssetImpact[] = scenarioResult.assetPnl.map(a => ({
		symbol: a.symbol,
		weightPct: a.weight * 100,
		shockPct: a.shock * 100,
		portfolioImpactPct: a.pnlPct * 100,
		pnlUsd: a.pnlUsd,
	}));

	// Sort by absolute PnL descending for most impactful first
	perAsset.sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd));

	const mostExposed = perAsset[0] ?? { symbol: '—', pnlUsd: 0 };

	return {
		assumptions,
		totalValue,
		portfolioPnlPct: scenarioResult.portfolioPnlPct,
		portfolioPnlUsd: scenarioResult.portfolioPnlUsd,
		perAsset,
		mostExposedSymbol: mostExposed.symbol,
		mostExposedPnlUsd: mostExposed.pnlUsd,
		scenarioResult,
	};
}
