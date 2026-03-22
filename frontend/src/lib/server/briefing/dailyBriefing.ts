// Daily Market Briefing — T-605
// Assembles morning summary: top crypto movers (24h), paper portfolio PnL.
// Formats output as Telegram HTML. Used by tool + /api/briefing route.

import { listOpenTrades, listClosedTrades, buildPaperPortfolio } from '../paperTrading/paperTrader';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TopMover = {
	symbol: string;
	priceChangePct: number;  // e.g. 5.23 or -3.11
	currentPrice: number;
};

export type DailyBriefing = {
	date: string;               // ISO date string e.g. "2026-03-22"
	topGainers: TopMover[];
	topLosers: TopMover[];
	totalUnrealisedPnL: number;
	totalRealisedPnL: number;
	openTradeCount: number;
	closedTradeCount: number;
	winRate: number | null;     // 0–1
};

// ─── Binance 24h ticker types ─────────────────────────────────────────────────

type BinanceTicker = {
	symbol: string;
	priceChangePercent: string;
	lastPrice: string;
	quoteVolume: string;
};

// ─── Top movers ───────────────────────────────────────────────────────────────

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const MIN_VOLUME_USDT = 5_000_000; // filter out low-liquidity pairs

/**
 * Fetch top gaining and losing USDT-quoted pairs from Binance.
 * Returns empty arrays on network error.
 */
export async function fetchTopMovers(limit = 5): Promise<{ gainers: TopMover[]; losers: TopMover[] }> {
	try {
		const res = await fetch(BINANCE_TICKER_URL);
		if (!res.ok) return { gainers: [], losers: [] };

		const tickers = (await res.json()) as BinanceTicker[];

		const usdt = tickers
			.filter(t =>
				t.symbol.endsWith('USDT') &&
				!t.symbol.includes('DOWN') &&
				!t.symbol.includes('UP') &&
				parseFloat(t.quoteVolume) >= MIN_VOLUME_USDT
			)
			.map(t => ({
				symbol:         t.symbol,
				priceChangePct: parseFloat(t.priceChangePercent),
				currentPrice:   parseFloat(t.lastPrice),
			}));

		usdt.sort((a, b) => b.priceChangePct - a.priceChangePct);

		return {
			gainers: usdt.slice(0, limit),
			losers:  usdt.slice(-limit).reverse(),
		};
	} catch {
		return { gainers: [], losers: [] };
	}
}

// ─── Portfolio PnL ────────────────────────────────────────────────────────────

async function fetchPortfolioSummary(userId: string) {
	const [open, closed] = await Promise.all([
		listOpenTrades(userId),
		listClosedTrades(userId),
	]);
	// Use entry prices as current prices for briefing (no live lookup needed)
	const priceMap = new Map(open.map(t => [t.symbol, t.entryPrice]));
	const snap = buildPaperPortfolio(open, priceMap, closed);
	return snap;
}

// ─── Briefing assembly ────────────────────────────────────────────────────────

export async function assembleDailyBriefing(
	userId = 'default',
	limit = 5
): Promise<DailyBriefing> {
	const [{ gainers, losers }, portfolio] = await Promise.all([
		fetchTopMovers(limit),
		fetchPortfolioSummary(userId),
	]);

	return {
		date:               new Date().toISOString().slice(0, 10),
		topGainers:         gainers,
		topLosers:          losers,
		totalUnrealisedPnL: portfolio.totalUnrealisedPnL,
		totalRealisedPnL:   portfolio.totalRealisedPnL,
		openTradeCount:     portfolio.openCount,
		closedTradeCount:   portfolio.tradeCount,
		winRate:            portfolio.winRate,
	};
}

// ─── Telegram formatting ──────────────────────────────────────────────────────

function fmtPct(pct: number): string {
	return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtPnL(n: number): string {
	const sign = n >= 0 ? '+' : '-';
	const abs  = Math.abs(n);
	if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
	if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(2)}K`;
	return `${sign}$${abs.toFixed(2)}`;
}

function fmtPrice(n: number): string {
	if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	if (n >= 1)    return `$${n.toFixed(4)}`;
	return `$${n.toFixed(6)}`;
}

function moverRow(m: TopMover): string {
	const emoji = m.priceChangePct >= 0 ? '🟢' : '🔴';
	return `${emoji} <b>${m.symbol.replace('USDT', '')}</b>  ${fmtPct(m.priceChangePct)}  @ ${fmtPrice(m.currentPrice)}`;
}

/**
 * Format a DailyBriefing as a Telegram HTML message.
 */
export function formatBriefingTelegram(b: DailyBriefing): string {
	const lines: string[] = [
		`<b>📊 BigLot.ai Daily Briefing</b>`,
		`<i>${b.date}</i>`,
		``,
	];

	// Top gainers
	if (b.topGainers.length > 0) {
		lines.push(`<b>🚀 Top Gainers (24h)</b>`);
		for (const m of b.topGainers) lines.push(moverRow(m));
		lines.push('');
	}

	// Top losers
	if (b.topLosers.length > 0) {
		lines.push(`<b>📉 Top Losers (24h)</b>`);
		for (const m of b.topLosers) lines.push(moverRow(m));
		lines.push('');
	}

	// Paper portfolio
	lines.push(`<b>💼 Paper Portfolio</b>`);
	lines.push(`Open trades: <b>${b.openTradeCount}</b>   Closed: <b>${b.closedTradeCount}</b>`);
	lines.push(`Unrealised PnL: <b>${fmtPnL(b.totalUnrealisedPnL)}</b>`);
	lines.push(`Realised PnL:   <b>${fmtPnL(b.totalRealisedPnL)}</b>`);
	if (b.winRate !== null) {
		lines.push(`Win rate: <b>${(b.winRate * 100).toFixed(1)}%</b>`);
	}
	lines.push('');
	lines.push(`<i>Virtual — no real money</i>`);

	return lines.join('\n');
}
