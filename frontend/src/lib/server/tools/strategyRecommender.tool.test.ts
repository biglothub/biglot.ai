// Tests for strategyRecommender data layer — T-1304
// Tests pure functions: scoreStrategy, rankStrategies, classifyVolatility,
//   parseStrategyExplanation, buildStrategyPrompt

import { describe, it, expect } from 'vitest';
import {
	scoreStrategy,
	rankStrategies,
	classifyVolatility,
	parseStrategyExplanation,
	buildStrategyPrompt,
	STRATEGY_LIBRARY,
	type StrategyConditions,
} from '../data/strategyRecommender.data';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const trendingUpConditions: StrategyConditions = {
	regime: 'trending_up',
	regimeConfidence: 80,
	adxValue: 35,
	atrRatio: 2.0,
	rsiValue: 65,
	currentPrice: 85000,
	macroSignal: 'risk_on',
	dxyChange: -0.5,
	spxChange: 0.8,
	tnxRate: 4.2,
};

const rangingConditions: StrategyConditions = {
	regime: 'ranging',
	regimeConfidence: 70,
	adxValue: 15,
	atrRatio: 1.2,
	rsiValue: 50,
	currentPrice: 85000,
	macroSignal: 'neutral',
	dxyChange: 0.1,
	spxChange: -0.1,
	tnxRate: 4.5,
};

const highVolConditions: StrategyConditions = {
	regime: 'high_volatility',
	regimeConfidence: 90,
	adxValue: 20,
	atrRatio: 4.5,
	rsiValue: 72,
	currentPrice: 85000,
	macroSignal: 'risk_off',
	dxyChange: 0.8,
	spxChange: -1.2,
	tnxRate: 4.8,
};

// ─── classifyVolatility ────────────────────────────────────────────────────────

describe('classifyVolatility', () => {
	it('returns "low" for ATR ratio < 1.5', () => {
		expect(classifyVolatility(0.5)).toBe('low');
		expect(classifyVolatility(1.4)).toBe('low');
	});

	it('returns "medium" for ATR ratio 1.5–2.99', () => {
		expect(classifyVolatility(1.5)).toBe('medium');
		expect(classifyVolatility(2.5)).toBe('medium');
		expect(classifyVolatility(2.99)).toBe('medium');
	});

	it('returns "high" for ATR ratio >= 3.0', () => {
		expect(classifyVolatility(3.0)).toBe('high');
		expect(classifyVolatility(5.0)).toBe('high');
	});

	it('handles zero', () => {
		expect(classifyVolatility(0)).toBe('low');
	});
});

// ─── scoreStrategy ─────────────────────────────────────────────────────────────

describe('scoreStrategy — trend_following in trending_up regime', () => {
	it('returns a match with high score in trending_up regime', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'trend_following')!;
		const match = scoreStrategy(strategy, trendingUpConditions);
		expect(match.matchScore).toBeGreaterThan(60);
	});

	it('includes regime match reason', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'trend_following')!;
		const match = scoreStrategy(strategy, trendingUpConditions);
		expect(match.matchReasons.some(r => r.toLowerCase().includes('regime'))).toBe(true);
	});

	it('returns correct win rate for current regime', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'trend_following')!;
		const match = scoreStrategy(strategy, trendingUpConditions);
		expect(match.winRateInCurrentRegime).toBe(strategy.winRates.trending_up);
	});

	it('score does not exceed 100', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'trend_following')!;
		const match = scoreStrategy(strategy, trendingUpConditions);
		expect(match.matchScore).toBeLessThanOrEqual(100);
	});

	it('score is non-negative', () => {
		for (const strategy of STRATEGY_LIBRARY) {
			const match = scoreStrategy(strategy, trendingUpConditions);
			expect(match.matchScore).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('scoreStrategy — mean_reversion in ranging regime', () => {
	it('scores high for mean_reversion in ranging regime', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'mean_reversion')!;
		const match = scoreStrategy(strategy, rangingConditions);
		expect(match.matchScore).toBeGreaterThan(60);
	});

	it('scores low for trend_following in ranging regime', () => {
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'trend_following')!;
		const match = scoreStrategy(strategy, rangingConditions);
		// trending_up/down is not the current regime, so score should be lower
		expect(match.matchScore).toBeLessThan(50);
	});
});

describe('scoreStrategy — null regime defaults to ranging', () => {
	it('handles null regime by defaulting to ranging', () => {
		const nullRegimeConditions: StrategyConditions = {
			...rangingConditions,
			regime: null,
			regimeConfidence: 0,
		};
		const strategy = STRATEGY_LIBRARY.find(s => s.id === 'mean_reversion')!;
		const match = scoreStrategy(strategy, nullRegimeConditions);
		expect(match.matchScore).toBeGreaterThanOrEqual(0);
		expect(match.matchScore).toBeLessThanOrEqual(100);
	});
});

// ─── rankStrategies ────────────────────────────────────────────────────────────

