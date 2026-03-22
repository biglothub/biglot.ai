// Tests for P&L Report Data — T-1402

import { describe, it, expect } from 'vitest';
import {
	estimateFees,
	calcHoldingDays,
	buildMonthlyBreakdown,
	buildAssetBreakdown,
	buildPnLReport,
	buildTaxNotesText,
	type TradeRecord,
	type AccountingMethod,
} from './pnlReport.data';
import type { JournalEntry } from '../portfolio/journal';
import type { PaperTrade } from '../paperTrading/paperTrader';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJournal(overrides: Partial<JournalEntry> = {}): JournalEntry {
	const defaults: JournalEntry = {
		id:           'j1',
		userId:       'user1',
		symbol:       'BTCUSDT',
		direction:    'long',
		entryPrice:   40000,
		exitPrice:    42000,
		size:         1,
		pnlUSD:       2000,
		rMultiple:    null,
		setupType:    null,
		emotion:      null,
		preNotes:     null,
		postNotes:    null,
		mistakes:     [],
		followedPlan: null,
		tradeDate:    '2024-03-15',
		createdAt:    '2024-03-15T10:00:00Z',
	};
	return { ...defaults, ...overrides };
}

function makePaperTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
	const defaults: PaperTrade = {
		id:         'p1',
		userId:     'user1',
		symbol:     'ETHUSDT',
		side:       'long',
		qty:        2,
		entryPrice: 2000,
		exitPrice:  2500,
		pnl:        1000,
		isOpen:     false,
		openedAt:   '2024-01-10T00:00:00Z',
		closedAt:   '2024-03-20T00:00:00Z',
		notes:      null,
	};
	return { ...defaults, ...overrides };
}

// ─── estimateFees ─────────────────────────────────────────────────────────────

describe('estimateFees', () => {
	it('computes 0.1% per leg on both sides', () => {
		// entry value = 40000 * 1 = 40000, exit = 42000 * 1 = 42000
		// fees = (40000 + 42000) * 0.001 = 82
		expect(estimateFees(40000, 42000, 1)).toBeCloseTo(82, 5);
	});

	it('scales with qty', () => {
		// entry = 2000*2=4000, exit = 2500*2=5000 → (4000+5000)*0.001 = 9
		expect(estimateFees(2000, 2500, 2)).toBeCloseTo(9, 5);
	});

	it('returns 0 for zero prices', () => {
		expect(estimateFees(0, 0, 1)).toBe(0);
	});
});

// ─── calcHoldingDays ──────────────────────────────────────────────────────────

describe('calcHoldingDays', () => {
	it('returns correct days between two ISO strings', () => {
		expect(calcHoldingDays('2024-01-01T00:00:00Z', '2024-01-11T00:00:00Z')).toBe(10);
	});

	it('returns 0 for same day', () => {
		expect(calcHoldingDays('2024-03-15T00:00:00Z', '2024-03-15T00:00:00Z')).toBe(0);
	});

	it('returns 0 when close < open', () => {
		expect(calcHoldingDays('2024-03-15', '2024-03-14')).toBe(0);
	});

	it('identifies long_term threshold at 365 days', () => {
		expect(calcHoldingDays('2023-01-01T00:00:00Z', '2024-01-01T00:00:00Z')).toBe(365);
	});
});

// ─── buildMonthlyBreakdown ────────────────────────────────────────────────────

describe('buildMonthlyBreakdown', () => {
	it('groups trades by month correctly', () => {
		const trades: TradeRecord[] = [
			{
				id: '1', source: 'journal', symbol: 'BTC', direction: 'long',
				entryPrice: 100, exitPrice: 110, size: 1,
				grossPnlUSD: 10, estimatedFees: 0.21, netPnlUSD: 9.79,
				tradeDate: '2024-01-15', holdingDays: 0, holdingPeriod: 'short_term',
			},
			{
				id: '2', source: 'journal', symbol: 'ETH', direction: 'long',
				entryPrice: 200, exitPrice: 180, size: 1,
				grossPnlUSD: -20, estimatedFees: 0.38, netPnlUSD: -20.38,
				tradeDate: '2024-01-20', holdingDays: 0, holdingPeriod: 'short_term',
			},
			{
				id: '3', source: 'paper', symbol: 'SOL', direction: 'long',
				entryPrice: 50, exitPrice: 60, size: 5,
				grossPnlUSD: 50, estimatedFees: 0.55, netPnlUSD: 49.45,
				tradeDate: '2024-02-10', holdingDays: 5, holdingPeriod: 'short_term',
			},
		];

		const breakdown = buildMonthlyBreakdown(trades);
		expect(breakdown).toHaveLength(2);

		const jan = breakdown[0];
		expect(jan.month).toBe('2024-01');
		expect(jan.tradeCount).toBe(2);
		expect(jan.winCount).toBe(1);
		expect(jan.grossPnL).toBeCloseTo(-10, 5);

		const feb = breakdown[1];
		expect(feb.month).toBe('2024-02');
		expect(feb.tradeCount).toBe(1);
		expect(feb.winCount).toBe(1);
	});

	it('returns empty array for no trades', () => {
		expect(buildMonthlyBreakdown([])).toEqual([]);
	});
});

