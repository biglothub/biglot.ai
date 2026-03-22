// P&L Statement & Tax Report Tool — T-1402
// Tool: generate_pnl_report

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { listJournalEntries } from '../portfolio/journal';
import { listClosedTrades } from '../paperTrading/paperTrader';
import { buildPnLReport, buildTaxNotesText, type AccountingMethod } from '../data/pnlReport.data';
import type { ContentBlock, MetricCardBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtUsd(v: number): string {
	const sign = v >= 0 ? '$' : '-$';
	return `${sign}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(v: number, total: number): string {
	if (total === 0) return '0%';
	return `${((v / Math.abs(total)) * 100).toFixed(1)}%`;
}

function direction(v: number): 'up' | 'down' | 'neutral' {
	return v > 0 ? 'up' : v < 0 ? 'down' : 'neutral';
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'generate_pnl_report',
	description:
		'Generate a P&L Statement and Tax Report from the trade journal and paper trading history. Supports FIFO, LIFO, and average cost accounting methods. Calculates realised/unrealised P&L, estimated trading fees, net P&L, holding period classification (short-term < 1 year, long-term ≥ 1 year), and a Thai capital gains tax estimate (15%). Groups results by month and by asset. Use when asked about profits/losses, tax reporting, P&L summary, or year-end financial review.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID to load trade data for (required).',
			},
			method: {
				type: 'string',
				enum: ['fifo', 'lifo', 'average_cost'],
				description: 'Accounting method for cost basis: fifo (default), lifo, or average_cost.',
			},
			year: {
				type: 'number',
				description: 'Filter trades to a specific year (e.g. 2024). Omit for all-time report.',
			},
		},
		required: ['user_id'],
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id.trim() : '';
		if (!userId) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'user_id is required.', tool: 'generate_pnl_report' }],
				textSummary: 'Error: user_id is required.',
			};
		}

		const method: AccountingMethod =
			args.method === 'lifo' || args.method === 'average_cost'
				? args.method
				: 'fifo';

		const year = typeof args.year === 'number' ? args.year : undefined;

		const cacheKey = toolCache.generateKey('generate_pnl_report', { userId, method, year });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Fetch data ─────────────────────────────────────────────────────────
		let journalEntries;
		let closedPaperTrades;
		try {
			[journalEntries, closedPaperTrades] = await Promise.all([
				listJournalEntries(userId, 500),
				listClosedTrades(userId),
			]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : 'Failed to fetch trade data.';
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: msg, tool: 'generate_pnl_report' }],
				textSummary: `Error: ${msg}`,
			};
		}

		// ── Build report ───────────────────────────────────────────────────────
		const report = buildPnLReport(journalEntries, closedPaperTrades, method, year);

		const yearLabel = year ? ` (${year})` : ' (All-Time)';

		// ── MetricCard ─────────────────────────────────────────────────────────
		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `P&L Report${yearLabel} — ${method.toUpperCase()}`,
			metrics: [
				{
					label:     'Total Realised P&L',
					value:     fmtUsd(report.totalGrossPnL),
					direction: direction(report.totalGrossPnL),
				},
				{
					label:     'Est. Trading Fees',
					value:     `-${fmtUsd(report.totalFees)}`,
					change:    '0.1% per leg',
					direction: 'down',
				},
				{
					label:     'Net P&L',
					value:     fmtUsd(report.totalNetPnL),
					change:    `${report.winCount}/${report.tradeCount} winning trades`,
					direction: direction(report.totalNetPnL),
				},
				{
					label:     'Thai Tax Estimate (15%)',
					value:     report.totalNetPnL > 0 ? fmtUsd(report.thaiTaxEstimate) : 'No liability',
					change:    report.totalNetPnL > 0 ? 'On positive net gain' : 'Net loss — no tax',
					direction: report.totalNetPnL > 0 ? 'down' : 'neutral',
				},
				{
					label:     'Short-Term P&L',
					value:     fmtUsd(report.shortTermPnL),
					change:    '< 1 year held',
					direction: direction(report.shortTermPnL),
				},
				{
					label:     'Long-Term P&L',
					value:     fmtUsd(report.longTermPnL),
					change:    '≥ 1 year held',
					direction: direction(report.longTermPnL),
				},
			],
		};

		const contentBlocks: ContentBlock[] = [metricBlock];

		// ── Monthly Breakdown Table ────────────────────────────────────────────
		if (report.monthlyBreakdown.length > 0) {
			const monthTable: TableBlock = {
				type:    'table',
				title:   'Monthly P&L Summary',
				headers: ['Month', 'Trades', 'Wins', 'Gross P&L', 'Fees', 'Net P&L'],
				rows:    report.monthlyBreakdown.map(m => [
					m.month,
					m.tradeCount,
					`${m.winCount}/${m.tradeCount}`,
					fmtUsd(m.grossPnL),
					`-${fmtUsd(m.fees)}`,
					fmtUsd(m.netPnL),
				]),
			};
			contentBlocks.push(monthTable);
		}

		// ── Asset Breakdown Table ──────────────────────────────────────────────
		if (report.assetBreakdown.length > 0) {
			const assetTable: TableBlock = {
				type:    'table',
				title:   'Per-Asset P&L Breakdown',
				headers: ['Asset', 'Trades', 'Win Rate', 'Gross P&L', 'Fees', 'Net P&L', 'Avg Hold (days)'],
				rows:    report.assetBreakdown.map(a => [
					a.symbol,
					a.tradeCount,
					`${a.tradeCount > 0 ? ((a.winCount / a.tradeCount) * 100).toFixed(0) : 0}%`,
					fmtUsd(a.grossPnL),
					`-${fmtUsd(a.fees)}`,
					fmtUsd(a.netPnL),
					a.avgHoldingDays.toFixed(1),
				]),
			};
			contentBlocks.push(assetTable);
		}

		// ── Tax Notes TextBlock ────────────────────────────────────────────────
		const taxText: TextBlock = {
			type:    'text',
			content: buildTaxNotesText(report),
		};
		contentBlocks.push(taxText);

		// ── Text Summary ───────────────────────────────────────────────────────
		const textSummary = [
			`P&L Report${yearLabel} (${method.toUpperCase()}).`,
			`${report.tradeCount} closed trades`,
			report.startDate ? `from ${report.startDate} to ${report.endDate}.` : '.',
			`Gross P&L: ${fmtUsd(report.totalGrossPnL)}.`,
			`Fees: -${fmtUsd(report.totalFees)}.`,
			`Net P&L: ${fmtUsd(report.totalNetPnL)}.`,
			report.totalNetPnL > 0
				? `Thai tax estimate: ${fmtUsd(report.thaiTaxEstimate)}.`
				: 'No tax liability (net loss).',
		].join(' ');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [{ name: 'Trade Journal + Paper Trading', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, result, 120_000); // 2 min cache
		return result;
	},
});
