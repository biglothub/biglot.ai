// Scenario Simulator Data Tests — T-1306

import { describe, it, expect } from 'vitest';
import {
	parseScenarioAssumptions,
	fallbackParseScenario,
	simulateScenario,
	buildScenarioParsePrompt,
	buildImplicationsPrompt,
} from './scenarioSimulator.data';

// ─── parseScenarioAssumptions ─────────────────────────────────────────────────

describe('parseScenarioAssumptions', () => {
	it('parses valid JSON with asset shocks', () => {
		const raw = JSON.stringify({
			scenarioTitle: 'Fed Rate Cut',
			description: 'Fed cuts 50bps, risk assets rally.',
			assetShocks: [
				{ symbol: 'BTC', shock: 0.20 },
				{ symbol: 'SPY', shock: 0.04 },
			],
			globalShock: 0.05,
			confidence: 'high',
		});

		const result = parseScenarioAssumptions(raw);
		expect(result).not.toBeNull();
		expect(result!.scenarioTitle).toBe('Fed Rate Cut');
		expect(result!.assetShocks).toHaveLength(2);
		expect(result!.assetShocks[0].symbol).toBe('BTC');
		expect(result!.assetShocks[0].shock).toBe(0.20);
		expect(result!.globalShock).toBe(0.05);
		expect(result!.confidence).toBe('high');
	});

	it('parses JSON wrapped in markdown code block', () => {
		const raw = '```json\n' + JSON.stringify({
			scenarioTitle: 'BTC Bull',
			description: 'BTC pumps.',
			assetShocks: [{ symbol: 'BTC', shock: 0.30 }],
			globalShock: 0.10,
			confidence: 'medium',
		}) + '\n```';

		const result = parseScenarioAssumptions(raw);
		expect(result).not.toBeNull();
		expect(result!.scenarioTitle).toBe('BTC Bull');
	});

	it('normalises symbol to remove USDT suffix', () => {
		const raw = JSON.stringify({
			scenarioTitle: 'Test',
			description: 'Test scenario.',
			assetShocks: [{ symbol: 'BTCUSDT', shock: 0.15 }],
			globalShock: 0,
			confidence: 'low',
		});
		const result = parseScenarioAssumptions(raw);
		expect(result!.assetShocks[0].symbol).toBe('BTC');
	});

	it('defaults confidence to medium if unrecognised', () => {
		const raw = JSON.stringify({
			scenarioTitle: 'Test',
			description: 'Test.',
			assetShocks: [{ symbol: 'ETH', shock: 0.10 }],
			globalShock: 0.02,
			confidence: 'ultra',
		});
		const result = parseScenarioAssumptions(raw);
		expect(result!.confidence).toBe('medium');
	});

	it('returns null for empty JSON', () => {
		expect(parseScenarioAssumptions('not json at all')).toBeNull();
	});

	it('returns null when assetShocks and globalShock are both zero', () => {
		const raw = JSON.stringify({
			scenarioTitle: 'Empty',
			description: 'Nothing.',
			assetShocks: [],
			globalShock: 0,
			confidence: 'low',
		});
		expect(parseScenarioAssumptions(raw)).toBeNull();
	});

	it('handles missing optional fields gracefully', () => {
		const raw = JSON.stringify({
			assetShocks: [{ symbol: 'BTC', shock: 0.05 }],
			globalShock: 0.01,
		});
		const result = parseScenarioAssumptions(raw);
		expect(result).not.toBeNull();
		expect(result!.scenarioTitle).toBe('Custom Scenario');
		expect(result!.confidence).toBe('medium');
	});
});

// ─── fallbackParseScenario ────────────────────────────────────────────────────

