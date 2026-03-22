// Trading Journal Pattern Analyzer Data — T-1307
// Core analysis logic: setup patterns, day-of-week, emotion, streaks, sizing, discipline

import type { JournalEntry } from '../portfolio/journal';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SetupPattern {
	setupType: string;
	tradeCount: number;
	wins: number;
	losses: number;
	winRate: number;       // 0–1
	avgRMultiple: number | null;
	totalPnlUSD: number | null;
}

export interface DayPattern {
	day: string;           // "Monday", "Tuesday", etc.
	dayIndex: number;      // 0=Sunday … 6=Saturday
	tradeCount: number;
	wins: number;
	winRate: number;       // 0–1
	avgPnlUSD: number | null;
}

export interface EmotionPattern {
	emotion: string;
	tradeCount: number;
	wins: number;
	winRate: number;       // 0–1
	avgRMultiple: number | null;
	avgPnlUSD: number | null;
}

export interface StreakResult {
	currentStreakType: 'win' | 'loss' | 'none';
	currentStreakCount: number;
	maxWinStreak: number;
	maxLossStreak: number;
}

export interface SizingPattern {
	winAvgSize: number | null;
	lossAvgSize: number | null;
	sizeConsistency: 'consistent' | 'variable' | 'unclear';
	oversizedOnLoss: boolean;
}

export interface JournalPatternBundle {
	totalTrades: number;
	closedTrades: number;
	overallWinRate: number | null;
	setupPatterns: SetupPattern[];
	dayPatterns: DayPattern[];
	emotionPatterns: EmotionPattern[];
	streak: StreakResult;
	sizing: SizingPattern;
	disciplineScore: number;  // 0–100
	topSetup: string | null;
	worstSetup: string | null;
	keyInsight: string;
	commonMistakes: { mistake: string; count: number }[];
}

// ─── Day Names ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ─── Setup Patterns ───────────────────────────────────────────────────────────

export function analyzeSetupPatterns(entries: JournalEntry[]): SetupPattern[] {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const map = new Map<string, { wins: number; total: number; pnls: number[]; rs: number[] }>();

	for (const e of closed) {
		const key = e.setupType ?? 'unspecified';
		const rec = map.get(key) ?? { wins: 0, total: 0, pnls: [], rs: [] };
		rec.total++;
		if ((e.pnlUSD ?? 0) > 0) rec.wins++;
		rec.pnls.push(e.pnlUSD ?? 0);
		if (e.rMultiple !== null) rec.rs.push(e.rMultiple);
		map.set(key, rec);
	}

	return [...map.entries()]
		.map(([setupType, { wins, total, pnls, rs }]) => ({
			setupType,
			tradeCount: total,
			wins,
			losses: total - wins,
			winRate: total > 0 ? wins / total : 0,
			avgRMultiple: rs.length > 0 ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
			totalPnlUSD: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) : null,
		}))
		.sort((a, b) => b.tradeCount - a.tradeCount);
}

// ─── Day-of-Week Patterns ─────────────────────────────────────────────────────

export function analyzeDayPatterns(entries: JournalEntry[]): DayPattern[] {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const map = new Map<number, { wins: number; total: number; pnls: number[] }>();

	for (const e of closed) {
		const d = new Date(e.tradeDate + 'T00:00:00Z');
		const dayIdx = d.getUTCDay();
		const rec = map.get(dayIdx) ?? { wins: 0, total: 0, pnls: [] };
		rec.total++;
		if ((e.pnlUSD ?? 0) > 0) rec.wins++;
		rec.pnls.push(e.pnlUSD ?? 0);
		map.set(dayIdx, rec);
	}

	// Order: Mon-Fri, then Sat, Sun
	return ([1, 2, 3, 4, 5, 6, 0] as const)
		.filter(i => map.has(i))
		.map(dayIdx => {
			const { wins, total, pnls } = map.get(dayIdx)!;
			return {
				day: DAY_NAMES[dayIdx],
				dayIndex: dayIdx,
				tradeCount: total,
				wins,
				winRate: total > 0 ? wins / total : 0,
				avgPnlUSD: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : null,
			};
		});
}

// ─── Emotion Patterns ─────────────────────────────────────────────────────────

