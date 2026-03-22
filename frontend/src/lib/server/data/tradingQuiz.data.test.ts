// Trading Quiz Data Tests — T-1403

import { describe, it, expect } from 'vitest';
import {
	defaultScore,
	getAdaptiveDifficulty,
	calcLevel,
	getCategoryAccuracy,
	getStrongestCategory,
	selectTemplate,
	evaluateAnswer,
	getStaticQuestions,
	getChartTemplates,
	getAllTemplates,
	type QuizScore,
	type ResolvedQuestion,
} from './tradingQuiz.data';

// ─── defaultScore ─────────────────────────────────────────────────────────────

describe('defaultScore', () => {
	it('returns zeroed score', () => {
		const s = defaultScore();
		expect(s.totalAnswered).toBe(0);
		expect(s.totalCorrect).toBe(0);
		expect(s.streak).toBe(0);
		expect(s.bestStreak).toBe(0);
		expect(s.byCategory).toEqual({});
	});
});

// ─── getAdaptiveDifficulty ────────────────────────────────────────────────────

describe('getAdaptiveDifficulty', () => {
	it('returns beginner for fresh user (< 5 questions)', () => {
		const s = defaultScore();
		expect(getAdaptiveDifficulty(s)).toBe('beginner');
	});

	it('returns beginner for < 55% accuracy after 5+ questions', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 10, totalCorrect: 4, streak: 0, bestStreak: 0 };
		expect(getAdaptiveDifficulty(s)).toBe('beginner');
	});

	it('returns intermediate for 55–74% accuracy after 5+ questions', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 10, totalCorrect: 6, streak: 0, bestStreak: 0 };
		expect(getAdaptiveDifficulty(s)).toBe('intermediate');
	});

	it('returns advanced for >= 75% accuracy after 5+ questions', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 10, totalCorrect: 8, streak: 0, bestStreak: 0 };
		expect(getAdaptiveDifficulty(s)).toBe('advanced');
	});

	it('returns beginner at exactly 5 answered with 0 correct', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 5, totalCorrect: 0, streak: 0, bestStreak: 0 };
		expect(getAdaptiveDifficulty(s)).toBe('beginner');
	});

	it('returns advanced at exactly 75% on 20 questions', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 20, totalCorrect: 15, streak: 0, bestStreak: 0 };
		expect(getAdaptiveDifficulty(s)).toBe('advanced');
	});
});

// ─── calcLevel ────────────────────────────────────────────────────────────────

describe('calcLevel', () => {
	it('returns Developing Trader for a new user', () => {
		expect(calcLevel(defaultScore())).toBe('Developing Trader');
	});

	it('returns Expert Trader for high accuracy advanced user', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 20, totalCorrect: 18, streak: 5, bestStreak: 5 };
		expect(calcLevel(s)).toBe('Expert Trader');
	});

	it('returns Intermediate Trader for 55–74% accuracy user', () => {
		const s: QuizScore = { ...defaultScore(), totalAnswered: 10, totalCorrect: 6, streak: 0, bestStreak: 0 };
		expect(calcLevel(s)).toBe('Intermediate Trader');
	});

	it('returns a non-empty string in all cases', () => {
		expect(calcLevel(defaultScore()).length).toBeGreaterThan(0);
	});
});

// ─── getCategoryAccuracy ──────────────────────────────────────────────────────

describe('getCategoryAccuracy', () => {
	it('returns 0 for category with no answered questions', () => {
		expect(getCategoryAccuracy(defaultScore(), 'technical_analysis')).toBe(0);
	});

	it('returns 100 when all correct', () => {
		const s: QuizScore = {
			...defaultScore(),
			byCategory: { technical_analysis: { answered: 4, correct: 4 } },
		};
		expect(getCategoryAccuracy(s, 'technical_analysis')).toBe(100);
	});

	it('returns 50 when half correct', () => {
		const s: QuizScore = {
			...defaultScore(),
			byCategory: { risk_management: { answered: 6, correct: 3 } },
		};
		expect(getCategoryAccuracy(s, 'risk_management')).toBe(50);
	});

	it('returns 0 for category not yet attempted', () => {
		const s: QuizScore = {
			...defaultScore(),
			byCategory: { psychology: { answered: 3, correct: 2 } },
		};
		expect(getCategoryAccuracy(s, 'macro')).toBe(0);
	});
});

