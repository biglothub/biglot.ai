// Trade Checklist Data — T-1302
// Pure functions for the 8-point pre-trade checklist

import { fetchOHLCV, normalizeBinanceSymbol } from './ohlcvProvider';
import { analyzeRegime } from '../indicators/regime';
import { detectConfluence } from '../indicators/confluence';
import { scanDivergences } from '../indicators/divergence';
import { listJournalEntries } from '../portfolio/journal';
import type { ChecklistItem, ChecklistItemStatus } from '$lib/types/contentBlock';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChecklistInputs {
	symbol: string;
	direction: 'long' | 'short';
	timeframe: string;
	entryPrice?: number;
	stopPrice?: number;
	targetPrice?: number;
	accountSize?: number;
	riskPct?: number;
	userId?: string;
}

interface CalendarEvent {
	title: string;
	country: string;
	date: string;
	impact: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function mkItem(
	id: string,
	number: number,
	question: string,
	status: ChecklistItemStatus,
	explanation: string,
): ChecklistItem {
	return { id, number, question, status, explanation };
}

/**
 * Compute R:R ratio. Positive = valid, negative = invalid inputs.
 */
export function calcRR(
	entryPrice: number,
	stopPrice: number,
	targetPrice: number,
	direction: 'long' | 'short',
): number {
	const risk   = direction === 'long' ? entryPrice - stopPrice : stopPrice - entryPrice;
	const reward = direction === 'long' ? targetPrice - entryPrice : entryPrice - targetPrice;
	if (risk <= 0 || reward <= 0) return -1;
	return reward / risk;
}

/**
 * Compute a 0–100 readiness score from checklist items.
 * Pass = full points, Warning = half, Fail = 0, Skip = excluded from denominator.
 */
export function calcReadinessScore(items: ChecklistItem[]): number {
	const scored = items.filter(i => i.status !== 'skip');
	if (scored.length === 0) return 50;
	const total = scored.length * 2;
	const earned = scored.reduce((acc, i) => {
		if (i.status === 'pass')    return acc + 2;
		if (i.status === 'warning') return acc + 1;
		return acc; // fail = 0
	}, 0);
	return Math.round((earned / total) * 100);
}

/**
 * Map readiness score + fail count to a recommendation.
 */
export function getRecommendation(
	score: number,
	failCount: number,
): 'PROCEED' | 'CAUTION' | 'ABORT' {
	if (failCount >= 2) return 'ABORT';
	if (score >= 75 && failCount === 0) return 'PROCEED';
	return 'CAUTION';
}

// ─── Calendar fetch ───────────────────────────────────────────────────────────

async function fetchHighImpactEvents(): Promise<CalendarEvent[]> {
	const urls = [
		'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
		'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
	];
	const results = await Promise.allSettled(
		urls.map(url =>
			fetch(url, {
				headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
				signal: AbortSignal.timeout(8_000),
			}).then(r => r.ok ? r.json() as Promise<CalendarEvent[]> : Promise.resolve([] as CalendarEvent[]))
		)
	);
	const events: CalendarEvent[] = [];
	for (const r of results) {
		if (r.status === 'fulfilled' && Array.isArray(r.value)) events.push(...r.value);
	}
	return events.filter(e => e.impact === 'High');
}

// ─── Main checklist runner ────────────────────────────────────────────────────

export async function runPreTradeChecklist(inputs: ChecklistInputs): Promise<ChecklistItem[]> {
	const { symbol, direction, timeframe, entryPrice, stopPrice, targetPrice, accountSize, riskPct, userId } = inputs;
	const normalized = normalizeBinanceSymbol(symbol);
	const isLong = direction === 'long';

	const [ohlcvResult, calendarResult, journalResult] = await Promise.allSettled([
		fetchOHLCV(normalized, timeframe, 150),
		fetchHighImpactEvents(),
		userId ? listJournalEntries(userId, 50) : Promise.resolve([]),
	]);

	const items: ChecklistItem[] = [];

	// ── 1. Clear Edge ──────────────────────────────────────────────────────────
	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		const confluence = ohlcv.length >= 52 ? detectConfluence(ohlcv) : null;
		if (confluence) {
			const aligned = isLong ? confluence.bullishScore : confluence.bearishScore;
			const opposite = isLong ? confluence.bearishScore : confluence.bullishScore;
			if (aligned >= 6) {
				items.push(mkItem('clear_edge', 1, 'Clear edge?', 'pass', `Strong ${direction} confluence score: ${aligned} (opposing: ${opposite}).`));
			} else if (aligned >= 3) {
				items.push(mkItem('clear_edge', 1, 'Clear edge?', 'warning', `Moderate ${direction} confluence score: ${aligned}. Consider waiting for stronger confirmation.`));
			} else {
				items.push(mkItem('clear_edge', 1, 'Clear edge?', 'fail', `Weak ${direction} confluence score: ${aligned}. No clear edge detected.`));
			}
		} else {
			items.push(mkItem('clear_edge', 1, 'Clear edge?', 'skip', 'Insufficient candle history for confluence analysis (need 52+).'));
		}
	} else {
		items.push(mkItem('clear_edge', 1, 'Clear edge?', 'skip', 'Could not fetch market data to assess edge.'));
	}

