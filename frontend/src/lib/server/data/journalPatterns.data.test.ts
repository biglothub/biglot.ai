// Tests for Trading Journal Pattern Analyzer Data — T-1307

import { describe, it, expect } from 'vitest';
import type { JournalEntry } from '../portfolio/journal';
import {
	analyzeSetupPatterns,
	analyzeDayPatterns,
	analyzeEmotionPatterns,
	analyzeStreaks,
	analyzeSizingPatterns,
	calcDisciplineScore,
	extractCommonMistakes,
	analyzeJournalPatterns,
	buildPatternPrompt,
	parsePatternCoaching,
	buildFallbackPatternCoaching,
} from './journalPatterns.data';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id: 'test-id',
		userId: 'user1',
		symbol: 'BTCUSDT',
		direction: 'long',
		entryPrice: 50000,
		exitPrice: 51000,
		size: 1,
		pnlUSD: 1000,
		rMultiple: 2,
		setupType: 'pullback',
		emotion: 'calm',
		preNotes: null,
		postNotes: null,
		mistakes: [],
		followedPlan: true,
		tradeDate: '2024-01-15', // Monday
		createdAt: new Date().toISOString(),
		...overrides,
	};
}

const MONDAY    = '2024-01-15';
const TUESDAY   = '2024-01-16';
const WEDNESDAY = '2024-01-17';

// ─── analyzeSetupPatterns ─────────────────────────────────────────────────────

describe('analyzeSetupPatterns', () => {
	it('returns empty array for no entries', () => {
		expect(analyzeSetupPatterns([])).toEqual([]);
	});

	it('skips open trades with null pnl', () => {
		const entry = makeEntry({ pnlUSD: null, exitPrice: null });
		expect(analyzeSetupPatterns([entry])).toEqual([]);
	});

	it('groups by setup type and calculates win rate', () => {
		const entries: JournalEntry[] = [
			makeEntry({ setupType: 'pullback', pnlUSD: 100, rMultiple: 2 }),
			makeEntry({ setupType: 'pullback', pnlUSD: -50, rMultiple: -1 }),
			makeEntry({ setupType: 'breakout', pnlUSD: 200, rMultiple: 3 }),
		];
		const result = analyzeSetupPatterns(entries);

		const pullback = result.find(s => s.setupType === 'pullback');
		expect(pullback).toBeDefined();
		expect(pullback!.tradeCount).toBe(2);
		expect(pullback!.wins).toBe(1);
		expect(pullback!.winRate).toBeCloseTo(0.5);
		expect(pullback!.avgRMultiple).toBeCloseTo(0.5);
		expect(pullback!.totalPnlUSD).toBeCloseTo(50);

		const breakout = result.find(s => s.setupType === 'breakout');
		expect(breakout!.wins).toBe(1);
		expect(breakout!.winRate).toBe(1);
	});

	it('uses "unspecified" for null setupType', () => {
		const entry = makeEntry({ setupType: null });
		const result = analyzeSetupPatterns([entry]);
		expect(result[0].setupType).toBe('unspecified');
	});

	it('sorts by trade count descending', () => {
		const entries: JournalEntry[] = [
			makeEntry({ setupType: 'breakout' }),
			makeEntry({ setupType: 'pullback' }),
			makeEntry({ setupType: 'pullback' }),
		];
		const result = analyzeSetupPatterns(entries);
		expect(result[0].setupType).toBe('pullback');
		expect(result[0].tradeCount).toBe(2);
	});
});

// ─── analyzeDayPatterns ───────────────────────────────────────────────────────

describe('analyzeDayPatterns', () => {
	it('returns empty for no entries', () => {
		expect(analyzeDayPatterns([])).toEqual([]);
	});

	it('skips open trades', () => {
		const entry = makeEntry({ pnlUSD: null });
		expect(analyzeDayPatterns([entry])).toEqual([]);
	});

	it('groups by day of week correctly', () => {
		const entries: JournalEntry[] = [
			makeEntry({ tradeDate: MONDAY,  pnlUSD: 100 }), // Monday
			makeEntry({ tradeDate: MONDAY,  pnlUSD: -50 }), // Monday
			makeEntry({ tradeDate: TUESDAY, pnlUSD: 200 }), // Tuesday
		];
		const result = analyzeDayPatterns(entries);
		const monday = result.find(d => d.day === 'Monday');
		expect(monday).toBeDefined();
		expect(monday!.tradeCount).toBe(2);
		expect(monday!.wins).toBe(1);
		expect(monday!.winRate).toBeCloseTo(0.5);
		expect(monday!.dayIndex).toBe(1);

		const tuesday = result.find(d => d.day === 'Tuesday');
		expect(tuesday!.tradeCount).toBe(1);
		expect(tuesday!.winRate).toBe(1);
	});

	it('orders Mon-Fri first', () => {
		const sunday = '2024-01-14'; // Sunday
		const entries = [
			makeEntry({ tradeDate: sunday,  pnlUSD: 100 }),
			makeEntry({ tradeDate: MONDAY,  pnlUSD: 100 }),
		];
		const result = analyzeDayPatterns(entries);
		expect(result[0].day).toBe('Monday');
		expect(result[1].day).toBe('Sunday');
	});
});