export function analyzeEmotionPatterns(entries: JournalEntry[]): EmotionPattern[] {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const map = new Map<string, { wins: number; total: number; pnls: number[]; rs: number[] }>();

	for (const e of closed) {
		const emotion = e.emotion ?? 'not recorded';
		const rec = map.get(emotion) ?? { wins: 0, total: 0, pnls: [], rs: [] };
		rec.total++;
		if ((e.pnlUSD ?? 0) > 0) rec.wins++;
		rec.pnls.push(e.pnlUSD ?? 0);
		if (e.rMultiple !== null) rec.rs.push(e.rMultiple);
		map.set(emotion, rec);
	}

	return [...map.entries()]
		.map(([emotion, { wins, total, pnls, rs }]) => ({
			emotion,
			tradeCount: total,
			wins,
			winRate: total > 0 ? wins / total : 0,
			avgRMultiple: rs.length > 0 ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
			avgPnlUSD: pnls.length > 0 ? pnls.reduce((s, p) => s + p, 0) / pnls.length : null,
		}))
		.sort((a, b) => b.tradeCount - a.tradeCount);
}

// ─── Streak Analysis ──────────────────────────────────────────────────────────

export function analyzeStreaks(entries: JournalEntry[]): StreakResult {
	const closed = entries
		.filter(e => e.pnlUSD !== null)
		.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

	if (closed.length === 0) {
		return { currentStreakType: 'none', currentStreakCount: 0, maxWinStreak: 0, maxLossStreak: 0 };
	}

	let maxWinStreak = 0;
	let maxLossStreak = 0;
	let curWin = 0;
	let curLoss = 0;

	for (const e of closed) {
		if ((e.pnlUSD ?? 0) > 0) {
			curLoss = 0;
			curWin++;
			if (curWin > maxWinStreak) maxWinStreak = curWin;
		} else {
			curWin = 0;
			curLoss++;
			if (curLoss > maxLossStreak) maxLossStreak = curLoss;
		}
	}

	// Current streak from most recent trades backwards
	const lastIsWin = (closed[closed.length - 1].pnlUSD ?? 0) > 0;
	const currentStreakType = lastIsWin ? 'win' : 'loss';
	let currentStreakCount = 0;
	for (let i = closed.length - 1; i >= 0; i--) {
		const isWin = (closed[i].pnlUSD ?? 0) > 0;
		if (isWin === lastIsWin) {
			currentStreakCount++;
		} else {
			break;
		}
	}

	return { currentStreakType, currentStreakCount, maxWinStreak, maxLossStreak };
}

// ─── Position Sizing Patterns ─────────────────────────────────────────────────

export function analyzeSizingPatterns(entries: JournalEntry[]): SizingPattern {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const wins   = closed.filter(e => (e.pnlUSD ?? 0) > 0);
	const losses = closed.filter(e => (e.pnlUSD ?? 0) <= 0);

	const avgSize = (arr: JournalEntry[]): number | null =>
		arr.length > 0 ? arr.reduce((s, e) => s + e.size, 0) / arr.length : null;

	const winAvgSize  = avgSize(wins);
	const lossAvgSize = avgSize(losses);

	let sizeConsistency: SizingPattern['sizeConsistency'] = 'unclear';
	if (closed.length >= 5) {
		const sizes = closed.map(e => e.size);
		const mean   = sizes.reduce((s, v) => s + v, 0) / sizes.length;
		const stdDev = Math.sqrt(sizes.reduce((s, v) => s + (v - mean) ** 2, 0) / sizes.length);
		const cv     = mean > 0 ? stdDev / mean : 0;
		sizeConsistency = cv < 0.2 ? 'consistent' : 'variable';
	}

	const oversizedOnLoss =
		winAvgSize !== null && lossAvgSize !== null
			? lossAvgSize > winAvgSize * 1.2
			: false;

	return { winAvgSize, lossAvgSize, sizeConsistency, oversizedOnLoss };
}

// ─── Discipline Score ─────────────────────────────────────────────────────────

export function calcDisciplineScore(entries: JournalEntry[]): number {
	if (entries.length === 0) return 50;

	let score = 50; // base

	// Plan adherence — up to +25
	const withPlan = entries.filter(e => e.followedPlan !== null);
	if (withPlan.length > 0) {
		const adherence = withPlan.filter(e => e.followedPlan === true).length / withPlan.length;
		score += Math.round(adherence * 25);
	}

	// Emotional discipline — up to +15
	const emotional = entries.filter(e => ['fearful', 'greedy', 'impulsive'].includes(e.emotion ?? ''));
	score += Math.round((1 - emotional.length / entries.length) * 15);

	// Journal completeness (setup typed) — up to +10
	const withSetup = entries.filter(e => e.setupType !== null).length / entries.length;
	score += Math.round(withSetup * 10);

	return Math.max(0, Math.min(100, score));
}

