// Strategy Recommender Data — T-1304
// Defines strategy library and scoring logic for adaptive strategy matching

import { fetchOHLCV, normalizeBinanceSymbol } from './ohlcvProvider';
import { analyzeRegime } from '../indicators/regime';
import { fetchMacroData } from './macro.data';
import type { MarketRegime } from '../indicators/regime';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StrategyId =
	| 'trend_following'
	| 'mean_reversion'
	| 'breakout'
	| 'range_trading'
	| 'momentum'
	| 'carry_trade'
	| 'pairs_spread'
	| 'volatility';

export type MacroBias = 'risk_on' | 'risk_off' | 'neutral';
export type VolatilityLevel = 'low' | 'medium' | 'high' | 'any';

export interface StrategyProfile {
	id: StrategyId;
	name: string;
	description: string;
	idealRegimes: MarketRegime[];
	idealADXRange: [number, number]; // [min, max]
	idealVolatility: VolatilityLevel;
	macroBias: MacroBias;
	/** Historical win-rate per regime (0–100) */
	winRates: Record<MarketRegime, number>;
}

export interface StrategyMatch {
	strategy: StrategyProfile;
	matchScore: number;      // 0–100
	matchReasons: string[];
	winRateInCurrentRegime: number;
}

export interface StrategyConditions {
	regime: MarketRegime | null;
	regimeConfidence: number;
	adxValue: number;
	atrRatio: number;
	rsiValue: number;
	currentPrice: number;
	macroSignal: MacroBias;
	dxyChange: number;
	spxChange: number;
	tnxRate: number;
}

// ─── Strategy Library ─────────────────────────────────────────────────────────

export const STRATEGY_LIBRARY: StrategyProfile[] = [
	{
		id: 'trend_following',
		name: 'Trend Following',
		description: 'Ride established trends using moving average crossovers, breakouts, or momentum filters. Hold until trend weakens.',
		idealRegimes: ['trending_up', 'trending_down'],
		idealADXRange: [25, 100],
		idealVolatility: 'medium',
		macroBias: 'neutral',
		winRates: {
			trending_up: 58,
			trending_down: 55,
			ranging: 34,
			high_volatility: 42,
		},
	},
	{
		id: 'mean_reversion',
		name: 'Mean Reversion',
		description: 'Fade overextended moves back to the mean using Bollinger Bands, RSI extremes, or statistical z-scores.',
		idealRegimes: ['ranging'],
		idealADXRange: [0, 25],
		idealVolatility: 'low',
		macroBias: 'neutral',
		winRates: {
			trending_up: 38,
			trending_down: 36,
			ranging: 72,
			high_volatility: 30,
		},
	},
	{
		id: 'breakout',
		name: 'Breakout',
		description: 'Enter on confirmed breakout from consolidation zones, key levels, or chart patterns. Requires volume confirmation.',
		idealRegimes: ['ranging', 'trending_up'],
		idealADXRange: [15, 40],
		idealVolatility: 'medium',
		macroBias: 'risk_on',
		winRates: {
			trending_up: 52,
			trending_down: 38,
			ranging: 45,
			high_volatility: 35,
		},
	},
	{
		id: 'range_trading',
		name: 'Range Trading',
		description: 'Buy support, sell resistance in well-defined ranges. Works best with tight bands and predictable oscillations.',
		idealRegimes: ['ranging'],
		idealADXRange: [0, 20],
		idealVolatility: 'low',
		macroBias: 'neutral',
		winRates: {
			trending_up: 35,
			trending_down: 32,
			ranging: 68,
			high_volatility: 28,
		},
	},
	{
		id: 'momentum',
		name: 'Momentum',
		description: 'Buy strength, sell weakness. Enter high-performing assets continuing their move. Uses RSI, rate-of-change, and relative strength.',
		idealRegimes: ['trending_up'],
		idealADXRange: [30, 100],
		idealVolatility: 'medium',
		macroBias: 'risk_on',
		winRates: {
			trending_up: 63,
			trending_down: 28,
			ranging: 40,
			high_volatility: 44,
		},
	},
	{
		id: 'carry_trade',
		name: 'Carry Trade',
		description: 'Capture funding rate differentials and yield spreads. Long high-yield assets, short low-yield. Requires stable, low-vol environment.',
		idealRegimes: ['ranging', 'trending_up'],
		idealADXRange: [0, 30],
		idealVolatility: 'low',
		macroBias: 'risk_on',
		winRates: {
			trending_up: 65,
			trending_down: 35,
			ranging: 72,
			high_volatility: 28,
		},
	},
	{
		id: 'pairs_spread',
		name: 'Pairs / Spread',
		description: 'Market-neutral strategy: long one asset, short a correlated asset. Profits from relative performance divergence.',
		idealRegimes: ['ranging', 'trending_up', 'trending_down'],
		idealADXRange: [0, 50],
		idealVolatility: 'any',
		macroBias: 'neutral',
		winRates: {
			trending_up: 62,
			trending_down: 60,
			ranging: 65,
			high_volatility: 48,
		},
	},
	{
		id: 'volatility',
		name: 'Volatility Strategy',
		description: 'Sell implied volatility (options premium) during calm periods, or buy vol (straddles) when vol is cheap and a large move is expected.',
		idealRegimes: ['ranging', 'high_volatility'],
		idealADXRange: [0, 35],
		idealVolatility: 'any',
		macroBias: 'neutral',
		winRates: {
			trending_up: 55,
			trending_down: 52,
			ranging: 70,
			high_volatility: 48,
		},
	},
];

