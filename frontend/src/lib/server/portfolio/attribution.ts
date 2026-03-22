// Strategy Performance Attribution — T-905
// Break down trade performance by multiple dimensions.

import type { JournalEntry } from './journal';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttributionRow {
	label:      string;
	tradeCount: number;
	winRate:    number;  // 0–100
	avgPnl:     number;  // USD
	avgR:       number;
	totalPnl:   number;
}

export interface AttributionResult {
	byDayOfWeek:   AttributionRow[];  // Mon–Sun
	bySetupType:   AttributionRow[];
	byEmotion:     AttributionRow[];
	byPlanAdhere:  AttributionRow[];  // followed plan vs didn't
	bestCondition: AttributionRow | null;
	worstCondition: AttributionRow | null;
	totalTrades:   number;
	overallWinRate: number;
	overallAvgR:   number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseDOW(tradeDate: string): number {
	// YYYY-MM-DD → day of week (0 = Sunday)
	const d = new Date(tradeDate + 'T12:00:00Z');
	return d.getUTCDay();
}

export function buildRow(label: string, entries: JournalEntry[]): AttributionRow {
	const closed = entries.filter(e => e.pnlUSD !== null);
	if (closed.length === 0) {
		return { label, tradeCount: entries.length, winRate: 0, avgPnl: 0, avgR: 0, totalPnl: 0 };
	}
	const wins     = closed.filter(e => (e.pnlUSD ?? 0) > 0);
	const winRate  = (wins.length / closed.length) * 100;
	const totalPnl = closed.reduce((s, e) => s + (e.pnlUSD ?? 0), 0);
	const avgPnl   = totalPnl / closed.length;
	const rEntries = closed.filter(e => e.rMultiple !== null);
	const avgR     = rEntries.length > 0
		? rEntries.reduce((s, e) => s + (e.rMultiple ?? 0), 0) / rEntries.length
		: 0;
	return { label, tradeCount: entries.length, winRate, avgPnl, avgR, totalPnl };
}

function findBest(rows: AttributionRow[]): AttributionRow | null {
	const valid = rows.filter(r => r.tradeCount >= 3);
	if (valid.length === 0) return null;
	return valid.reduce((best, r) => (r.avgR > best.avgR ? r : best), valid[0]);
}

function findWorst(rows: AttributionRow[]): AttributionRow | null {
	const valid = rows.filter(r => r.tradeCount >= 3);
	if (valid.length === 0) return null;
	return valid.reduce((worst, r) => (r.avgR < worst.avgR ? r : worst), valid[0]);
}

// ─── Main attribution ────────────────────────────────────────────────────────

export function attributePerformance(entries: JournalEntry[]): AttributionResult {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const totalTrades    = entries.length;
	const overallWinRate = closed.length > 0
		? (closed.filter(e => (e.pnlUSD ?? 0) > 0).length / closed.length) * 100
		: 0;
	const rEntries       = closed.filter(e => e.rMultiple !== null);
	const overallAvgR    = rEntries.length > 0
		? rEntries.reduce((s, e) => s + (e.rMultiple ?? 0), 0) / rEntries.length
		: 0;

	// ── By day of week ──────────────────────────────────────────────────────
	const dowGroups = new Map<number, JournalEntry[]>();
	for (const e of entries) {
		const dow = parseDOW(e.tradeDate);
		if (!dowGroups.has(dow)) dowGroups.set(dow, []);
		dowGroups.get(dow)!.push(e);
	}
	const byDayOfWeek: AttributionRow[] = [1, 2, 3, 4, 5, 6, 0].map(dow => {
		const group = dowGroups.get(dow) ?? [];
		return buildRow(DOW_NAMES[dow], group);
	}).filter(r => r.tradeCount > 0);

	// ── By setup type ───────────────────────────────────────────────────────
	const setupGroups = new Map<string, JournalEntry[]>();
	for (const e of entries) {
		const key = e.setupType?.trim() || 'Unclassified';
		if (!setupGroups.has(key)) setupGroups.set(key, []);
		setupGroups.get(key)!.push(e);
	}
	const bySetupType: AttributionRow[] = [...setupGroups.entries()]
		.map(([label, group]) => buildRow(label, group))
		.sort((a, b) => b.avgR - a.avgR);

	// ── By emotion ──────────────────────────────────────────────────────────
	const emotionGroups = new Map<string, JournalEntry[]>();
	for (const e of entries) {
		const key = e.emotion ?? 'unrecorded';
		if (!emotionGroups.has(key)) emotionGroups.set(key, []);
		emotionGroups.get(key)!.push(e);
	}
	const byEmotion: AttributionRow[] = [...emotionGroups.entries()]
		.map(([label, group]) => buildRow(label, group))
		.sort((a, b) => b.avgR - a.avgR);

	// ── By plan adherence ───────────────────────────────────────────────────
	const planYes = entries.filter(e => e.followedPlan === true);
	const planNo  = entries.filter(e => e.followedPlan === false);
	const planNa  = entries.filter(e => e.followedPlan === null);
	const byPlanAdhere: AttributionRow[] = [
		...(planYes.length > 0 ? [buildRow('Followed Plan', planYes)] : []),
		...(planNo.length  > 0 ? [buildRow('Broke Plan',    planNo)]  : []),
		...(planNa.length  > 0 ? [buildRow('Not Recorded',  planNa)]  : []),
	];

	// ── Best/worst across all dimensions ────────────────────────────────────
	const allRows = [...byDayOfWeek, ...bySetupType, ...byEmotion, ...byPlanAdhere];
	const bestCondition  = findBest(allRows);
	const worstCondition = findWorst(allRows);

	return {
		byDayOfWeek,
		bySetupType,
		byEmotion,
		byPlanAdhere,
		bestCondition,
		worstCondition,
		totalTrades,
		overallWinRate,
		overallAvgR,
	};
}
