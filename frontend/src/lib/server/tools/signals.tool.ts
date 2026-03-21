// Signal Generator Tool - multi-indicator confluence detection
// Returns TradeSetupBlock when strong confluence is found

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import type { OHLCV, TradeSetupBlock, MetricCardBlock } from '$lib/types/contentBlock';
import { detectConfluence, type ConfluenceResult, type Signal } from '../indicators/confluence';
import { atr } from '../indicators/engine';
import { isForexOrCommodity, fetchYahooOHLCV } from './yahooFinance';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

const INTERVAL_MAP: Record<string, string> = {
	'1m': '1m',
	'5m': '5m',
	'15m': '15m',
	'30m': '30m',
	'1h': '1h',
	'2h': '2h',
	'4h': '4h',
	'6h': '6h',
	'8h': '8h',
	'12h': '12h',
	'1d': '1d',
	'1w': '1w',
	'1M': '1M'
};

function normalizeSymbol(symbol: string): string {
	let s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
	const isFullPair =
		s.endsWith('USDT') ||
		s.endsWith('BUSD') ||
		(s.endsWith('BTC') && s.length > 3) ||
		(s.endsWith('ETH') && s.length > 3);
	if (!isFullPair) s += 'USDT';
	return s;
}

function normalizeInterval(interval: string): string {
	const lower = interval.toLowerCase().trim();
	return INTERVAL_MAP[lower] ?? '4h';
}

// ─── OHLCV Fetching ──────────────────────────────────────────────────────────

async function fetchOHLCV(
	rawSymbol: string,
	interval: string,
	limit: number
): Promise<{ ohlcv: OHLCV[]; displaySymbol: string } | { error: string }> {
	if (isForexOrCommodity(rawSymbol)) {
		const displaySymbol = rawSymbol.toUpperCase().replace(/[^A-Z]/g, '');
		const result = await fetchYahooOHLCV(rawSymbol, interval, limit);
		if ('error' in result) return { error: result.error };
		return { ohlcv: result.ohlcv, displaySymbol };
	}

	const symbol = normalizeSymbol(rawSymbol);
	const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

	const response = await fetch(url);
	if (!response.ok) {
		return { error: `Failed to fetch data for ${symbol} (HTTP ${response.status})` };
	}

	const rawData = (await response.json()) as number[][];
	const ohlcv: OHLCV[] = rawData.map((k) => ({
		time: Math.floor(k[0] / 1000),
		open: parseFloat(String(k[1])),
		high: parseFloat(String(k[2])),
		low: parseFloat(String(k[3])),
		close: parseFloat(String(k[4])),
		volume: parseFloat(String(k[5]))
	}));

	return { ohlcv, displaySymbol: symbol };
}

// ─── Trade Setup Builder ──────────────────────────────────────────────────────

function buildTradeSetup(
	symbol: string,
	interval: string,
	confluence: ConfluenceResult
): TradeSetupBlock {
	const { currentPrice, atrValue, dominantDirection, signals } = confluence;
	const dir = dominantDirection!;
	const isLong = dir === 'bullish';

	// Entry zone: ±0.5 ATR around current price
	const halfAtr = atrValue * 0.5;
	const entryZone = {
		low: +(currentPrice - halfAtr).toFixed(2),
		high: +(currentPrice + halfAtr).toFixed(2)
	};

	// Stop loss: 1.5 ATR against direction from entry midpoint
	const entryMid = (entryZone.low + entryZone.high) / 2;
	const stopLoss = isLong
		? +(entryMid - atrValue * 1.5).toFixed(2)
		: +(entryMid + atrValue * 1.5).toFixed(2);

	const riskPerUnit = Math.abs(entryMid - stopLoss);

	// Targets: 1.5R, 3R, 5R
	const targets = isLong
		? [
				{ price: +(entryMid + riskPerUnit * 1.5).toFixed(2), label: 'T1 (1.5R)', rMultiple: 1.5 },
				{ price: +(entryMid + riskPerUnit * 3).toFixed(2), label: 'T2 (3R)', rMultiple: 3 },
				{ price: +(entryMid + riskPerUnit * 5).toFixed(2), label: 'T3 (5R)', rMultiple: 5 }
			]
		: [
				{ price: +(entryMid - riskPerUnit * 1.5).toFixed(2), label: 'T1 (1.5R)', rMultiple: 1.5 },
				{ price: +(entryMid - riskPerUnit * 3).toFixed(2), label: 'T2 (3R)', rMultiple: 3 },
				{ price: +(entryMid - riskPerUnit * 5).toFixed(2), label: 'T3 (5R)', rMultiple: 5 }
			];

	// Build thesis from signals
	const bullSignals = signals.filter((s) => s.direction === 'bullish');
	const bearSignals = signals.filter((s) => s.direction === 'bearish');
	const dominantSignals = isLong ? bullSignals : bearSignals;
	const thesis = dominantSignals.map((s) => s.description).join('; ');

	// Invalidation: opposite side of stop
	const invalidation = isLong
		? `Close below ${stopLoss.toFixed(2)} invalidates setup`
		: `Close above ${stopLoss.toFixed(2)} invalidates setup`;

	return {
		type: 'trade_setup',
		asset: symbol,
		direction: dir === 'bullish' ? 'long' : 'short',
		thesis,
		entryZone,
		stopLoss,
		targets,
		riskRewardRatio: 1.5,
		maxRiskPct: 1,
		invalidation,
		timeframe: interval
	};
}

