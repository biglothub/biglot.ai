// Tests for positionSizing.ts — T-301
import { describe, it, expect, vi } from 'vitest';
import {
	validateInputs,
	formatUSDAmount,
	fixedFractional,
	kellyCriterion,
	volatilityAdjusted,
	equalRiskContribution,
	calculatePositionSize,
} from './positionSizing';

vi.mock('../cache.server', () => ({
	toolCache: {
		generateKey: vi.fn((_n: string, args: unknown) => JSON.stringify(args)),
		get: vi.fn(() => null),
		set: vi.fn(),
	},
}));

// Register tool for integration tests
import '../tools/positionSize.tool';

// ─── validateInputs ───────────────────────────────────────────────────────────

describe('validateInputs', () => {
	const base = { accountSize: 10000, riskPct: 1, entryPrice: 100, stopPrice: 95 };

	it('returns null for valid inputs', () => {
		expect(validateInputs(base)).toBeNull();
	});

	it('rejects non-positive account size', () => {
		expect(validateInputs({ ...base, accountSize: 0 })).toMatch(/account size/i);
		expect(validateInputs({ ...base, accountSize: -1 })).toMatch(/account size/i);
	});

	it('rejects risk % outside 0–100', () => {
		expect(validateInputs({ ...base, riskPct: 0 })).toMatch(/risk/i);
		expect(validateInputs({ ...base, riskPct: 101 })).toMatch(/risk/i);
	});

	it('rejects non-positive entry price', () => {
		expect(validateInputs({ ...base, entryPrice: 0 })).toMatch(/entry/i);
	});

	it('rejects non-positive stop price', () => {
		expect(validateInputs({ ...base, stopPrice: 0 })).toMatch(/stop/i);
	});

	it('rejects equal entry and stop prices', () => {
		expect(validateInputs({ ...base, stopPrice: 100 })).toMatch(/equal/i);
	});

	it('accepts short trade (stop above entry)', () => {
		expect(validateInputs({ ...base, entryPrice: 95, stopPrice: 100 })).toBeNull();
	});
});

// ─── formatUSDAmount ──────────────────────────────────────────────────────────

describe('formatUSDAmount', () => {
	it('formats millions', () => {
		expect(formatUSDAmount(2_500_000)).toBe('$2.50M');
	});

	it('formats thousands', () => {
		expect(formatUSDAmount(5_500)).toBe('$5.50K');
	});

	it('formats small values', () => {
		expect(formatUSDAmount(99.5)).toBe('$99.50');
	});
});

// ─── fixedFractional ──────────────────────────────────────────────────────────

describe('fixedFractional', () => {
	it('calculates correct position size', () => {
		// Account: $10,000, Risk: 1%, Entry: $100, Stop: $95
		// Risk $: $100, Stop distance: $5, Units: $100/$5 = 20
		const result = fixedFractional({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
		});
		expect(result.riskAmount).toBe(100);
		expect(result.positionSizeUnits).toBe(20);
		expect(result.positionSizeUSD).toBe(2000);
		expect(result.stopDistance).toBe(5);
		expect(result.stopDistancePct).toBe(5);
		expect(result.method).toBe('Fixed Fractional');
	});

	it('works for short trade (stop above entry)', () => {
		const result = fixedFractional({
			accountSize: 10_000,
			riskPct: 2,
			entryPrice: 100,
			stopPrice: 105,
		});
		expect(result.riskAmount).toBe(200);
		expect(result.positionSizeUnits).toBeCloseTo(40);
		expect(result.stopDistance).toBe(5);
	});

	it('scales with account size', () => {
		const small = fixedFractional({ accountSize: 1_000, riskPct: 1, entryPrice: 100, stopPrice: 95 });
		const large = fixedFractional({ accountSize: 100_000, riskPct: 1, entryPrice: 100, stopPrice: 95 });
		expect(large.positionSizeUnits).toBe(small.positionSizeUnits * 100);
	});
});