// ─── Conditions Gathering ─────────────────────────────────────────────────────

/**
 * Gather current market conditions for a symbol.
 * Fetches OHLCV for regime analysis and macro data for risk signal.
 */
export async function gatherStrategyConditions(
	symbol: string,
	timeframe: string,
): Promise<StrategyConditions> {
	const normalized = normalizeBinanceSymbol(symbol);

	const [ohlcvResult, macroResult] = await Promise.allSettled([
		fetchOHLCV(normalized, timeframe, 150),
		fetchMacroData(),
	]);

	// ── Regime ───────────────────────────────────────────────────────────────
	let regime: MarketRegime | null = null;
	let regimeConfidence = 0;
	let adxValue = 0;
	let atrRatio = 0;
	let rsiValue = 50;
	let currentPrice = 0;

	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		if (ohlcv.length > 0) {
			currentPrice = ohlcv[ohlcv.length - 1].close;
		}
		if (ohlcv.length >= 40) {
			const analysis = analyzeRegime(ohlcv);
			if (analysis) {
				regime = analysis.regime;
				regimeConfidence = analysis.confidence;
				adxValue = analysis.adxValue;
				atrRatio = analysis.atrRatio;
				rsiValue = analysis.rsiValue;
			}
		}
	}

	// ── Macro signal ─────────────────────────────────────────────────────────
	let macroSignal: MacroBias = 'neutral';
	let dxyChange = 0;
	let spxChange = 0;
	let tnxRate = 0;

	if (macroResult.status === 'fulfilled') {
		const macro = macroResult.value;
		dxyChange = macro.dxy?.change ?? 0;
		spxChange = macro.spx?.change ?? 0;
		tnxRate   = macro.tnx?.price ?? 0;

		// risk_on: SPX rising + DXY falling
		// risk_off: SPX falling + DXY rising
		if (spxChange > 0.3 && dxyChange < 0) {
			macroSignal = 'risk_on';
		} else if (spxChange < -0.3 && dxyChange > 0) {
			macroSignal = 'risk_off';
		}
	}

	return {
		regime,
		regimeConfidence,
		adxValue,
		atrRatio,
		rsiValue,
		currentPrice,
		macroSignal,
		dxyChange,
		spxChange,
		tnxRate,
	};
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

/**
 * Score a single strategy against current conditions.
 * Points: regime match (50), ADX fit (20), macro alignment (20), vol level (10).
 */
