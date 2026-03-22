// Post-Trade Analyst Data — T-1303
// Core logic for post-mortem analysis: timing efficiency, signal replay, coaching

import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { fetchOHLCV, normalizeBinanceSymbol } from './ohlcvProvider';
import { rsi, ema, macd, atr } from '../indicators/engine';
import type { OHLCV } from '$lib/types/contentBlock';
import type { JournalEntry } from '../portfolio/journal';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SignalSnapshot {
	timestamp: number;
	price: number;
	rsi14: number | null;
	ema20: number | null;
	ema50: number | null;
	macdLine: number | null;
	macdSignal: number | null;
	atr14: number | null;
}

export interface TimingEfficiencyResult {
	actualPnlUSD: number | null;
	maxPossiblePnL: number;
	timingEfficiencyPct: number;   // 0–100 (clamped)
	entrySlippagePct: number;      // how far actual entry was from optimal (%)
	exitSlippagePct: number;       // how far actual exit was from optimal (%)
	optimalEntryPrice: number;
	optimalExitPrice: number;
	hasExitData: boolean;
}

export interface PostTradeCoaching {
	thesisAccuracyScore: number;   // 0–100
	wentWell: string[];
	toImprove: string[];
	keyLesson: string;
	coachingFeedback: string;      // full markdown
}

export interface PostTradeAnalysisBundle {
	entry: JournalEntry;
	ohlcv: OHLCV[];
	tradePeriodOhlcv: OHLCV[];
	entryIndex: number;
	exitIndex: number;
	entrySignals: SignalSnapshot;
	exitSignals: SignalSnapshot;
	timing: TimingEfficiencyResult;
	timeframe: string;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

type DbJournalRow = {
	id: string;
	user_id: string;
	symbol: string;
	direction: 'long' | 'short';
	entry_price: number;
	exit_price: number | null;
	size: number;
	pnl_usd: number | null;
	r_multiple: number | null;
	setup_type: string | null;
	emotion: string | null;
	pre_notes: string | null;
	post_notes: string | null;
	mistakes: string[];
	followed_plan: boolean | null;
	trade_date: string;
	created_at: string;
};

function mapRow(row: DbJournalRow): JournalEntry {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		direction: row.direction,
		entryPrice: row.entry_price,
		exitPrice: row.exit_price,
		size: row.size,
		pnlUSD: row.pnl_usd,
		rMultiple: row.r_multiple,
		setupType: row.setup_type,
		emotion: (row.emotion as JournalEntry['emotion']) ?? null,
		preNotes: row.pre_notes,
		postNotes: row.post_notes,
		mistakes: row.mistakes ?? [],
		followedPlan: row.followed_plan,
		tradeDate: row.trade_date,
		createdAt: row.created_at,
	};
}

export async function fetchJournalEntryById(
	userId: string,
	tradeId: string,
): Promise<JournalEntry | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('trade_journal')
		.select()
		.eq('id', tradeId)
		.eq('user_id', userId)
		.single();

	if (error || !data) return null;
	return mapRow(data as DbJournalRow);
}

// ─── Candle index helpers ─────────────────────────────────────────────────────

/** Convert YYYY-MM-DD to start-of-day Unix seconds (UTC). */
export function dateToUnixDay(dateStr: string): number {
	return Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 1000);
}

/**
 * Find the OHLCV index whose candle time falls on the given calendar day.
 * Falls back to the closest candle if no exact match.
 */
export function findCandleIndex(ohlcv: OHLCV[], targetDayUnix: number): number {
	if (ohlcv.length === 0) return 0;
	const dayEnd = targetDayUnix + 86400;
	// Exact: candle time within the day
	for (let i = 0; i < ohlcv.length; i++) {
		if (ohlcv[i].time >= targetDayUnix && ohlcv[i].time < dayEnd) return i;
	}
	// Fallback: closest by absolute difference
	let best = 0;
	let bestDist = Math.abs(ohlcv[0].time - targetDayUnix);
	for (let i = 1; i < ohlcv.length; i++) {
		const dist = Math.abs(ohlcv[i].time - targetDayUnix);
		if (dist < bestDist) { best = i; bestDist = dist; }
	}
	return best;
}