// ─── analyzeEmotionPatterns ───────────────────────────────────────────────────

describe('analyzeEmotionPatterns', () => {
	it('returns empty for no closed entries', () => {
		expect(analyzeEmotionPatterns([])).toEqual([]);
	});

	it('groups by emotion and calculates stats', () => {
		const entries: JournalEntry[] = [
			makeEntry({ emotion: 'calm',     pnlUSD:  100, rMultiple:  2 }),
			makeEntry({ emotion: 'calm',     pnlUSD:  150, rMultiple:  3 }),
			makeEntry({ emotion: 'impulsive',pnlUSD: -100, rMultiple: -1 }),
		];
		const result = analyzeEmotionPatterns(entries);
		const calm = result.find(e => e.emotion === 'calm');
		expect(calm!.tradeCount).toBe(2);
		expect(calm!.winRate).toBe(1);
		expect(calm!.avgRMultiple).toBeCloseTo(2.5);
		expect(calm!.avgPnlUSD).toBeCloseTo(125);

		const impulsive = result.find(e => e.emotion === 'impulsive');
		expect(impulsive!.winRate).toBe(0);
	});

	it('uses "not recorded" for null emotion', () => {
		const entry = makeEntry({ emotion: null });
		const result = analyzeEmotionPatterns([entry]);
		expect(result[0].emotion).toBe('not recorded');
	});
});

// ─── analyzeStreaks ───────────────────────────────────────────────────────────

describe('analyzeStreaks', () => {
	it('returns none streak for empty input', () => {
		const result = analyzeStreaks([]);
		expect(result.currentStreakType).toBe('none');
		expect(result.currentStreakCount).toBe(0);
		expect(result.maxWinStreak).toBe(0);
		expect(result.maxLossStreak).toBe(0);
	});

	it('detects current win streak', () => {
		const entries: JournalEntry[] = [
			makeEntry({ tradeDate: MONDAY,    pnlUSD: -100 }),
			makeEntry({ tradeDate: TUESDAY,   pnlUSD:  100 }),
			makeEntry({ tradeDate: WEDNESDAY, pnlUSD:  200 }),
		];
		const result = analyzeStreaks(entries);
		expect(result.currentStreakType).toBe('win');
		expect(result.currentStreakCount).toBe(2);
		expect(result.maxWinStreak).toBe(2);
		expect(result.maxLossStreak).toBe(1);
	});

	it('detects current loss streak', () => {
		const entries: JournalEntry[] = [
			makeEntry({ tradeDate: MONDAY,    pnlUSD:  100 }),
			makeEntry({ tradeDate: TUESDAY,   pnlUSD: -100 }),
			makeEntry({ tradeDate: WEDNESDAY, pnlUSD: -200 }),
		];
		const result = analyzeStreaks(entries);
		expect(result.currentStreakType).toBe('loss');
		expect(result.currentStreakCount).toBe(2);
		expect(result.maxLossStreak).toBe(2);
	});

	it('skips open trades', () => {
		const entry = makeEntry({ pnlUSD: null });
		const result = analyzeStreaks([entry]);
		expect(result.currentStreakType).toBe('none');
	});

	it('tracks max streaks correctly', () => {
		const entries: JournalEntry[] = [
			makeEntry({ tradeDate: '2024-01-01', pnlUSD:  100 }),
			makeEntry({ tradeDate: '2024-01-02', pnlUSD:  100 }),
			makeEntry({ tradeDate: '2024-01-03', pnlUSD:  100 }),
			makeEntry({ tradeDate: '2024-01-04', pnlUSD: -100 }),
			makeEntry({ tradeDate: '2024-01-05', pnlUSD: -100 }),
		];
		const result = analyzeStreaks(entries);
		expect(result.maxWinStreak).toBe(3);
		expect(result.maxLossStreak).toBe(2);
		expect(result.currentStreakType).toBe('loss');
		expect(result.currentStreakCount).toBe(2);
	});
});

// ─── analyzeSizingPatterns ────────────────────────────────────────────────────

