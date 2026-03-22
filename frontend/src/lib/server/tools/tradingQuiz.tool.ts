// Trading Quiz Tool — T-1403
// Tool: start_quiz — interactive trading knowledge quiz with real chart data,
// adaptive difficulty, and persistent score tracking via memory.

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	defaultScore,
	selectTemplate,
	resolveQuestion,
	evaluateAnswer,
	calcLevel,
	getCategoryAccuracy,
	getStrongestCategory,
	getAdaptiveDifficulty,
	type QuizScore,
	type ResolvedQuestion,
	type QuizCategory,
} from '../data/tradingQuiz.data';
import { saveMemory, recallMemory } from '../memory.server';
import type { ContentBlock, MetricCardBlock, ChartBlock } from '$lib/types/contentBlock';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCORE_CACHE_TTL = 60 * 60_000;         // 1 hour
const QUESTION_CACHE_TTL = 30 * 60_000;      // 30 min
const CATEGORIES: (QuizCategory | 'random')[] = [
	'technical_analysis', 'risk_management', 'market_microstructure', 'psychology', 'macro', 'random',
];

// ─── Score persistence helpers ────────────────────────────────────────────────

function scoreSessionKey(userId: string): string {
	return `quiz_score:${userId}`;
}

function questionCacheKey(userId: string): string {
	return `quiz_question:${userId}`;
}

async function loadScore(userId: string): Promise<QuizScore> {
	// Check session cache first
	const cached = toolCache.get<QuizScore>(scoreSessionKey(userId));
	if (cached) return cached;

	if (userId === 'anonymous') return defaultScore();

	// Try memory
	try {
		const result = await recallMemory(userId, 'note', 'quiz_score');
		if (result.entries.length > 0) {
			const raw = result.entries[0].value as Record<string, unknown>;
			const score = parseScore(raw);
			toolCache.set(scoreSessionKey(userId), score, SCORE_CACHE_TTL);
			return score;
		}
	} catch {
		// fall through
	}
	return defaultScore();
}

async function persistScore(userId: string, score: QuizScore): Promise<void> {
	toolCache.set(scoreSessionKey(userId), score, SCORE_CACHE_TTL);
	if (userId === 'anonymous') return;
	try {
		await saveMemory(userId, 'note', 'quiz_score', score as unknown as Record<string, unknown>);
	} catch {
		// non-fatal
	}
}

function parseScore(raw: Record<string, unknown>): QuizScore {
	const def = defaultScore();
	return {
		totalAnswered: typeof raw.totalAnswered === 'number' ? raw.totalAnswered : def.totalAnswered,
		totalCorrect: typeof raw.totalCorrect === 'number' ? raw.totalCorrect : def.totalCorrect,
		streak: typeof raw.streak === 'number' ? raw.streak : def.streak,
		bestStreak: typeof raw.bestStreak === 'number' ? raw.bestStreak : def.bestStreak,
		byCategory: (typeof raw.byCategory === 'object' && raw.byCategory !== null)
			? raw.byCategory as QuizScore['byCategory']
			: def.byCategory,
	};
}

// ─── Block builders ───────────────────────────────────────────────────────────

function buildScoreMetricCard(score: QuizScore, title = 'Quiz Score'): MetricCardBlock {
	const accuracy = score.totalAnswered > 0
		? Math.round((score.totalCorrect / score.totalAnswered) * 100)
		: 0;
	const level = calcLevel(score);
	const strongest = getStrongestCategory(score);
	const diff = getAdaptiveDifficulty(score);

	return {
		type: 'metric_card',
		title,
		metrics: [
			{
				label: 'Level',
				value: level,
				direction: 'neutral',
			},
			{
				label: 'Accuracy',
				value: `${accuracy}%`,
				change: `${score.totalCorrect}/${score.totalAnswered} correct`,
				direction: accuracy >= 70 ? 'up' : accuracy >= 50 ? 'neutral' : 'down',
			},
			{
				label: 'Current Streak',
				value: `${score.streak}`,
				change: `Best: ${score.bestStreak}`,
				direction: score.streak >= 3 ? 'up' : 'neutral',
			},
			{
				label: 'Adaptive Difficulty',
				value: diff.charAt(0).toUpperCase() + diff.slice(1),
				direction: 'neutral',
			},
			{
				label: 'Strongest Category',
				value: strongest,
				direction: 'neutral',
			},
		],
	};
}