/**
 * Find exit candle: search forward from entryIndex for a candle whose high
 * comes within 1% of the exitPrice. Falls back to entryIndex + defaultOffset.
 */
export function findExitCandleIndex(
	ohlcv: OHLCV[],
	entryIndex: number,
	exitPrice: number,
	defaultOffset = 5,
): number {
	const maxSearch = Math.min(ohlcv.length - 1, entryIndex + 60);
	for (let i = entryIndex + 1; i <= maxSearch; i++) {
		const candle = ohlcv[i];
		if (Math.abs(candle.high - exitPrice) / exitPrice < 0.01) return i;
		if (Math.abs(candle.close - exitPrice) / exitPrice < 0.01) return i;
		if (Math.abs(candle.low - exitPrice) / exitPrice < 0.01) return i;
	}
	return Math.min(ohlcv.length - 1, entryIndex + defaultOffset);
}

// ─── Timing Efficiency ────────────────────────────────────────────────────────

/**
 * Calculate timing efficiency: how close were the actual entry/exit prices
 * to the optimal (best low/high around the entry/exit candles)?
 */
export function calcTimingEfficiency(
	entry: JournalEntry,
	ohlcv: OHLCV[],
	entryIdx: number,
	exitIdx: number,
): TimingEfficiencyResult {
	if (ohlcv.length === 0) {
		return {
			actualPnlUSD: entry.pnlUSD,
			maxPossiblePnL: 0,
			timingEfficiencyPct: 0,
			entrySlippagePct: 0,
			exitSlippagePct: 0,
			optimalEntryPrice: entry.entryPrice,
			optimalExitPrice: entry.exitPrice ?? entry.entryPrice,
			hasExitData: entry.exitPrice !== null,
		};
	}

	const isLong = entry.direction === 'long';
	const entryCandle = ohlcv[entryIdx];
	const exitCandle  = ohlcv[exitIdx];

	// Optimal entry: for long = lowest low in ±1 candles around entry
	//                for short = highest high in ±1 candles around entry
	const entryWindow = ohlcv.slice(Math.max(0, entryIdx - 1), entryIdx + 2);
	const optimalEntryPrice = isLong
		? Math.min(...entryWindow.map(c => c.low))
		: Math.max(...entryWindow.map(c => c.high));

	// Optimal exit: for long = highest high in ±1 candles around exit
	//               for short = lowest low in ±1 candles around exit
	const exitWindow = ohlcv.slice(Math.max(0, exitIdx - 1), exitIdx + 2);
	const optimalExitPrice = isLong
		? Math.max(...exitWindow.map(c => c.high))
		: Math.min(...exitWindow.map(c => c.low));

	const hasExitData = entry.exitPrice !== null;
	const actualExitPrice = entry.exitPrice ?? entryCandle.close;

	// Max possible PnL (per unit)
	const maxPossiblePerUnit = isLong
		? optimalExitPrice - optimalEntryPrice
		: optimalEntryPrice - optimalExitPrice;

	const maxPossiblePnL = maxPossiblePerUnit * entry.size;

	// Actual PnL
	const actualPnlUSD = entry.pnlUSD !== null
		? entry.pnlUSD
		: hasExitData
			? (isLong ? (actualExitPrice - entry.entryPrice) : (entry.entryPrice - actualExitPrice)) * entry.size
			: null;

	// Timing efficiency
	let timingEfficiencyPct = 0;
	if (maxPossiblePnL > 0 && actualPnlUSD !== null) {
		timingEfficiencyPct = Math.max(0, Math.min(100, (actualPnlUSD / maxPossiblePnL) * 100));
	}

	// Slippage %
	const entrySlippagePct = optimalEntryPrice > 0
		? Math.abs(entry.entryPrice - optimalEntryPrice) / optimalEntryPrice * 100
		: 0;
	const exitSlippagePct = hasExitData && optimalExitPrice > 0
		? Math.abs(actualExitPrice - optimalExitPrice) / optimalExitPrice * 100
		: 0;

	return {
		actualPnlUSD,
		maxPossiblePnL,
		timingEfficiencyPct,
		entrySlippagePct,
		exitSlippagePct,
		optimalEntryPrice,
		optimalExitPrice,
		hasExitData,
	};
}