// ─── Signal Summary Card ─────────────────────────────────────────────────────

function buildSignalSummary(
	symbol: string,
	interval: string,
	confluence: ConfluenceResult
): MetricCardBlock {
	const { bullishScore, bearishScore, dominantDirection, signals, currentPrice, atrValue } =
		confluence;

	const signalCount = signals.length;
	const bullCount = signals.filter((s) => s.direction === 'bullish').length;
	const bearCount = signals.filter((s) => s.direction === 'bearish').length;

	const dirLabel =
		dominantDirection === 'bullish'
			? 'BULLISH'
			: dominantDirection === 'bearish'
				? 'BEARISH'
				: 'NEUTRAL';

	return {
		type: 'metric_card',
		title: `Signal Scan: ${symbol} (${interval})`,
		metrics: [
			{ label: 'Direction', value: dirLabel },
			{
				label: 'Confluence Score',
				value: `${Math.max(bullishScore, bearishScore)} pts`,
				direction: dominantDirection === 'bullish' ? 'up' : dominantDirection === 'bearish' ? 'down' : 'neutral'
			},
			{ label: 'Bullish Signals', value: `${bullCount} (score: ${bullishScore})`, direction: 'up' },
			{ label: 'Bearish Signals', value: `${bearCount} (score: ${bearishScore})`, direction: 'down' },
			{ label: 'Total Signals', value: String(signalCount) },
			{ label: 'Current Price', value: currentPrice.toLocaleString() },
			{ label: 'ATR (14)', value: atrValue > 0 ? atrValue.toFixed(4) : 'N/A' }
		]
	};
}

// ─── Build Text Summary ───────────────────────────────────────────────────────

function buildTextSummary(
	symbol: string,
	interval: string,
	confluence: ConfluenceResult
): string {
	const { bullishScore, bearishScore, dominantDirection, signals, currentPrice } = confluence;

	const lines: string[] = [
		`Signal scan for ${symbol} on ${interval} timeframe.`,
		`Current price: ${currentPrice}`,
		`Bullish score: ${bullishScore} | Bearish score: ${bearishScore}`,
		`Direction: ${dominantDirection ?? 'NEUTRAL (no strong confluence)'}`,
		''
	];

	if (signals.length > 0) {
		lines.push('Active signals:');
		for (const s of signals) {
			lines.push(`  [${s.direction.toUpperCase()}] ${s.description} (strength: ${s.strength})`);
		}
	} else {
		lines.push('No active signals detected.');
	}

	return lines.join('\n');
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'generate_signals',
	description:
		'Scan a trading symbol for multi-indicator confluence signals. Detects MA crossovers, RSI divergences, MACD signal crosses, Bollinger Band breakouts/squeezes, support/resistance touches, SuperTrend flips, and Stochastic crosses. Returns a TradeSetupBlock when strong confluence (score ≥ 4) is found.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description:
					'Trading symbol (e.g. BTC, ETHUSDT, SOLUSDT, XAUUSD for gold, EURUSD for forex)'
			},
			interval: {
				type: 'string',
				description: 'Candlestick interval',
				enum: ['15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w']
			},
			min_confluence_score: {
				type: 'number',
				description:
					'Minimum confluence score to generate a trade setup (default: 4). Higher = stricter.'
			}
		},
		required: ['symbol']
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol = String(args.symbol || 'BTCUSDT');
		const interval = normalizeInterval(String(args.interval || '4h'));
		const minScore = Number(args.min_confluence_score) || 4;

		// Fetch enough candles for all indicators (need ~300 for SMA200)
		const limit = 300;

		const cacheKey = toolCache.generateKey('generate_signals', { rawSymbol, interval });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const fetched = await fetchOHLCV(rawSymbol, interval, limit);
		if ('error' in fetched) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: fetched.error, tool: 'generate_signals' }],
				textSummary: `Error: ${fetched.error}`
			};
		}

		const { ohlcv, displaySymbol } = fetched;
		if (ohlcv.length < 30) {
			return {
				success: false,
				contentBlocks: [
					{
						type: 'error',
						message: `Insufficient data for ${displaySymbol}: only ${ohlcv.length} candles`,
						tool: 'generate_signals'
					}
				],
				textSummary: `Error: Not enough data for ${displaySymbol}.`
			};
		}

		const confluence = detectConfluence(ohlcv);
		const summaryCard = buildSignalSummary(displaySymbol, interval, confluence);
		const textSummary = buildTextSummary(displaySymbol, interval, confluence);

		const contentBlocks = [summaryCard as import('$lib/types/contentBlock').ContentBlock];

		// Only generate TradeSetupBlock if confluence is strong enough
		if (confluence.dominantDirection !== null && confluence.confluenceScore >= minScore) {
			const tradeSetup = buildTradeSetup(displaySymbol, interval, confluence);
			contentBlocks.push(tradeSetup);
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{
					name: isForexOrCommodity(rawSymbol) ? 'Yahoo Finance' : 'Binance',
					url: isForexOrCommodity(rawSymbol) ? 'https://finance.yahoo.com' : 'https://binance.com',
					accessedAt: Date.now()
				}
			]
		};

		// Cache for 5 minutes
		toolCache.set(cacheKey, result, 5 * 60_000);
		return result;
	}
});
