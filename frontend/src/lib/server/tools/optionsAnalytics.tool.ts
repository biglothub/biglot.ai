// Options Analytics Tool — T-802
// Tool: get_options_analytics

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	blackScholes,
	calcHistoricalVolatility,
	calcIVRank,
	fmtGreek,
	fmtPct,
} from '../indicators/blackScholes';
import { fetchOHLCV } from '../data/ohlcvProvider';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'get_options_analytics',
	description:
		'Options analytics using the Black-Scholes model — computes call/put prices, option Greeks (Delta, Gamma, Theta, Vega, Rho), historical volatility, and IV rank. Inputs: underlying symbol, strike price, days to expiry. Uses real-time historical volatility from OHLCV data as the volatility estimate. Returns MetricCard (option prices, HV, IV rank) + Greeks table. Use when asked about option pricing, hedging costs, Greeks, implied volatility, or options strategy analysis.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Underlying asset (e.g. BTCUSDT, AAPL, SPY). Default: BTCUSDT',
			},
			strike: {
				type: 'number',
				description: 'Option strike price. Defaults to current ATM price.',
			},
			days_to_expiry: {
				type: 'number',
				description: 'Days until option expiry (default: 30, min: 1, max: 365)',
			},
			risk_free_rate: {
				type: 'number',
				description: 'Annual risk-free rate as a decimal (default: 0.05 = 5%)',
			},
			hv_window: {
				type: 'number',
				description: 'Historical volatility lookback window in days (default: 30)',
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const symbol  = typeof args.symbol === 'string' && args.symbol ? args.symbol.toUpperCase() : 'BTCUSDT';
		const dte     = Math.min(365, Math.max(1, typeof args.days_to_expiry === 'number' ? args.days_to_expiry : 30));
		const rfr     = typeof args.risk_free_rate === 'number' ? args.risk_free_rate : 0.05;
		const hvWindow = Math.min(252, Math.max(10, typeof args.hv_window === 'number' ? args.hv_window : 30));

		const cacheKey = toolCache.generateKey('get_options_analytics', { symbol, dte, rfr, hvWindow });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV (365 days for IV rank) ────────────────────────────────
		const fetchResult = await fetchOHLCV(symbol, '1d', 365);
		if ('error' in fetchResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for ${symbol}: ${fetchResult.error}`, tool: 'get_options_analytics' }],
				textSummary: `Error: no data for ${symbol}.`,
			};
		}

		const candles = fetchResult.ohlcv;
		if (candles.length < hvWindow + 5) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Insufficient data for ${symbol}. Need at least ${hvWindow + 5} candles.`, tool: 'get_options_analytics' }],
				textSummary: `Error: insufficient data for ${symbol}.`,
			};
		}

		const currentPrice = candles[candles.length - 1].close;
		const strike       = typeof args.strike === 'number' && args.strike > 0 ? args.strike : currentPrice;
		const T            = dte / 365;

		// ── Historical Volatility ──────────────────────────────────────────────
		const closes = candles.map(c => c.close);
		const hv     = calcHistoricalVolatility(closes, hvWindow);
		if (hv === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not compute historical volatility for ${symbol}.`, tool: 'get_options_analytics' }],
				textSummary: `Error: no volatility data for ${symbol}.`,
			};
		}

		const ivRank = calcIVRank(candles, Math.min(hvWindow, Math.floor(candles.length / 2)));

		// ── Black-Scholes Pricing ──────────────────────────────────────────────
		const bs = blackScholes(currentPrice, strike, T, rfr, hv);
		if (!bs) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Black-Scholes computation failed for ${symbol}.`, tool: 'get_options_analytics' }],
				textSummary: `Error: BS failed for ${symbol}.`,
			};
		}

		const moneyness = strike > currentPrice ? 'OTM' : strike < currentPrice ? 'ITM' : 'ATM';
		const callPremiumPct = (bs.callPrice / currentPrice) * 100;
		const putPremiumPct  = (bs.putPrice  / currentPrice) * 100;

		// ── MetricCard ─────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Options Analytics — ${symbol} (${moneyness} ${dte}DTE)`,
			metrics: [
				{
					label:     'Current Price',
					value:     currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 }),
					change:    `Strike: ${strike.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${moneyness})`,
					direction: 'neutral',
				},
				{
					label:     'Call Option Price',
					value:     bs.callPrice.toFixed(4),
					change:    `${callPremiumPct.toFixed(2)}% of underlying`,
					direction: 'up',
				},
				{
					label:     'Put Option Price',
					value:     bs.putPrice.toFixed(4),
					change:    `${putPremiumPct.toFixed(2)}% of underlying`,
					direction: 'down',
				},
				{
					label:     'Historical Volatility (HV)',
					value:     fmtPct(hv),
					change:    `${hvWindow}-day annualised`,
					direction: hv > 0.5 ? 'down' : hv > 0.3 ? 'neutral' : 'up',
				},
				...(ivRank ? [
					{
						label:     'IV Rank',
						value:     `${ivRank.ivRank.toFixed(0)} / 100`,
						change:    `IV Percentile: ${ivRank.ivPercentile.toFixed(0)}% | Range: ${fmtPct(ivRank.hvMin)} – ${fmtPct(ivRank.hvMax)}`,
						direction: (ivRank.ivRank > 70 ? 'down' : ivRank.ivRank < 30 ? 'up' : 'neutral') as 'up' | 'down' | 'neutral',
					},
				] : []),
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Greeks Table ───────────────────────────────────────────────────────
		const greeksTable: TableBlock = {
			type:    'table',
			title:   `Option Greeks — ${symbol} Strike ${strike} ${dte}DTE HV=${fmtPct(hv)}`,
			headers: ['Greek', 'Call', 'Put', 'Interpretation'],
			rows: [
				[
					'Delta (Δ)',
					fmtGreek(bs.callGreeks.delta),
					fmtGreek(bs.putGreeks.delta),
					'Price change per $1 move in underlying',
				],
				[
					'Gamma (Γ)',
					fmtGreek(bs.callGreeks.gamma, 6),
					fmtGreek(bs.putGreeks.gamma, 6),
					'Delta change per $1 move (curvature)',
				],
				[
					'Theta (Θ)',
					fmtGreek(bs.callGreeks.theta, 4),
					fmtGreek(bs.putGreeks.theta, 4),
					'Daily time decay (negative = loses value)',
				],
				[
					'Vega (ν)',
					fmtGreek(bs.callGreeks.vega, 4),
					fmtGreek(bs.putGreeks.vega, 4),
					'Price change per 1% move in volatility',
				],
				[
					'Rho (ρ)',
					fmtGreek(bs.callGreeks.rho, 4),
					fmtGreek(bs.putGreeks.rho, 4),
					'Price change per 1% move in risk-free rate',
				],
			],
		};
		contentBlocks.push(greeksTable);

		// ── Scenario Table (price moves) ───────────────────────────────────────
		const moves = [-0.20, -0.10, -0.05, 0, +0.05, +0.10, +0.20];
		const scenarioTable: TableBlock = {
			type:    'table',
			title:   `P&L Scenarios — Long Call vs Long Put at Strike ${strike}`,
			headers: ['Price Move', 'New Price', 'Call P&L', 'Put P&L'],
			rows: moves.map(move => {
				const newPrice = currentPrice * (1 + move);
				const newBS    = blackScholes(newPrice, strike, T, rfr, hv);
				if (!newBS) return [
					`${move >= 0 ? '+' : ''}${(move * 100).toFixed(0)}%`,
					newPrice.toFixed(2),
					'N/A', 'N/A',
				];
				const callPnL = newBS.callPrice - bs.callPrice;
				const putPnL  = newBS.putPrice  - bs.putPrice;
				return [
					`${move >= 0 ? '+' : ''}${(move * 100).toFixed(0)}%`,
					newPrice.toLocaleString('en-US', { maximumFractionDigits: 2 }),
					`${callPnL >= 0 ? '+' : ''}${callPnL.toFixed(4)}`,
					`${putPnL  >= 0 ? '+' : ''}${putPnL.toFixed(4)}`,
				];
			}),
		};
		contentBlocks.push(scenarioTable);

		const ivRankText = ivRank
			? ` IV Rank ${ivRank.ivRank.toFixed(0)}/100 (${ivRank.ivRank > 70 ? 'elevated — selling premium favored' : ivRank.ivRank < 30 ? 'low — buying premium favored' : 'neutral'}).`
			: '';

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `${symbol} options: HV=${fmtPct(hv)} (${hvWindow}d), ${moneyness} K=${strike} ${dte}DTE — Call=${bs.callPrice.toFixed(4)} (δ=${fmtGreek(bs.callGreeks.delta)}), Put=${bs.putPrice.toFixed(4)} (δ=${fmtGreek(bs.putGreeks.delta)}).${ivRankText}`,
			sources: [{ name: 'Black-Scholes Model', url: 'https://www.investopedia.com/terms/b/blackscholes.asp', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 10 * 60_000); // 10 min cache
		return result;
	},
});