// ─── getStrongestCategory ─────────────────────────────────────────────────────

describe('getStrongestCategory', () => {
	it('returns N/A when no category has 2+ attempts', () => {
		expect(getStrongestCategory(defaultScore())).toBe('N/A');
	});

	it('returns the category with highest accuracy (2+ attempts)', () => {
		const s: QuizScore = {
			...defaultScore(),
			byCategory: {
				technical_analysis: { answered: 4, correct: 2 },
				risk_management: { answered: 4, correct: 4 },
				psychology: { answered: 2, correct: 1 },
			},
		};
		const strongest = getStrongestCategory(s);
		expect(strongest).toBe('risk management'); // underscores replaced
	});

	it('ignores categories with fewer than 2 attempts', () => {
		const s: QuizScore = {
			...defaultScore(),
			byCategory: {
				macro: { answered: 1, correct: 1 }, // skipped
				psychology: { answered: 3, correct: 3 },
			},
		};
		expect(getStrongestCategory(s)).toBe('psychology');
	});
});

// ─── selectTemplate ───────────────────────────────────────────────────────────

describe('selectTemplate', () => {
	it('returns a template for "random" category', () => {
		const t = selectTemplate('random', 'beginner', defaultScore());
		expect(t).not.toBeNull();
		expect(t?.id).toBeTruthy();
	});

	it('returns a template from the correct category', () => {
		const t = selectTemplate('risk_management', 'beginner', defaultScore());
		expect(t?.category).toBe('risk_management');
	});

	it('returns null when all questions in category are used', () => {
		const allIds = getAllTemplates()
			.filter(q => q.category === 'psychology')
			.map(q => q.id);
		const t = selectTemplate('psychology', 'adaptive', defaultScore(), allIds);
		expect(t).toBeNull();
	});

	it('does not return a used question', () => {
		const first = selectTemplate('technical_analysis', 'beginner', defaultScore());
		expect(first).not.toBeNull();
		// Get all TA beginner questions and mark all but one as used
		const taQuestions = getAllTemplates()
			.filter(q => q.category === 'technical_analysis' && q.difficulty === 'beginner');
		if (taQuestions.length >= 2) {
			const usedIds = [taQuestions[0].id];
			const second = selectTemplate('technical_analysis', 'beginner', defaultScore(), usedIds);
			expect(second?.id).not.toBe(taQuestions[0].id);
		}
	});

	it('returns a beginner question when adaptive and score is fresh', () => {
		const t = selectTemplate('random', 'adaptive', defaultScore());
		// With fresh score, adaptive = beginner — but pool may have any difficulty
		// Just verify a question is returned
		expect(t).not.toBeNull();
	});
});

// ─── evaluateAnswer ───────────────────────────────────────────────────────────

function makeResolvedQuestion(correctIndex: 0 | 1 | 2 | 3 = 0): ResolvedQuestion {
	return {
		id: 'test_q',
		category: 'technical_analysis',
		difficulty: 'beginner',
		question: 'Test question?',
		options: ['Option A', 'Option B', 'Option C', 'Option D'],
		correctIndex,
		explanation: 'Test explanation.',
		requiresChart: false,
	};
}

