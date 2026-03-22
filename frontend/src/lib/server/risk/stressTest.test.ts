// Stress Test Tool Tests — T-1102

import { describe, it, expect } from 'vitest';
import {
	normaliseSymbol,
	findShock,
	applyScenario,
	runStressTest,
	SCENARIOS,
	type Scenario,
} from './stressTest';

// ─── normaliseSymbol ──────────────────────────────────────────────────────────

describe('normaliseSymbol', () => {
	it('strips USDT suffix', () => {
		expect(normaliseSymbol('BTCUSDT')).toBe('BTC');
	});

	it('strips USD suffix', () => {
		expect(normaliseSymbol('BTCUSD')).toBe('BTC');
	});

	it('strips -USD suffix', () => {
		expect(normaliseSymbol('BTC-USD')).toBe('BTC');
	});

	it('strips -USDT suffix', () => {
		expect(normaliseSymbol('ETH-USDT')).toBe('ETH');
	});

	it('uppercases the result', () => {
		expect(normaliseSymbol('btcusdt')).toBe('BTC');
	});

	it('leaves bare symbol unchanged', () => {
		expect(normaliseSymbol('SPY')).toBe('SPY');
	});
});

// ─── findShock ────────────────────────────────────────────────────────────────

describe('findShock', () => {
	const shocks = [
		{ symbol: 'BTC',  shock: -0.50 },
		{ symbol: 'SPY',  shock: -0.34 },
		{ symbol: '*',    shock: -0.40 },
	];

	it('returns correct shock for exact match', () => {
		expect(findShock('BTC', shocks)).toBe(-0.50);
		expect(findShock('SPY', shocks)).toBe(-0.34);
	});

	it('matches BTCUSDT to BTC shock', () => {
		expect(findShock('BTCUSDT', shocks)).toBe(-0.50);
	});

	it('uses wildcard fallback for unknown symbol', () => {
		expect(findShock('LINK', shocks)).toBe(-0.40);
	});

	it('returns 0 when no wildcard and no match', () => {
		const noWildcard = [{ symbol: 'BTC', shock: -0.50 }];
		expect(findShock('ETH', noWildcard)).toBe(0);
	});

	it('case-insensitive matching via normalise', () => {
		expect(findShock('btcusdt', shocks)).toBe(-0.50);
	});
});

// ─── applyScenario ────────────────────────────────────────────────────────────

describe('applyScenario', () => {
	const scenario: Scenario = {
		name:        'Test Crash',
		description: 'Test scenario',
		period:      '2020',
		shocks: [
			{ symbol: 'BTC', shock: -0.50 },
			{ symbol: 'SPY', shock: -0.20 },
			{ symbol: '*',   shock: -0.30 },
		],
	};

	it('computes correct portfolio PnL for single asset', () => {
		const holdings = new Map([['BTC', 1000]]);
		const result   = applyScenario(scenario, holdings, 1000);
		expect(result.portfolioPnlPct).toBeCloseTo(-0.50, 8);
		expect(result.portfolioPnlUsd).toBeCloseTo(-500, 8);
	});

	it('computes weighted PnL for two assets', () => {
		// 50% BTC (-50%) + 50% SPY (-20%) = -35% total
		const holdings = new Map([['BTC', 500], ['SPY', 500]]);
		const result   = applyScenario(scenario, holdings, 1000);
		expect(result.portfolioPnlPct).toBeCloseTo(-0.35, 8);
		expect(result.portfolioPnlUsd).toBeCloseTo(-350, 8);
	});

	it('uses wildcard fallback for unknown symbol', () => {
		const holdings = new Map([['LINK', 1000]]);
		const result   = applyScenario(scenario, holdings, 1000);
		expect(result.portfolioPnlPct).toBeCloseTo(-0.30, 8);
	});

	it('handles totalValue = 0 gracefully', () => {
		const holdings = new Map([['BTC', 0]]);
		const result   = applyScenario(scenario, holdings, 0);
		expect(result.portfolioPnlPct).toBe(0);
	});

	it('includes per-asset breakdown', () => {
		const holdings = new Map([['BTC', 1000]]);
		const result   = applyScenario(scenario, holdings, 1000);
		expect(result.assetPnl).toHaveLength(1);
		expect(result.assetPnl[0].symbol).toBe('BTC');
		expect(result.assetPnl[0].shock).toBe(-0.50);
		expect(result.assetPnl[0].pnlUsd).toBeCloseTo(-500, 8);
	});
});

// ─── runStressTest ────────────────────────────────────────────────────────────

