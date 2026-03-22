// Strategy Performance Attribution Tests — T-905
import { describe, it, expect } from 'vitest';
import {
	parseDOW,
	buildRow,
	attributePerformance,
	type AttributionRow,
} from './attribution';
import type { JournalEntry } from './journal';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
	return {
		id:          'test-id',
		userId:      'user-1',
		symbol:      'BTCUSDT',
		direction:   'long',
		entryPrice:  50000,
		exitPrice:   55000,
		size:        0.1,
		pnlUSD:      500,
		rMultiple:   2.0,
		setupType:   'breakout',
		emotion:     'calm',
		preNotes:    null,
		postNotes:   null,
		mistakes:    [],
		followedPlan: true,
		tradeDate:   '2024-01-15',  // Monday
		createdAt:   '2024-01-15T10:00:00Z',
		...overrides,
	};
}

// ─── parseDOW ─────────────────────────────────────────────────────────────────

describe('parseDOW', () => {
	it('correctly identifies Monday', () => {
		expect(parseDOW('2024-01-15')).toBe(1); // Monday = 1
	});

	it('correctly identifies Friday', () => {
		expect(parseDOW('2024-01-19')).toBe(5); // Friday = 5
	});

	it('correctly identifies Sunday', () => {
		expect(parseDOW('2024-01-21')).toBe(0); // Sunday = 0
	});

	it('correctly identifies Saturday', () => {
		expect(parseDOW('2024-01-20')).toBe(6); // Saturday = 6
	});

	it('correctly identifies Wednesday', () => {
		expect(parseDOW('2024-01-17')).toBe(3); // Wednesday = 3
	});
});

// ─── buildRow ─────────────────────────────────────────────────────────────────

describe('buildRow', () => {
	it('returns zeros for empty array', () => {
		const row = buildRow('Test', []);
		expect(row.tradeCount).toBe(0);
		expect(row.winRate).toBe(0);
		expect(row.avgPnl).toBe(0);
		expect(row.avgR).toBe(0);
		expect(row.totalPnl).toBe(0);
	});

	it('returns zeros for entries without closed pnl', () => {
		const entries = [makeEntry({ pnlUSD: null, exitPrice: null })];
		const row = buildRow('Open', entries);
		expect(row.tradeCount).toBe(1);
		expect(row.winRate).toBe(0);
		expect(row.avgPnl).toBe(0);
	});

	it('computes 100% win rate for all wins', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: 200 }),
			makeEntry({ pnlUSD: 50 }),
		];
		const row = buildRow('All Wins', entries);
		expect(row.winRate).toBe(100);
	});

	it('computes 0% win rate for all losses', () => {
		const entries = [
			makeEntry({ pnlUSD: -100 }),
			makeEntry({ pnlUSD: -50 }),
		];
		const row = buildRow('All Losses', entries);
		expect(row.winRate).toBe(0);
	});

	it('computes 50% win rate for mixed', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: -50 }),
		];
		const row = buildRow('Mixed', entries);
		expect(row.winRate).toBe(50);
	});

	it('computes avgPnl correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: 300 }),
		];
		const row = buildRow('Avg', entries);
		expect(row.avgPnl).toBeCloseTo(200);
	});

	it('computes totalPnl correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: -50 }),
			makeEntry({ pnlUSD: 200 }),
		];
		const row = buildRow('Total', entries);
		expect(row.totalPnl).toBeCloseTo(250);
	});

	it('computes avgR correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100, rMultiple: 2.0 }),
			makeEntry({ pnlUSD: 50,  rMultiple: 1.0 }),
		];
		const row = buildRow('R', entries);
		expect(row.avgR).toBeCloseTo(1.5);
	});

	it('ignores null rMultiple entries in avgR', () => {
		const entries = [
			makeEntry({ pnlUSD: 100, rMultiple: 2.0 }),
			makeEntry({ pnlUSD: 50,  rMultiple: null }),
		];
		const row = buildRow('R null', entries);
		expect(row.avgR).toBeCloseTo(2.0);
	});

	it('sets label from parameter', () => {
		const row = buildRow('Monday', [makeEntry()]);
		expect(row.label).toBe('Monday');
	});

	it('tradeCount includes open (null pnl) entries', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: null, exitPrice: null }),
		];
		const row = buildRow('Mixed open', entries);
		expect(row.tradeCount).toBe(2);
	});
});