describe('fallbackParseScenario', () => {
	it('detects Fed rate cut scenarios', () => {
		const r = fallbackParseScenario('What if the Fed cuts rates by 50bps?');
		expect(r.scenarioTitle).toBe('Fed Rate Cut');
		expect(r.assetShocks.find(s => s.symbol === 'BTC')?.shock).toBeGreaterThan(0);
		expect(r.assetShocks.find(s => s.symbol === 'TLT')?.shock).toBeGreaterThan(0);
		expect(r.assetShocks.find(s => s.symbol === 'DXY')?.shock).toBeLessThan(0);
	});

	it('detects Fed rate hike scenarios', () => {
		const r = fallbackParseScenario('Fed hikes 75bps emergency meeting');
		expect(r.scenarioTitle).toBe('Fed Rate Hike');
		expect(r.assetShocks.find(s => s.symbol === 'BTC')?.shock).toBeLessThan(0);
		expect(r.globalShock).toBeLessThan(0);
	});

	it('detects BTC bull run scenarios', () => {
		const r = fallbackParseScenario('What if BTC breaks $100k?');
		expect(r.scenarioTitle).toBe('BTC Bull Run');
		expect(r.assetShocks.find(s => s.symbol === 'BTC')?.shock).toBeGreaterThan(0);
		expect(r.assetShocks.find(s => s.symbol === 'ETH')?.shock).toBeGreaterThan(0);
	});

	it('detects BTC crash scenarios', () => {
		const r = fallbackParseScenario('What if BTC crashes to $30k?');
		expect(r.scenarioTitle).toBe('BTC Crash');
		expect(r.assetShocks.find(s => s.symbol === 'BTC')?.shock).toBeLessThan(0);
		expect(r.globalShock).toBeLessThan(0);
	});

	it('detects recession scenarios', () => {
		const r = fallbackParseScenario('Global recession hits markets hard');
		expect(r.scenarioTitle).toBe('Recession / Market Crash');
		expect(r.assetShocks.find(s => s.symbol === 'GLD')?.shock).toBeGreaterThan(0);
		expect(r.confidence).toBe('low');
	});

	it('returns default custom scenario for unrecognised input', () => {
		const r = fallbackParseScenario('What if purple unicorns invade the market?');
		expect(r.scenarioTitle).toBe('Custom Scenario');
		expect(r.globalShock).toBe(0.05);
	});

	it('always returns valid structure', () => {
		const r = fallbackParseScenario('');
		expect(r).toHaveProperty('scenarioTitle');
		expect(r).toHaveProperty('assetShocks');
		expect(r).toHaveProperty('globalShock');
		expect(r).toHaveProperty('confidence');
		expect(Array.isArray(r.assetShocks)).toBe(true);
	});
});

// ─── simulateScenario ─────────────────────────────────────────────────────────

