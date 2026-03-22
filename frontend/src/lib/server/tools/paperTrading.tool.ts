// Paper Trading Tool — T-603
// Tools: paper_buy, paper_sell, paper_portfolio
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	openPaperTrade,
	closePaperTrade,
	listOpenTrades,
	listClosedTrades,
	getOpenTradeBySymbol,
	buildPaperPortfolio,
} from '../paperTrading/paperTrader';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';

const DEFAULT_USER = 'default';

// ─── Price helper ─────────────────────────────────────────────────────────────

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
	try {
		const result = await fetchBinanceOHLCV(symbol.toUpperCase(), '1d', 1);
		if ('error' in result || result.ohlcv.length === 0) return null;
		return result.ohlcv[result.ohlcv.length - 1].close;
	} catch {
		return null;
	}
}

async function fetchPriceMap(symbols: string[]): Promise<Map<string, number>> {
	const map = new Map<string, number>();
	await Promise.all(symbols.map(async sym => {
		const price = await fetchCurrentPrice(sym);
		if (price !== null) map.set(sym.toUpperCase(), price);
	}));
	return map;
}

function fmtPrice(n: number): string {
	if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	if (n >= 1)    return `$${n.toFixed(4)}`;
	return `$${n.toFixed(6)}`;
}

function fmtPnL(n: number): string {
	const sign = n >= 0 ? '+' : '';
	return `${sign}$${n.toFixed(2)}`;
}

// ─── paper_buy ────────────────────────────────────────────────────────────────

registerTool({
	name: 'paper_buy',
	description:
		'Open a virtual long (buy) position in the paper trading sandbox. Fetches current market price and records the trade. Use when user wants to practice buying an asset without real money.',
	parameters: {
		type: 'object',
		properties: {
			symbol:  { type: 'string',  description: 'Trading symbol (e.g. BTCUSDT, ETHUSDT)' },
			qty:     { type: 'number',  description: 'Quantity to buy in base asset (e.g. 0.1 for 0.1 BTC)' },
			notes:   { type: 'string',  description: 'Optional trade notes or rationale' },
			user_id: { type: 'string',  description: 'User ID (defaults to "default")' },
		},
		required: ['symbol', 'qty'],
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol || !args.qty) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'symbol and qty are required.', tool: 'paper_buy' }],
				textSummary: 'Error: symbol and qty are required.'
			};
		}
		const symbol  = String(args.symbol).toUpperCase();
		const qty     = Number(args.qty);
		const userId  = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const notes   = typeof args.notes === 'string' ? args.notes : undefined;

		if (qty <= 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'qty must be greater than 0.', tool: 'paper_buy' }],
				textSummary: 'Error: qty must be positive.'
			};
		}

		const entryPrice = await fetchCurrentPrice(symbol);
		if (entryPrice === null) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `Could not fetch price for ${symbol}.`, tool: 'paper_buy' }],
				textSummary: `Error: Could not fetch price for ${symbol}.`
			};
		}

		const trade = await openPaperTrade(userId, symbol, 'long', qty, entryPrice, notes);
		if (!trade) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to record trade in database.', tool: 'paper_buy' }],
				textSummary: 'Error: Could not save trade.'
			};
		}

		const totalValue = qty * entryPrice;

		return {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `Paper Buy — ${symbol}`,
				metrics: [
					{ label: 'Action',       value: 'BUY (Long)',     direction: 'up'     },
					{ label: 'Symbol',       value: symbol,           direction: 'neutral' },
					{ label: 'Quantity',     value: String(qty),      direction: 'neutral' },
					{ label: 'Entry Price',  value: fmtPrice(entryPrice), direction: 'neutral' },
					{ label: 'Total Value',  value: fmtPrice(totalValue), direction: 'neutral' },
					{ label: 'Trade ID',     value: trade.id.slice(0, 8) + '…', direction: 'neutral' },
				],
			}],
			textSummary: `Paper buy: ${qty} ${symbol} at ${fmtPrice(entryPrice)} (total ${fmtPrice(totalValue)}). Trade ID: ${trade.id}.`,
		};
	},
});

// ─── paper_sell ───────────────────────────────────────────────────────────────