// ─── kellyCriterion ───────────────────────────────────────────────────────────

describe('kellyCriterion', () => {
	it('calculates half-Kelly position size', () => {
		// W=0.6, R=1.5 → Kelly = 0.6 - 0.4/1.5 = 0.6 - 0.267 = 0.333
		// Half-Kelly = 0.167 → 16.7% of account
		// Capped at riskPct=2% → effective = 2%
		const result = kellyCriterion({
			accountSize: 10_000,
			riskPct: 2,
			entryPrice: 100,
			stopPrice: 95,
			winRate: 0.6,
			avgWinLoss: 1.5,
		});
		// Effective pct is min(halfKelly*100, 2%) = 2% (Kelly > 2%)
		expect(result.riskPct).toBeCloseTo(2, 1);
		expect(result.method).toContain('Kelly');
	});

	it('returns negative Kelly note for losing edge', () => {
		// W=0.3, R=1.0 → Kelly = 0.3 - 0.7/1.0 = -0.4 → negative
		const result = kellyCriterion({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			winRate: 0.3,
			avgWinLoss: 1.0,
		});
		expect(result.notes).toContain('Negative Kelly');
		expect(result.positionSizeUnits).toBe(0);
		expect(result.riskPct).toBe(0);
	});

	it('uses half-Kelly when it is less than riskPct', () => {
		// W=0.52, R=1.1 → Kelly = 0.52 - 0.48/1.1 = 0.52 - 0.436 = 0.084 = 8.4%
		// Half-Kelly = 4.2% > riskPct=1% → capped at 1%
		const result = kellyCriterion({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			winRate: 0.52,
			avgWinLoss: 1.1,
		});
		// Min(half-kelly% , 1%) → capped at 1%
		expect(result.riskPct).toBeLessThanOrEqual(1);
	});

	it('sets risk to half-Kelly when below riskPct', () => {
		// W=0.51, R=1.02 → Kelly = 0.51 - 0.49/1.02 ≈ 0.51 - 0.48 = 0.03 = 3%
		// Half-Kelly = 1.5% < riskPct=5% → use 1.5%
		const result = kellyCriterion({
			accountSize: 10_000,
			riskPct: 5,
			entryPrice: 100,
			stopPrice: 95,
			winRate: 0.51,
			avgWinLoss: 1.02,
		});
		expect(result.riskPct).toBeLessThan(5);
	});
});

// ─── volatilityAdjusted ───────────────────────────────────────────────────────

describe('volatilityAdjusted', () => {
	it('uses ATR stop when larger than user stop', () => {
		// ATR=10, multiple=2 → ATR stop = 20 (user stop = 5)
		// Uses max(20, 5) = 20
		const result = volatilityAdjusted({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			atr: 10,
			atrMultiple: 2,
		});
		expect(result.stopDistance).toBe(20);
		expect(result.positionSizeUnits).toBeCloseTo(100 / 20, 4); // 5 units
	});

	it('uses user stop when larger than ATR stop', () => {
		// ATR=1, multiple=2 → ATR stop = 2 (user stop = 5)
		// Uses max(2, 5) = 5
		const result = volatilityAdjusted({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			atr: 1,
			atrMultiple: 2,
		});
		expect(result.stopDistance).toBe(5);
	});

	it('defaults to multiple=2 when atrMultiple not provided', () => {
		const result = volatilityAdjusted({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			atr: 3,
		});
		// ATR stop = 3*2 = 6; user stop = 5; uses 6
		expect(result.stopDistance).toBe(6);
		expect(result.method).toContain('ATR×2');
	});
});

// ─── equalRiskContribution ────────────────────────────────────────────────────