function buildQuestionText(question: ResolvedQuestion, qNumber: number): string {
	const categoryLabel: Record<QuizCategory, string> = {
		technical_analysis: 'Technical Analysis',
		risk_management: 'Risk Management',
		market_microstructure: 'Market Microstructure',
		psychology: 'Trading Psychology',
		macro: 'Macro',
	};
	const diffEmoji = question.difficulty === 'beginner' ? '🟢' : question.difficulty === 'intermediate' ? '🟡' : '🔴';

	const lines = [
		`**Question ${qNumber}** — ${categoryLabel[question.category]} ${diffEmoji} ${question.difficulty}`,
		'',
		question.question,
		'',
		...question.options.map((opt, i) => `**${String.fromCharCode(65 + i)}.** ${opt}`),
		'',
		'*Reply with the letter of your answer (A, B, C, or D)*',
	];
	return lines.join('\n');
}

function buildResultText(result: ReturnType<typeof evaluateAnswer>, question: ResolvedQuestion): string {
	const selectedLetter = String.fromCharCode(65 + result.selectedIndex);
	const correctLetter = String.fromCharCode(65 + result.correctIndex);
	const streakNote = result.updatedScore.streak >= 3 ? `\n\n🔥 **${result.updatedScore.streak} correct in a row!**` : '';

	if (result.correct) {
		return [
			`✅ **Correct!** You selected **${selectedLetter}**.`,
			'',
			`**Explanation:** ${result.explanation}`,
			streakNote,
		].join('\n');
	}

	return [
		`❌ **Incorrect.** You selected **${selectedLetter}**, but the correct answer is **${correctLetter}**.`,
		'',
		`**Explanation:** ${result.explanation}`,
	].join('\n');
}

// ─── Tool registration ────────────────────────────────────────────────────────

