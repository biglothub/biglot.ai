// Funding Rate Arbitrage Scanner Tool — T-1103
// Tool: scan_funding_arb

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	buildFundingArbSnapshot,
	DEFAULT_SYMBOLS,
	DEFAULT_MIN_CARRY_PCT,
} from '../data/fundingArb.data';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number, decimals = 1): string {
	const sign = v >= 0 ? '+' : '';
	return `${sign}${v.toFixed(decimals)}%`;
}

function fmtPrice(v: number): string {
	return v >= 1000
		? v.toLocaleString('en-US', { maximumFractionDigits: 0 })
		: v.toFixed(4);
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'scan_funding_arb',
	description:
		'Funding Rate Arbitrage Scanner — scans top USDT perpetual futures on Binance for cash-and-carry arbitrage opportunities. For each symbol: fetches markPrice, indexPrice, and lastFundingRate (8h). Computes annualised funding (%), basis % (perp vs spot), and net carry (funding_ann - basis_ann). Positive carry = buy spot + short perp to earn funding. Negative carry = long perp + short spot. Filters to |carry| ≥ 10% annualised. Returns MetricCard (best/worst opportunity, counts) + opportunities TableBlock sorted by |carry| desc. Use when asked about funding rate arbitrage, carry trades, perp/spot basis, cash-and-carry, or perpetual funding.',
	parameters: {
		type: 'object',
		properties: {
			symbols: {
				type:        'array',
				items:       { type: 'string' },
				description: `Custom list of perpetual symbols (default: top 20 USDT perps)`,
			},
			min_carry_pct: {
				type:        'number',
				description: `Minimum absolute annualised carry % to show (default: ${DEFAULT_MIN_CARRY_PCT})`,
			},
		},
		required: [],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbols   = Array.isArray(args.symbols) ? (args.symbols as unknown[]) : [];
		const symbols      = rawSymbols.length > 0
			? rawSymbols.map(s => String(s).toUpperCase().trim()).filter(Boolean)
			: DEFAULT_SYMBOLS;
		const minCarryPct  = typeof args.min_carry_pct === 'number' && args.min_carry_pct >= 0
			? args.min_carry_pct
			: DEFAULT_MIN_CARRY_PCT;

		const cacheKey = toolCache.generateKey('scan_funding_arb', { symbols, minCarryPct });
		const cached   = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Scan ──────────────────────────────────────────────────────────────
		let snap;
		try {
			snap = await buildFundingArbSnapshot(symbols, minCarryPct);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Failed to fetch funding rates: ${msg}`, tool: 'scan_funding_arb' }],
				textSummary: 'Funding arb scan failed.',
			};
		}

		if (snap.symbolsScanned === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'No data returned from Binance premiumIndex. Check symbol names.', tool: 'scan_funding_arb' }],
				textSummary: 'No funding rate data available.',
			};
		}

		const { bestOpportunity, opportunities } = snap;
		const hasOpps = opportunities.length > 0;

		// ── MetricCard ────────────────────────────────────────────────────────
		const bestLabel = bestOpportunity
			? `${bestOpportunity.symbol} ${fmtPct(bestOpportunity.carryAnn)} p.a.`
			: 'None above threshold';
		const bestDir   = bestOpportunity
			? (bestOpportunity.carryAnn > 0 ? 'up' as const : 'down' as const)
			: 'neutral' as const;

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Funding Rate Arb Scanner — ${snap.symbolsScanned} symbols (≥${minCarryPct}% carry)`,
			metrics: [
				{
					label:     'Best Opportunity',
					value:     bestLabel,
					change:    bestOpportunity ? bestOpportunity.strategy : 'No opportunities above threshold',
					direction: bestDir,
				},
				{
					label:     'Positive Carry Opps',
					value:     String(snap.positiveCount),
					change:    'Buy spot + short perp (earn funding)',
					direction: snap.positiveCount > 0 ? 'up' : 'neutral',
				},
				{
					label:     'Negative Carry Opps',
					value:     String(snap.negativeCount),
					change:    'Short spot + long perp (earn negative funding)',
					direction: snap.negativeCount > 0 ? 'up' : 'neutral',
				},
				{
					label:     'Scanned',
					value:     `${snap.symbolsScanned} perps`,
					change:    `Min threshold: ${minCarryPct}% p.a. | Found: ${opportunities.length}`,
					direction: 'neutral',
				},
			],
		};

		// ── Opportunities table ───────────────────────────────────────────────
		const rows: string[][] = hasOpps
			? opportunities.slice(0, 20).map(o => [
				o.symbol,
				fmtPct(o.fundingAnn, 1),
				fmtPct(o.basisPct, 3),
				fmtPct(o.carryAnn, 1),
				o.direction === 'positive' ? 'Long spot / Short perp' : 'Short spot / Long perp',
				`$${fmtPrice(o.markPrice)}`,
			])
			: [['No opportunities found above ' + minCarryPct + '% threshold', '', '', '', '', '']];

		const oppTable: TableBlock = {
			type:    'table',
			title:   `Funding Arb Opportunities (sorted by |carry| desc)`,
			headers: ['Symbol', 'Funding Ann%', 'Basis%', 'Net Carry%', 'Strategy', 'Mark Price'],
			rows,
		};

		const contentBlocks: ContentBlock[] = [metricBlock, oppTable];

		const summary = hasOpps
			? `Funding arb scan (${snap.symbolsScanned} perps): ${snap.positiveCount} positive, ${snap.negativeCount} negative carry opps above ${minCarryPct}%. Best: ${bestLabel}.`
			: `Funding arb scan (${snap.symbolsScanned} perps): no opportunities above ${minCarryPct}% annualised carry threshold.`;

		const toolResult: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: summary,
			sources: [{ name: 'Binance Futures premiumIndex', accessedAt: Date.now() }],
		};

		toolCache.set(cacheKey, toolResult, 5 * 60_000); // 5 min cache
		return toolResult;
	},
});
