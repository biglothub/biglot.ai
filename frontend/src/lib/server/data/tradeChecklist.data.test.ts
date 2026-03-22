// Trade Checklist Data Tests — T-1302

import { describe, it, expect } from 'vitest';
import {
	calcRR,
	calcReadinessScore,
	getRecommendation,
	type ChecklistInputs,
} from './tradeChecklist.data';
import type { ChecklistItem } from '$lib/types/contentBlock';

// ─── calcRR ───────────────────────────────────────────────────────────────────

describe('calcRR', () => {
	it('returns correct R:R for a long trade', () => {
		// entry=100, stop=95, target=110 → risk=5, reward=10 → 2.0
		expect(calcRR(100, 95, 110, 'long')).toBeCloseTo(2.0);
	});

	it('returns correct R:R for a short trade', () => {
		// entry=100, stop=105, target=90 → risk=5, reward=10 → 2.0
		expect(calcRR(100, 105, 90, 'short')).toBeCloseTo(2.0);
	});

	it('returns -1 when stop is on wrong side for a long', () => {
		// stop above entry for long → invalid
		expect(calcRR(100, 110, 120, 'long')).toBe(-1);
	});

	it('returns -1 when target is on wrong side for a long', () => {
		// target below entry for long → invalid
		expect(calcRR(100, 95, 90, 'long')).toBe(-1);
	});

	it('returns -1 when stop is on wrong side for a short', () => {
		// stop below entry for short → invalid
		expect(calcRR(100, 90, 80, 'short')).toBe(-1);
	});

	it('returns -1 when target is on wrong side for a short', () => {
		// target above entry for short → invalid
		expect(calcRR(100, 105, 110, 'short')).toBe(-1);
	});

	it('handles a 3:1 R:R correctly', () => {
		// entry=100, stop=98, target=106 → risk=2, reward=6 → 3.0
		expect(calcRR(100, 98, 106, 'long')).toBeCloseTo(3.0);
	});

	it('handles a 1.5:1 R:R correctly', () => {
		// entry=100, stop=96, target=106 → risk=4, reward=6 → 1.5
		expect(calcRR(100, 96, 106, 'long')).toBeCloseTo(1.5);
	});
});

// ─── calcReadinessScore ───────────────────────────────────────────────────────

describe('calcReadinessScore', () => {
	it('returns 50 for empty items', () => {
		expect(calcReadinessScore([])).toBe(50);
	});

	it('returns 100 when all items pass', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'pass', explanation: '' },
			{ id: 'b', number: 2, question: 'Q2', status: 'pass', explanation: '' },
		];
		expect(calcReadinessScore(items)).toBe(100);
	});

	it('returns 0 when all items fail', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'fail', explanation: '' },
			{ id: 'b', number: 2, question: 'Q2', status: 'fail', explanation: '' },
		];
		expect(calcReadinessScore(items)).toBe(0);
	});

	it('returns 50 when all items are warning', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'warning', explanation: '' },
			{ id: 'b', number: 2, question: 'Q2', status: 'warning', explanation: '' },
		];
		expect(calcReadinessScore(items)).toBe(50);
	});

	it('excludes skip items from denominator', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'pass', explanation: '' },
			{ id: 'b', number: 2, question: 'Q2', status: 'skip', explanation: '' },
		];
		// only 1 scored item, pass = 100%
		expect(calcReadinessScore(items)).toBe(100);
	});

	it('returns 50 when all items are skipped', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'skip', explanation: '' },
		];
		expect(calcReadinessScore(items)).toBe(50);
	});

	it('handles mixed pass/warning/fail correctly', () => {
		const items: ChecklistItem[] = [
			{ id: 'a', number: 1, question: 'Q1', status: 'pass',    explanation: '' }, // 2 pts
			{ id: 'b', number: 2, question: 'Q2', status: 'warning', explanation: '' }, // 1 pt
			{ id: 'c', number: 3, question: 'Q3', status: 'fail',    explanation: '' }, // 0 pts
			{ id: 'd', number: 4, question: 'Q4', status: 'skip',    explanation: '' }, // excluded
		];
		// 3 scored items, total=6, earned=3 → 50%
		expect(calcReadinessScore(items)).toBe(50);
	});
});

// ─── getRecommendation ────────────────────────────────────────────────────────

describe('getRecommendation', () => {
	it('returns PROCEED for high score with no fails', () => {
		expect(getRecommendation(80, 0)).toBe('PROCEED');
	});

	it('returns PROCEED for score exactly 75 with no fails', () => {
		expect(getRecommendation(75, 0)).toBe('PROCEED');
	});

	it('returns CAUTION for high score but 1 fail', () => {
		expect(getRecommendation(80, 1)).toBe('CAUTION');
	});

	it('returns ABORT for 2+ fails regardless of score', () => {
		expect(getRecommendation(90, 2)).toBe('ABORT');
		expect(getRecommendation(100, 3)).toBe('ABORT');
	});

	it('returns CAUTION for score below 75 with no fails', () => {
		expect(getRecommendation(60, 0)).toBe('CAUTION');
	});

	it('returns CAUTION for score below 75 with 1 fail', () => {
		expect(getRecommendation(50, 1)).toBe('CAUTION');
	});

	it('returns ABORT even with score 0', () => {
		expect(getRecommendation(0, 2)).toBe('ABORT');
	});
});

// ─── ChecklistInputs type guard (structural) ──────────────────────────────────

describe('ChecklistInputs type', () => {
	it('accepts all optional fields', () => {
		const inputs: ChecklistInputs = {
			symbol:     'BTCUSDT',
			direction:  'long',
			timeframe:  '1d',
			entryPrice:  95000,
			stopPrice:   92000,
			targetPrice: 101000,
			accountSize: 10000,
			riskPct:     1,
			userId:      'user123',
		};
		expect(inputs.symbol).toBe('BTCUSDT');
	});

	it('requires only symbol, direction, timeframe', () => {
		const inputs: ChecklistInputs = {
			symbol:    'ETHUSDT',
			direction: 'short',
			timeframe: '4h',
		};
		expect(inputs.direction).toBe('short');
	});
});
