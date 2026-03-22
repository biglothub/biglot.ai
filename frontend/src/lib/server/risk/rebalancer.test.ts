// Tests for rebalancer.ts — T-705
import { describe, it, expect } from 'vitest';
import {
	normaliseAllocations,
	riskParityWeights,
	computeRebalanceTrades,
	rebalance,
	type CurrentHolding,
	type TargetAllocation,
} from './rebalancer';

// ─── normaliseAllocations ─────────────────────────────────────────────────────

describe('normaliseAllocations', () => {
	it('keeps already-normalised allocations intact', () => {
		const input: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 50 },
			{ symbol: 'ETH', targetPct: 50 },
		];
		const result = normaliseAllocations(input);
		expect(result[0].targetPct).toBeCloseTo(50, 5);
		expect(result[1].targetPct).toBeCloseTo(50, 5);
	});

	it('normalises allocations that sum to more than 100', () => {
		const input: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 60 },
			{ symbol: 'ETH', targetPct: 60 },
		];
		const result = normaliseAllocations(input);
		const sum = result.reduce((s, a) => s + a.targetPct, 0);
		expect(sum).toBeCloseTo(100, 5);
	});

	it('normalises allocations that sum to less than 100', () => {
		const input: TargetAllocation[] = [
			{ symbol: 'A', targetPct: 20 },
			{ symbol: 'B', targetPct: 30 },
		];
		const result = normaliseAllocations(input);
		const sum = result.reduce((s, a) => s + a.targetPct, 0);
		expect(sum).toBeCloseTo(100, 5);
	});

	it('equal-weights zero allocations', () => {
		const input: TargetAllocation[] = [
			{ symbol: 'A', targetPct: 0 },
			{ symbol: 'B', targetPct: 0 },
		];
		const result = normaliseAllocations(input);
		expect(result[0].targetPct).toBeCloseTo(50, 5);
		expect(result[1].targetPct).toBeCloseTo(50, 5);
	});
});

// ─── riskParityWeights ────────────────────────────────────────────────────────

describe('riskParityWeights', () => {
	it('lower-volatility assets get higher weights', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'SPY', valueUSD: 1000, volatility: 15 },   // low vol
			{ symbol: 'BTC', valueUSD: 1000, volatility: 80 },   // high vol
		];
		const weights = riskParityWeights(holdings);
		const spy = weights.find(w => w.symbol === 'SPY')!;
		const btc = weights.find(w => w.symbol === 'BTC')!;
		expect(spy.targetPct).toBeGreaterThan(btc.targetPct);
	});

	it('weights sum to 100%', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'A', valueUSD: 500, volatility: 20 },
			{ symbol: 'B', valueUSD: 300, volatility: 40 },
			{ symbol: 'C', valueUSD: 200, volatility: 60 },
		];
		const weights = riskParityWeights(holdings);
		const sum = weights.reduce((s, w) => s + w.targetPct, 0);
		expect(sum).toBeCloseTo(100, 4);
	});

	it('uses fallback vol for holdings without volatility', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'A', valueUSD: 500 },
			{ symbol: 'B', valueUSD: 500 },
		];
		const weights = riskParityWeights(holdings);
		// With equal fallback vol, weights should be equal
		expect(weights[0].targetPct).toBeCloseTo(50, 4);
		expect(weights[1].targetPct).toBeCloseTo(50, 4);
	});

	it('handles single asset with 100% weight', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 1000, volatility: 50 },
		];
		const weights = riskParityWeights(holdings);
		expect(weights[0].targetPct).toBeCloseTo(100, 4);
	});
});

// ─── computeRebalanceTrades ───────────────────────────────────────────────────