// ─── Signal Replay ────────────────────────────────────────────────────────────

/**
 * Compute indicator values at a specific OHLCV index using data up to that point.
 */
export function replayIndicatorsAt(ohlcv: OHLCV[], idx: number): SignalSnapshot {
	const slice = ohlcv.slice(0, idx + 1);
	const candle = ohlcv[idx];

	const rsiSeries  = slice.length >= 15 ? rsi(slice, 14) : [];
	const ema20Series = slice.length >= 20 ? ema(slice, 20) : [];
	const ema50Series = slice.length >= 50 ? ema(slice, 50) : [];
	const macdResult  = slice.length >= 35 ? macd(slice, 12, 26, 9) : null;
	const atrSeries   = slice.length >= 15 ? atr(slice, 14) : [];

	const last = <T extends { value: number }>(arr: T[]): number | null =>
		arr.length > 0 ? (arr[arr.length - 1]?.value ?? null) : null;

	return {
		timestamp: candle.time,
		price: candle.close,
		rsi14: last(rsiSeries),
		ema20: last(ema20Series),
		ema50: last(ema50Series),
		macdLine:   macdResult ? last(macdResult.macd)   : null,
		macdSignal: macdResult ? last(macdResult.signal) : null,
		atr14: last(atrSeries),
	};
}

// ─── Data Gathering ───────────────────────────────────────────────────────────

export async function gatherPostTradeData(
	entry: JournalEntry,
	timeframe = '1d',
): Promise<PostTradeAnalysisBundle> {
	const symbol = normalizeBinanceSymbol(entry.symbol);
	const result = await fetchOHLCV(symbol, timeframe, 500);

	if ('error' in result || result.ohlcv.length === 0) {
		// Return minimal bundle with no OHLCV
		const emptySignal: SignalSnapshot = {
			timestamp: 0, price: entry.entryPrice,
			rsi14: null, ema20: null, ema50: null,
			macdLine: null, macdSignal: null, atr14: null,
		};
		const emptyTiming = calcTimingEfficiency(entry, [], 0, 0);
		return {
			entry, ohlcv: [], tradePeriodOhlcv: [],
			entryIndex: 0, exitIndex: 0,
			entrySignals: emptySignal, exitSignals: emptySignal,
			timing: emptyTiming, timeframe,
		};
	}

	const ohlcv = result.ohlcv;
	const entryDayUnix = dateToUnixDay(entry.tradeDate);
	const entryIndex   = findCandleIndex(ohlcv, entryDayUnix);

	const exitIndex = entry.exitPrice !== null
		? findExitCandleIndex(ohlcv, entryIndex, entry.exitPrice)
		: Math.min(ohlcv.length - 1, entryIndex + 5);

	const entrySignals = replayIndicatorsAt(ohlcv, entryIndex);
	const exitSignals  = replayIndicatorsAt(ohlcv, exitIndex);
	const timing       = calcTimingEfficiency(entry, ohlcv, entryIndex, exitIndex);

	// Trade period with 10 candles context before/after
	const startIdx = Math.max(0, entryIndex - 10);
	const endIdx   = Math.min(ohlcv.length - 1, exitIndex + 5);
	const tradePeriodOhlcv = ohlcv.slice(startIdx, endIdx + 1);

	return {
		entry, ohlcv, tradePeriodOhlcv,
		entryIndex, exitIndex,
		entrySignals, exitSignals,
		timing, timeframe,
	};
}

// ─── LLM Prompt ──────────────────────────────────────────────────────────────

