// Signal Scanner — T-402
// Scheduled scanner: fetches OHLCV for watchlist assets, runs confluence detection,
// auto-pushes high-confluence setups via Telegram.

import type { OHLCV, TradeSetupBlock } from '$lib/types/contentBlock';
import { detectConfluence, type ConfluenceResult } from '../indicators/confluence';
import { atr } from '../indicators/engine';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScannerConfig = {
	symbols: string[];
	interval?: string;            // default '4h'
	limit?: number;               // candles to fetch, default 200
	minConfluenceScore?: number;  // minimum to flag, default 4
};

export type ScanHit = {
	symbol: string;
	interval: string;
	confluenceScore: number;
	direction: 'bullish' | 'bearish';
	setup: TradeSetupBlock;
	scannedAt: number;
};

export type ScanReport = {
	hits: ScanHit[];
	scanned: number;
	errors: string[];
	durationMs: number;
	timestamp: number;
};

// ─── OHLCV Fetcher ────────────────────────────────────────────────────────────

const BINANCE_BASE = 'https://api.binance.com/api/v3';

/**
 * Normalise raw input to a full Binance pair (e.g. "BTC" → "BTCUSDT").
 */
export function normaliseSymbol(raw: string): string {
	const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
	const hasPair =
		s.endsWith('USDT') || s.endsWith('BUSD') ||
		(s.endsWith('BTC') && s.length > 3) ||
		(s.endsWith('ETH') && s.length > 3);
	return hasPair ? s : s + 'USDT';
}

async function fetchOHLCV(symbol: string, interval: string, limit: number): Promise<OHLCV[] | null> {
	try {
		const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
		const res = await fetch(url);
		if (!res.ok) return null;
		const raw = (await res.json()) as number[][];
		return raw.map(k => ({
			time: Math.floor(k[0] / 1000),
			open: parseFloat(String(k[1])),
			high: parseFloat(String(k[2])),
			low: parseFloat(String(k[3])),
			close: parseFloat(String(k[4])),
			volume: parseFloat(String(k[5])),
		}));
	} catch {
		return null;
	}
}

// ─── Trade Setup Builder ──────────────────────────────────────────────────────

export function buildTradeSetup(
	symbol: string,
	interval: string,
	confluence: ConfluenceResult
): TradeSetupBlock {
	const { currentPrice, atrValue, dominantDirection, signals } = confluence;
	const dir = dominantDirection!;
	const isLong = dir === 'bullish';

	const halfAtr = atrValue * 0.5;
	const entryZone = {
		low: +(currentPrice - halfAtr).toFixed(2),
		high: +(currentPrice + halfAtr).toFixed(2),
	};
	const entryMid = (entryZone.low + entryZone.high) / 2;
	const stopLoss = isLong
		? +(entryMid - atrValue * 1.5).toFixed(2)
		: +(entryMid + atrValue * 1.5).toFixed(2);
	const risk = Math.abs(entryMid - stopLoss);

	const targets = isLong
		? [
			{ price: +(entryMid + risk * 1.5).toFixed(2), label: 'T1 (1.5R)', rMultiple: 1.5 },
			{ price: +(entryMid + risk * 3).toFixed(2), label: 'T2 (3R)', rMultiple: 3 },
			{ price: +(entryMid + risk * 5).toFixed(2), label: 'T3 (5R)', rMultiple: 5 },
		]
		: [
			{ price: +(entryMid - risk * 1.5).toFixed(2), label: 'T1 (1.5R)', rMultiple: 1.5 },
			{ price: +(entryMid - risk * 3).toFixed(2), label: 'T2 (3R)', rMultiple: 3 },
			{ price: +(entryMid - risk * 5).toFixed(2), label: 'T3 (5R)', rMultiple: 5 },
		];

	const dominantSignals = signals.filter(s => s.direction === (isLong ? 'bullish' : 'bearish'));
	const thesis = dominantSignals.map(s => s.description).join('; ') || `${dir} confluence on ${interval}`;

	return {
		type: 'trade_setup',
		asset: symbol,
		direction: isLong ? 'long' : 'short',
		thesis,
		entryZone,
		stopLoss,
		targets,
		riskRewardRatio: 1.5,
		maxRiskPct: 1,
		invalidation: isLong
			? `Close below ${stopLoss.toFixed(2)} invalidates setup`
			: `Close above ${stopLoss.toFixed(2)} invalidates setup`,
		timeframe: interval,
	};
}

// ─── Core scanner ─────────────────────────────────────────────────────────────

/**
 * Scan a single symbol and return the confluence result.
 * Returns null if OHLCV fetch fails or data is insufficient.
 */
export async function scanSymbol(
	rawSymbol: string,
	interval = '4h',
	limit = 200
): Promise<{ result: ConfluenceResult; symbol: string } | null> {
	const symbol = normaliseSymbol(rawSymbol);
	const ohlcv = await fetchOHLCV(symbol, interval, limit);
	if (!ohlcv || ohlcv.length < 50) return null;

	const result = detectConfluence(ohlcv);
	return { result, symbol };
}

/**
 * Scan a full watchlist and return all hits above minConfluenceScore.
 */
export async function scanWatchlist(config: ScannerConfig): Promise<ScanReport> {
	const {
		symbols,
		interval = '4h',
		limit = 200,
		minConfluenceScore = 4,
	} = config;

	const startMs = Date.now();
	const hits: ScanHit[] = [];
	const errors: string[] = [];

	await Promise.allSettled(symbols.map(async (rawSym) => {
		try {
			const scanned = await scanSymbol(rawSym, interval, limit);
			if (!scanned) {
				errors.push(`${rawSym}: failed to fetch data`);
				return;
			}
			const { result, symbol } = scanned;
			if (result.confluenceScore >= minConfluenceScore && result.dominantDirection !== null) {
				hits.push({
					symbol,
					interval,
					confluenceScore: result.confluenceScore,
					direction: result.dominantDirection,
					setup: buildTradeSetup(symbol, interval, result),
					scannedAt: Date.now(),
				});
			}
		} catch {
			errors.push(`${rawSym}: scan error`);
		}
	}));

	// Sort by score descending
	hits.sort((a, b) => b.confluenceScore - a.confluenceScore);

	return {
		hits,
		scanned: symbols.length,
		errors,
		durationMs: Date.now() - startMs,
		timestamp: Date.now(),
	};
}

// ─── Default watchlist ────────────────────────────────────────────────────────

export const DEFAULT_WATCHLIST = [
	'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT',
	'XRPUSDT', 'ADAUSDT', 'DOTUSDT', 'LINKUSDT',
];
