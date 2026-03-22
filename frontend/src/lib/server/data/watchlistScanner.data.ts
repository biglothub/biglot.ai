// Watchlist Scanner — T-901
// Pure logic: scan multiple symbols and aggregate signal/regime/RSI metrics

import type { OHLCV } from '$lib/types/contentBlock';
import { rsi, sma } from '../indicators/engine';
import { analyzeRegime, type MarketRegime } from '../indicators/regime';
import { detectConfluence, type SignalDirection } from '../indicators/confluence';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SymbolScanResult = {
	symbol:           string;
	price:            number;
	change24h:        number;    // percent
	rsiValue:         number;    // 0–100
	regime:           MarketRegime | null;
	signalDirection:  SignalDirection | null;
	bullishScore:     number;    // sum of bullish signal strengths
	bearishScore:     number;    // sum of bearish signal strengths
	confluenceScore:  number;    // max(bull, bear)
	aboveSMA50:       boolean | null;
	aboveSMA200:      boolean | null;
	error?:           string;
};

export type WatchlistScanSummary = {
	results:     SymbolScanResult[];
	bullCount:   number;
	bearCount:   number;
	neutralCount: number;
	avgRSI:      number;  // across valid symbols
	scannedAt:   number;  // Date.now()
};

// ─── Per-symbol scan ─────────────────────────────────────────────────────────

/**
 * Compute all scanner metrics from a pre-fetched OHLCV array.
 * Returns the symbol row without the `symbol` field (caller adds it).
 */
export function scanSymbol(ohlcv: OHLCV[]): Omit<SymbolScanResult, 'symbol'> {
	if (ohlcv.length < 2) {
		return {
			price: 0, change24h: 0, rsiValue: 50, regime: null,
			signalDirection: null, bullishScore: 0, bearishScore: 0,
			confluenceScore: 0, aboveSMA50: null, aboveSMA200: null,
		};
	}

	const current   = ohlcv[ohlcv.length - 1];
	const prev      = ohlcv[ohlcv.length - 2];
	const price     = current.close;
	const change24h = prev.close > 0 ? ((price - prev.close) / prev.close) * 100 : 0;

	// RSI(14)
	const rsiPts   = rsi(ohlcv, 14);
	const rsiValue = rsiPts.length > 0 ? rsiPts[rsiPts.length - 1].value : 50;

	// SMA positions
	const sma50Pts  = sma(ohlcv, 50);
	const sma200Pts = sma(ohlcv, 200);
	const aboveSMA50  = sma50Pts.length  > 0 ? price > sma50Pts[sma50Pts.length - 1].value   : null;
	const aboveSMA200 = sma200Pts.length > 0 ? price > sma200Pts[sma200Pts.length - 1].value : null;

	// Market regime
	const regimeAnalysis = analyzeRegime(ohlcv);

	// Confluence signals
	const confluence = detectConfluence(ohlcv);

	return {
		price,
		change24h,
		rsiValue,
		regime:          regimeAnalysis?.regime ?? null,
		signalDirection: confluence.dominantDirection,
		bullishScore:    confluence.bullishScore,
		bearishScore:    confluence.bearishScore,
		confluenceScore: confluence.confluenceScore,
		aboveSMA50,
		aboveSMA200,
	};
}

// ─── Aggregate scan ───────────────────────────────────────────────────────────

/**
 * Aggregate per-symbol OHLCV into a full watchlist scan summary.
 * Symbol results are sorted by confluenceScore descending, then by 24h change.
 */
export function buildWatchlistScan(
	symbolData: { symbol: string; ohlcv: OHLCV[] | null; error?: string }[]
): WatchlistScanSummary {
	const results: SymbolScanResult[] = symbolData.map(({ symbol, ohlcv, error }) => {
		if (error || !ohlcv || ohlcv.length === 0) {
			return {
				symbol, price: 0, change24h: 0, rsiValue: 50, regime: null,
				signalDirection: null, bullishScore: 0, bearishScore: 0,
				confluenceScore: 0, aboveSMA50: null, aboveSMA200: null,
				error: error ?? 'No data',
			};
		}
		return { symbol, ...scanSymbol(ohlcv) };
	});

	// Sort: errors last, then by confluenceScore desc, then change24h desc
	results.sort((a, b) => {
		if (a.error && !b.error) return 1;
		if (!a.error && b.error) return -1;
		if (b.confluenceScore !== a.confluenceScore) return b.confluenceScore - a.confluenceScore;
		return b.change24h - a.change24h;
	});

	const valid      = results.filter(r => !r.error);
	const bullCount  = valid.filter(r => r.signalDirection === 'bullish').length;
	const bearCount  = valid.filter(r => r.signalDirection === 'bearish').length;
	const neutralCount = valid.length - bullCount - bearCount;
	const avgRSI     = valid.length > 0
		? valid.reduce((s, r) => s + r.rsiValue, 0) / valid.length
		: 50;

	return { results, bullCount, bearCount, neutralCount, avgRSI, scannedAt: Date.now() };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function fmtPrice(price: number): string {
	if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
	if (price >= 1)    return price.toFixed(4);
	return price.toPrecision(4);
}

export function fmtChange(pct: number): string {
	return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export function signalLabel(direction: SignalDirection | null, score: number): string {
	if (!direction) return 'Neutral';
	const strength = score >= 8 ? 'Strong' : score >= 5 ? 'Moderate' : 'Weak';
	return `${strength} ${direction.charAt(0).toUpperCase() + direction.slice(1)}`;
}

export function regimeEmoji(regime: MarketRegime | null): string {
	switch (regime) {
		case 'trending_up':    return '↑ Trending Up';
		case 'trending_down':  return '↓ Trending Down';
		case 'ranging':        return '↔ Ranging';
		case 'high_volatility': return '⚡ High Vol';
		default:               return '—';
	}
}

export function smaPositionLabel(above50: boolean | null, above200: boolean | null): string {
	if (above50 === null && above200 === null) return '—';
	const s50  = above50  === null ? '?' : above50  ? '✓' : '✗';
	const s200 = above200 === null ? '?' : above200 ? '✓' : '✗';
	return `50: ${s50} | 200: ${s200}`;
}