describe('computeRebalanceTrades', () => {
	it('returns empty for zero total value', () => {
		const holdings: CurrentHolding[] = [{ symbol: 'BTC', valueUSD: 0 }];
		const targets:  TargetAllocation[] = [{ symbol: 'BTC', targetPct: 100 }];
		expect(computeRebalanceTrades(holdings, targets)).toHaveLength(0);
	});

	it('generates buy trade for underweight asset', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 3000 }, // 30%
			{ symbol: 'ETH', valueUSD: 7000 }, // 70%
		];
		const targets: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 50 },
			{ symbol: 'ETH', targetPct: 50 },
		];
		const trades = computeRebalanceTrades(holdings, targets);
		const btcTrade = trades.find(t => t.symbol === 'BTC');
		expect(btcTrade?.action).toBe('buy');
		expect(btcTrade?.valueUSD).toBeCloseTo(2000, 0);
	});

	it('generates sell trade for overweight asset', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 8000 }, // 80%
			{ symbol: 'ETH', valueUSD: 2000 }, // 20%
		];
		const targets: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 60 },
			{ symbol: 'ETH', targetPct: 40 },
		];
		const trades = computeRebalanceTrades(holdings, targets);
		const btcTrade = trades.find(t => t.symbol === 'BTC');
		expect(btcTrade?.action).toBe('sell');
	});

	it('generates buy for new asset with no current holding', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 10000 },
		];
		const targets: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 70 },
			{ symbol: 'ETH', targetPct: 30 },
		];
		const trades = computeRebalanceTrades(holdings, targets);
		const ethTrade = trades.find(t => t.symbol === 'ETH');
		expect(ethTrade?.action).toBe('buy');
		expect(ethTrade?.valueUSD).toBeCloseTo(3000, 0);
	});

	it('trades sorted by absolute drift descending', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'A', valueUSD: 1000 },
			{ symbol: 'B', valueUSD: 1000 },
			{ symbol: 'C', valueUSD: 1000 },
		];
		const targets: TargetAllocation[] = [
			{ symbol: 'A', targetPct: 70 }, // big drift
			{ symbol: 'B', targetPct: 20 }, // small drift
			{ symbol: 'C', targetPct: 10 }, // medium drift
		];
		const trades = computeRebalanceTrades(holdings, targets);
		for (let i = 1; i < trades.length; i++) {
			expect(Math.abs(trades[i - 1].driftPct)).toBeGreaterThanOrEqual(Math.abs(trades[i].driftPct));
		}
	});

	it('ignores dust trades (< $1)', () => {
		const holdings: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 100 },
			{ symbol: 'ETH', valueUSD: 100 },
		];
		const targets: TargetAllocation[] = [
			{ symbol: 'BTC', targetPct: 50.001 },
			{ symbol: 'ETH', targetPct: 49.999 },
		];
		const trades = computeRebalanceTrades(holdings, targets);
		// Tiny drift → should be filtered
		for (const t of trades) {
			expect(t.valueUSD).toBeGreaterThanOrEqual(1);
		}
	});
});

// ─── rebalance ────────────────────────────────────────────────────────────────

describe('rebalance', () => {
	const holdings: CurrentHolding[] = [
		{ symbol: 'BTC', valueUSD: 6000, volatility: 80 },
		{ symbol: 'ETH', valueUSD: 4000, volatility: 60 },
	];
	const targets: TargetAllocation[] = [
		{ symbol: 'BTC', targetPct: 50 },
		{ symbol: 'ETH', targetPct: 50 },
	];

	it('fixed_weight result has correct total value', () => {
		const result = rebalance(holdings, targets, 'fixed_weight');
		expect(result.totalValueUSD).toBe(10000);
		expect(result.method).toBe('fixed_weight');
	});

	it('fixed_weight uses provided targets', () => {
		const result = rebalance(holdings, targets, 'fixed_weight');
		const btcTarget = result.effectiveTargets.find(t => t.symbol === 'BTC');
		expect(btcTarget?.targetPct).toBeCloseTo(50, 1);
	});

	it('risk_parity assigns higher weight to lower-vol asset', () => {
		const result = rebalance(holdings, [], 'risk_parity');
		expect(result.method).toBe('risk_parity');
		const eth = result.effectiveTargets.find(t => t.symbol === 'ETH')!;
		const btc = result.effectiveTargets.find(t => t.symbol === 'BTC')!;
		expect(eth.targetPct).toBeGreaterThan(btc.targetPct);
	});

	it('maxDriftPct is non-negative', () => {
		const result = rebalance(holdings, targets, 'fixed_weight');
		expect(result.maxDriftPct).toBeGreaterThanOrEqual(0);
	});

	it('already balanced portfolio has zero trades', () => {
		const balanced: CurrentHolding[] = [
			{ symbol: 'BTC', valueUSD: 5000 },
			{ symbol: 'ETH', valueUSD: 5000 },
		];
		const result = rebalance(balanced, targets, 'fixed_weight');
		expect(result.trades).toHaveLength(0);
		expect(result.maxDriftPct).toBe(0);
	});
});