describe('analyzeSizingPatterns', () => {
	it('returns null sizes for empty input', () => {
		const result = analyzeSizingPatterns([]);
		expect(result.winAvgSize).toBeNull();
		expect(result.lossAvgSize).toBeNull();
		expect(result.sizeConsistency).toBe('unclear');
		expect(result.oversizedOnLoss).toBe(false);
	});

	it('detects consistent sizing', () => {
		const entries = [1, 1, 1, 1, 1].map(size =>
			makeEntry({ size, pnlUSD: 100 })
		);
		const result = analyzeSizingPatterns(entries);
		expect(result.sizeConsistency).toBe('consistent');
	});

	it('detects variable sizing', () => {
		const entries = [0.1, 1, 5, 0.2, 4].map(size =>
			makeEntry({ size, pnlUSD: 100 })
		);
		const result = analyzeSizingPatterns(entries);
		expect(result.sizeConsistency).toBe('variable');
	});

	it('detects oversized losses', () => {
		const entries: JournalEntry[] = [
			makeEntry({ size: 1,   pnlUSD:  100 }),
			makeEntry({ size: 1,   pnlUSD:  100 }),
			makeEntry({ size: 5,   pnlUSD: -100 }),
			makeEntry({ size: 5,   pnlUSD: -100 }),
		];
		const result = analyzeSizingPatterns(entries);
		expect(result.winAvgSize).toBeCloseTo(1);
		expect(result.lossAvgSize).toBeCloseTo(5);
		expect(result.oversizedOnLoss).toBe(true);
	});

	it('is not oversized when loss size <= 1.2x win size', () => {
		const entries: JournalEntry[] = [
			makeEntry({ size: 1,   pnlUSD:  100 }),
			makeEntry({ size: 1.1, pnlUSD: -100 }),
		];
		const result = analyzeSizingPatterns(entries);
		expect(result.oversizedOnLoss).toBe(false);
	});
});

// ─── calcDisciplineScore ──────────────────────────────────────────────────────

describe('calcDisciplineScore', () => {
	it('returns 50 for empty input', () => {
		expect(calcDisciplineScore([])).toBe(50);
	});

	it('increases with plan adherence', () => {
		const noAdherence = [makeEntry({ followedPlan: false, emotion: 'calm', setupType: 'pullback' })];
		const fullAdherence = [makeEntry({ followedPlan: true, emotion: 'calm', setupType: 'pullback' })];
		expect(calcDisciplineScore(fullAdherence)).toBeGreaterThan(calcDisciplineScore(noAdherence));
	});

	it('decreases with emotional trades', () => {
		const calm = [makeEntry({ emotion: 'calm', followedPlan: null, setupType: null })];
		const impulsive = [makeEntry({ emotion: 'impulsive', followedPlan: null, setupType: null })];
		expect(calcDisciplineScore(calm)).toBeGreaterThan(calcDisciplineScore(impulsive));
	});

	it('increases with setup type completeness', () => {
		const withSetup    = [makeEntry({ setupType: 'pullback', emotion: null, followedPlan: null })];
		const withoutSetup = [makeEntry({ setupType: null, emotion: null, followedPlan: null })];
		expect(calcDisciplineScore(withSetup)).toBeGreaterThan(calcDisciplineScore(withoutSetup));
	});

	it('clamps to 0–100', () => {
		const fullDiscipline = Array(10).fill(null).map(() =>
			makeEntry({ followedPlan: true, emotion: 'calm', setupType: 'pullback' })
		);
		const score = calcDisciplineScore(fullDiscipline);
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(100);
	});
});

// ─── extractCommonMistakes ────────────────────────────────────────────────────

describe('extractCommonMistakes', () => {
	it('returns empty for no mistakes', () => {
		expect(extractCommonMistakes([makeEntry({ mistakes: [] })])).toEqual([]);
	});

	it('counts and sorts mistakes', () => {
		const entries = [
			makeEntry({ mistakes: ['FOMO', 'early exit'] }),
			makeEntry({ mistakes: ['FOMO'] }),
			makeEntry({ mistakes: ['FOMO', 'no stop loss'] }),
		];
		const result = extractCommonMistakes(entries);
		expect(result[0].mistake).toBe('FOMO');
		expect(result[0].count).toBe(3);
	});

	it('limits to top 5', () => {
		const mistakes = ['a', 'b', 'c', 'd', 'e', 'f'];
		const entry = makeEntry({ mistakes });
		const result = extractCommonMistakes([entry]);
		expect(result.length).toBe(5);
	});
});

// ─── analyzeJournalPatterns ───────────────────────────────────────────────────

