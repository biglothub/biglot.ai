// Portfolio Rebalancer — T-705
// Computes required trades to match target allocations.
// Supports fixed-weight and risk-parity (inverse-volatility) methods.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TargetAllocation {
	symbol:    string;
	targetPct: number; // 0-100
}

export interface CurrentHolding {
	symbol:       string;
	valueUSD:     number;
	volatility?:  number; // annualised % (for risk-parity). Optional.
}

export interface RebalanceTrade {
	symbol:     string;
	action:     'buy' | 'sell';
	valueUSD:   number; // absolute USD to trade
	currentPct: number; // current weight %
	targetPct:  number; // target weight %
	driftPct:   number; // targetPct - currentPct
}

export interface RebalanceResult {
	totalValueUSD:   number;
	trades:          RebalanceTrade[];
	maxDriftPct:     number; // largest absolute drift
	method:          'fixed_weight' | 'risk_parity';
	effectiveTargets: TargetAllocation[]; // final targets used (may differ from input for risk-parity)
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Normalise allocations so they sum to 100%. */
export function normaliseAllocations(allocations: TargetAllocation[]): TargetAllocation[] {
	const total = allocations.reduce((s, a) => s + a.targetPct, 0);
	if (total === 0) return allocations.map(a => ({ ...a, targetPct: 100 / allocations.length }));
	return allocations.map(a => ({ ...a, targetPct: (a.targetPct / total) * 100 }));
}

/**
 * Compute inverse-volatility weights.
 * Assets with missing volatility fall back to average volatility.
 */
export function riskParityWeights(
	holdings: CurrentHolding[],
	fallbackVol = 20, // 20% annualised default
): TargetAllocation[] {
	const vols = holdings.map(h => h.volatility ?? fallbackVol);
	const invVols = vols.map(v => (v > 0 ? 1 / v : 0));
	const totalInv = invVols.reduce((s, v) => s + v, 0);

	return holdings.map((h, i) => ({
		symbol:    h.symbol,
		targetPct: totalInv > 0 ? (invVols[i] / totalInv) * 100 : 100 / holdings.length,
	}));
}

/**
 * Compute rebalance trades given current holdings and target allocations.
 * Returns trades sorted descending by abs driftPct.
 */
export function computeRebalanceTrades(
	holdings:   CurrentHolding[],
	targets:    TargetAllocation[],
): RebalanceTrade[] {
	const totalValue = holdings.reduce((s, h) => s + h.valueUSD, 0);
	if (totalValue === 0) return [];

	const targetMap = new Map(targets.map(t => [t.symbol, t.targetPct]));

	const trades: RebalanceTrade[] = [];

	for (const holding of holdings) {
		const currentPct = (holding.valueUSD / totalValue) * 100;
		const targetPct  = targetMap.get(holding.symbol) ?? 0;
		const driftPct   = targetPct - currentPct;
		const valueUSD   = Math.abs((driftPct / 100) * totalValue);

		if (valueUSD < 1) continue; // ignore dust

		trades.push({
			symbol:     holding.symbol,
			action:     driftPct > 0 ? 'buy' : 'sell',
			valueUSD:   parseFloat(valueUSD.toFixed(2)),
			currentPct: parseFloat(currentPct.toFixed(2)),
			targetPct:  parseFloat(targetPct.toFixed(2)),
			driftPct:   parseFloat(driftPct.toFixed(2)),
		});
	}

	// Also handle symbols in targets that have zero current holdings
	for (const target of targets) {
		if (holdings.find(h => h.symbol === target.symbol)) continue;
		const valueUSD = (target.targetPct / 100) * totalValue;
		if (valueUSD < 1) continue;
		trades.push({
			symbol:     target.symbol,
			action:     'buy',
			valueUSD:   parseFloat(valueUSD.toFixed(2)),
			currentPct: 0,
			targetPct:  parseFloat(target.targetPct.toFixed(2)),
			driftPct:   parseFloat(target.targetPct.toFixed(2)),
		});
	}

	return trades.sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}

/** Main rebalancer entry. */
export function rebalance(
	holdings:      CurrentHolding[],
	targets:       TargetAllocation[],
	method:        'fixed_weight' | 'risk_parity' = 'fixed_weight',
): RebalanceResult {
	const totalValueUSD = holdings.reduce((s, h) => s + h.valueUSD, 0);

	const effectiveTargets: TargetAllocation[] = method === 'risk_parity'
		? riskParityWeights(holdings)
		: normaliseAllocations(targets);

	const trades = computeRebalanceTrades(holdings, effectiveTargets);

	const maxDriftPct = trades.length > 0
		? Math.max(...trades.map(t => Math.abs(t.driftPct)))
		: 0;

	return { totalValueUSD, trades, maxDriftPct, method, effectiveTargets };
}