describe('simulateScenario', () => {
	const btcBullAssumptions = {
		scenarioTitle: 'BTC Rally',
		description: 'BTC pumps 30%.',
		assetShocks: [
			{ symbol: 'BTC', shock: 0.30 },
			{ symbol: 'ETH', shock: 0.20 },
		],
		globalShock: 0.05,
		confidence: 'medium' as const,
	};

	it('calculates correct portfolio PnL for equal-weight portfolio', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT', 'ETHUSDT'],
			[0.5, 0.5],
			10_000,
		);

		// BTC: 5000 * 0.30 = +1500, ETH: 5000 * 0.20 = +1000 → total +2500
		expect(result.portfolioPnlUsd).toBeCloseTo(2500, 0);
		expect(result.portfolioPnlPct).toBeCloseTo(0.25, 2);
		expect(result.totalValue).toBe(10_000);
	});

	it('returns per-asset impacts sorted by absolute PnL', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT', 'ETHUSDT'],
			[0.6, 0.4],
			10_000,
		);

		// BTC: 6000 * 0.30 = 1800, ETH: 4000 * 0.20 = 800 → BTC first
		expect(result.perAsset[0].symbol).toBe('BTCUSDT');
		expect(result.perAsset[0].pnlUsd).toBeCloseTo(1800, 0);
		expect(result.perAsset[1].symbol).toBe('ETHUSDT');
	});

	it('identifies most exposed position', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT', 'ETHUSDT'],
			[0.8, 0.2],
			10_000,
		);
		expect(result.mostExposedSymbol).toBe('BTCUSDT');
		expect(result.mostExposedPnlUsd).toBeCloseTo(2400, 0);
	});

	it('applies global fallback shock to unspecified assets', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['SOLUSDT'],  // not in assetShocks, uses globalShock = 0.05
			[1.0],
			10_000,
		);
		// SOL gets globalShock: 10000 * 0.05 = +500
		expect(result.portfolioPnlUsd).toBeCloseTo(500, 0);
	});

	it('handles negative shock scenarios correctly', () => {
		const crashAssumptions = {
			scenarioTitle: 'Crash',
			description: 'Everything crashes.',
			assetShocks: [{ symbol: 'BTC', shock: -0.50 }],
			globalShock: -0.30,
			confidence: 'medium' as const,
		};

		const result = simulateScenario(
			crashAssumptions,
			['BTCUSDT', 'ETHUSDT'],
			[0.5, 0.5],
			10_000,
		);

		// BTC: 5000 * -0.50 = -2500, ETH: 5000 * -0.30 = -1500 → total -4000
		expect(result.portfolioPnlUsd).toBeCloseTo(-4000, 0);
		expect(result.portfolioPnlPct).toBeLessThan(0);
	});

	it('returns correct weightPct in perAsset', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT', 'ETHUSDT'],
			[0.7, 0.3],
			10_000,
		);
		const btcAsset = result.perAsset.find(a => a.symbol === 'BTCUSDT');
		expect(btcAsset!.weightPct).toBeCloseTo(70, 1);
	});

	it('converts shock fraction to display percentage in shockPct', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT'],
			[1.0],
			10_000,
		);
		const btcAsset = result.perAsset.find(a => a.symbol === 'BTCUSDT');
		expect(btcAsset!.shockPct).toBeCloseTo(30, 1); // 0.30 → 30
	});

	it('handles single-asset portfolio', () => {
		const result = simulateScenario(
			btcBullAssumptions,
			['BTCUSDT'],
			[1.0],
			5_000,
		);
		expect(result.portfolioPnlUsd).toBeCloseTo(1500, 0);
		expect(result.mostExposedSymbol).toBe('BTCUSDT');
	});
});

// ─── buildScenarioParsePrompt ─────────────────────────────────────────────────

describe('buildScenarioParsePrompt', () => {
	it('includes the scenario text', () => {
		const prompt = buildScenarioParsePrompt('What if BTC breaks $100k?');
		expect(prompt).toContain('What if BTC breaks $100k?');
	});

	it('instructs JSON-only output', () => {
		const prompt = buildScenarioParsePrompt('test');
		expect(prompt).toContain('Return ONLY valid JSON');
	});

	it('includes shock format explanation', () => {
		const prompt = buildScenarioParsePrompt('test');
		expect(prompt).toContain('fractional');
	});
});

// ─── buildImplicationsPrompt ──────────────────────────────────────────────────

describe('buildImplicationsPrompt', () => {
	const mockResult = {
		assumptions: {
			scenarioTitle: 'Fed Cut',
			description: 'Fed cuts rates.',
			assetShocks: [],
			globalShock: 0.05,
			confidence: 'medium' as const,
		},
		totalValue: 10_000,
		portfolioPnlPct: 0.15,
		portfolioPnlUsd: 1500,
		perAsset: [
			{ symbol: 'BTCUSDT', weightPct: 50, shockPct: 20, portfolioImpactPct: 10, pnlUsd: 1000 },
			{ symbol: 'ETHUSDT', weightPct: 50, shockPct: 10, portfolioImpactPct: 5, pnlUsd: 500 },
		],
		mostExposedSymbol: 'BTCUSDT',
		mostExposedPnlUsd: 1000,
		scenarioResult: {} as ReturnType<typeof simulateScenario>['scenarioResult'],
	};

	it('includes scenario text in prompt', () => {
		const prompt = buildImplicationsPrompt(mockResult, 'Fed cuts 50bps');
		expect(prompt).toContain('Fed cuts 50bps');
	});

	it('includes portfolio PnL in prompt', () => {
		const prompt = buildImplicationsPrompt(mockResult, 'Fed cuts');
		expect(prompt).toContain('10,000');
	});

	it('asks for hedging suggestions', () => {
		const prompt = buildImplicationsPrompt(mockResult, 'Fed cuts');
		expect(prompt).toContain('hedging');
	});
});