describe('analyzeJournalPatterns', () => {
	it('handles empty entries', () => {
		const bundle = analyzeJournalPatterns([]);
		expect(bundle.totalTrades).toBe(0);
		expect(bundle.closedTrades).toBe(0);
		expect(bundle.overallWinRate).toBeNull();
		expect(bundle.streak.currentStreakType).toBe('none');
		expect(bundle.setupPatterns).toEqual([]);
		expect(bundle.disciplineScore).toBe(50);
	});

	it('computes overall win rate correctly', () => {
		const entries: JournalEntry[] = [
			makeEntry({ pnlUSD:  100 }),
			makeEntry({ pnlUSD:  200 }),
			makeEntry({ pnlUSD: -100 }),
			makeEntry({ pnlUSD: null }), // open trade
		];
		const bundle = analyzeJournalPatterns(entries);
		expect(bundle.totalTrades).toBe(4);
		expect(bundle.closedTrades).toBe(3);
		expect(bundle.overallWinRate).toBeCloseTo(2 / 3);
	});

	it('sets topSetup to null when no qualified setups (< 3 trades)', () => {
		const entries = [
			makeEntry({ setupType: 'pullback', pnlUSD: 100 }),
			makeEntry({ setupType: 'pullback', pnlUSD: 100 }),
		];
		const bundle = analyzeJournalPatterns(entries);
		expect(bundle.topSetup).toBeNull();
	});

	it('identifies top and worst setup', () => {
		const entries: JournalEntry[] = [
			// pullback: 3 wins → 100% win rate
			makeEntry({ setupType: 'pullback', pnlUSD: 100, tradeDate: '2024-01-01' }),
			makeEntry({ setupType: 'pullback', pnlUSD: 100, tradeDate: '2024-01-02' }),
			makeEntry({ setupType: 'pullback', pnlUSD: 100, tradeDate: '2024-01-03' }),
			// breakout: 0 wins → 0% win rate
			makeEntry({ setupType: 'breakout', pnlUSD: -100, tradeDate: '2024-01-04' }),
			makeEntry({ setupType: 'breakout', pnlUSD: -100, tradeDate: '2024-01-05' }),
			makeEntry({ setupType: 'breakout', pnlUSD: -100, tradeDate: '2024-01-06' }),
		];
		const bundle = analyzeJournalPatterns(entries);
		expect(bundle.topSetup).toBe('pullback');
		expect(bundle.worstSetup).toBe('breakout');
		expect(bundle.keyInsight).toContain('pullback');
		expect(bundle.keyInsight).toContain('breakout');
	});
});

// ─── buildPatternPrompt ───────────────────────────────────────────────────────

describe('buildPatternPrompt', () => {
	it('returns a non-empty string', () => {
		const entries = [makeEntry()];
		const bundle  = analyzeJournalPatterns(entries);
		const prompt  = buildPatternPrompt(bundle);
		expect(typeof prompt).toBe('string');
		expect(prompt.length).toBeGreaterThan(100);
	});

	it('includes key statistics', () => {
		const entries = [makeEntry({ pnlUSD: 100, setupType: 'pullback' })];
		const bundle  = analyzeJournalPatterns(entries);
		const prompt  = buildPatternPrompt(bundle);
		expect(prompt).toContain('pullback');
		expect(prompt).toContain('Discipline score');
	});
});

// ─── parsePatternCoaching ─────────────────────────────────────────────────────

describe('parsePatternCoaching', () => {
	it('returns non-empty trimmed string', () => {
		expect(parsePatternCoaching('  Hello world  ')).toBe('Hello world');
	});

	it('returns null for empty string', () => {
		expect(parsePatternCoaching('')).toBeNull();
		expect(parsePatternCoaching('   ')).toBeNull();
	});
});

// ─── buildFallbackPatternCoaching ─────────────────────────────────────────────

describe('buildFallbackPatternCoaching', () => {
	it('returns a non-empty string', () => {
		const entries = [makeEntry()];
		const bundle  = analyzeJournalPatterns(entries);
		const text    = buildFallbackPatternCoaching(bundle);
		expect(typeof text).toBe('string');
		expect(text.length).toBeGreaterThan(20);
	});

	it('mentions oversized loss warning when relevant', () => {
		const entries: JournalEntry[] = [
			makeEntry({ size: 1, pnlUSD:  100 }),
			makeEntry({ size: 5, pnlUSD: -100 }),
		];
		const bundle = analyzeJournalPatterns(entries);
		// Force oversized flag
		const bundleWithFlag = { ...bundle, sizing: { ...bundle.sizing, oversizedOnLoss: true, winAvgSize: 1, lossAvgSize: 5 } };
		const text = buildFallbackPatternCoaching(bundleWithFlag);
		expect(text.toLowerCase()).toContain('sizing');
	});

	it('includes discipline score', () => {
		const entries = [makeEntry()];
		const bundle  = analyzeJournalPatterns(entries);
		const text    = buildFallbackPatternCoaching(bundle);
		expect(text).toContain('Discipline Score');
	});
});
