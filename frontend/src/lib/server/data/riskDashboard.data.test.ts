// Tests for Risk Dashboard Data — T-1401

import { describe, it, expect } from 'vitest';
import type { Position } from '$lib/types/portfolio';
import {
	getBaseSymbol,
	estimateDailyVol,
	estimateBeta,
	computePositionRiskBreakdowns,
	computeRiskScore,
	buildRiskHeatmap,
	buildRiskCommentary,
	buildRiskDashboard,
} from './riskDashboard.data';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<Position> = {}): Position {
	return {
		id: 'pos-1',
		userId: 'user1',
		symbol: 'BTCUSDT',
		direction: 'long',
		entryPrice: 60000,
		size: 0.1,
		stopPrice: 58000,
		targetPrice: 65000,
		notes: null,
		openedAt: '2024-01-01T00:00:00Z',
		...overrides,
	};
}

// ─── getBaseSymbol ────────────────────────────────────────────────────────────

describe('getBaseSymbol', () => {
	it('strips USDT suffix', () => {
		expect(getBaseSymbol('BTCUSDT')).toBe('BTC');
	});

	it('strips BTC suffix', () => {
		expect(getBaseSymbol('ETHBTC')).toBe('ETH');
	});

	it('strips USDC suffix', () => {
		expect(getBaseSymbol('SOLUSDC')).toBe('SOL');
	});

	it('returns symbol unchanged when no known suffix', () => {
		expect(getBaseSymbol('SPY')).toBe('SPY');
	});

	it('handles already-base symbols', () => {
		expect(getBaseSymbol('BTC')).toBe('BTC');
	});

	it('is case insensitive', () => {
		expect(getBaseSymbol('btcusdt')).toBe('BTC');
	});
});

// ─── estimateDailyVol ─────────────────────────────────────────────────────────

describe('estimateDailyVol', () => {
	it('returns known vol for BTC', () => {
		expect(estimateDailyVol('BTCUSDT')).toBe(4.5);
	});

	it('returns known vol for ETH', () => {
		expect(estimateDailyVol('ETHUSDT')).toBe(5.5);
	});

	it('returns default 6.0 for unknown symbol', () => {
		expect(estimateDailyVol('UNKNOWNTOKEN')).toBe(6.0);
	});

	it('returns lower vol for SPY', () => {
		expect(estimateDailyVol('SPY')).toBe(1.2);
	});
});

// ─── estimateBeta ─────────────────────────────────────────────────────────────

describe('estimateBeta', () => {
	it('returns 1.0 for BTC', () => {
		expect(estimateBeta('BTCUSDT')).toBe(1.0);
	});

	it('returns 1.2 for ETH', () => {
		expect(estimateBeta('ETHUSDT')).toBe(1.2);
	});

	it('returns positive beta for SOL', () => {
		expect(estimateBeta('SOLUSDT')).toBeGreaterThan(1);
	});

	it('returns low beta for SPY', () => {
		expect(estimateBeta('SPY')).toBeLessThan(0.5);
	});

	it('returns default 1.0 for unknown symbol', () => {
		expect(estimateBeta('UNKNOWNTOKEN')).toBe(1.0);
	});
});

// ─── computePositionRiskBreakdowns ────────────────────────────────────────────

describe('computePositionRiskBreakdowns', () => {
	it('returns empty array for empty positions', () => {
		expect(computePositionRiskBreakdowns([], new Map(), 10000, 0)).toEqual([]);
	});

	it('computes basic breakdown for a single long position', () => {
		const pos = makePosition({ symbol: 'BTCUSDT', direction: 'long', entryPrice: 60000, size: 0.1, stopPrice: null });
		const priceMap = new Map([['BTCUSDT', 62000]]);
		const accountSize = 10000;
		const totalPortfolioValue = 62000 * 0.1; // 6200

		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, accountSize, totalPortfolioValue);

		expect(breakdown.symbol).toBe('BTCUSDT');
		expect(breakdown.direction).toBe('long');
		expect(breakdown.positionValueUsd).toBeCloseTo(6200, 2);
		expect(breakdown.concentrationPct).toBe(100); // only position
		expect(breakdown.unrealisedPnlUsd).toBeCloseTo(200, 2); // (62000-60000)*0.1
		expect(breakdown.unrealisedPnlPct).toBeGreaterThan(0);
		expect(breakdown.varUsd95).toBeGreaterThan(0);
		expect(breakdown.riskContributionPct).toBeCloseTo(100, 1); // only position
	});

	it('computes short position PnL correctly', () => {
		const pos = makePosition({ direction: 'short', entryPrice: 60000, size: 0.1, stopPrice: null });
		const priceMap = new Map([['BTCUSDT', 58000]]); // price dropped → short profits
		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, 10000, 5800);
		expect(breakdown.unrealisedPnlUsd).toBeCloseTo(200, 2); // (60000-58000)*0.1
	});

	it('uses stop for openRiskUsd when stop is set', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1, stopPrice: 58000 });
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, 10000, 6000);
		// openRisk = |60000 - 58000| * 0.1 = 200
		expect(breakdown.openRiskUsd).toBeCloseTo(200, 2);
	});

	it('falls back to VaR for openRiskUsd when no stop', () => {
		const pos = makePosition({ stopPrice: null });
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, 10000, 6000);
		expect(breakdown.openRiskUsd).toBeCloseTo(breakdown.varUsd95, 5);
	});

	it('distributes risk contribution proportionally across positions', () => {
		const pos1 = makePosition({ symbol: 'BTCUSDT', size: 0.1, stopPrice: null });
		const pos2 = makePosition({ id: 'pos-2', symbol: 'ETHUSDT', entryPrice: 3000, size: 1, stopPrice: null });
		const priceMap = new Map([['BTCUSDT', 60000], ['ETHUSDT', 3000]]);
		const total = 60000 * 0.1 + 3000 * 1; // 6000 + 3000 = 9000
		const [b1, b2] = computePositionRiskBreakdowns([pos1, pos2], priceMap, 10000, total);
		const totalRisk = b1.riskContributionPct + b2.riskContributionPct;
		expect(totalRisk).toBeCloseTo(100, 1);
	});

	it('falls back to entryPrice when symbol not in priceMap', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1, stopPrice: null });
		const priceMap = new Map<string, number>(); // empty
		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, 10000, 6000);
		expect(breakdown.positionValueUsd).toBeCloseTo(6000, 2);
	});
});