describe('rankStrategies', () => {
	it('returns all 8 strategies', () => {
		const ranked = rankStrategies(trendingUpConditions);
		expect(ranked).toHaveLength(STRATEGY_LIBRARY.length);
		expect(ranked).toHaveLength(8);
	});

	it('sorts by matchScore descending', () => {
		const ranked = rankStrategies(trendingUpConditions);
		for (let i = 1; i < ranked.length; i++) {
			expect(ranked[i - 1].matchScore).toBeGreaterThanOrEqual(ranked[i].matchScore);
		}
	});

	it('places trend_following at or near top for trending_up regime', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const trendIdx = ranked.findIndex(m => m.strategy.id === 'trend_following');
		expect(trendIdx).toBeLessThanOrEqual(2);
	});

	it('places mean_reversion at or near top for ranging regime', () => {
		const ranked = rankStrategies(rangingConditions);
		const revertIdx = ranked.findIndex(m => m.strategy.id === 'mean_reversion');
		expect(revertIdx).toBeLessThanOrEqual(3);
	});

	it('every match has matchReasons array', () => {
		const ranked = rankStrategies(trendingUpConditions);
		for (const m of ranked) {
			expect(Array.isArray(m.matchReasons)).toBe(true);
			expect(m.matchReasons.length).toBeGreaterThan(0);
		}
	});

	it('works with high_volatility regime', () => {
		const ranked = rankStrategies(highVolConditions);
		expect(ranked).toHaveLength(8);
		expect(ranked[0].matchScore).toBeGreaterThanOrEqual(ranked[ranked.length - 1].matchScore);
	});
});

// ─── parseStrategyExplanation ─────────────────────────────────────────────────

describe('parseStrategyExplanation', () => {
	it('strips markdown code fences', () => {
		const raw = '```\nSome explanation here.\n```';
		const result = parseStrategyExplanation(raw);
		expect(result).not.toContain('```');
		expect(result).toContain('Some explanation here.');
	});

	it('strips json code fences', () => {
		const raw = '```json\n{"key": "value"}\n```';
		const result = parseStrategyExplanation(raw);
		expect(result).not.toContain('```');
	});

	it('returns empty string for short input', () => {
		expect(parseStrategyExplanation('hi')).toBe('');
	});

	it('preserves plain text', () => {
		const text = 'Use trend following in a strong trending market with ADX above 30.';
		expect(parseStrategyExplanation(text)).toBe(text);
	});

	it('trims leading/trailing whitespace', () => {
		const raw = '   Some explanation here.   ';
		expect(parseStrategyExplanation(raw)).toBe('Some explanation here.');
	});
});

// ─── buildStrategyPrompt ──────────────────────────────────────────────────────

describe('buildStrategyPrompt', () => {
	it('includes symbol in prompt', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const prompt = buildStrategyPrompt(trendingUpConditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('BTCUSDT');
	});

	it('includes regime label', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const prompt = buildStrategyPrompt(trendingUpConditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('trending up');
	});

	it('includes ADX value', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const prompt = buildStrategyPrompt(trendingUpConditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('35');
	});

	it('includes top 3 strategies', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const prompt = buildStrategyPrompt(trendingUpConditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('1.');
		expect(prompt).toContain('2.');
		expect(prompt).toContain('3.');
	});

	it('includes macro signal', () => {
		const ranked = rankStrategies(trendingUpConditions);
		const prompt = buildStrategyPrompt(trendingUpConditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('risk_on');
	});

	it('handles null regime gracefully', () => {
		const conditions = { ...trendingUpConditions, regime: null };
		const ranked = rankStrategies(conditions);
		const prompt = buildStrategyPrompt(conditions, ranked, 'BTCUSDT');
		expect(prompt).toContain('unknown');
	});
});

// ─── STRATEGY_LIBRARY integrity ───────────────────────────────────────────────

describe('STRATEGY_LIBRARY', () => {
	it('has 8 strategies', () => {
		expect(STRATEGY_LIBRARY).toHaveLength(8);
	});

	it('each strategy has unique id', () => {
		const ids = STRATEGY_LIBRARY.map(s => s.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(8);
	});

	it('each strategy has win rates for all 4 regimes', () => {
		const regimes: ('trending_up' | 'trending_down' | 'ranging' | 'high_volatility')[] = [
			'trending_up', 'trending_down', 'ranging', 'high_volatility',
		];
		for (const strategy of STRATEGY_LIBRARY) {
			for (const regime of regimes) {
				expect(strategy.winRates[regime]).toBeGreaterThanOrEqual(0);
				expect(strategy.winRates[regime]).toBeLessThanOrEqual(100);
			}
		}
	});

	it('each strategy has at least one ideal regime', () => {
		for (const strategy of STRATEGY_LIBRARY) {
			expect(strategy.idealRegimes.length).toBeGreaterThan(0);
		}
	});

	it('each strategy idealADXRange has min <= max', () => {
		for (const strategy of STRATEGY_LIBRARY) {
			expect(strategy.idealADXRange[0]).toBeLessThanOrEqual(strategy.idealADXRange[1]);
		}
	});
});