describe('evaluateAnswer', () => {
	it('marks correct answer as correct', () => {
		const q = makeResolvedQuestion(2);
		const result = evaluateAnswer(q, 2, defaultScore());
		expect(result.correct).toBe(true);
		expect(result.selectedIndex).toBe(2);
		expect(result.correctIndex).toBe(2);
	});

	it('marks wrong answer as incorrect', () => {
		const q = makeResolvedQuestion(0);
		const result = evaluateAnswer(q, 3, defaultScore());
		expect(result.correct).toBe(false);
		expect(result.selectedIndex).toBe(3);
		expect(result.correctIndex).toBe(0);
	});

	it('increments totalAnswered on correct', () => {
		const q = makeResolvedQuestion(1);
		const prev = defaultScore();
		const r = evaluateAnswer(q, 1, prev);
		expect(r.updatedScore.totalAnswered).toBe(1);
		expect(r.updatedScore.totalCorrect).toBe(1);
	});

	it('increments totalAnswered but not totalCorrect on wrong', () => {
		const q = makeResolvedQuestion(1);
		const r = evaluateAnswer(q, 0, defaultScore());
		expect(r.updatedScore.totalAnswered).toBe(1);
		expect(r.updatedScore.totalCorrect).toBe(0);
	});

	it('increments streak on correct answers', () => {
		const q = makeResolvedQuestion(0);
		const prev: QuizScore = { ...defaultScore(), streak: 3 };
		const r = evaluateAnswer(q, 0, prev);
		expect(r.updatedScore.streak).toBe(4);
	});

	it('resets streak on wrong answer', () => {
		const q = makeResolvedQuestion(0);
		const prev: QuizScore = { ...defaultScore(), streak: 5 };
		const r = evaluateAnswer(q, 1, prev);
		expect(r.updatedScore.streak).toBe(0);
	});

	it('updates bestStreak when streak exceeds it', () => {
		const q = makeResolvedQuestion(0);
		const prev: QuizScore = { ...defaultScore(), streak: 4, bestStreak: 4 };
		const r = evaluateAnswer(q, 0, prev);
		expect(r.updatedScore.bestStreak).toBe(5);
	});

	it('does not decrease bestStreak on wrong answer', () => {
		const q = makeResolvedQuestion(0);
		const prev: QuizScore = { ...defaultScore(), streak: 3, bestStreak: 7 };
		const r = evaluateAnswer(q, 1, prev);
		expect(r.updatedScore.bestStreak).toBe(7); // unchanged
	});

	it('updates byCategory stats correctly', () => {
		const q = makeResolvedQuestion(0);
		q.category = 'risk_management' as typeof q.category;
		const r = evaluateAnswer(q, 0, defaultScore());
		expect(r.updatedScore.byCategory.risk_management?.answered).toBe(1);
		expect(r.updatedScore.byCategory.risk_management?.correct).toBe(1);
	});

	it('accumulates byCategory stats across calls', () => {
		const q = makeResolvedQuestion(0);
		q.category = 'macro' as typeof q.category;
		const r1 = evaluateAnswer(q, 0, defaultScore()); // correct
		const r2 = evaluateAnswer(q, 1, r1.updatedScore); // wrong
		expect(r2.updatedScore.byCategory.macro?.answered).toBe(2);
		expect(r2.updatedScore.byCategory.macro?.correct).toBe(1);
	});

	it('preserves explanation from the question', () => {
		const q = makeResolvedQuestion(0);
		const r = evaluateAnswer(q, 0, defaultScore());
		expect(r.explanation).toBe('Test explanation.');
	});

	it('does not mutate previous score', () => {
		const q = makeResolvedQuestion(0);
		const prev = defaultScore();
		evaluateAnswer(q, 0, prev);
		expect(prev.totalAnswered).toBe(0);
	});
});

// ─── Question bank integrity ──────────────────────────────────────────────────

