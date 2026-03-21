// Position Sizing Module — T-301
// Methods: Fixed Fractional, Kelly Criterion, Volatility-Adjusted (ATR), Equal Risk Contribution

// ─── Types ────────────────────────────────────────────────────────────────────

export type InstrumentType = 'crypto' | 'forex' | 'stock' | 'futures' | 'gold';

export type SizingInput = {
	accountSize: number;        // total account value in USD
	riskPct: number;            // risk per trade as % of account (e.g. 1 = 1%)
	entryPrice: number;         // entry price
	stopPrice: number;          // stop-loss price
	instrumentType?: InstrumentType;
	// For Kelly:
	winRate?: number;           // 0–1 (optional, enables Kelly)
	avgWinLoss?: number;        // average win / average loss ratio (optional)
	// For ATR-based:
	atr?: number;               // Average True Range (optional)
	atrMultiple?: number;       // number of ATRs for stop (default 2)
};

export type SizingResult = {
	method: string;
	positionSizeUnits: number;  // number of units/contracts
	positionSizeUSD: number;    // position value in USD
	riskAmount: number;         // USD at risk
	riskPct: number;            // % of account at risk
	stopDistance: number;       // |entry - stop| in price terms
	stopDistancePct: number;    // stop distance as % of entry
	notes?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate inputs; return error string or null.
 */
export function validateInputs(input: SizingInput): string | null {
	if (input.accountSize <= 0) return 'Account size must be positive';
	if (input.riskPct <= 0 || input.riskPct > 100) return 'Risk % must be between 0 and 100';
	if (input.entryPrice <= 0) return 'Entry price must be positive';
	if (input.stopPrice <= 0) return 'Stop price must be positive';
	if (Math.abs(input.entryPrice - input.stopPrice) < 1e-10) return 'Entry and stop prices cannot be equal';
	return null;
}

/**
 * Format a number as a compact currency string.
 */
export function formatUSDAmount(amount: number): string {
	if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
	if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
	return `$${amount.toFixed(2)}`;
}

// ─── Method 1: Fixed Fractional ───────────────────────────────────────────────

/**
 * Fixed Fractional: risk exactly riskPct% of account on this trade.
 * Position size = (account * riskPct%) / (entry - stop)
 */
export function fixedFractional(input: SizingInput): SizingResult {
	const riskAmount = input.accountSize * (input.riskPct / 100);
	const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
	const positionSizeUnits = riskAmount / stopDistance;
	const positionSizeUSD = positionSizeUnits * input.entryPrice;
	const stopDistancePct = (stopDistance / input.entryPrice) * 100;

	return {
		method: 'Fixed Fractional',
		positionSizeUnits,
		positionSizeUSD,
		riskAmount,
		riskPct: input.riskPct,
		stopDistance,
		stopDistancePct,
	};
}

// ─── Method 2: Kelly Criterion ────────────────────────────────────────────────

/**
 * Kelly Criterion: optimal bet fraction based on win rate and win/loss ratio.
 * Kelly % = W - (1-W)/R, where W = win rate, R = avg win/loss ratio.
 * Then scale to account size, capped at riskPct to avoid over-betting.
 */
export function kellyCriterion(input: SizingInput & { winRate: number; avgWinLoss: number }): SizingResult {
	const { winRate, avgWinLoss } = input;

	// Full Kelly fraction
	const kellyFraction = winRate - (1 - winRate) / avgWinLoss;
	// Half-Kelly is common practice (reduces variance)
	const halfKelly = kellyFraction / 2;
	// Cap at user's max risk %
	const effectivePct = Math.max(0, Math.min(halfKelly * 100, input.riskPct));

	const riskAmount = input.accountSize * (effectivePct / 100);
	const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
	const positionSizeUnits = stopDistance > 0 ? riskAmount / stopDistance : 0;
	const positionSizeUSD = positionSizeUnits * input.entryPrice;
	const stopDistancePct = (stopDistance / input.entryPrice) * 100;

	const notes = kellyFraction <= 0
		? 'Negative Kelly — edge is unfavorable, avoid this trade'
		: `Full Kelly: ${(kellyFraction * 100).toFixed(1)}% | Half-Kelly: ${(halfKelly * 100).toFixed(1)}%`;

	return {
		method: 'Kelly Criterion (Half-Kelly)',
		positionSizeUnits,
		positionSizeUSD,
		riskAmount,
		riskPct: effectivePct,
		stopDistance,
		stopDistancePct,
		notes,
	};
}

// ─── Method 3: Volatility-Adjusted (ATR) ─────────────────────────────────────

/**
 * Volatility-Adjusted: use ATR to set the stop distance, then size to risk%.
 * Stop = entry ± (ATR * multiple), position = (account * risk%) / (ATR * multiple)
 */
export function volatilityAdjusted(input: SizingInput & { atr: number }): SizingResult {
	const multiple = input.atrMultiple ?? 2;
	const atrStop = input.atr * multiple;

	// Effective stop = ATR-based or user's stop, whichever is larger (more conservative)
	const userStop = Math.abs(input.entryPrice - input.stopPrice);
	const stopDistance = Math.max(atrStop, userStop);

	const riskAmount = input.accountSize * (input.riskPct / 100);
	const positionSizeUnits = riskAmount / stopDistance;
	const positionSizeUSD = positionSizeUnits * input.entryPrice;
	const stopDistancePct = (stopDistance / input.entryPrice) * 100;

	return {
		method: `Volatility-Adjusted (ATR×${multiple})`,
		positionSizeUnits,
		positionSizeUSD,
		riskAmount,
		riskPct: input.riskPct,
		stopDistance,
		stopDistancePct,
		notes: `ATR stop: ${atrStop.toFixed(4)} | User stop: ${userStop.toFixed(4)} | Using: ${stopDistance.toFixed(4)}`,
	};
}

// ─── Method 4: Equal Risk Contribution ───────────────────────────────────────

/**
 * Equal Risk Contribution: assumes a portfolio of n positions, each gets 1/n
 * of total risk budget. Useful when sizing within a diversified portfolio.
 */
export function equalRiskContribution(input: SizingInput & { numPositions: number }): SizingResult {
	const { numPositions } = input;
	const perPositionRiskPct = input.riskPct / numPositions;
	const riskAmount = input.accountSize * (perPositionRiskPct / 100);
	const stopDistance = Math.abs(input.entryPrice - input.stopPrice);
	const positionSizeUnits = stopDistance > 0 ? riskAmount / stopDistance : 0;
	const positionSizeUSD = positionSizeUnits * input.entryPrice;
	const stopDistancePct = (stopDistance / input.entryPrice) * 100;

	return {
		method: `Equal Risk Contribution (${numPositions} positions)`,
		positionSizeUnits,
		positionSizeUSD,
		riskAmount,
		riskPct: perPositionRiskPct,
		stopDistance,
		stopDistancePct,
		notes: `Total risk ${input.riskPct}% ÷ ${numPositions} positions = ${perPositionRiskPct.toFixed(2)}% per position`,
	};
}

// ─── Combined calculator ──────────────────────────────────────────────────────

export type SizingOutput = {
	fixedFractional: SizingResult;
	kelly: SizingResult | null;
	volatilityAdjusted: SizingResult | null;
	equalRisk: SizingResult | null;
	recommended: SizingResult;
	recommendedMethod: string;
};

/**
 * Run all available sizing methods and return recommended result.
 */
export function calculatePositionSize(input: SizingInput & {
	winRate?: number;
	avgWinLoss?: number;
	atr?: number;
	atrMultiple?: number;
	numPositions?: number;
}): SizingOutput {
	const ff = fixedFractional(input);

	const kellyResult = (input.winRate !== undefined && input.avgWinLoss !== undefined)
		? kellyCriterion({ ...input, winRate: input.winRate, avgWinLoss: input.avgWinLoss })
		: null;

	const atrResult = (input.atr !== undefined && input.atr > 0)
		? volatilityAdjusted({ ...input, atr: input.atr })
		: null;

	const ercResult = (input.numPositions !== undefined && input.numPositions > 1)
		? equalRiskContribution({ ...input, numPositions: input.numPositions })
		: null;

	// Recommend: ATR if available (most conservative), else Kelly if available, else FF
	const recommended = atrResult ?? kellyResult ?? ff;
	const recommendedMethod = atrResult
		? 'Volatility-Adjusted'
		: kellyResult
		? 'Kelly Criterion'
		: 'Fixed Fractional';

	return { fixedFractional: ff, kelly: kellyResult, volatilityAdjusted: atrResult, equalRisk: ercResult, recommended, recommendedMethod };
}
