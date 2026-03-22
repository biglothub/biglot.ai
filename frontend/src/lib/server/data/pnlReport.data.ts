// P&L Statement & Tax Report Data — T-1402
// Core logic: FIFO/LIFO/average-cost reporting, monthly + per-asset breakdowns, Thai tax estimate

import type { JournalEntry } from '../portfolio/journal';
import type { PaperTrade } from '../paperTrading/paperTrader';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AccountingMethod = 'fifo' | 'lifo' | 'average_cost';

export interface TradeRecord {
	id: string;
	source: 'journal' | 'paper';
	symbol: string;
	direction: 'long' | 'short';
	entryPrice: number;
	exitPrice: number;
	size: number;
	grossPnlUSD: number;
	estimatedFees: number;
	netPnlUSD: number;
	tradeDate: string;         // YYYY-MM-DD (exit/close date)
	holdingDays: number;
	holdingPeriod: 'short_term' | 'long_term'; // >= 365 days = long_term
}

export interface MonthlyPnL {
	month: string;             // YYYY-MM
	grossPnL: number;
	fees: number;
	netPnL: number;
	tradeCount: number;
	winCount: number;
}

export interface AssetPnL {
	symbol: string;
	grossPnL: number;
	fees: number;
	netPnL: number;
	tradeCount: number;
	winCount: number;
	avgHoldingDays: number;
}

export interface PnLReport {
	method: AccountingMethod;
	trades: TradeRecord[];
	totalGrossPnL: number;
	totalFees: number;
	totalNetPnL: number;
	shortTermPnL: number;
	longTermPnL: number;
	thaiTaxEstimate: number;   // 15% on positive net PnL
	monthlyBreakdown: MonthlyPnL[];
	assetBreakdown: AssetPnL[];
	startDate: string | null;
	endDate: string | null;
	tradeCount: number;
	winCount: number;
}

// ─── Fee Estimation ───────────────────────────────────────────────────────────

/** Estimate round-trip trading fees at 0.1% per leg (entry + exit). */
export function estimateFees(entryPrice: number, exitPrice: number, size: number): number {
	const entryValue = entryPrice * size;
	const exitValue  = exitPrice  * size;
	return (entryValue + exitValue) * 0.001;
}

// ─── Holding Period ───────────────────────────────────────────────────────────

/** Calculate holding days between two ISO date strings or YYYY-MM-DD strings. */
export function calcHoldingDays(openedAt: string, closedAt: string): number {
	const open  = new Date(openedAt).getTime();
	const close = new Date(closedAt).getTime();
	if (isNaN(open) || isNaN(close) || close < open) return 0;
	return Math.floor((close - open) / (1000 * 60 * 60 * 24));
}

// ─── Monthly Breakdown ────────────────────────────────────────────────────────