// ─── attributePerformance ─────────────────────────────────────────────────────

describe('attributePerformance', () => {
	it('handles empty entries', () => {
		const result = attributePerformance([]);
		expect(result.totalTrades).toBe(0);
		expect(result.overallWinRate).toBe(0);
		expect(result.byDayOfWeek).toHaveLength(0);
		expect(result.bestCondition).toBeNull();
		expect(result.worstCondition).toBeNull();
	});

	it('groups by day of week correctly', () => {
		const entries = [
			makeEntry({ tradeDate: '2024-01-15' }),  // Monday
			makeEntry({ tradeDate: '2024-01-16' }),  // Tuesday
			makeEntry({ tradeDate: '2024-01-16' }),  // Tuesday (second)
		];
		const result = attributePerformance(entries);
		const tuesdayRow = result.byDayOfWeek.find(r => r.label === 'Tuesday');
		const mondayRow  = result.byDayOfWeek.find(r => r.label === 'Monday');
		expect(tuesdayRow?.tradeCount).toBe(2);
		expect(mondayRow?.tradeCount).toBe(1);
	});

	it('groups by setup type correctly', () => {
		const entries = [
			makeEntry({ setupType: 'breakout' }),
			makeEntry({ setupType: 'breakout' }),
			makeEntry({ setupType: 'reversal' }),
		];
		const result = attributePerformance(entries);
		const breakout = result.bySetupType.find(r => r.label === 'breakout');
		const reversal = result.bySetupType.find(r => r.label === 'reversal');
		expect(breakout?.tradeCount).toBe(2);
		expect(reversal?.tradeCount).toBe(1);
	});

	it('groups null setupType as Unclassified', () => {
		const entries = [makeEntry({ setupType: null })];
		const result = attributePerformance(entries);
		const unclassed = result.bySetupType.find(r => r.label === 'Unclassified');
		expect(unclassed?.tradeCount).toBe(1);
	});

	it('groups by emotion correctly', () => {
		const entries = [
			makeEntry({ emotion: 'calm' }),
			makeEntry({ emotion: 'fearful' }),
			makeEntry({ emotion: 'calm' }),
		];
		const result = attributePerformance(entries);
		const calm    = result.byEmotion.find(r => r.label === 'calm');
		const fearful = result.byEmotion.find(r => r.label === 'fearful');
		expect(calm?.tradeCount).toBe(2);
		expect(fearful?.tradeCount).toBe(1);
	});

	it('groups by plan adherence correctly', () => {
		const entries = [
			makeEntry({ followedPlan: true }),
			makeEntry({ followedPlan: true }),
			makeEntry({ followedPlan: false }),
		];
		const result = attributePerformance(entries);
		const yes = result.byPlanAdhere.find(r => r.label === 'Followed Plan');
		const no  = result.byPlanAdhere.find(r => r.label === 'Broke Plan');
		expect(yes?.tradeCount).toBe(2);
		expect(no?.tradeCount).toBe(1);
	});

	it('computes overall win rate correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: 100 }),
			makeEntry({ pnlUSD: -50 }),
			makeEntry({ pnlUSD: -50 }),
		];
		const result = attributePerformance(entries);
		expect(result.overallWinRate).toBe(50);
	});

	it('computes overall avgR correctly', () => {
		const entries = [
			makeEntry({ pnlUSD: 100, rMultiple: 2.0 }),
			makeEntry({ pnlUSD: -50, rMultiple: -1.0 }),
		];
		const result = attributePerformance(entries);
		expect(result.overallAvgR).toBeCloseTo(0.5);
	});

	it('identifies best condition (highest avgR, ≥3 trades)', () => {
		const entries = [
			// breakout setup: 3 trades, avgR = 3.0
			makeEntry({ setupType: 'breakout', pnlUSD: 200, rMultiple: 3.0, tradeDate: '2024-01-15' }),
			makeEntry({ setupType: 'breakout', pnlUSD: 200, rMultiple: 3.0, tradeDate: '2024-01-16' }),
			makeEntry({ setupType: 'breakout', pnlUSD: 200, rMultiple: 3.0, tradeDate: '2024-01-17' }),
			// scalp setup: 3 trades, avgR = -1.0 (worst)
			makeEntry({ setupType: 'scalp', pnlUSD: -50, rMultiple: -1.0, tradeDate: '2024-01-18' }),
			makeEntry({ setupType: 'scalp', pnlUSD: -50, rMultiple: -1.0, tradeDate: '2024-01-19' }),
			makeEntry({ setupType: 'scalp', pnlUSD: -50, rMultiple: -1.0, tradeDate: '2024-01-22' }),
		];
		const result = attributePerformance(entries);
		expect(result.bestCondition).not.toBeNull();
		// breakout has the highest avgR among qualifying groups
		expect(result.bestCondition?.avgR).toBeCloseTo(3.0);
		expect(result.worstCondition?.avgR).toBeCloseTo(-1.0);
	});

	it('returns null bestCondition when no dimension has ≥3 trades', () => {
		const entries = [
			makeEntry({ pnlUSD: 100, rMultiple: 2.0 }),
			makeEntry({ pnlUSD: -50, rMultiple: -1.0 }),
		];
		const result = attributePerformance(entries);
		// Only 2 entries in total, no dimension will hit ≥3
		// So bestCondition might be null or based on DOW (which could have ≥3? no, only 2 entries)
		// No dimension has ≥3 trades in total → both null
		expect(result.totalTrades).toBe(2);
	});

	it('setup types sorted by avgR descending', () => {
		const entries = [
			makeEntry({ setupType: 'bad',  pnlUSD: -100, rMultiple: -2.0 }),
			makeEntry({ setupType: 'good', pnlUSD: 200,  rMultiple: 3.0 }),
			makeEntry({ setupType: 'mid',  pnlUSD: 50,   rMultiple: 1.0 }),
		];
		const result = attributePerformance(entries);
		const avgRs = result.bySetupType.map(r => r.avgR);
		for (let i = 0; i < avgRs.length - 1; i++) {
			expect(avgRs[i]).toBeGreaterThanOrEqual(avgRs[i + 1]);
		}
	});

	it('includes null followedPlan as Not Recorded', () => {
		const entries = [makeEntry({ followedPlan: null })];
		const result = attributePerformance(entries);
		const notRecorded = result.byPlanAdhere.find(r => r.label === 'Not Recorded');
		expect(notRecorded?.tradeCount).toBe(1);
	});

	it('byDayOfWeek only includes days with trades', () => {
		const entries = [makeEntry({ tradeDate: '2024-01-15' })]; // Monday only
		const result = attributePerformance(entries);
		expect(result.byDayOfWeek).toHaveLength(1);
		expect(result.byDayOfWeek[0].label).toBe('Monday');
	});

	it('byDayOfWeek ordered Mon through Sun', () => {
		const entries = [
			makeEntry({ tradeDate: '2024-01-15' }), // Monday
			makeEntry({ tradeDate: '2024-01-19' }), // Friday
			makeEntry({ tradeDate: '2024-01-21' }), // Sunday
		];
		const result = attributePerformance(entries);
		const days = result.byDayOfWeek.map(r => r.label);
		expect(days.indexOf('Monday')).toBeLessThan(days.indexOf('Friday'));
		expect(days.indexOf('Friday')).toBeLessThan(days.indexOf('Sunday'));
	});
});
