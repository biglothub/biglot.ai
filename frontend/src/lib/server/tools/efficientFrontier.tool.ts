// Efficient Frontier & Portfolio Optimization Tool — T-1101
// Tool: optimize_portfolio

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { fetchOHLCV } from '../data/ohlcvProvider';
import { runEfficientFrontier } from '../risk/efficientFrontier';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Default assets ───────────────────────────────────────────────────────────

const DEFAULT_ASSETS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 1): string {
	return (v * 100).toFixed(decimals) + '%';
}

function fmtWeight(v: number): string {
	return (v * 100).toFixed(1) + '%';
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'optimize_portfolio',
	description:
		'Efficient Frontier & Portfolio Optimization — given a list of crypto/stock symbols, fetches 180-day daily prices and applies Modern Portfolio Theory. Computes annualised returns, covariance matrix, and runs a 2000-portfolio Monte Carlo simulation to find: (1) Maximum-Sharpe-ratio portfolio (best risk-adjusted return), (2) Minimum-variance portfolio (lowest risk), (3) Equal-weight benchmark. Returns MetricCard (max-Sharpe weights, return, risk, Sharpe) + comparison TableBlock (3 portfolios with per-asset weights) + efficient frontier scatter TableBlock. Use when asked about portfolio optimization, asset allocation, efficient frontier, Sharpe ratio, or mean-variance analysis.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type:        'array',
				items:       { type: 'string' },
				description: `List of symbols to optimize (2–10 assets). Default: ${DEFAULT_ASSETS.join(', ')}`,
			},
			risk_free_rate: {
				type:        'number',
				description: 'Annualised risk-free rate (default: 0.05 = 5%)',
			},
			num_portfolios: {
				type:        'number',
				description: 'Number of Monte Carlo portfolios (default: 2000, max: 5000)',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		// ── Parse args ────────────────────────────────────────────────────────
		const rawSymbols = Array.isArray(args.symbols) ? (args.symbols as unknown[]) : [];
		const symbols    = (rawSymbols.length >= 2 && rawSymbols.length <= 10)
			? rawSymbols.map(s => String(s).toUpperCase().trim()).filter(Boolean)
			: DEFAULT_ASSETS;

		const rfr          = typeof args.risk_free_rate === 'number' ? args.risk_free_rate : 0.05;
		const numPortfolios = Math.min(5000, Math.max(500, typeof args.num_portfolios === 'number' ? args.num_portfolios : 2000));

		const cacheKey = toolCache.generateKey('optimize_portfolio', { symbols, rfr, numPortfolios });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch OHLCV for all symbols ───────────────────────────────────────
		const results = await Promise.all(
			symbols.map(sym => fetchOHLCV(sym, '1d', 180))
		);

		// Check for errors
		const errors: string[] = [];
		const validPriceSeries: number[][] = [];
		const validSymbols:     string[]   = [];

		for (let i = 0; i < symbols.length; i++) {
			const res = results[i];
			if ('error' in res) {
				errors.push(`${symbols[i]}: ${res.error}`);
			} else if (res.ohlcv.length < 30) {
				errors.push(`${symbols[i]}: insufficient data (${res.ohlcv.length} candles, need ≥30)`);
			} else {
				validSymbols.push(symbols[i]);
				validPriceSeries.push(res.ohlcv.map(c => c.close));
			}
		}

		if (validSymbols.length < 1) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch data for any symbol. Errors: ${errors.join('; ')}`, tool: 'optimize_portfolio' }],
				textSummary: 'Portfolio optimization failed — no valid data.',
			};
		}

		// ── Run optimization ──────────────────────────────────────────────────
		const result = runEfficientFrontier(validSymbols, validPriceSeries, rfr, numPortfolios);
		const { maxSharpe, minVariance, equalWeight } = result;

		// ── MetricCard ────────────────────────────────────────────────────────
		const topWeights = validSymbols
			.map((sym, i) => `${sym} ${fmtWeight(maxSharpe.weights[i])}`)
			.join(' · ');

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Portfolio Optimization — ${validSymbols.length} Assets (${numPortfolios.toLocaleString()} portfolios)`,
			metrics: [
				{
					label:     'Max Sharpe Portfolio',
					value:     `Sharpe ${maxSharpe.sharpe.toFixed(2)}`,
					change:    topWeights,
					direction: maxSharpe.sharpe > 1 ? 'up' : maxSharpe.sharpe > 0 ? 'neutral' : 'down',
				},
				{
					label:     'Expected Return (Ann.)',
					value:     fmtPct(maxSharpe.returns),
					change:    `Min-var: ${fmtPct(minVariance.returns)} | Equal: ${fmtPct(equalWeight.returns)}`,
					direction: maxSharpe.returns > 0 ? 'up' : 'down',
				},
				{
					label:     'Annualised Risk (Std Dev)',
					value:     fmtPct(maxSharpe.risk),
					change:    `Min-var: ${fmtPct(minVariance.risk)} | Equal: ${fmtPct(equalWeight.risk)}`,
					direction: maxSharpe.risk < minVariance.risk ? 'up' : 'neutral',
				},
				{
					label:     'Risk-Free Rate',
					value:     fmtPct(rfr),
					change:    `${validSymbols.length} assets · 180d daily history`,
					direction: 'neutral',
				},
			],
		};

		// ── Weights comparison table ──────────────────────────────────────────
		const weightsRows: string[][] = validSymbols.map((sym, i) => [
			sym,
			fmtWeight(maxSharpe.weights[i]),
			fmtWeight(minVariance.weights[i]),
			fmtWeight(equalWeight.weights[i]),
		]);

		// Add summary rows
		weightsRows.push([
			'─── Expected Return',
			fmtPct(maxSharpe.returns),
			fmtPct(minVariance.returns),
			fmtPct(equalWeight.returns),
		]);
		weightsRows.push([
			'─── Annualised Risk',
			fmtPct(maxSharpe.risk),
			fmtPct(minVariance.risk),
			fmtPct(equalWeight.risk),
		]);
		weightsRows.push([
			'─── Sharpe Ratio',
			maxSharpe.sharpe.toFixed(2),
			minVariance.sharpe.toFixed(2),
			equalWeight.sharpe.toFixed(2),
		]);

		const weightsTable: TableBlock = {
			type:    'table',
			title:   'Portfolio Weights Comparison',
			headers: ['Asset', 'Max Sharpe', 'Min Variance', 'Equal Weight'],
			rows:    weightsRows,
		};

		// ── Efficient frontier scatter table ──────────────────────────────────
		const frontierRows = result.frontier.map(pt => [
			fmtPct(pt.risk, 2),
			fmtPct(pt.returns, 2),
			pt.sharpe.toFixed(3),
		]);

		const frontierTable: TableBlock = {
			type:    'table',
			title:   `Efficient Frontier (${result.frontier.length} points, sorted by risk)`,
			headers: ['Risk (σ)', 'Return (μ)', 'Sharpe'],
			rows:    frontierRows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, weightsTable, frontierTable];

		if (errors.length > 0) {
			contentBlocks.push({
				type:    'table',
				title:   'Data Fetch Warnings',
				headers: ['Warning'],
				rows:    errors.map(e => [e]),
			} satisfies TableBlock);
		}

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Portfolio optimization (${validSymbols.length} assets, ${numPortfolios} portfolios): Max-Sharpe → return ${fmtPct(maxSharpe.returns)}, risk ${fmtPct(maxSharpe.risk)}, Sharpe ${maxSharpe.sharpe.toFixed(2)}. Min-variance → return ${fmtPct(minVariance.returns)}, risk ${fmtPct(minVariance.risk)}. Weights: ${topWeights}.`,
			sources: [{ name: 'Efficient Frontier Optimization', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 30 * 60_000); // 30 min cache
		return toolResult;
	},
});