// ─── Common Mistakes ──────────────────────────────────────────────────────────

export function extractCommonMistakes(entries: JournalEntry[]): { mistake: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const e of entries) {
		for (const m of e.mistakes) {
			counts.set(m, (counts.get(m) ?? 0) + 1);
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([mistake, count]) => ({ mistake, count }));
}

// ─── Main Bundle ──────────────────────────────────────────────────────────────

export function analyzeJournalPatterns(entries: JournalEntry[]): JournalPatternBundle {
	const closed = entries.filter(e => e.pnlUSD !== null);
	const wins   = closed.filter(e => (e.pnlUSD ?? 0) > 0);

	const setupPatterns   = analyzeSetupPatterns(entries);
	const dayPatterns     = analyzeDayPatterns(entries);
	const emotionPatterns = analyzeEmotionPatterns(entries);
	const streak          = analyzeStreaks(entries);
	const sizing          = analyzeSizingPatterns(entries);
	const disciplineScore = calcDisciplineScore(entries);
	const commonMistakes  = extractCommonMistakes(entries);
	const overallWinRate  = closed.length > 0 ? wins.length / closed.length : null;

	// Best and worst setup (min 3 trades for statistical relevance)
	const qualifiedSetups = setupPatterns.filter(s => s.tradeCount >= 3);
	const sorted = [...qualifiedSetups].sort((a, b) => b.winRate - a.winRate);
	const topSetup   = sorted[0]?.setupType ?? null;
	const worstSetup = sorted[sorted.length - 1]?.setupType !== topSetup
		? sorted[sorted.length - 1]?.setupType ?? null
		: null;

	// Key insight
	let keyInsight = `${entries.length} trades analyzed`;
	if (topSetup && worstSetup) {
		const top   = qualifiedSetups.find(s => s.setupType === topSetup);
		const worst = qualifiedSetups.find(s => s.setupType === worstSetup);
		if (top && worst) {
			keyInsight =
				`${top.setupType} wins ${(top.winRate * 100).toFixed(0)}% vs ` +
				`${worst.setupType} at ${(worst.winRate * 100).toFixed(0)}%`;
		}
	} else if (overallWinRate !== null) {
		keyInsight = `${(overallWinRate * 100).toFixed(0)}% win rate across ${closed.length} closed trades`;
	}

	return {
		totalTrades: entries.length,
		closedTrades: closed.length,
		overallWinRate,
		setupPatterns,
		dayPatterns,
		emotionPatterns,
		streak,
		sizing,
		disciplineScore,
		topSetup,
		worstSetup,
		keyInsight,
		commonMistakes,
	};
}

// ─── LLM Prompt ──────────────────────────────────────────────────────────────

export function buildPatternPrompt(bundle: JournalPatternBundle): string {
	const setupRows = bundle.setupPatterns.slice(0, 8).map(s =>
		`- ${s.setupType}: ${s.tradeCount} trades, ${(s.winRate * 100).toFixed(0)}% win rate, avg R=${s.avgRMultiple !== null ? s.avgRMultiple.toFixed(2) : 'N/A'}`
	).join('\n');

	const emotionRows = bundle.emotionPatterns.map(e =>
		`- ${e.emotion}: ${e.tradeCount} trades, ${(e.winRate * 100).toFixed(0)}% win rate, avg PnL=${e.avgPnlUSD !== null ? '$' + e.avgPnlUSD.toFixed(2) : 'N/A'}`
	).join('\n');

	const dayRows = bundle.dayPatterns.map(d =>
		`- ${d.day}: ${d.tradeCount} trades, ${(d.winRate * 100).toFixed(0)}% win rate`
	).join('\n');

	const mistakeRows = bundle.commonMistakes.length > 0
		? bundle.commonMistakes.map(m => `- ${m.mistake} (${m.count}x)`).join('\n')
		: 'None recorded';

	return `You are a professional trading coach. Analyze this trader's journal patterns and provide actionable coaching.

JOURNAL SUMMARY:
- Total trades: ${bundle.totalTrades} (${bundle.closedTrades} closed)
- Overall win rate: ${bundle.overallWinRate !== null ? (bundle.overallWinRate * 100).toFixed(0) + '%' : 'N/A'}
- Discipline score: ${bundle.disciplineScore}/100
- Key insight: ${bundle.keyInsight}
- Current streak: ${bundle.streak.currentStreakCount} ${bundle.streak.currentStreakType}
- Max win streak: ${bundle.streak.maxWinStreak} | Max loss streak: ${bundle.streak.maxLossStreak}

SETUP PATTERNS:
${setupRows || 'No setup data recorded'}

EMOTION PATTERNS:
${emotionRows || 'No emotion data recorded'}

DAY-OF-WEEK PATTERNS:
${dayRows || 'No day data'}

POSITION SIZING:
- Avg size on wins: ${bundle.sizing.winAvgSize?.toFixed(2) ?? 'N/A'} | Avg size on losses: ${bundle.sizing.lossAvgSize?.toFixed(2) ?? 'N/A'}
- Size consistency: ${bundle.sizing.sizeConsistency}
- Oversized on losses: ${bundle.sizing.oversizedOnLoss ? 'YES — critical issue' : 'No'}

COMMON MISTAKES:
${mistakeRows}

Provide concise, specific coaching in 200–350 words (bilingual Thai/English where helpful):
1. What this trader does well
2. Critical areas to improve (reference specific numbers)
3. One actionable recommendation per weak area
4. Overall verdict

Be direct, data-driven, and constructive.`;
}