// ─── computeRiskScore ─────────────────────────────────────────────────────────

describe('computeRiskScore', () => {
	it('returns score 0 and safe level when all inputs are 0', () => {
		const { score, level } = computeRiskScore(0, 0, 0, 0, 0);
		expect(score).toBe(0);
		expect(level).toBe('safe');
	});

	it('returns safe level for moderate drawdown (10%)', () => {
		const { score, level } = computeRiskScore(10, 0, 0, 0, 0);
		// drawdownScore = min(100, (10/20)*100) = 50 → score = 50*0.30 = 15 → safe
		expect(score).toBe(15);
		expect(level).toBe('safe');
	});

	it('returns warning level when score is between 50 and 74', () => {
		// All at 50% of their max
		const { score, level } = computeRiskScore(10, 2.5, 25, 5, 25);
		// drawdown=50*0.30=15, var=50*0.25=12.5, concen=50*0.20=10, open=50*0.15=7.5, stress=50*0.10=5 → 50
		expect(score).toBe(50);
		expect(level).toBe('warning');
	});

	it('returns critical level when all inputs at max', () => {
		const { score, level } = computeRiskScore(20, 5, 50, 10, 50);
		expect(score).toBe(100);
		expect(level).toBe('critical');
	});

	it('caps individual scores at 100', () => {
		// maxDrawdownPct > 20 should not push score above 100
		const { score } = computeRiskScore(100, 100, 100, 100, 100);
		expect(score).toBe(100);
	});
});

// ─── buildRiskHeatmap ─────────────────────────────────────────────────────────

describe('buildRiskHeatmap', () => {
	it('returns empty assets and data for no positions', () => {
		const { assets, rows, data } = buildRiskHeatmap([], 10000);
		expect(assets).toEqual([]);
		expect(data).toEqual([]);
		expect(rows.length).toBeGreaterThan(0);
	});

	it('returns correct dimensions for positions', () => {
		const pos = makePosition();
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const [breakdown] = computePositionRiskBreakdowns([pos], priceMap, 10000, 6000);
		const { assets, rows, data } = buildRiskHeatmap([breakdown], 10000);

		expect(assets).toHaveLength(1);
		expect(rows).toHaveLength(4);
		expect(data).toHaveLength(4); // 4 rows
		expect(data[0]).toHaveLength(1); // 1 column
	});

	it('limits assets to 8', () => {
		const positions = Array.from({ length: 12 }, (_, i) =>
			computePositionRiskBreakdowns(
				[makePosition({ id: `pos-${i}`, symbol: `TOKEN${i}USDT`, entryPrice: 100, size: 1, stopPrice: null })],
				new Map([[`TOKEN${i}USDT`, 100]]),
				10000,
				1000,
			)[0],
		);
		const { assets } = buildRiskHeatmap(positions, 10000);
		expect(assets.length).toBeLessThanOrEqual(8);
	});

	it('values are in 0-100 range', () => {
		const pos = makePosition();
		const [breakdown] = computePositionRiskBreakdowns(
			[pos],
			new Map([['BTCUSDT', 60000]]),
			10000,
			6000,
		);
		const { data } = buildRiskHeatmap([breakdown], 10000);
		for (const row of data) {
			for (const val of row) {
				expect(val).toBeGreaterThanOrEqual(0);
				expect(val).toBeLessThanOrEqual(100);
			}
		}
	});
});