export function scoreStrategy(
	strategy: StrategyProfile,
	conditions: StrategyConditions,
): StrategyMatch {
	const reasons: string[] = [];
	let score = 0;

	// ── 1. Regime match (0–50) ────────────────────────────────────────────────
	const currentRegime = conditions.regime ?? 'ranging';
	const regimeMatch = strategy.idealRegimes.includes(currentRegime);
	if (regimeMatch) {
		const regimePts = Math.round(50 * (conditions.regimeConfidence / 100));
		score += Math.max(regimePts, 25); // at least 25 if regime matches
		reasons.push(`Regime ${currentRegime.replace('_', ' ')} matches ideal conditions`);
	} else {
		reasons.push(`Current regime (${currentRegime.replace('_', ' ')}) is not ideal for this strategy`);
	}

	// ── 2. ADX fit (0–20) ─────────────────────────────────────────────────────
	const [adxMin, adxMax] = strategy.idealADXRange;
	if (conditions.adxValue >= adxMin && conditions.adxValue <= adxMax) {
		score += 20;
		reasons.push(`ADX=${conditions.adxValue.toFixed(1)} is within ideal range [${adxMin}–${adxMax}]`);
	} else {
		const dist = Math.min(
			Math.abs(conditions.adxValue - adxMin),
			Math.abs(conditions.adxValue - adxMax),
		);
		const partial = Math.max(0, 20 - Math.round(dist * 0.8));
		score += partial;
		if (partial > 0) {
			reasons.push(`ADX=${conditions.adxValue.toFixed(1)} is near ideal range (partial match)`);
		}
	}

	// ── 3. Macro alignment (0–20) ─────────────────────────────────────────────
	const macroBias = strategy.macroBias;
	if (macroBias === 'neutral' || macroBias === conditions.macroSignal) {
		score += 20;
		if (macroBias !== 'neutral') {
			reasons.push(`Macro environment (${conditions.macroSignal}) aligns with strategy bias`);
		}
	} else {
		reasons.push(`Macro signal (${conditions.macroSignal}) conflicts with strategy's ${macroBias} bias`);
	}

	// ── 4. Volatility level (0–10) ────────────────────────────────────────────
	const currentVolLevel = classifyVolatility(conditions.atrRatio);
	if (strategy.idealVolatility === 'any' || strategy.idealVolatility === currentVolLevel) {
		score += 10;
		if (strategy.idealVolatility !== 'any') {
			reasons.push(`Volatility level (${currentVolLevel}) is ideal for this strategy`);
		}
	} else {
		reasons.push(`Volatility level (${currentVolLevel}) is not ideal — strategy prefers ${strategy.idealVolatility}`);
	}

	const winRateInCurrentRegime = strategy.winRates[currentRegime];

	return {
		strategy,
		matchScore: Math.min(100, score),
		matchReasons: reasons,
		winRateInCurrentRegime,
	};
}

/** Classify ATR-ratio into a volatility level. */
export function classifyVolatility(atrRatio: number): 'low' | 'medium' | 'high' {
	if (atrRatio < 1.5) return 'low';
	if (atrRatio < 3.0) return 'medium';
	return 'high';
}

/**
 * Rank all strategies by match score descending.
 */
export function rankStrategies(conditions: StrategyConditions): StrategyMatch[] {
	return STRATEGY_LIBRARY
		.map(s => scoreStrategy(s, conditions))
		.sort((a, b) => b.matchScore - a.matchScore);
}

// ─── LLM Prompt ───────────────────────────────────────────────────────────────

export function buildStrategyPrompt(
	conditions: StrategyConditions,
	ranked: StrategyMatch[],
	symbol: string,
): string {
	const regimeLabel = conditions.regime
		? conditions.regime.replace(/_/g, ' ')
		: 'unknown';

	const top3 = ranked.slice(0, 3)
		.map((m, i) => `${i + 1}. ${m.strategy.name} (score: ${m.matchScore}/100, win rate: ${m.winRateInCurrentRegime}%)`)
		.join('\n');

	return `You are an expert trading strategist. Given the current market conditions for ${symbol}, explain which trading approach is most appropriate right now and why.

CURRENT CONDITIONS:
- Market Regime: ${regimeLabel} (confidence: ${conditions.regimeConfidence}%)
- ADX (trend strength): ${conditions.adxValue.toFixed(1)}
- ATR Ratio (volatility %): ${conditions.atrRatio.toFixed(2)}%
- RSI: ${conditions.rsiValue.toFixed(1)}
- Macro Signal: ${conditions.macroSignal}
- SPX change: ${conditions.spxChange > 0 ? '+' : ''}${conditions.spxChange.toFixed(2)}%
- DXY change: ${conditions.dxyChange > 0 ? '+' : ''}${conditions.dxyChange.toFixed(2)}%
- 10Y Treasury: ${conditions.tnxRate.toFixed(2)}%

TOP STRATEGY MATCHES:
${top3}

Write a concise explanation (150–250 words) covering:
1. Why the top strategy fits current conditions best
2. Which strategies to avoid and why
3. One concrete tactical suggestion for the top strategy

Keep it practical and data-driven. End with a brief Thai summary (2-3 sentences).`;
}

/** Extract explanation text from LLM response — strips JSON if present. */
export function parseStrategyExplanation(raw: string): string {
	const cleaned = raw
		.replace(/```[\w]*\n?/g, '')
		.replace(/```/g, '')
		.trim();
	return cleaned.length > 20 ? cleaned : '';
}
