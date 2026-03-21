// Portfolio Tool — portfolio_snapshot, add_position, close_position
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	buildPortfolioSnapshot,
	addPosition,
	closePosition,
	deletePosition,
} from '../portfolio/tracker';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';

const DEFAULT_USER = 'default';

// ─── Helper: fetch current prices for a list of symbols ──────────────────────

async function fetchPriceMap(symbols: string[]): Promise<Map<string, number>> {
	const priceMap = new Map<string, number>();
	await Promise.all(symbols.map(async (symbol) => {
		try {
			const result = await fetchBinanceOHLCV(symbol, '1d', 1);
			if (!('error' in result) && result.ohlcv.length > 0) {
				priceMap.set(symbol.toUpperCase(), result.ohlcv[result.ohlcv.length - 1].close);
			}
		} catch {
			// skip missing price
		}
	}));
	return priceMap;
}

function fmt(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
	if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
	return `$${n.toFixed(2)}`;
}

// ─── portfolio_snapshot ────────────────────────────────────────────────────────

registerTool({
	name: 'portfolio_snapshot',
	description:
		'Show current portfolio: open positions with live PnL, closed trade history, win rate, avg R-multiple, and equity curve. Use when user asks about their portfolio, positions, trades, PnL, performance.',
	parameters: {
		type: 'object',
		properties: {
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")'
			}
		},
		required: []
	},
	timeout: 25_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		const cacheKey = toolCache.generateKey('portfolio_snapshot', { userId });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// Build snapshot — fetch prices for open positions
		const placeholderMap = new Map<string, number>();

		let snapshot;
		try {
			// First get positions to know which symbols to price
			const { listPositions } = await import('../portfolio/tracker');
			const positions = await listPositions(userId);
			const symbols = [...new Set(positions.map(p => p.symbol))];
			const priceMap = symbols.length > 0 ? await fetchPriceMap(symbols) : placeholderMap;
			snapshot = await buildPortfolioSnapshot(userId, priceMap);
		} catch {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to fetch portfolio data.', tool: 'portfolio_snapshot' }],
				textSummary: 'Error: Could not fetch portfolio data.'
			};
		}

		const metrics: { label: string; value: string; direction?: 'up' | 'down' | 'neutral' }[] = [
			{
				label: 'Open Positions',
				value: String(snapshot.positions.length),
				direction: 'neutral'
			},
			{
				label: 'Unrealised P&L',
				value: fmt(snapshot.totalUnrealisedPnL),
				direction: snapshot.totalUnrealisedPnL > 0 ? 'up' : snapshot.totalUnrealisedPnL < 0 ? 'down' : 'neutral'
			},
			{
				label: 'Realised P&L (all time)',
				value: fmt(snapshot.totalRealised),
				direction: snapshot.totalRealised > 0 ? 'up' : snapshot.totalRealised < 0 ? 'down' : 'neutral'
			},
		];

		if (snapshot.winRate !== null) {
			metrics.push({ label: 'Win Rate', value: `${(snapshot.winRate * 100).toFixed(1)}%`, direction: 'neutral' });
		}
		if (snapshot.avgRMultiple !== null) {
			metrics.push({
				label: 'Avg R-Multiple',
				value: snapshot.avgRMultiple.toFixed(2),
				direction: snapshot.avgRMultiple >= 1 ? 'up' : snapshot.avgRMultiple >= 0 ? 'neutral' : 'down'
			});
		}

		const contentBlocks: ToolResult['contentBlocks'] = [{
			type: 'metric_card',
			title: `Portfolio Snapshot — ${new Date().toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`,
			metrics
		}];

		// Open positions table
		if (snapshot.positions.length > 0) {
			const rows: (string | number)[][] = snapshot.positions.map(p => [
				p.symbol,
				p.direction.toUpperCase(),
				p.entryPrice.toFixed(4),
				p.size.toString(),
				p.currentPrice !== null ? p.currentPrice.toFixed(4) : 'N/A',
				p.unrealisedPnLUSD !== null ? fmt(p.unrealisedPnLUSD) : 'N/A',
			]);
			contentBlocks.push({
				type: 'table',
				title: 'Open Positions',
				headers: ['Symbol', 'Side', 'Entry', 'Size', 'Current', 'Unreal. PnL'],
				rows
			});
		}

		// Closed trades table (last 10)
		if (snapshot.closedTrades.length > 0) {
			const rows: (string | number)[][] = snapshot.closedTrades.slice(0, 10).map(t => [
				t.symbol,
				t.direction.toUpperCase(),
				t.entryPrice.toFixed(4),
				t.exitPrice.toFixed(4),
				fmt(t.pnlUSD),
				t.rMultiple !== null ? t.rMultiple.toFixed(2) : 'N/A',
			]);
			contentBlocks.push({
				type: 'table',
				title: 'Recent Trades',
				headers: ['Symbol', 'Side', 'Entry', 'Exit', 'PnL', 'R'],
				rows
			});
		}

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary: `Portfolio: ${snapshot.positions.length} open positions, unrealised ${fmt(snapshot.totalUnrealisedPnL)}, realised ${fmt(snapshot.totalRealised)}${snapshot.winRate !== null ? `, win rate ${(snapshot.winRate * 100).toFixed(1)}%` : ''}${snapshot.avgRMultiple !== null ? `, avg R ${snapshot.avgRMultiple.toFixed(2)}` : ''}.`
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});

