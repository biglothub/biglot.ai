// Backtest Tool - T-104
// Tool `run_backtest` — simulate a trading strategy on historical OHLCV data.

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import type { OHLCV, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';
import type { Strategy } from '$lib/types/strategy';
import type { BacktestResult, WalkForwardResult } from '$lib/types/backtest';
import { runBacktest, runWalkForward } from '../backtest/engine';
import { isForexOrCommodity, fetchYahooOHLCV } from './yahooFinance';

const BINANCE_BASE = 'https://api.binance.com/api/v3';

const INTERVAL_MAP: Record<string, string> = {
	'1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
	'1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h',
	'8h': '8h', '12h': '12h', '1d': '1d', '1w': '1w', '1M': '1M',
};

function normalizeSymbol(symbol: string): string {
	let s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
	const isFullPair =
		s.endsWith('USDT') || s.endsWith('BUSD') ||
		(s.endsWith('BTC') && s.length > 3) ||
		(s.endsWith('ETH') && s.length > 3);
	if (!isFullPair) s += 'USDT';
	return s;
}

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
	const binanceInterval = INTERVAL_MAP[interval] ?? '1d';
	const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${binanceInterval}&limit=${limit}`;

	const cacheKey = `binance_klines:${symbol}:${binanceInterval}:${limit}`;
	const cached = toolCache.get<OHLCV[]>(cacheKey);
	if (cached) return { ohlcv: cached, displaySymbol: symbol };

	try {
		const res = await fetch(url);
		if (!res.ok) return { error: `Binance API error: ${res.status}` };
		const raw = (await res.json()) as unknown[][];
		const ohlcv: OHLCV[] = raw.map((k) => ({
			time: Math.floor((k[0] as number) / 1000),
			open: parseFloat(k[1] as string),
			high: parseFloat(k[2] as string),
			low: parseFloat(k[3] as string),
			close: parseFloat(k[4] as string),
			volume: parseFloat(k[5] as string),
		}));
		toolCache.set(cacheKey, ohlcv, 300); // 5 min cache
		return { ohlcv, displaySymbol: symbol };
	} catch (err) {
		return { error: err instanceof Error ? err.message : 'Unknown fetch error' };
	}
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
	return n.toFixed(decimals);
}

function fmtPct(n: number): string {
	return `${n >= 0 ? '+' : ''}${fmt(n)}%`;
}

function metricsBlock(result: BacktestResult, title: string): MetricCardBlock {
	const m = result.metrics;
	return {
		type: 'metric_card',
		title,
		metrics: [
			{ label: 'Total Return', value: fmtPct(m.totalReturn), direction: m.totalReturn >= 0 ? 'up' : 'down' },
			{ label: 'CAGR', value: fmtPct(m.cagr), direction: m.cagr >= 0 ? 'up' : 'down' },
			{ label: 'Max Drawdown', value: `-${fmt(m.maxDrawdown)}%`, direction: 'down' },
			{ label: 'Sharpe', value: fmt(m.sharpe), direction: m.sharpe >= 1 ? 'up' : m.sharpe >= 0 ? 'neutral' : 'down' },
			{ label: 'Sortino', value: fmt(m.sortino), direction: m.sortino >= 1 ? 'up' : m.sortino >= 0 ? 'neutral' : 'down' },
			{ label: 'Win Rate', value: `${fmt(m.winRate)}%`, direction: m.winRate >= 50 ? 'up' : 'down' },
			{ label: 'Profit Factor', value: fmt(m.profitFactor), direction: m.profitFactor >= 1.5 ? 'up' : m.profitFactor >= 1 ? 'neutral' : 'down' },
			{ label: 'Avg R-Multiple', value: fmt(m.avgRMultiple), direction: m.avgRMultiple >= 0 ? 'up' : 'down' },
			{ label: 'Total Trades', value: String(m.totalTrades), direction: 'neutral' },
			{ label: 'Max Consec. Losses', value: String(m.maxConsecutiveLosses), direction: m.maxConsecutiveLosses >= 5 ? 'down' : 'neutral' },
			{ label: 'Expectancy/Trade', value: `$${fmt(m.expectancy)}`, direction: m.expectancy >= 0 ? 'up' : 'down' },
		],
	};
}

function tradeTableBlock(result: BacktestResult): TableBlock {
	const rows = result.trades.slice(0, 50).map((t) => [
		new Date(t.entryTime * 1000).toISOString().split('T')[0],
		new Date(t.exitTime * 1000).toISOString().split('T')[0],
		t.direction.toUpperCase(),
		fmt(t.entryPrice, 4),
		fmt(t.exitPrice, 4),
		fmtPct(t.pnlPct),
		fmt(t.rMultiple),
		t.exitReason.replace(/_/g, ' '),
	]);

	return {
		type: 'table',
		title: `Trade Log (${result.trades.length} trades${result.trades.length > 50 ? ', showing first 50' : ''})`,
		headers: ['Entry Date', 'Exit Date', 'Dir', 'Entry', 'Exit', 'P&L %', 'R-Mult', 'Exit Reason'],
		rows,
	};
}

function walkForwardSummaryBlock(wf: WalkForwardResult): MetricCardBlock {
	return {
		type: 'metric_card',
		title: 'Walk-Forward Analysis',
		metrics: [
			{ label: 'In-Sample Return (70%)', value: fmtPct(wf.inSample.metrics.totalReturn), direction: wf.inSample.metrics.totalReturn >= 0 ? 'up' : 'down' },
			{ label: 'Out-of-Sample Return (30%)', value: fmtPct(wf.outOfSample.metrics.totalReturn), direction: wf.outOfSample.metrics.totalReturn >= 0 ? 'up' : 'down' },
			{ label: 'Performance Degradation', value: fmtPct(wf.degradationPct), direction: wf.degradationPct > 50 ? 'down' : wf.degradationPct > 0 ? 'neutral' : 'up' },
			{ label: 'Overfit Risk', value: wf.degradationPct > 80 ? 'High' : wf.degradationPct > 40 ? 'Medium' : 'Low', direction: wf.degradationPct > 80 ? 'down' : wf.degradationPct > 40 ? 'neutral' : 'up' },
		],
	};
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'run_backtest',
	description:
		'Backtest a trading strategy on historical OHLCV data. Returns performance metrics (total return, Sharpe, Sortino, max drawdown, win rate, profit factor, R-multiples) and a trade log. Optionally runs walk-forward validation (70/30 split) to detect overfitting.',
	parameters: {
		type: 'object',
		properties: {
			strategy: {
				type: 'object',
				description: 'A Strategy object matching the Strategy schema from T-103.',
			},
			symbol: {
				type: 'string',
				description: 'Asset symbol (e.g. "BTCUSDT", "ETHUSDT", "XAUUSD", "AAPL").',
			},
			interval: {
				type: 'string',
				description: 'Candlestick interval: 1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1M.',
				default: '1d',
			},
			bars: {
				type: 'number',
				description: 'Number of historical bars to fetch (max 1000). Default 500.',
				default: 500,
			},
			initialCapital: {
				type: 'number',
				description: 'Starting capital in USD. Default 10000.',
				default: 10000,
			},
			walkForward: {
				type: 'boolean',
				description: 'Run walk-forward validation (70/30 split). Default false.',
				default: false,
			},
		},
		required: ['strategy', 'symbol'],
	},

	execute: async (args): Promise<ToolResult> => {
		const {
			strategy,
			symbol,
			interval = '1d',
			bars = 500,
			initialCapital = 10_000,
			walkForward = false,
		} = args as {
			strategy: Strategy;
			symbol: string;
			interval?: string;
			bars?: number;
			initialCapital?: number;
			walkForward?: boolean;
		};

		const limit = Math.min(Math.max(bars, 50), 1000);
		const fetchResult = await fetchOHLCV(symbol, interval, limit);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [],
				textSummary: `Failed to fetch OHLCV data for ${symbol}: ${fetchResult.error}`,
			};
		}

		const { ohlcv, displaySymbol } = fetchResult;
		if (ohlcv.length < 50) {
			return {
				success: false,
				contentBlocks: [],
				textSummary: `Insufficient data for ${displaySymbol}: only ${ohlcv.length} bars available (minimum 50).`,
			};
		}

		if (walkForward) {
			const wf = runWalkForward({ strategy, ohlcv, symbol: displaySymbol, initialCapital });
			const contentBlocks = [
				walkForwardSummaryBlock(wf),
				metricsBlock(wf.inSample, `In-Sample Performance (${new Date(wf.inSample.startTime * 1000).toISOString().split('T')[0]} – ${new Date(wf.inSample.endTime * 1000).toISOString().split('T')[0]})`),
				metricsBlock(wf.outOfSample, `Out-of-Sample Performance (${new Date(wf.outOfSample.startTime * 1000).toISOString().split('T')[0]} – ${new Date(wf.outOfSample.endTime * 1000).toISOString().split('T')[0]})`),
				tradeTableBlock(wf.combined),
			];
			const summary = `Walk-forward backtest of "${strategy.name}" on ${displaySymbol} (${interval}). ` +
				`In-sample: ${fmtPct(wf.inSample.metrics.totalReturn)} return, ${fmt(wf.inSample.metrics.sharpe)} Sharpe. ` +
				`Out-of-sample: ${fmtPct(wf.outOfSample.metrics.totalReturn)} return, ${fmt(wf.outOfSample.metrics.sharpe)} Sharpe. ` +
				`Degradation: ${fmtPct(wf.degradationPct)}.`;

			return { success: true, contentBlocks, textSummary: summary };
		}

		const result = runBacktest({ strategy, ohlcv, symbol: displaySymbol, initialCapital });
		const contentBlocks = [
			metricsBlock(result, `Backtest: ${strategy.name} on ${displaySymbol} (${interval})`),
			tradeTableBlock(result),
		];

		const m = result.metrics;
		const summary = `Backtest of "${strategy.name}" on ${displaySymbol} (${interval}, ${ohlcv.length} bars). ` +
			`Total return: ${fmtPct(m.totalReturn)}, Max drawdown: ${fmt(m.maxDrawdown)}%, ` +
			`Sharpe: ${fmt(m.sharpe)}, Win rate: ${fmt(m.winRate)}%, ${m.totalTrades} trades.`;

		return { success: true, contentBlocks, textSummary: summary };
	},
});