// ─── buildAssetBreakdown ──────────────────────────────────────────────────────

describe('buildAssetBreakdown', () => {
	it('groups by symbol and sums correctly', () => {
		const trades: TradeRecord[] = [
			{
				id: '1', source: 'journal', symbol: 'BTC', direction: 'long',
				entryPrice: 100, exitPrice: 110, size: 1,
				grossPnlUSD: 100, estimatedFees: 1, netPnlUSD: 99,
				tradeDate: '2024-01-15', holdingDays: 0, holdingPeriod: 'short_term',
			},
			{
				id: '2', source: 'journal', symbol: 'BTC', direction: 'long',
				entryPrice: 100, exitPrice: 105, size: 1,
				grossPnlUSD: 50, estimatedFees: 0.5, netPnlUSD: 49.5,
				tradeDate: '2024-01-20', holdingDays: 0, holdingPeriod: 'short_term',
			},
			{
				id: '3', source: 'paper', symbol: 'ETH', direction: 'short',
				entryPrice: 200, exitPrice: 150, size: 2,
				grossPnlUSD: 100, estimatedFees: 0.7, netPnlUSD: 99.3,
				tradeDate: '2024-02-10', holdingDays: 10, holdingPeriod: 'short_term',
			},
		];

		const breakdown = buildAssetBreakdown(trades);
		const btc = breakdown.find(a => a.symbol === 'BTC');
		expect(btc).toBeDefined();
		expect(btc!.tradeCount).toBe(2);
		expect(btc!.winCount).toBe(2);
		expect(btc!.netPnL).toBeCloseTo(148.5, 4);
		expect(btc!.avgHoldingDays).toBe(0);

		const eth = breakdown.find(a => a.symbol === 'ETH');
		expect(eth).toBeDefined();
		expect(eth!.avgHoldingDays).toBe(10);
	});

	it('sorts by absolute netPnL descending', () => {
		const trades: TradeRecord[] = [
			{
				id: '1', source: 'journal', symbol: 'A', direction: 'long',
				entryPrice: 10, exitPrice: 11, size: 1,
				grossPnlUSD: 10, estimatedFees: 0.021, netPnlUSD: 9.979,
				tradeDate: '2024-01-01', holdingDays: 0, holdingPeriod: 'short_term',
			},
			{
				id: '2', source: 'journal', symbol: 'B', direction: 'long',
				entryPrice: 100, exitPrice: 200, size: 5,
				grossPnlUSD: 500, estimatedFees: 1.5, netPnlUSD: 498.5,
				tradeDate: '2024-01-02', holdingDays: 0, holdingPeriod: 'short_term',
			},
		];
		const breakdown = buildAssetBreakdown(trades);
		expect(breakdown[0].symbol).toBe('B');
		expect(breakdown[1].symbol).toBe('A');
	});

	it('returns empty array for no trades', () => {
		expect(buildAssetBreakdown([])).toEqual([]);
	});
});

// ─── buildPnLReport ───────────────────────────────────────────────────────────