// ─── add_position ─────────────────────────────────────────────────────────────

registerTool({
	name: 'add_position',
	description:
		'Add a new open trade position to the portfolio tracker. Use when user says they entered a trade, opened a position, bought/sold something.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading symbol (e.g. BTCUSDT, XAUUSD)'
			},
			direction: {
				type: 'string',
				enum: ['long', 'short'],
				description: 'Trade direction'
			},
			entry_price: {
				type: 'number',
				description: 'Entry price'
			},
			size: {
				type: 'number',
				description: 'Position size in units'
			},
			stop_price: {
				type: 'number',
				description: 'Stop-loss price (optional)'
			},
			target_price: {
				type: 'number',
				description: 'Take-profit target price (optional)'
			},
			notes: {
				type: 'string',
				description: 'Trade notes/rationale (optional)'
			},
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")'
			}
		},
		required: ['symbol', 'direction', 'entry_price', 'size']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		if (!args.symbol || !args.direction || !args.entry_price || !args.size) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Missing required fields: symbol, direction, entry_price, size.', tool: 'add_position' }],
				textSummary: 'Error: Missing required position fields.'
			};
		}

		const position = await addPosition(userId, {
			symbol: String(args.symbol).toUpperCase(),
			direction: args.direction as 'long' | 'short',
			entryPrice: Number(args.entry_price),
			size: Number(args.size),
			stopPrice: args.stop_price !== undefined ? Number(args.stop_price) : null,
			targetPrice: args.target_price !== undefined ? Number(args.target_price) : null,
			notes: typeof args.notes === 'string' ? args.notes : null,
		});

		if (!position) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to save position to database.', tool: 'add_position' }],
				textSummary: 'Error: Could not save position.'
			};
		}

		// Invalidate snapshot cache
		toolCache.set(toolCache.generateKey('portfolio_snapshot', { userId }), null as unknown as ToolResult, 0);

		const riskStr = position.stopPrice
			? ` | Stop: ${position.stopPrice} | Risk: ${fmt(Math.abs(position.entryPrice - position.stopPrice) * position.size)}`
			: '';

		return {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `Position Added — ${position.symbol} ${position.direction.toUpperCase()}`,
				metrics: [
					{ label: 'Symbol', value: position.symbol, direction: 'neutral' },
					{ label: 'Direction', value: position.direction.toUpperCase(), direction: position.direction === 'long' ? 'up' : 'down' },
					{ label: 'Entry Price', value: position.entryPrice.toFixed(4), direction: 'neutral' },
					{ label: 'Size', value: position.size.toString(), direction: 'neutral' },
					{ label: 'Position Value', value: fmt(position.entryPrice * position.size), direction: 'neutral' },
					...(position.stopPrice ? [{ label: 'Stop Price', value: position.stopPrice.toFixed(4), direction: 'down' as const }] : []),
					...(position.targetPrice ? [{ label: 'Target Price', value: position.targetPrice.toFixed(4), direction: 'up' as const }] : []),
				]
			}],
			textSummary: `Added ${position.direction.toUpperCase()} ${position.symbol} @ ${position.entryPrice} × ${position.size} units${riskStr}. ID: ${position.id.slice(0, 8)}.`
		};
	}
});