	// ── 2. Regime Aligned ─────────────────────────────────────────────────────
	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		const regime = analyzeRegime(ohlcv);
		if (regime) {
			const regimeFavors = isLong
				? regime.regime === 'trending_up'
				: regime.regime === 'trending_down';
			if (regimeFavors) {
				items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'pass', `Regime: ${regime.regime} (ADX=${regime.adxValue.toFixed(1)}). Aligns with ${direction} direction.`));
			} else if (regime.regime === 'ranging') {
				items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'warning', `Market is ranging (ADX=${regime.adxValue.toFixed(1)}). Trend-following has lower probability. Consider mean-reversion approach.`));
			} else if (regime.regime === 'high_volatility') {
				items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'warning', `High volatility regime — unpredictable direction. Widen stops and reduce position size.`));
			} else {
				items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'fail', `Regime: ${regime.regime} (ADX=${regime.adxValue.toFixed(1)}). Opposes your ${direction} direction.`));
			}
		} else {
			items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'skip', 'Insufficient data for regime analysis (need 40+ candles).'));
		}
	} else {
		items.push(mkItem('regime_aligned', 2, 'Regime aligned?', 'skip', 'Could not fetch data for regime check.'));
	}

	// ── 3. R:R ≥ 2:1 ─────────────────────────────────────────────────────────
	if (entryPrice !== undefined && stopPrice !== undefined && targetPrice !== undefined) {
		const rr = calcRR(entryPrice, stopPrice, targetPrice, direction);
		if (rr < 0) {
			items.push(mkItem('rr_ratio', 3, 'R:R > 2:1?', 'fail', `Invalid R:R — stop or target is on the wrong side of entry for a ${direction}.`));
		} else if (rr >= 2) {
			items.push(mkItem('rr_ratio', 3, 'R:R > 2:1?', 'pass', `R:R = ${rr.toFixed(2)}:1. Meets minimum 2:1 requirement.`));
		} else if (rr >= 1.5) {
			items.push(mkItem('rr_ratio', 3, 'R:R > 2:1?', 'warning', `R:R = ${rr.toFixed(2)}:1. Below ideal 2:1 — consider adjusting target or tightening stop.`));
		} else {
			items.push(mkItem('rr_ratio', 3, 'R:R > 2:1?', 'fail', `R:R = ${rr.toFixed(2)}:1. Too low. Minimum acceptable is 2:1.`));
		}
	} else {
		items.push(mkItem('rr_ratio', 3, 'R:R > 2:1?', 'skip', 'Provide entry_price, stop_price, and target_price to calculate R:R.'));
	}

	// ── 4. Position Size Within Limits ────────────────────────────────────────
	if (accountSize !== undefined && riskPct !== undefined) {
		if (riskPct <= 1) {
			items.push(mkItem('position_size', 4, 'Position size within limits?', 'pass', `Risking ${riskPct.toFixed(2)}% ($${(accountSize * riskPct / 100).toFixed(0)}) — conservative (≤1%).`));
		} else if (riskPct <= 2) {
			items.push(mkItem('position_size', 4, 'Position size within limits?', 'pass', `Risking ${riskPct.toFixed(2)}% ($${(accountSize * riskPct / 100).toFixed(0)}) — within standard 2% rule.`));
		} else if (riskPct <= 3) {
			items.push(mkItem('position_size', 4, 'Position size within limits?', 'warning', `Risking ${riskPct.toFixed(2)}% ($${(accountSize * riskPct / 100).toFixed(0)}) — above standard 2% risk rule. Reduce size if conviction is not high.`));
		} else {
			items.push(mkItem('position_size', 4, 'Position size within limits?', 'fail', `Risking ${riskPct.toFixed(2)}% ($${(accountSize * riskPct / 100).toFixed(0)}) — exceeds 3% max risk per trade. Size down.`));
		}
	} else {
		items.push(mkItem('position_size', 4, 'Position size within limits?', 'skip', 'Provide account_size and risk_pct to verify position sizing.'));
	}

	// ── 5. No Conflicting Signals ─────────────────────────────────────────────
	if (ohlcvResult.status === 'fulfilled' && !('error' in ohlcvResult.value)) {
		const ohlcv = ohlcvResult.value.ohlcv;
		const divResult = scanDivergences(ohlcv);
		const opposing = divResult.signals.filter(d =>
			(isLong && d.direction === 'bearish') || (!isLong && d.direction === 'bullish')
		);
		if (opposing.length === 0) {
			items.push(mkItem('no_conflict', 5, 'No conflicting signals?', 'pass', 'No opposing divergences detected across RSI, MACD, and OBV.'));
		} else {
			const names = [...new Set(opposing.map(d => d.oscillator))].join(', ');
			items.push(mkItem('no_conflict', 5, 'No conflicting signals?', 'warning', `${opposing.length} opposing divergence(s) on ${names}. Review before entering.`));
		}
	} else {
		items.push(mkItem('no_conflict', 5, 'No conflicting signals?', 'skip', 'Could not fetch data to check conflicting signals.'));
	}

	// ── 6. No Near-Term Event Risk ────────────────────────────────────────────
	if (calendarResult.status === 'fulfilled') {
		const now = Date.now();
		const within48h = calendarResult.value.filter(e => {
			const t = new Date(e.date).getTime();
			return t >= now && t <= now + 48 * 3_600_000;
		});
		if (within48h.length === 0) {
			items.push(mkItem('event_risk', 6, 'No near-term event risk?', 'pass', 'No high-impact economic events in the next 48 hours.'));
		} else {
			const names = within48h.slice(0, 3).map(e => `${e.country}: ${e.title}`).join('; ');
			items.push(mkItem('event_risk', 6, 'No near-term event risk?', 'warning', `${within48h.length} high-impact event(s) within 48h: ${names}. Consider reducing size or waiting.`));
		}
	} else {
		items.push(mkItem('event_risk', 6, 'No near-term event risk?', 'skip', 'Could not fetch economic calendar.'));
	}

	// ── 7. In Trading Plan ────────────────────────────────────────────────────
	if (journalResult.status === 'fulfilled' && journalResult.value.length > 0) {
		const entries = journalResult.value;
		const similar = entries.filter(e => e.symbol === normalized && e.direction === direction);
		if (similar.length === 0) {
			items.push(mkItem('in_plan', 7, 'In trading plan?', 'warning', `No past ${direction} trades on ${normalized} in journal. Confirm this trade is part of your written plan.`));
		} else {
			const wins = similar.filter(e => (e.rMultiple ?? 0) > 0).length;
			const wr = wins / similar.length;
			if (wr >= 0.5) {
				items.push(mkItem('in_plan', 7, 'In trading plan?', 'pass', `${similar.length} prior ${direction} trades on ${normalized}: ${(wr * 100).toFixed(0)}% win rate. Consistent with your trading plan.`));
			} else {
				items.push(mkItem('in_plan', 7, 'In trading plan?', 'warning', `${similar.length} prior ${direction} trades on ${normalized}: only ${(wr * 100).toFixed(0)}% win rate. Review your edge before trading.`));
			}
		}
	} else if (journalResult.status === 'fulfilled') {
		items.push(mkItem('in_plan', 7, 'In trading plan?', 'skip', 'No journal entries found. Log trades to enable plan-adherence checks.'));
	} else {
		items.push(mkItem('in_plan', 7, 'In trading plan?', 'skip', 'Could not access trade journal.'));
	}

	// ── 8. Not Revenge Trading / Tilted ──────────────────────────────────────
	if (journalResult.status === 'fulfilled' && journalResult.value.length > 0) {
		const recent = journalResult.value
			.filter(e => e.rMultiple !== null)
			.sort((a, b) => new Date(b.tradeDate).getTime() - new Date(a.tradeDate).getTime())
			.slice(0, 5);
		const recentLosses = recent.filter(e => (e.rMultiple ?? 0) < 0).length;
		const hasImpulsive = recent.some(e =>
			e.emotion === 'impulsive' || e.emotion === 'fearful' || e.emotion === 'greedy'
		);
		if (recentLosses >= 3) {
			items.push(mkItem('not_revenge', 8, 'Not revenge trading / tilted?', 'fail', `${recentLosses} of last ${recent.length} trades were losses. High risk of revenge trading — step away and reset.`));
		} else if (recentLosses >= 2 || hasImpulsive) {
			const reason = hasImpulsive ? ' + emotional trade in recent history' : '';
			items.push(mkItem('not_revenge', 8, 'Not revenge trading / tilted?', 'warning', `${recentLosses} recent loss(es)${reason}. Monitor your mindset carefully before entering.`));
		} else {
			items.push(mkItem('not_revenge', 8, 'Not revenge trading / tilted?', 'pass', `Recent performance stable: ${recentLosses} loss(es) in last ${recent.length} closed trades.`));
		}
	} else {
		items.push(mkItem('not_revenge', 8, 'Not revenge trading / tilted?', 'skip', 'No journal history to assess emotional state.'));
	}

	return items;
}