export function buildMonthlyBreakdown(trades: TradeRecord[]): MonthlyPnL[] {
	const map = new Map<string, MonthlyPnL>();

	for (const t of trades) {
		const month = t.tradeDate.slice(0, 7); // YYYY-MM
		const existing = map.get(month) ?? {
			month,
			grossPnL:   0,
			fees:        0,
			netPnL:      0,
			tradeCount:  0,
			winCount:    0,
		};
		existing.grossPnL  += t.grossPnlUSD;
		existing.fees      += t.estimatedFees;
		existing.netPnL    += t.netPnlUSD;
		existing.tradeCount++;
		if (t.netPnlUSD > 0) existing.winCount++;
		map.set(month, existing);
	}

	return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ─── Asset Breakdown ──────────────────────────────────────────────────────────

export function buildAssetBreakdown(trades: TradeRecord[]): AssetPnL[] {
	const map = new Map<string, { grossPnL: number; fees: number; netPnL: number; tradeCount: number; winCount: number; holdingDaysSum: number }>();

	for (const t of trades) {
		const existing = map.get(t.symbol) ?? {
			grossPnL:       0,
			fees:            0,
			netPnL:          0,
			tradeCount:      0,
			winCount:        0,
			holdingDaysSum:  0,
		};
		existing.grossPnL      += t.grossPnlUSD;
		existing.fees          += t.estimatedFees;
		existing.netPnL        += t.netPnlUSD;
		existing.tradeCount++;
		if (t.netPnlUSD > 0) existing.winCount++;
		existing.holdingDaysSum += t.holdingDays;
		map.set(t.symbol, existing);
	}

	return [...map.entries()]
		.map(([symbol, v]) => ({
			symbol,
			grossPnL:       v.grossPnL,
			fees:            v.fees,
			netPnL:          v.netPnL,
			tradeCount:      v.tradeCount,
			winCount:        v.winCount,
			avgHoldingDays:  v.tradeCount > 0 ? v.holdingDaysSum / v.tradeCount : 0,
		}))
		.sort((a, b) => Math.abs(b.netPnL) - Math.abs(a.netPnL));
}

// ─── Journal Entry → TradeRecord ──────────────────────────────────────────────

function journalToTradeRecord(e: JournalEntry): TradeRecord | null {
	if (e.exitPrice === null || e.pnlUSD === null) return null;
	const grossPnl = e.pnlUSD;
	const fees     = estimateFees(e.entryPrice, e.exitPrice, e.size);
	return {
		id:             e.id,
		source:         'journal',
		symbol:         e.symbol,
		direction:      e.direction,
		entryPrice:     e.entryPrice,
		exitPrice:      e.exitPrice,
		size:           e.size,
		grossPnlUSD:    grossPnl,
		estimatedFees:  fees,
		netPnlUSD:      grossPnl - fees,
		tradeDate:      e.tradeDate,
		holdingDays:    0,      // journal stores only one date field
		holdingPeriod:  'short_term',
	};
}

// ─── Paper Trade → TradeRecord ────────────────────────────────────────────────

function paperToTradeRecord(t: PaperTrade): TradeRecord | null {
	if (t.isOpen || t.exitPrice === null || t.pnl === null || t.closedAt === null) return null;
	const grossPnl   = t.pnl;
	const fees       = estimateFees(t.entryPrice, t.exitPrice, t.qty);
	const holdDays   = calcHoldingDays(t.openedAt, t.closedAt);
	const tradeDate  = t.closedAt.slice(0, 10);
	return {
		id:             t.id,
		source:         'paper',
		symbol:         t.symbol,
		direction:      t.side,
		entryPrice:     t.entryPrice,
		exitPrice:      t.exitPrice,
		size:           t.qty,
		grossPnlUSD:    grossPnl,
		estimatedFees:  fees,
		netPnlUSD:      grossPnl - fees,
		tradeDate,
		holdingDays:    holdDays,
		holdingPeriod:  holdDays >= 365 ? 'long_term' : 'short_term',
	};
}

// ─── Main Builder ──────────────────────────────────────────────────────────────

export function buildPnLReport(
	journalEntries: JournalEntry[],
	paperTrades:    PaperTrade[],
	method:         AccountingMethod,
	year?:          number,
): PnLReport {
	// Convert both sources to unified TradeRecord[]
	const journalRecords = journalEntries
		.map(journalToTradeRecord)
		.filter((r): r is TradeRecord => r !== null);

	const paperRecords = paperTrades
		.map(paperToTradeRecord)
		.filter((r): r is TradeRecord => r !== null);

	let allTrades = [...journalRecords, ...paperRecords];

	// Filter by year if specified
	if (year !== undefined) {
		const yearStr = String(year);
		allTrades = allTrades.filter(t => t.tradeDate.startsWith(yearStr));
	}

	// Sort chronologically
	allTrades.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

	const totalGrossPnL = allTrades.reduce((s, t) => s + t.grossPnlUSD,   0);
	const totalFees     = allTrades.reduce((s, t) => s + t.estimatedFees, 0);
	const totalNetPnL   = allTrades.reduce((s, t) => s + t.netPnlUSD,     0);

	const shortTermPnL = allTrades
		.filter(t => t.holdingPeriod === 'short_term')
		.reduce((s, t) => s + t.netPnlUSD, 0);

	const longTermPnL = allTrades
		.filter(t => t.holdingPeriod === 'long_term')
		.reduce((s, t) => s + t.netPnlUSD, 0);

	// Thai capital gains tax: 15% on positive net PnL
	const thaiTaxEstimate = Math.max(0, totalNetPnL * 0.15);

	const winCount = allTrades.filter(t => t.netPnlUSD > 0).length;

	const dates    = allTrades.map(t => t.tradeDate).sort();
	const startDate = dates[0]              ?? null;
	const endDate   = dates[dates.length - 1] ?? null;

	return {
		method,
		trades:           allTrades,
		totalGrossPnL,
		totalFees,
		totalNetPnL,
		shortTermPnL,
		longTermPnL,
		thaiTaxEstimate,
		monthlyBreakdown: buildMonthlyBreakdown(allTrades),
		assetBreakdown:   buildAssetBreakdown(allTrades),
		startDate,
		endDate,
		tradeCount:       allTrades.length,
		winCount,
	};
}

// ─── Tax Notes Text Builder ────────────────────────────────────────────────────

export function buildTaxNotesText(report: PnLReport): string {
	const methodLabel: Record<AccountingMethod, string> = {
		fifo:          'First In First Out (FIFO)',
		lifo:          'Last In First Out (LIFO)',
		average_cost:  'Average Cost',
	};

	const fmt = (v: number) => {
		const sign = v >= 0 ? '$' : '-$';
		return `${sign}${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
	};

	const lines: string[] = [
		`## P&L Report — Tax Notes`,
		``,
		`**Accounting Method:** ${methodLabel[report.method]}`,
		`**Period:** ${report.startDate ?? 'N/A'} to ${report.endDate ?? 'N/A'}`,
		``,
		`### Summary`,
		`- Gross Realized P&L: **${fmt(report.totalGrossPnL)}**`,
		`- Estimated Trading Fees (0.1%/leg): **${fmt(-report.totalFees)}**`,
		`- **Net P&L: ${fmt(report.totalNetPnL)}**`,
		`- Short-term P&L (< 1 year): ${fmt(report.shortTermPnL)}`,
		`- Long-term P&L (≥ 1 year): ${fmt(report.longTermPnL)}`,
		``,
		`### Thai Tax Estimate (ภาษีกำไรจากการซื้อขาย)`,
		report.totalNetPnL > 0
			? `- Estimated tax at 15% on net gain: **${fmt(report.thaiTaxEstimate)}**`
			: `- Net P&L is negative — no tax liability estimated.`,
		``,
		`### Disclaimers`,
		`- **Trading fees are estimated** at 0.1% per leg. Actual fees vary by exchange and instrument.`,
		`- **Thai tax rates** depend on income classification. Crypto may be treated as capital gains (15%) or ordinary income. Consult a Thai tax professional (นักบัญชีหรือผู้เชี่ยวชาญด้านภาษี).`,
		`- **Paper trades** are not taxable events — they are simulated trades for educational purposes.`,
		`- This report is for informational purposes only and does not constitute tax or legal advice.`,
		`- FIFO/LIFO/Average Cost methods apply to cost basis calculation when trade lots are tracked. Since P&L is computed at trade close, the method choice is for reporting reference only.`,
	];

	return lines.join('\n');
}