// ─── LLM Response Parser ──────────────────────────────────────────────────────

export function parsePatternCoaching(raw: string): string | null {
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : null;
}

// ─── Fallback Coaching ────────────────────────────────────────────────────────

export function buildFallbackPatternCoaching(bundle: JournalPatternBundle): string {
	const lines: string[] = ['## Trading Coach Analysis\n'];

	if (bundle.topSetup) {
		const top = bundle.setupPatterns.find(s => s.setupType === bundle.topSetup);
		if (top) {
			lines.push(
				`**Best Setup: ${top.setupType}** — ${(top.winRate * 100).toFixed(0)}% win rate over ${top.tradeCount} trades. ` +
				`Focus on refining and repeating this setup.\n`
			);
		}
	}

	if (bundle.worstSetup) {
		const worst = bundle.setupPatterns.find(s => s.setupType === bundle.worstSetup);
		if (worst && worst.tradeCount >= 3) {
			lines.push(
				`**Weakest Setup: ${worst.setupType}** — only ${(worst.winRate * 100).toFixed(0)}% win rate. ` +
				`Consider dropping this or paper-trading it until refined.\n`
			);
		}
	}

	if (bundle.sizing.oversizedOnLoss) {
		const wStr = bundle.sizing.winAvgSize?.toFixed(2) ?? 'N/A';
		const lStr = bundle.sizing.lossAvgSize?.toFixed(2) ?? 'N/A';
		lines.push(
			`**Position Sizing Issue:** Avg size on losses (${lStr}) exceeds wins (${wStr}). ` +
			`Standardize size to prevent compounding drawdowns.\n`
		);
	}

	const badEmotions = bundle.emotionPatterns
		.filter(e => ['fearful', 'greedy', 'impulsive'].includes(e.emotion))
		.sort((a, b) => a.winRate - b.winRate);
	if (badEmotions.length > 0) {
		const worst = badEmotions[0];
		lines.push(
			`**Emotional Trading:** "${worst.emotion}" trades win only ${(worst.winRate * 100).toFixed(0)}%. ` +
			`Implement a pre-trade pause protocol before entering positions.\n`
		);
	}

	if (bundle.streak.maxLossStreak >= 3) {
		lines.push(
			`**Streak Risk:** Max losing streak of ${bundle.streak.maxLossStreak}. ` +
			`Consider halving position size after 2 consecutive losses.\n`
		);
	}

	if (bundle.commonMistakes.length > 0) {
		lines.push(
			`**Top Mistake: ${bundle.commonMistakes[0].mistake}** (${bundle.commonMistakes[0].count}x). ` +
			`Add this to your pre-trade checklist.\n`
		);
	}

	const scoreLabel = bundle.disciplineScore >= 70 ? 'Good' : bundle.disciplineScore >= 50 ? 'Average' : 'Needs improvement';
	lines.push(
		`**Discipline Score: ${bundle.disciplineScore}/100** (${scoreLabel}) — ` +
		(bundle.disciplineScore >= 70
			? 'Maintain consistency and continue journaling.'
			: 'Focus on plan adherence and reducing emotional trades.')
	);

	return lines.join('\n');
}