describe('runStressTest', () => {
	it('throws for empty symbols', () => {
		expect(() => runStressTest([], [], 10000)).toThrow();
	});

	it('throws when symbols and weights lengths differ', () => {
		expect(() => runStressTest(['BTC'], [0.5, 0.5], 10000)).toThrow();
	});

	it('returns results for all scenarios', () => {
		const result = runStressTest(['BTC'], [1.0], 10000);
		expect(result.results).toHaveLength(SCENARIOS.length);
	});

	it('results are sorted by portfolioPnlPct ascending (worst first)', () => {
		const result = runStressTest(['BTC'], [1.0], 10000);
		for (let i = 1; i < result.results.length; i++) {
			expect(result.results[i].portfolioPnlPct).toBeGreaterThanOrEqual(
				result.results[i - 1].portfolioPnlPct - 1e-10,
			);
		}
	});

	it('worstScenario has the lowest PnL', () => {
		const result = runStressTest(['BTC'], [1.0], 10000);
		const minPnl = Math.min(...result.results.map(r => r.portfolioPnlPct));
		expect(result.worstScenario.portfolioPnlPct).toBeCloseTo(minPnl, 8);
	});

	it('bestScenario has the highest PnL', () => {
		const result = runStressTest(['BTC'], [1.0], 10000);
		const maxPnl = Math.max(...result.results.map(r => r.portfolioPnlPct));
		expect(result.bestScenario.portfolioPnlPct).toBeCloseTo(maxPnl, 8);
	});

	it('maxSingleLossPct equals worstScenario PnL', () => {
		const result = runStressTest(['BTC'], [1.0], 10000);
		expect(result.maxSingleLossPct).toBeCloseTo(result.worstScenario.portfolioPnlPct, 8);
	});

	it('totalValue is preserved', () => {
		const result = runStressTest(['BTC'], [1.0], 25000);
		expect(result.totalValue).toBe(25000);
	});

	it('BTC-heavy portfolio worst scenario is a major crypto crash', () => {
		const result = runStressTest(['BTCUSDT'], [1.0], 10000);
		// 2018 BTC Bear or 2022 Crypto Winter should be worst
		expect(result.worstScenario.portfolioPnlPct).toBeLessThan(-0.70);
	});

	it('BTC best scenario should be 2013 rally or 2020 bull', () => {
		const result = runStressTest(['BTCUSDT'], [1.0], 10000);
		expect(result.bestScenario.portfolioPnlPct).toBeGreaterThan(1.0); // > +100%
	});

	it('diversified portfolio (BTC+SPY) has smaller loss than all-BTC', () => {
		const btcOnly = runStressTest(['BTC'], [1.0], 10000);
		// Find COVID crash for both
		const findCovid = (results: typeof btcOnly.results) =>
			results.find(r => r.scenario === 'COVID Crash 2020')!;

		const covidBtc = findCovid(btcOnly.results);
		// 50% BTC, 50% SPY
		const mixed = runStressTest(['BTC', 'SPY'], [0.5, 0.5], 10000);
		const covidMixed = findCovid(mixed.results);

		// Mixed should have a smaller loss (SPY -34% vs BTC -50%)
		expect(covidMixed.portfolioPnlPct).toBeGreaterThan(covidBtc.portfolioPnlPct);
	});

	it('GFC scenario: BTC and ETH have zero shock (pre-crypto era)', () => {
		const result = runStressTest(['BTC', 'ETH'], [0.5, 0.5], 10000);
		const gfc    = result.results.find(r => r.scenario === 'GFC 2008')!;
		const btcPnl = gfc.assetPnl.find(a => a.symbol === 'BTC')!;
		const ethPnl = gfc.assetPnl.find(a => a.symbol === 'ETH')!;
		expect(btcPnl.shock).toBe(0);
		expect(ethPnl.shock).toBe(0);
	});

	it('handles USDT-suffixed symbols', () => {
		const result = runStressTest(['BTCUSDT', 'ETHUSDT'], [0.6, 0.4], 10000);
		expect(result.results).toHaveLength(SCENARIOS.length);
		// Should still find specific shocks (not just wildcard)
		const winter = result.results.find(r => r.scenario === '2022 Crypto Winter')!;
		const btcPnl = winter.assetPnl.find(a => a.symbol === 'BTCUSDT')!;
		expect(btcPnl.shock).toBeCloseTo(-0.77, 4);
	});
});

// ─── SCENARIOS constant ───────────────────────────────────────────────────────

describe('SCENARIOS', () => {
	it('has 8 scenarios', () => {
		expect(SCENARIOS).toHaveLength(8);
	});

	it('each scenario has a name, description, period, and shocks', () => {
		for (const s of SCENARIOS) {
			expect(s.name).toBeTruthy();
			expect(s.description).toBeTruthy();
			expect(s.period).toBeTruthy();
			expect(s.shocks.length).toBeGreaterThan(0);
		}
	});

	it('each scenario has a wildcard (*) fallback shock', () => {
		for (const s of SCENARIOS) {
			const hasWildcard = s.shocks.some(sh => sh.symbol === '*');
			expect(hasWildcard).toBe(true);
		}
	});

	it('2022 Crypto Winter has BTC shock of -0.77', () => {
		const winter = SCENARIOS.find(s => s.name === '2022 Crypto Winter')!;
		const btc    = winter.shocks.find(sh => sh.symbol === 'BTC')!;
		expect(btc.shock).toBeCloseTo(-0.77, 4);
	});

	it('2018 BTC Bear has BTC shock of -0.84', () => {
		const bear = SCENARIOS.find(s => s.name === '2018 BTC Bear')!;
		const btc  = bear.shocks.find(sh => sh.symbol === 'BTC')!;
		expect(btc.shock).toBeCloseTo(-0.84, 4);
	});
});