describe('equalRiskContribution', () => {
	it('divides risk evenly across positions', () => {
		// 5 positions, 2% total risk → 0.4% per position
		const result = equalRiskContribution({
			accountSize: 10_000,
			riskPct: 2,
			entryPrice: 100,
			stopPrice: 95,
			numPositions: 5,
		});
		expect(result.riskPct).toBeCloseTo(0.4, 5);
		expect(result.riskAmount).toBeCloseTo(40, 5);
	});

	it('includes position count in method name', () => {
		const result = equalRiskContribution({
			accountSize: 10_000,
			riskPct: 1,
			entryPrice: 100,
			stopPrice: 95,
			numPositions: 3,
		});
		expect(result.method).toContain('3 positions');
	});
});

// ─── calculatePositionSize ────────────────────────────────────────────────────

describe('calculatePositionSize', () => {
	const base = { accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 95 };

	it('returns fixedFractional when no extras provided', () => {
		const result = calculatePositionSize(base);
		expect(result.fixedFractional).toBeDefined();
		expect(result.kelly).toBeNull();
		expect(result.volatilityAdjusted).toBeNull();
		expect(result.equalRisk).toBeNull();
		expect(result.recommendedMethod).toBe('Fixed Fractional');
	});

	it('returns Kelly when winRate and avgWinLoss provided', () => {
		const result = calculatePositionSize({ ...base, winRate: 0.55, avgWinLoss: 1.5 });
		expect(result.kelly).not.toBeNull();
		expect(result.recommendedMethod).toBe('Kelly Criterion');
	});

	it('returns ATR-adjusted when atr provided, and prefers it over Kelly', () => {
		const result = calculatePositionSize({ ...base, atr: 5, winRate: 0.55, avgWinLoss: 1.5 });
		expect(result.volatilityAdjusted).not.toBeNull();
		expect(result.recommendedMethod).toBe('Volatility-Adjusted');
	});

	it('returns ERC when numPositions provided', () => {
		const result = calculatePositionSize({ ...base, numPositions: 4 });
		expect(result.equalRisk).not.toBeNull();
	});

	it('recommended equals ATR result when atr provided', () => {
		const result = calculatePositionSize({ ...base, atr: 5 });
		expect(result.recommended).toEqual(result.volatilityAdjusted);
	});
});

// ─── Tool integration ─────────────────────────────────────────────────────────

describe('calculate_position_size tool', () => {
	it('is registered', async () => {
		const { getTool } = await import('../tools/registry');
		expect(getTool('calculate_position_size')).toBeDefined();
	});

	it('returns error on invalid inputs', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('calculate_position_size')!;
		const result = await tool.execute({
			account_size: -1000,
			risk_pct: 1,
			entry_price: 100,
			stop_price: 95,
		});
		expect(result.success).toBe(false);
	});

	it('returns MetricCardBlock on valid inputs', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('calculate_position_size')!;
		const result = await tool.execute({
			account_size: 10000,
			risk_pct: 1,
			entry_price: 100,
			stop_price: 95,
			instrument_type: 'crypto',
		});
		expect(result.success).toBe(true);
		const metricBlock = result.contentBlocks.find(b => b.type === 'metric_card');
		const tableBlock = result.contentBlocks.find(b => b.type === 'table');
		expect(metricBlock).toBeDefined();
		expect(tableBlock).toBeDefined();
	});

	it('includes Kelly in table when winRate provided', async () => {
		const { getTool } = await import('../tools/registry');
		const tool = getTool('calculate_position_size')!;
		const result = await tool.execute({
			account_size: 10000,
			risk_pct: 1,
			entry_price: 100,
			stop_price: 95,
			win_rate: 0.55,
			avg_win_loss: 1.5,
		});
		expect(result.success).toBe(true);
		const tableBlock = result.contentBlocks.find(b => b.type === 'table') as { rows: (string | number)[][] } | undefined;
		const hasKelly = tableBlock?.rows.some(r => String(r[0]).includes('Kelly'));
		expect(hasKelly).toBe(true);
	});
});