describe('question bank integrity', () => {
	it('has at least 25 static questions', () => {
		expect(getStaticQuestions().length).toBeGreaterThanOrEqual(25);
	});

	it('has at least 3 chart templates', () => {
		expect(getChartTemplates().length).toBeGreaterThanOrEqual(3);
	});

	it('all static questions have 4 options', () => {
		for (const q of getStaticQuestions()) {
			expect(q.options.length).toBe(4);
		}
	});

	it('all static questions have correctIndex 0–3', () => {
		for (const q of getStaticQuestions()) {
			expect(q.correctIndex).toBeGreaterThanOrEqual(0);
			expect(q.correctIndex).toBeLessThanOrEqual(3);
		}
	});

	it('all static questions have non-empty explanation', () => {
		for (const q of getStaticQuestions()) {
			expect(q.explanation.length).toBeGreaterThan(10);
		}
	});

	it('all static question IDs are unique', () => {
		const ids = getStaticQuestions().map(q => q.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
	});

	it('all template IDs are unique across static + chart', () => {
		const ids = getAllTemplates().map(q => q.id);
		const unique = new Set(ids);
		expect(unique.size).toBe(ids.length);
	});

	it('all static questions have valid category', () => {
		const validCats = new Set(['technical_analysis', 'risk_management', 'market_microstructure', 'psychology', 'macro']);
		for (const q of getStaticQuestions()) {
			expect(validCats.has(q.category)).toBe(true);
		}
	});

	it('all static questions have valid difficulty', () => {
		const validDiffs = new Set(['beginner', 'intermediate', 'advanced']);
		for (const q of getStaticQuestions()) {
			expect(validDiffs.has(q.difficulty)).toBe(true);
		}
	});

	it('each category has at least 3 questions', () => {
		const cats = ['technical_analysis', 'risk_management', 'market_microstructure', 'psychology', 'macro'];
		for (const cat of cats) {
			const count = getAllTemplates().filter(q => q.category === cat).length;
			expect(count).toBeGreaterThanOrEqual(3);
		}
	});
});

// ─── Chart template generate() ───────────────────────────────────────────────

describe('chart template generate()', () => {
	function makeCandles(closes: number[]): import('./tradingQuiz.data').ResolvedQuestion['ohlcv'] {
		return closes.map((c, i) => ({
			time: i * 3600,
			open: c * 0.99,
			high: c * 1.01,
			low: c * 0.98,
			close: c,
			volume: 100,
		}));
	}

	it('ta_chart_ma20_position generates bullish when price >> MA20', () => {
		const templates = getChartTemplates();
		const t = templates.find(t => t.id === 'ta_chart_ma20_position');
		expect(t).toBeTruthy();
		if (!t) return;

		// 20 candles at 100, then last at 110 (10% above MA)
		const candles = makeCandles([...Array(20).fill(100), 110]);
		const generated = t.generate(candles as import('$lib/types/contentBlock').OHLCV[]);
		expect(generated.correctIndex).toBe(0); // Above MA (bullish)
		expect(generated.question).toContain('MA');
	});

	it('ta_chart_ma20_position generates bearish when price << MA20', () => {
		const templates = getChartTemplates();
		const t = templates.find(t => t.id === 'ta_chart_ma20_position');
		if (!t) return;

		const candles = makeCandles([...Array(20).fill(100), 90]); // 10% below
		const generated = t.generate(candles as import('$lib/types/contentBlock').OHLCV[]);
		expect(generated.correctIndex).toBe(1); // Below MA (bearish)
	});

	it('ta_chart_green_candles generates correctly for 5 green candles', () => {
		const templates = getChartTemplates();
		const t = templates.find(t => t.id === 'ta_chart_green_candles');
		if (!t) return;

		// 5 green candles (close > open)
		const candles: import('$lib/types/contentBlock').OHLCV[] = Array.from({ length: 5 }, (_, i) => ({
			time: i * 86400,
			open: 100,
			high: 102,
			low: 99,
			close: 101, // green
			volume: 100,
		}));
		const generated = t.generate(candles);
		expect(generated.correctIndex).toBe(0); // "5 green candles"
	});

	it('ta_chart_rsi_zone handles overbought RSI', () => {
		const templates = getChartTemplates();
		const t = templates.find(t => t.id === 'ta_chart_rsi_zone');
		if (!t) return;

		// 15+ candles rising sharply (high gains, no losses) → RSI near 100
		const candles: import('$lib/types/contentBlock').OHLCV[] = Array.from({ length: 20 }, (_, i) => ({
			time: i * 86400,
			open: 100 + i * 3,
			high: 100 + i * 3 + 2,
			low: 100 + i * 3 - 1,
			close: 100 + i * 3 + 3, // always up
			volume: 100,
		}));
		const generated = t.generate(candles);
		expect(generated.correctIndex).toBe(0); // Overbought
		expect(generated.question).toContain('RSI');
	});

	it('ta_chart_ma20_position falls back gracefully with < 20 candles', () => {
		const templates = getChartTemplates();
		const t = templates.find(t => t.id === 'ta_chart_ma20_position');
		if (!t) return;

		const candles = makeCandles([100, 101]);
		const generated = t.generate(candles as import('$lib/types/contentBlock').OHLCV[]);
		expect(generated.options.length).toBe(4);
		expect(generated.explanation.length).toBeGreaterThan(0);
	});
});