export function buildPostTradePrompt(
	entry: JournalEntry,
	timing: TimingEfficiencyResult,
	entrySignals: SignalSnapshot,
	exitSignals: SignalSnapshot,
): string {
	const pnlStr = timing.actualPnlUSD !== null
		? `$${timing.actualPnlUSD.toFixed(2)} USD`
		: 'unknown';
	const rStr = entry.rMultiple !== null ? `${entry.rMultiple.toFixed(2)}R` : 'unknown';
	const hasExit = timing.hasExitData;

	const signalRow = (label: string, s: SignalSnapshot) => [
		`${label}: Price=${s.price.toFixed(4)}`,
		s.rsi14   !== null ? `RSI=${s.rsi14.toFixed(1)}`   : null,
		s.ema20   !== null ? `EMA20=${s.ema20.toFixed(4)}`  : null,
		s.ema50   !== null ? `EMA50=${s.ema50.toFixed(4)}`  : null,
		s.macdLine !== null ? `MACD=${s.macdLine.toFixed(4)} Signal=${s.macdSignal?.toFixed(4)}` : null,
	].filter(Boolean).join(', ');

	return `You are a professional trading coach providing a post-trade analysis.

TRADE DETAILS:
- Symbol: ${entry.symbol} | Direction: ${entry.direction.toUpperCase()}
- Setup: ${entry.setupType ?? 'unspecified'}
- Entry: ${entry.entryPrice} | Exit: ${entry.exitPrice ?? 'open'} | Size: ${entry.size}
- P&L: ${pnlStr} | R-Multiple: ${rStr}
- Trade Date: ${entry.tradeDate}
- Followed Plan: ${entry.followedPlan === null ? 'unknown' : entry.followedPlan ? 'yes' : 'no'}
- Emotion: ${entry.emotion ?? 'not recorded'}
- Pre-trade notes: ${entry.preNotes ?? 'none'}
- Post-trade notes: ${entry.postNotes ?? 'none'}
- Mistakes recorded: ${entry.mistakes.length > 0 ? entry.mistakes.join(', ') : 'none'}

EXECUTION QUALITY:
- Timing efficiency: ${timing.timingEfficiencyPct.toFixed(1)}% of max possible P&L captured
- Entry slippage from optimal: ${timing.entrySlippagePct.toFixed(2)}%
${hasExit ? `- Exit slippage from optimal: ${timing.exitSlippagePct.toFixed(2)}%` : '- Exit: trade still open or no exit data'}
- Optimal entry: ${timing.optimalEntryPrice.toFixed(4)} | Actual: ${entry.entryPrice}
${hasExit ? `- Optimal exit: ${timing.optimalExitPrice.toFixed(4)} | Actual: ${entry.exitPrice}` : ''}

SIGNAL REPLAY:
${signalRow('At Entry', entrySignals)}
${hasExit ? signalRow('At Exit', exitSignals) : ''}

Provide structured coaching feedback in JSON:
{
  "thesisAccuracyScore": <0-100, how accurate was the trader's original thesis>,
  "wentWell": ["<2-4 specific things that were good about this trade>"],
  "toImprove": ["<2-4 specific, actionable improvements>"],
  "keyLesson": "<single most important takeaway in one sentence>",
  "coachingFeedback": "<full coaching analysis in markdown, 200-350 words, bilingual hint if needed>"
}

Be specific, data-driven, and constructive. Reference the actual numbers.`;
}

// ─── LLM Response Parser ──────────────────────────────────────────────────────

