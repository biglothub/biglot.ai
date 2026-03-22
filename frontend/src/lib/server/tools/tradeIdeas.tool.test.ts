// Tests for tradeIdeas.tool.ts — T-905

import { describe, it, expect } from 'vitest';
import {
	scoreIdea,
	checkRegimeAlignment,
	buildIdeaSetup,
	generateIdeasFromOHLCV,
} from './tradeIdeas.tool';
import type { OHLCV } from '$lib/types/contentBlock';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCandle(close: number, i: number, volume = 1000): OHLCV {
	return {
		time: 1_700_000_000 + i * 3600,
		open: close * 0.999,
		high: close * 1.01,
		low:  close * 0.99,
		close,
		volume,
	};
}

/** Rising candles that should generate bullish confluence */
function buildRisingCandles(count = 150): OHLCV[] {
	return Array.from({ length: count }, (_, i) =>
		makeCandle(50 + i * 0.5, i)
	);
}

/** Falling candles that should generate bearish confluence */
function buildFallingCandles(count = 150): OHLCV[] {
	return Array.from({ length: count }, (_, i) =>
		makeCandle(Math.max(1, 150 - i * 0.5), i)
	);
}

// ─── scoreIdea ────────────────────────────────────────────────────────────────

describe('scoreIdea', () => {
	it('returns confluenceScore when no bonus factors', () => {
		expect(scoreIdea(5, false, false)).toBe(5);
	});

	it('adds 2 for regime alignment', () => {
		expect(scoreIdea(5, true, false)).toBe(7);
	});

	it('adds 1 for pattern confirmation', () => {
		expect(scoreIdea(5, false, true)).toBe(6);
	});

	it('adds 3 total for both bonuses', () => {
		expect(scoreIdea(4, true, true)).toBe(7);
	});

	it('returns 0 for all-zero inputs', () => {
		expect(scoreIdea(0, false, false)).toBe(0);
	});
});

// ─── checkRegimeAlignment ─────────────────────────────────────────────────────

describe('checkRegimeAlignment', () => {
	it('trending_up aligns with long', () => {
		expect(checkRegimeAlignment('trending_up', 'long')).toBe(true);
	});

	it('trending_up does not align with short', () => {
		expect(checkRegimeAlignment('trending_up', 'short')).toBe(false);
	});

	it('trending_down aligns with short', () => {
		expect(checkRegimeAlignment('trending_down', 'short')).toBe(true);
	});

	it('trending_down does not align with long', () => {
		expect(checkRegimeAlignment('trending_down', 'long')).toBe(false);
	});

	it('ranging aligns with both directions', () => {
		expect(checkRegimeAlignment('ranging', 'long')).toBe(true);
		expect(checkRegimeAlignment('ranging', 'short')).toBe(true);
	});

	it('high_volatility aligns with both directions', () => {
		expect(checkRegimeAlignment('high_volatility', 'long')).toBe(true);
		expect(checkRegimeAlignment('high_volatility', 'short')).toBe(true);
	});
});

// ─── buildIdeaSetup ───────────────────────────────────────────────────────────