// ─── buildRiskCommentary ──────────────────────────────────────────────────────

describe('buildRiskCommentary', () => {
	function makeData(overrides: Partial<Omit<import('./riskDashboard.data').RiskDashboardData, 'commentary'>> = {}) {
		return {
			totalPortfolioValue: 5000,
			concentrationRisk: 30,
			topConcentrationSymbol: 'BTCUSDT',
			portfolioVaR95Usd: 200,
			portfolioVaR95Pct: 2,
			maxDrawdownPct: 5,
			betaAdjustedExposure: 50,
			stressWorstCasePct: -30,
			stressScenarioName: 'COVID Crash 2020',
			overallRiskScore: 30,
			riskLevel: 'safe' as const,
			positions: [],
			heatmapAssets: [],
			heatmapRows: [],
			heatmapData: [],
			...overrides,
		};
	}

	it('returns a string', () => {
		const result = buildRiskCommentary(makeData());
		expect(typeof result).toBe('string');
	});

	it('mentions risk level', () => {
		const result = buildRiskCommentary(makeData({ riskLevel: 'critical', overallRiskScore: 95 }));
		expect(result.toUpperCase()).toContain('CRITICAL');
	});

	it('shows concentration warning above 40%', () => {
		// pass a dummy position so commentary doesn't early-exit on empty portfolio
		const dummyPos = computePositionRiskBreakdowns(
			[makePosition()], new Map([['BTCUSDT', 60000]]), 10000, 6000,
		);
		const result = buildRiskCommentary(makeData({ concentrationRisk: 55, topConcentrationSymbol: 'BTCUSDT', positions: dummyPos }));
		expect(result).toContain('55.0%');
	});

	it('shows healthy message for concentration below 40%', () => {
		const dummyPos = computePositionRiskBreakdowns(
			[makePosition()], new Map([['BTCUSDT', 60000]]), 10000, 6000,
		);
		const result = buildRiskCommentary(makeData({ concentrationRisk: 25, positions: dummyPos }));
		expect(result).toContain('healthy');
	});

	it('shows VaR warning above 3%', () => {
		const dummyPos = computePositionRiskBreakdowns(
			[makePosition()], new Map([['BTCUSDT', 60000]]), 10000, 6000,
		);
		const result = buildRiskCommentary(makeData({ portfolioVaR95Pct: 5, portfolioVaR95Usd: 500, positions: dummyPos }));
		expect(result).toContain('5.0%');
	});

	it('shows no-position message when positions empty', () => {
		const result = buildRiskCommentary(makeData({ positions: [] }));
		expect(result).toContain('No open positions');
	});
});

// ─── buildRiskDashboard ───────────────────────────────────────────────────────

describe('buildRiskDashboard', () => {
	it('returns zero portfolio value when no positions', () => {
		const result = buildRiskDashboard([], new Map(), 10000, 0);
		expect(result.totalPortfolioValue).toBe(0);
		expect(result.positions).toHaveLength(0);
		expect(result.overallRiskScore).toBeGreaterThanOrEqual(0);
	});

	it('includes commentary string', () => {
		const result = buildRiskDashboard([], new Map(), 10000, 0);
		expect(typeof result.commentary).toBe('string');
		expect(result.commentary.length).toBeGreaterThan(0);
	});

	it('computes portfolio value from positions', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1 });
		const priceMap = new Map([['BTCUSDT', 65000]]);
		const result = buildRiskDashboard([pos], priceMap, 10000, 0);
		expect(result.totalPortfolioValue).toBeCloseTo(6500, 2);
	});

	it('computes concentration correctly for single position', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1 });
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const result = buildRiskDashboard([pos], priceMap, 10000, 0);
		expect(result.concentrationRisk).toBeCloseTo(100, 1);
		expect(result.topConcentrationSymbol).toBe('BTCUSDT');
	});

	it('sets stressScenarioName when positions exist', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1 });
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const result = buildRiskDashboard([pos], priceMap, 10000, 0);
		expect(result.stressScenarioName).not.toBe('');
	});

	it('propagates maxDrawdownPct to risk score', () => {
		const result0 = buildRiskDashboard([], new Map(), 10000, 0);
		const result10 = buildRiskDashboard([], new Map(), 10000, 10);
		expect(result10.overallRiskScore).toBeGreaterThanOrEqual(result0.overallRiskScore);
	});

	it('builds heatmap for positions', () => {
		const pos = makePosition({ entryPrice: 60000, size: 0.1 });
		const priceMap = new Map([['BTCUSDT', 60000]]);
		const result = buildRiskDashboard([pos], priceMap, 10000, 0);
		expect(result.heatmapAssets.length).toBeGreaterThan(0);
		expect(result.heatmapData.length).toBe(4); // 4 rows
	});
});