registerTool({
	name: 'paper_sell',
	description:
		'Close an open paper trade or open a virtual short (sell) position. If trade_id is provided, closes that trade. If symbol is provided, closes the most recent open long for that symbol. Otherwise opens a new short position.',
	parameters: {
		type: 'object',
		properties: {
			symbol:   { type: 'string', description: 'Symbol to sell/close (e.g. BTCUSDT)' },
			qty:      { type: 'number', description: 'Quantity for new short position (ignored when closing an existing trade)' },
			trade_id: { type: 'string', description: 'Trade ID to close (from paper_buy)' },
			notes:    { type: 'string', description: 'Optional notes' },
			user_id:  { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: [],
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const userId   = typeof args.user_id  === 'string' ? args.user_id : DEFAULT_USER;
		const symbol   = typeof args.symbol   === 'string' ? args.symbol.toUpperCase() : undefined;
		const tradeId  = typeof args.trade_id === 'string' ? args.trade_id : undefined;
		const notes    = typeof args.notes    === 'string' ? args.notes : undefined;

		// ── Case 1: close by trade_id ──
		if (tradeId) {
			const currentPrice = symbol ? await fetchCurrentPrice(symbol) : null;
			if (currentPrice === null && symbol) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch price for ${symbol}.`, tool: 'paper_sell' }],
					textSummary: `Error: could not fetch price.`
				};
			}
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Provide symbol when closing by trade_id so we can fetch the exit price.', tool: 'paper_sell' }],
					textSummary: 'Error: symbol required when closing by trade_id.'
				};
			}
			const closed = await closePaperTrade(userId, tradeId, currentPrice);
			if (!closed) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Trade ${tradeId} not found or already closed.`, tool: 'paper_sell' }],
					textSummary: 'Error: trade not found.'
				};
			}
			return {
				success: true,
				contentBlocks: [{
					type: 'metric_card',
					title: `Paper Sell — ${closed.symbol}`,
					metrics: [
						{ label: 'Action',      value: 'SELL (Close Long)', direction: 'down'    },
						{ label: 'Symbol',      value: closed.symbol,       direction: 'neutral'  },
						{ label: 'Quantity',    value: String(closed.qty),  direction: 'neutral'  },
						{ label: 'Entry Price', value: fmtPrice(closed.entryPrice), direction: 'neutral' },
						{ label: 'Exit Price',  value: fmtPrice(currentPrice),      direction: 'neutral' },
						{ label: 'Realised PnL',value: fmtPnL(closed.pnl ?? 0),    direction: (closed.pnl ?? 0) >= 0 ? 'up' : 'down' },
					],
				}],
				textSummary: `Closed paper trade: ${closed.qty} ${closed.symbol}. Entry: ${fmtPrice(closed.entryPrice)}, Exit: ${fmtPrice(currentPrice)}, PnL: ${fmtPnL(closed.pnl ?? 0)}.`,
			};
		}

		// ── Case 2: close most recent long for symbol ──
		if (symbol) {
			const openTrade = await getOpenTradeBySymbol(userId, symbol);
			if (openTrade) {
				const exitPrice = await fetchCurrentPrice(symbol);
				if (exitPrice === null) {
					return {
						success: false,
						contentBlocks: [{ type: 'error', message: `Could not fetch price for ${symbol}.`, tool: 'paper_sell' }],
						textSummary: `Error: could not fetch price for ${symbol}.`
					};
				}
				const closed = await closePaperTrade(userId, openTrade.id, exitPrice);
				if (!closed) {
					return {
						success: false,
						contentBlocks: [{ type: 'error', message: 'Failed to close trade.', tool: 'paper_sell' }],
						textSummary: 'Error: could not close trade.'
					};
				}
				return {
					success: true,
					contentBlocks: [{
						type: 'metric_card',
						title: `Paper Sell — ${symbol}`,
						metrics: [
							{ label: 'Action',      value: 'SELL (Close Long)', direction: 'down'     },
							{ label: 'Symbol',      value: symbol,              direction: 'neutral'   },
							{ label: 'Quantity',    value: String(closed.qty),  direction: 'neutral'   },
							{ label: 'Entry Price', value: fmtPrice(closed.entryPrice), direction: 'neutral' },
							{ label: 'Exit Price',  value: fmtPrice(exitPrice),          direction: 'neutral' },
							{ label: 'Realised PnL',value: fmtPnL(closed.pnl ?? 0),    direction: (closed.pnl ?? 0) >= 0 ? 'up' : 'down' },
						],
					}],
					textSummary: `Closed paper trade: ${closed.qty} ${symbol}. PnL: ${fmtPnL(closed.pnl ?? 0)}.`,
				};
			}

			// No open long — open a short instead
			const qty = typeof args.qty === 'number' && args.qty > 0 ? args.qty : 1;
			const entryPrice = await fetchCurrentPrice(symbol);
			if (entryPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch price for ${symbol}.`, tool: 'paper_sell' }],
					textSummary: `Error: could not fetch price.`
				};
			}
			const trade = await openPaperTrade(userId, symbol, 'short', qty, entryPrice, notes);
			if (!trade) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Failed to record short trade.', tool: 'paper_sell' }],
					textSummary: 'Error: could not save trade.'
				};
			}
			return {
				success: true,
				contentBlocks: [{
					type: 'metric_card',
					title: `Paper Short — ${symbol}`,
					metrics: [
						{ label: 'Action',      value: 'SHORT (Sell)',    direction: 'down'    },
						{ label: 'Symbol',      value: symbol,            direction: 'neutral'  },
						{ label: 'Quantity',    value: String(qty),       direction: 'neutral'  },
						{ label: 'Entry Price', value: fmtPrice(entryPrice), direction: 'neutral' },
						{ label: 'Trade ID',    value: trade.id.slice(0, 8) + '…', direction: 'neutral' },
					],
				}],
				textSummary: `Paper short: ${qty} ${symbol} at ${fmtPrice(entryPrice)}. Trade ID: ${trade.id}.`,
			};
		}

		return {
			success: false,
			contentBlocks: [{ type: 'error', message: 'Provide symbol or trade_id to sell.', tool: 'paper_sell' }],
			textSummary: 'Error: symbol or trade_id required.'
		};
	},
});

// ─── paper_portfolio ──────────────────────────────────────────────────────────

registerTool({
	name: 'paper_portfolio',
	description:
		'Show the paper trading portfolio: open virtual positions with live P&L, closed trade history, win rate, and total P&L. Use when user asks about their paper trades, virtual portfolio, or simulation performance.',
	parameters: {
		type: 'object',
		properties: {
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: [],
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		const cacheKey = toolCache.generateKey('paper_portfolio', { userId });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const [openTrades, closedTrades] = await Promise.all([
			listOpenTrades(userId),
			listClosedTrades(userId),
		]);

		const symbols = [...new Set(openTrades.map(t => t.symbol))];
		const priceMap = symbols.length > 0 ? await fetchPriceMap(symbols) : new Map<string, number>();
		const snap = buildPaperPortfolio(openTrades, priceMap, closedTrades);

		const contentBlocks: ToolResult['contentBlocks'] = [];

		// ── Summary metric card ──
		const winRateStr = snap.winRate !== null ? `${(snap.winRate * 100).toFixed(0)}%` : 'N/A';
		contentBlocks.push({
			type: 'metric_card',
			title: 'Paper Portfolio Summary',
			metrics: [
				{ label: 'Open Positions',   value: String(snap.openCount),         direction: 'neutral' },
				{ label: 'Closed Trades',    value: String(snap.tradeCount),         direction: 'neutral' },
				{ label: 'Unrealised PnL',   value: fmtPnL(snap.totalUnrealisedPnL), direction: snap.totalUnrealisedPnL >= 0 ? 'up' : 'down' },
				{ label: 'Realised PnL',     value: fmtPnL(snap.totalRealisedPnL),   direction: snap.totalRealisedPnL >= 0 ? 'up' : 'down'   },
				{ label: 'Win Rate',         value: winRateStr,                      direction: 'neutral' },
			],
		});

		// ── Open positions table ──
		if (snap.openTrades.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Open Positions',
				headers: ['Symbol', 'Side', 'Qty', 'Entry', 'Current', 'P&L', 'P&L %'],
				rows: snap.openTrades.map(t => [
					t.symbol,
					t.side.toUpperCase(),
					String(t.qty),
					fmtPrice(t.entryPrice),
					fmtPrice(t.currentPrice),
					fmtPnL(t.unrealisedPnL),
					`${t.unrealisedPct >= 0 ? '+' : ''}${t.unrealisedPct.toFixed(2)}%`,
				]),
			});
		}

		// ── Closed trades table (last 10) ──
		if (snap.closedTrades.length > 0) {
			contentBlocks.push({
				type: 'table',
				title: 'Recent Closed Trades',
				headers: ['Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'PnL'],
				rows: snap.closedTrades.slice(0, 10).map(t => [
					t.symbol,
					t.side.toUpperCase(),
					String(t.qty),
					fmtPrice(t.entryPrice),
					t.exitPrice !== null ? fmtPrice(t.exitPrice) : '—',
					t.pnl !== null ? fmtPnL(t.pnl) : '—',
				]),
			});
		}

		if (snap.openCount === 0 && snap.tradeCount === 0) {
			contentBlocks.push({
				type: 'metric_card',
				title: 'No Paper Trades Yet',
				metrics: [{ label: 'Use paper_buy to open your first virtual trade', value: 'e.g. paper buy 0.1 BTC', direction: 'neutral' }],
			});
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Paper portfolio: ${snap.openCount} open, ${snap.tradeCount} closed. Unrealised: ${fmtPnL(snap.totalUnrealisedPnL)}, Realised: ${fmtPnL(snap.totalRealisedPnL)}. Win rate: ${winRateStr}.`,
		};

		toolCache.set(cacheKey, result, 60_000); // 1 min cache
		return result;
	},
});