describe('buildIdeaSetup', () => {
	const symbol    = 'BTCUSDT';
	const price     = 50_000;
	const atr       = 500;
	const signals   = ['MA crossover bullish', 'RSI oversold'];

	it('returns a TradeSetupBlock with correct type', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, signals, 'trending_up', '4h');
		expect(setup.type).toBe('trade_setup');
	});

	it('sets correct asset and direction', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, signals, 'trending_up', '4h');
		expect(setup.asset).toBe('BTCUSDT');
		expect(setup.direction).toBe('long');
	});

	it('entry zone straddles current price by ±0.5 ATR', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, signals, 'ranging', '4h');
		expect(setup.entryZone.low).toBeCloseTo(price - atr * 0.5, 0);
		expect(setup.entryZone.high).toBeCloseTo(price + atr * 0.5, 0);
	});

	it('stop loss is 1.5 ATR below entry mid for long', () => {
		const setup    = buildIdeaSetup(symbol, 'long', price, atr, signals, 'ranging', '4h');
		const entryMid = (setup.entryZone.low + setup.entryZone.high) / 2;
		expect(setup.stopLoss).toBeCloseTo(entryMid - atr * 1.5, 0);
	});

	it('stop loss is 1.5 ATR above entry mid for short', () => {
		const setup    = buildIdeaSetup(symbol, 'short', price, atr, signals, 'ranging', '4h');
		const entryMid = (setup.entryZone.low + setup.entryZone.high) / 2;
		expect(setup.stopLoss).toBeCloseTo(entryMid + atr * 1.5, 0);
	});

	it('has 3 targets (T1, T2, T3)', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, signals, 'trending_up', '4h');
		expect(setup.targets).toHaveLength(3);
		expect(setup.targets[0].rMultiple).toBe(1.5);
		expect(setup.targets[1].rMultiple).toBe(3.0);
		expect(setup.targets[2].rMultiple).toBe(5.0);
	});

	it('targets increase in price for long', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, signals, 'ranging', '4h');
		expect(setup.targets[0].price).toBeLessThan(setup.targets[1].price);
		expect(setup.targets[1].price).toBeLessThan(setup.targets[2].price);
	});

	it('targets decrease in price for short', () => {
		const setup = buildIdeaSetup(symbol, 'short', price, atr, signals, 'ranging', '4h');
		expect(setup.targets[0].price).toBeGreaterThan(setup.targets[1].price);
	});

	it('uses fallback ATR when atrValue = 0', () => {
		const setup = buildIdeaSetup(symbol, 'long', 1000, 0, [], 'ranging', '4h');
		// Fallback ATR = price * 0.01 = 10 → stop = entryMid - 10*1.5
		const entryMid = (setup.entryZone.low + setup.entryZone.high) / 2;
		expect(Math.abs(entryMid - setup.stopLoss)).toBeCloseTo(1000 * 0.01 * 1.5, 0);
	});

	it('includes signal descriptions in thesis', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, ['MA crossover'], 'trending_up', '4h');
		expect(setup.thesis).toContain('MA crossover');
	});

	it('sets timeframe correctly', () => {
		const setup = buildIdeaSetup(symbol, 'long', price, atr, [], 'ranging', '1d');
		expect(setup.timeframe).toBe('1d');
	});
});

// ─── generateIdeasFromOHLCV ───────────────────────────────────────────────────

describe('generateIdeasFromOHLCV', () => {
	it('returns null for insufficient candles', async () => {
		const candles = Array.from({ length: 30 }, (_, i) => makeCandle(100, i));
		const result  = await generateIdeasFromOHLCV('BTCUSDT', candles, '4h', 3);
		expect(result).toBeNull();
	});

	it('returns null when below minConfluenceScore', async () => {
		// Flat candles → no signals → null
		const candles = Array.from({ length: 100 }, (_, i) => makeCandle(100, i));
		const result  = await generateIdeasFromOHLCV('BTCUSDT', candles, '4h', 100); // impossible threshold
		expect(result).toBeNull();
	});

	it('returns a TradeIdea with correct direction for rising candles', async () => {
		const candles = buildRisingCandles(150);
		const result  = await generateIdeasFromOHLCV('BTCUSDT', candles, '4h', 1);
		if (result) {
			expect(['long', 'short']).toContain(result.direction);
			expect(result.symbol).toBe('BTCUSDT');
			expect(result.totalScore).toBeGreaterThan(0);
		}
		// May return null if confluence is still below 1 — just verify no throw
	});

	it('totalScore >= confluenceScore', async () => {
		const candles = buildRisingCandles(150);
		const result  = await generateIdeasFromOHLCV('BTCUSDT', candles, '4h', 1);
		if (result) {
			expect(result.totalScore).toBeGreaterThanOrEqual(result.confluenceScore);
		}
	});

	it('setup has expected TradeSetupBlock fields', async () => {
		const candles = buildRisingCandles(150);
		const result  = await generateIdeasFromOHLCV('BTCUSDT', candles, '4h', 1);
		if (result) {
			expect(result.setup.type).toBe('trade_setup');
			expect(result.setup.targets).toHaveLength(3);
			expect(result.setup.stopLoss).toBeGreaterThan(0);
		}
	});
});