registerTool({
	name: 'start_quiz',
	description:
		'Interactive Trading Quiz — tests knowledge across 5 categories: Technical Analysis (including real chart data), Risk Management (position sizing scenarios), Market Microstructure (order flow, spreads, funding), Trading Psychology (behavioral biases), and Macro (yield curve, rates, currency). Adaptive difficulty based on performance. Persistent score tracking. Use action="generate" to get a new question and action="evaluate" to check the user\'s answer. Returns TextBlock (question/result), optional ChartBlock (chart questions), and MetricCard (score/streak/level).',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['generate', 'evaluate'],
				description: '"generate" — create a new question. "evaluate" — evaluate the user\'s answer to the current question.',
			},
			category: {
				type: 'string',
				enum: ['technical_analysis', 'risk_management', 'market_microstructure', 'psychology', 'macro', 'random'],
				description: 'Quiz category. Use "random" to mix all categories. Default: random',
			},
			difficulty: {
				type: 'string',
				enum: ['beginner', 'intermediate', 'advanced', 'adaptive'],
				description: 'Question difficulty. Use "adaptive" to auto-adjust based on performance. Default: adaptive',
			},
			answer: {
				type: 'string',
				description: 'For action="evaluate": the user\'s answer as a letter (A, B, C, or D) or the full answer text.',
			},
			user_id: {
				type: 'string',
				description: 'User ID for persistent score tracking. Default: "anonymous"',
			},
		},
		required: ['action'],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const action = args.action === 'evaluate' ? 'evaluate' : 'generate';
		const category = CATEGORIES.includes(args.category as QuizCategory | 'random')
			? (args.category as QuizCategory | 'random')
			: 'random';
		const difficulty = ['beginner', 'intermediate', 'advanced', 'adaptive'].includes(args.difficulty as string)
			? (args.difficulty as 'beginner' | 'intermediate' | 'advanced' | 'adaptive')
			: 'adaptive';
		const rawAnswer = typeof args.answer === 'string' ? args.answer.trim().toUpperCase() : '';
		const userId = typeof args.user_id === 'string' && args.user_id ? args.user_id : 'anonymous';

		// ── EVALUATE ──────────────────────────────────────────────────────────
		if (action === 'evaluate') {
			const qKey = questionCacheKey(userId);
			const currentQuestion = toolCache.get<ResolvedQuestion>(qKey);

			if (!currentQuestion) {
				return {
					success: false,
					contentBlocks: [{
						type: 'error',
						message: 'No active question found. Use action="generate" to get a new question first.',
						tool: 'start_quiz',
					}],
					textSummary: 'No active question — generate one first.',
				};
			}

			// Parse answer letter → index
			let selectedIndex: number;
			const letterMatch = rawAnswer.match(/^[A-D]/);
			if (letterMatch) {
				selectedIndex = letterMatch[0].charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
			} else {
				// Try to match by option text
				const found = currentQuestion.options.findIndex(
					opt => opt.toLowerCase().includes(rawAnswer.toLowerCase()),
				);
				selectedIndex = found >= 0 ? found : 0;
			}

			selectedIndex = Math.max(0, Math.min(3, selectedIndex));

			const prevScore = await loadScore(userId);
			const result = evaluateAnswer(currentQuestion, selectedIndex, prevScore);

			// Persist updated score
			await persistScore(userId, result.updatedScore);

			// Clear current question from cache (answered)
			toolCache.set(qKey, null as unknown as ResolvedQuestion, 100);

			const resultText = buildResultText(result, currentQuestion);
			const scoreCard = buildScoreMetricCard(result.updatedScore, 'Updated Score');

			const contentBlocks: ContentBlock[] = [
				{ type: 'text', content: resultText },
				scoreCard,
				{
					type: 'text',
					content: result.correct
						? `**Keep going!** Type "next question" or ask for another quiz question to continue.`
						: `**Keep learning!** Type "next question" for another question, or ask me to explain this topic in more detail.`,
				},
			];

			const accuracy = result.updatedScore.totalAnswered > 0
				? Math.round((result.updatedScore.totalCorrect / result.updatedScore.totalAnswered) * 100)
				: 0;

			return {
				success: true,
				contentBlocks,
				textSummary:
					`Answer: ${result.correct ? 'CORRECT' : 'INCORRECT'}. ` +
					`Selected option ${String.fromCharCode(65 + result.selectedIndex)}, correct was ${String.fromCharCode(65 + result.correctIndex)}. ` +
					`Score: ${result.updatedScore.totalCorrect}/${result.updatedScore.totalAnswered} (${accuracy}%). ` +
					`Streak: ${result.updatedScore.streak}. ` +
					`Explanation: ${currentQuestion.explanation}`,
			};
		}

		// ── GENERATE ──────────────────────────────────────────────────────────
		const score = await loadScore(userId);
		const qNumber = score.totalAnswered + 1;

		// Select template
		const template = selectTemplate(category, difficulty, score, []);
		if (!template) {
			return {
				success: false,
				contentBlocks: [{
					type: 'error',
					message: `No questions available for category "${category}". Try a different category or "random".`,
					tool: 'start_quiz',
				}],
				textSummary: `No questions found for category "${category}".`,
			};
		}

		// Resolve (fetch OHLCV if chart question)
		const cacheKey = toolCache.generateKey('start_quiz_q', { id: template.id });
		let resolved = toolCache.get<ResolvedQuestion>(cacheKey);
		if (!resolved) {
			resolved = await resolveQuestion(template);
			if (resolved.requiresChart) {
				toolCache.set(cacheKey, resolved, 5 * 60_000); // 5 min cache for chart data
			}
		}

		// Store current question for evaluation
		toolCache.set(questionCacheKey(userId), resolved, QUESTION_CACHE_TTL);

		// Build content blocks
		const questionText = buildQuestionText(resolved, qNumber);
		const contentBlocks: ContentBlock[] = [
			{ type: 'text', content: questionText },
		];

		// Add ChartBlock for chart questions
		if (resolved.requiresChart && resolved.ohlcv && resolved.symbol && resolved.interval) {
			const chartBlock: ChartBlock = {
				type: 'chart',
				chartType: 'candlestick',
				symbol: resolved.symbol,
				interval: resolved.interval,
				data: resolved.ohlcv.slice(-50), // last 50 candles for readability
			};
			contentBlocks.push(chartBlock);
		}

		// Add score card
		contentBlocks.push(buildScoreMetricCard(score, `Quiz — Question ${qNumber}`));

		// Add category accuracy hint for non-beginner users
		if (score.totalAnswered >= 5) {
			const catAcc = getCategoryAccuracy(score, resolved.category);
			if (catAcc > 0) {
				contentBlocks.push({
					type: 'text',
					content: `*Your accuracy in ${resolved.category.replace(/_/g, ' ')}: ${catAcc}%*`,
				});
			}
		}

		const diffLabel = difficulty === 'adaptive'
			? `adaptive (${getAdaptiveDifficulty(score)})`
			: difficulty;

		return {
			success: true,
			contentBlocks,
			textSummary:
				`Quiz question ${qNumber} — Category: ${resolved.category}, Difficulty: ${resolved.difficulty}. ` +
				`Question: "${resolved.question}" ` +
				`Options: ${resolved.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join(' | ')}. ` +
				`Wait for user's answer, then call start_quiz with action="evaluate" and their answer. ` +
				`Current score: ${score.totalCorrect}/${score.totalAnswered}, difficulty: ${diffLabel}.`,
		};
	},
});