describe('buildPnLReport', () => {
	it('returns empty report for no trades', () => {
		const report = buildPnLReport([], [], 'fifo');
		expect(report.tradeCount).toBe(0);
		expect(report.totalGrossPnL).toBe(0);
		expect(report.totalFees).toBe(0);
		expect(report.totalNetPnL).toBe(0);
		expect(report.thaiTaxEstimate).toBe(0);
		expect(report.startDate).toBeNull();
		expect(report.endDate).toBeNull();
		expect(report.monthlyBreakdown).toEqual([]);
		expect(report.assetBreakdown).toEqual([]);
	});

	it('excludes open paper trades and journal entries without exit price', () => {
		const openPaper = makePaperTrade({ isOpen: true, pnl: null, exitPrice: null, closedAt: null });
		const noExit    = makeJournal({ exitPrice: null, pnlUSD: null });
		const report    = buildPnLReport([noExit], [openPaper], 'fifo');
		expect(report.tradeCount).toBe(0);
	});

	it('correctly processes journal entries', () => {
		const e = makeJournal({ entryPrice: 40000, exitPrice: 42000, size: 1, pnlUSD: 2000 });
		const report = buildPnLReport([e], [], 'fifo');
		expect(report.tradeCount).toBe(1);
		expect(report.totalGrossPnL).toBeCloseTo(2000, 5);
		// fees = (40000 + 42000) * 0.001 = 82
		expect(report.totalFees).toBeCloseTo(82, 5);
		expect(report.totalNetPnL).toBeCloseTo(1918, 5);
		expect(report.winCount).toBe(1);
		expect(report.method).toBe('fifo');
	});

	it('correctly processes paper trades with holding period', () => {
		// open 2023-01-01, close 2024-01-01 = 365 days → long_term
		const p = makePaperTrade({
			openedAt: '2023-01-01T00:00:00Z',
			closedAt: '2024-01-01T00:00:00Z',
			entryPrice: 2000, exitPrice: 2500, qty: 2, pnl: 1000,
		});
		const report = buildPnLReport([], [p], 'lifo');
		expect(report.tradeCount).toBe(1);
		expect(report.longTermPnL).toBeGreaterThan(0);
		expect(report.shortTermPnL).toBe(0);
		expect(report.method).toBe('lifo');
	});

	it('filters by year correctly', () => {
		const e2023 = makeJournal({ id: 'j2023', tradeDate: '2023-06-15', pnlUSD: 500, entryPrice: 1000, exitPrice: 1500, size: 1 });
		const e2024 = makeJournal({ id: 'j2024', tradeDate: '2024-03-15', pnlUSD: 2000, entryPrice: 40000, exitPrice: 42000, size: 1 });
		const report = buildPnLReport([e2023, e2024], [], 'fifo', 2024);
		expect(report.tradeCount).toBe(1);
		expect(report.trades[0].id).toBe('j2024');
	});

	it('calculates Thai tax at 15% on positive net PnL', () => {
		const e = makeJournal({ pnlUSD: 10000, entryPrice: 1000, exitPrice: 11000, size: 1 });
		const report = buildPnLReport([e], [], 'average_cost');
		expect(report.thaiTaxEstimate).toBeCloseTo(report.totalNetPnL * 0.15, 5);
	});

	it('returns 0 tax when net PnL is negative', () => {
		const e = makeJournal({ pnlUSD: -5000, entryPrice: 50000, exitPrice: 45000, size: 1 });
		const report = buildPnLReport([e], [], 'fifo');
		expect(report.thaiTaxEstimate).toBe(0);
	});

	it('sorts trades chronologically', () => {
		const e1 = makeJournal({ id: 'e1', tradeDate: '2024-03-10' });
		const e2 = makeJournal({ id: 'e2', tradeDate: '2024-01-05' });
		const report = buildPnLReport([e1, e2], [], 'fifo');
		expect(report.trades[0].id).toBe('e2');
		expect(report.trades[1].id).toBe('e1');
	});

	it('combines journal and paper trades', () => {
		const j = makeJournal();
		const p = makePaperTrade();
		const report = buildPnLReport([j], [p], 'fifo');
		expect(report.tradeCount).toBe(2);
		const sources = report.trades.map(t => t.source);
		expect(sources).toContain('journal');
		expect(sources).toContain('paper');
	});

	it('sets startDate and endDate correctly', () => {
		const e1 = makeJournal({ id: 'e1', tradeDate: '2024-01-10' });
		const e2 = makeJournal({ id: 'e2', tradeDate: '2024-06-20' });
		const report = buildPnLReport([e1, e2], [], 'fifo');
		expect(report.startDate).toBe('2024-01-10');
		expect(report.endDate).toBe('2024-06-20');
	});

	it('all three accounting methods produce the same numbers (same pre-computed PnL)', () => {
		const e = makeJournal();
		const methods: AccountingMethod[] = ['fifo', 'lifo', 'average_cost'];
		const reports = methods.map(m => buildPnLReport([e], [], m));
		expect(reports[0].totalNetPnL).toBeCloseTo(reports[1].totalNetPnL, 10);
		expect(reports[0].totalNetPnL).toBeCloseTo(reports[2].totalNetPnL, 10);
	});
});

// ─── buildTaxNotesText ────────────────────────────────────────────────────────

describe('buildTaxNotesText', () => {
	it('includes accounting method label', () => {
		const e = makeJournal();
		const report = buildPnLReport([e], [], 'fifo');
		const text = buildTaxNotesText(report);
		expect(text).toContain('First In First Out (FIFO)');
	});

	it('includes tax estimate when profit', () => {
		const e = makeJournal({ pnlUSD: 10000, entryPrice: 1000, exitPrice: 11000, size: 1 });
		const report = buildPnLReport([e], [], 'lifo');
		const text = buildTaxNotesText(report);
		expect(text).toContain('15%');
	});

	it('shows no-tax message when net PnL is negative', () => {
		const e = makeJournal({ pnlUSD: -3000, entryPrice: 50000, exitPrice: 47000, size: 1 });
		const report = buildPnLReport([e], [], 'fifo');
		const text = buildTaxNotesText(report);
		expect(text).toContain('negative');
	});

	it('includes disclaimer about paper trades', () => {
		const report = buildPnLReport([], [], 'fifo');
		const text = buildTaxNotesText(report);
		expect(text).toContain('Paper trades');
	});
});