export function parseCoachingResponse(raw: string): PostTradeCoaching | null {
	try {
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (!jsonMatch) return null;
		const parsed = JSON.parse(jsonMatch[0]) as unknown;
		if (typeof parsed !== 'object' || parsed === null) return null;
		const obj = parsed as Record<string, unknown>;

		const score = typeof obj.thesisAccuracyScore === 'number'
			? Math.max(0, Math.min(100, obj.thesisAccuracyScore))
			: 50;
		const wentWell = Array.isArray(obj.wentWell)
			? (obj.wentWell as unknown[]).filter(x => typeof x === 'string') as string[]
			: [];
		const toImprove = Array.isArray(obj.toImprove)
			? (obj.toImprove as unknown[]).filter(x => typeof x === 'string') as string[]
			: [];
		const keyLesson = typeof obj.keyLesson === 'string' ? obj.keyLesson : 'Review trade execution.';
		const coachingFeedback = typeof obj.coachingFeedback === 'string' ? obj.coachingFeedback : '';

		return { thesisAccuracyScore: score, wentWell, toImprove, keyLesson, coachingFeedback };
	} catch {
		return null;
	}
}

// ─── Fallback Coaching ────────────────────────────────────────────────────────

export function buildFallbackCoaching(
	entry: JournalEntry,
	timing: TimingEfficiencyResult,
): PostTradeCoaching {
	const wentWell: string[] = [];
	const toImprove: string[] = [];

	const rMul = entry.rMultiple ?? 0;
	const isWin = timing.actualPnlUSD !== null ? timing.actualPnlUSD > 0 : rMul > 0;

	if (isWin) wentWell.push('Trade was profitable — thesis was directionally correct.');
	if (entry.followedPlan === true) wentWell.push('Followed the trading plan — disciplined execution.');
	if (timing.timingEfficiencyPct >= 60) wentWell.push(`Good timing efficiency (${timing.timingEfficiencyPct.toFixed(0)}% of max captured).`);
	if (entry.emotion === 'calm' || entry.emotion === 'disciplined') wentWell.push('Good emotional state during the trade.');

	if (!isWin && timing.hasExitData) toImprove.push('Review thesis validity — price moved against the setup.');
	if (entry.followedPlan === false) toImprove.push('Trade did not follow the plan — identify what caused the deviation.');
	if (timing.timingEfficiencyPct < 40 && timing.maxPossiblePnL > 0) {
		toImprove.push(`Improve entry/exit timing — only captured ${timing.timingEfficiencyPct.toFixed(0)}% of available move.`);
	}
	if (timing.entrySlippagePct > 0.5) {
		toImprove.push(`Entry was ${timing.entrySlippagePct.toFixed(2)}% from optimal — consider limit orders.`);
	}
	if (entry.mistakes.length > 0) {
		toImprove.push(`Recorded mistakes: ${entry.mistakes.join(', ')} — focus on eliminating these.`);
	}
	if (entry.emotion === 'fearful' || entry.emotion === 'greedy' || entry.emotion === 'impulsive') {
		toImprove.push(`Emotional state was "${entry.emotion}" — practice mindfulness before entering trades.`);
	}

	if (wentWell.length === 0) wentWell.push('Trade data recorded for future pattern analysis.');
	if (toImprove.length === 0) toImprove.push('Continue journaling for better pattern insights over time.');

	const rStr = rMul !== 0 ? ` (${rMul.toFixed(2)}R)` : '';
	const keyLesson = isWin
		? `Document what made this ${entry.setupType ?? 'setup'} work — repeat the process.`
		: `Analyse what invalidated the thesis to avoid similar ${entry.setupType ?? 'setup'} errors.`;

	const lines = [
		`## Post-Trade Analysis: ${entry.symbol} ${entry.direction.toUpperCase()}${rStr}`,
		'',
		`**Result:** ${isWin ? 'Winner' : 'Loser'} | Timing efficiency: ${timing.timingEfficiencyPct.toFixed(0)}%`,
		'',
		'**What Went Well:**',
		...wentWell.map(w => `- ${w}`),
		'',
		'**Areas to Improve:**',
		...toImprove.map(t => `- ${t}`),
		'',
		`**Key Lesson:** ${keyLesson}`,
	].join('\n');

	return {
		thesisAccuracyScore: isWin ? 70 : 30,
		wentWell,
		toImprove,
		keyLesson,
		coachingFeedback: lines,
	};
}