// ─── close_position ───────────────────────────────────────────────────────────

registerTool({
	name: 'close_position',
	description:
		'Close an open position and record it as a completed trade with PnL and R-multiple. Use when user says they closed a trade, took profit, or hit stop.',
	parameters: {
		type: 'object',
		properties: {
			position_id: {
				type: 'string',
				description: 'Position ID to close (from portfolio_snapshot)'
			},
			exit_price: {
				type: 'number',
				description: 'Exit/close price'
			},
			notes: {
				type: 'string',
				description: 'Closing notes (optional)'
			},
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")'
			}
		},
		required: ['position_id', 'exit_price']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		if (!args.position_id || args.exit_price === undefined) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Missing required fields: position_id, exit_price.', tool: 'close_position' }],
				textSummary: 'Error: Missing position_id or exit_price.'
			};
		}

		const trade = await closePosition(userId, String(args.position_id), Number(args.exit_price), typeof args.notes === 'string' ? args.notes : undefined);

		if (!trade) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Position not found or could not be closed.', tool: 'close_position' }],
				textSummary: 'Error: Could not close position.'
			};
		}

		// Invalidate snapshot cache
		toolCache.set(toolCache.generateKey('portfolio_snapshot', { userId }), null as unknown as ToolResult, 0);

		const pnlDir: 'up' | 'down' | 'neutral' = trade.pnlUSD > 0 ? 'up' : trade.pnlUSD < 0 ? 'down' : 'neutral';

		return {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `Trade Closed — ${trade.symbol} ${trade.direction.toUpperCase()}`,
				metrics: [
					{ label: 'Symbol', value: trade.symbol, direction: 'neutral' },
					{ label: 'Entry → Exit', value: `${trade.entryPrice.toFixed(4)} → ${trade.exitPrice.toFixed(4)}`, direction: 'neutral' },
					{ label: 'P&L', value: fmt(trade.pnlUSD), direction: pnlDir },
					...(trade.rMultiple !== null ? [{ label: 'R-Multiple', value: trade.rMultiple.toFixed(2), direction: pnlDir }] : []),
				]
			}],
			textSummary: `Closed ${trade.direction.toUpperCase()} ${trade.symbol}: entry ${trade.entryPrice} → exit ${trade.exitPrice}, PnL ${fmt(trade.pnlUSD)}${trade.rMultiple !== null ? ` (${trade.rMultiple.toFixed(2)}R)` : ''}.`
		};
	}
});

// ─── delete_position ──────────────────────────────────────────────────────────

registerTool({
	name: 'delete_position',
	description:
		'Delete an open position from the portfolio without recording it as a closed trade. Use when the user made an error or wants to remove a phantom position.',
	parameters: {
		type: 'object',
		properties: {
			position_id: {
				type: 'string',
				description: 'Position ID to delete'
			},
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")'
			}
		},
		required: ['position_id']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const positionId = String(args.position_id);

		const success = await deletePosition(userId, positionId);
		if (!success) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Position not found or could not be deleted.', tool: 'delete_position' }],
				textSummary: 'Error: Could not delete position.'
			};
		}

		toolCache.set(toolCache.generateKey('portfolio_snapshot', { userId }), null as unknown as ToolResult, 0);

		return {
			success: true,
			contentBlocks: [],
			textSummary: `Position ${positionId.slice(0, 8)} deleted from portfolio.`
		};
	}
});
