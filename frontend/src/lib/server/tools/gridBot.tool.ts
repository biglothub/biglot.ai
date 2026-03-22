// Grid Bot Engine Tool — T-1204
// Tool: manage_grid_bot
// Paper grid bot for ranging markets: create/list/delete/status/run_now

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import { analyzeRegime, regimeLabel } from '../indicators/regime';
import { openPaperTrade } from '../paperTrading/paperTrader';
import {
	isValidGridConfig,
	calcGridLevels,
	detectGridCrossings,
	calcGridProfit,
	calcAmountPerGrid,
	calcGridSpacingAbs,
	calcGridPerformance,
	countCompletedCycles,
	describeGridBot,
	mapGridBotRow,
	mapGridExecutionRow,
	type GridBot,
	type GridExecution,
	type GridBotRow,
	type GridExecutionRow,
	type CreateGridBotInput,
} from '../data/gridBot.data';
import type { MetricCardBlock, TableBlock, TextBlock } from '$lib/types/contentBlock';

const DEFAULT_USER = 'default';

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmtUSD(n: number): string {
	return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number): string {
	const sign = n >= 0 ? '+' : '';
	return `${sign}${n.toFixed(2)}%`;
}

function fmtPrice(n: number): string {
	if (n >= 1000) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	if (n >= 1)    return `$${n.toFixed(4)}`;
	return `$${n.toFixed(6)}`;
}

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function dbCreateBot(input: CreateGridBotInput & { userId: string; initialPrice: number }): Promise<GridBot | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('grid_bots')
		.insert({
			user_id:           input.userId,
			symbol:            input.symbol.toUpperCase(),
			upper_price:       input.upperPrice,
			lower_price:       input.lowerPrice,
			grid_levels:       input.gridLevels,
			investment_amount: input.investmentAmount,
			active:            true,
			last_price:        input.initialPrice,
			total_profit:      0,
			fill_count:        0,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapGridBotRow(data as GridBotRow);
}

async function dbListBots(userId: string, includeInactive = false): Promise<GridBot[]> {
	const db = getSupabaseAdminClient();
	let q = db.from('grid_bots').select().eq('user_id', userId);
	if (!includeInactive) q = (q as typeof q).eq('active', true);
	const { data, error } = await (q as typeof q).order('created_at', { ascending: false });
	if (error || !data) return [];
	return (data as GridBotRow[]).map(mapGridBotRow);
}

async function dbGetBot(userId: string, botId: string): Promise<GridBot | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('grid_bots')
		.select()
		.eq('id', botId)
		.eq('user_id', userId)
		.single();
	if (error || !data) return null;
	return mapGridBotRow(data as GridBotRow);
}

async function dbDeleteBot(userId: string, botId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('grid_bots')
		.delete()
		.eq('id', botId)
		.eq('user_id', userId);
	return !error;
}

async function dbGetExecutions(botId: string, userId: string): Promise<GridExecution[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('grid_executions')
		.select()
		.eq('bot_id', botId)
		.eq('user_id', userId)
		.order('executed_at', { ascending: true });
	if (error || !data) return [];
	return (data as GridExecutionRow[]).map(mapGridExecutionRow);
}

async function dbRecordExecution(
	botId: string,
	userId: string,
	symbol: string,
	levelIndex: number,
	levelPrice: number,
	execType: 'buy' | 'sell',
	qty: number,
	amount: number,
	profit: number
): Promise<GridExecution | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('grid_executions')
		.insert({
			bot_id:      botId,
			user_id:     userId,
			symbol:      symbol.toUpperCase(),
			level_index: levelIndex,
			level_price: levelPrice,
			exec_type:   execType,
			qty,
			amount,
			profit,
		})
		.select()
		.single();
	if (error || !data) return null;
	return mapGridExecutionRow(data as GridExecutionRow);
}

async function dbUpdateBotStats(
	botId: string,
	userId: string,
	lastPrice: number,
	totalProfit: number,
	fillCount: number
): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('grid_bots')
		.update({ last_price: lastPrice, total_profit: totalProfit, fill_count: fillCount })
		.eq('id', botId)
		.eq('user_id', userId);
}

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

// ─── Regime warning ───────────────────────────────────────────────────────────

async function buildRegimeWarning(symbol: string): Promise<string | null> {
	try {
		const fetchResult = await fetchBinanceOHLCV(symbol.toUpperCase(), '1d', 100);
		if ('error' in fetchResult || fetchResult.ohlcv.length < 40) return null;
		const analysis = analyzeRegime(fetchResult.ohlcv);
		if (!analysis) return null;
		if (analysis.regime === 'trending_up' || analysis.regime === 'trending_down') {
			return `**Regime Warning:** ${symbol} is currently in a **${regimeLabel(analysis.regime)}** regime (ADX ${analysis.adxValue.toFixed(1)}, confidence ${analysis.confidence}%). Grid bots perform best in ranging markets. Consider waiting for consolidation before deploying this bot.`;
		}
		if (analysis.regime === 'high_volatility') {
			return `**Regime Note:** ${symbol} is in a **High Volatility** regime (ATR ${analysis.atrRatio.toFixed(2)}% of price). Grid bots can still work but expect wider-than-usual candles — ensure your grid range covers the volatility.`;
		}
		return null;
	} catch {
		return null;
	}
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'manage_grid_bot',
	description:
		'Manage paper grid trading bots for ranging markets. Actions: create (configure a new grid bot with price range, grid levels, and investment), list (all active bots with performance), delete (remove a bot), status (detailed view with grid levels table and performance), run_now (simulate grid fills based on current price movement). Grid bots place virtual buy orders below price and sell orders above. Warns if market regime is trending (grid bots underperform in trends). Returns MetricCard (grid profit, fill rate, est APY) + TableBlock (grid levels with status) + TextBlock (regime warning if trending).',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['create', 'list', 'delete', 'status', 'run_now'],
				description: 'Action to perform',
			},
			// create
			symbol: {
				type: 'string',
				description: 'Trading symbol, e.g. BTCUSDT, ETHUSDT',
			},
			upper_price: {
				type: 'number',
				description: 'Upper price boundary of the grid range',
			},
			lower_price: {
				type: 'number',
				description: 'Lower price boundary of the grid range',
			},
			grid_levels: {
				type: 'number',
				description: 'Number of grid intervals (2–100). E.g. 10 = 10 buy/sell zones with 11 price points',
			},
			investment_amount: {
				type: 'number',
				description: 'Total USDT to allocate across all grids',
			},
			// delete / status / run_now
			bot_id: {
				type: 'string',
				description: 'Bot ID (from list or create)',
			},
			// shared
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default")',
			},
			include_inactive: {
				type: 'boolean',
				description: 'Include inactive bots in list (default false)',
			},
		},
		required: ['action'],
	},
	timeout: 30_000,
	execute: async (args): Promise<ToolResult> => {
		const action = String(args.action ?? '');
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		// ── CREATE ──────────────────────────────────────────────────────────
		if (action === 'create') {
			const symbol = typeof args.symbol === 'string' ? args.symbol.toUpperCase() : '';
			const upperPrice = typeof args.upper_price === 'number' ? args.upper_price : 0;
			const lowerPrice = typeof args.lower_price === 'number' ? args.lower_price : 0;
			const gridLevels = typeof args.grid_levels === 'number' ? Math.round(args.grid_levels) : 0;
			const investmentAmount = typeof args.investment_amount === 'number' ? args.investment_amount : 0;

			if (!symbol) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: symbol required.',
				};
			}

			const validation = isValidGridConfig(upperPrice, lowerPrice, gridLevels, investmentAmount);
			if (!validation.valid) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: validation.error ?? 'Invalid grid config.', tool: 'manage_grid_bot' }],
					textSummary: `Error: ${validation.error}`,
				};
			}

			// Fetch current price to use as reference for side labelling
			const currentPrice = await fetchCurrentPrice(symbol);
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch current price for ${symbol}.`, tool: 'manage_grid_bot' }],
					textSummary: `Error: Could not fetch price for ${symbol}.`,
				};
			}

			// Warn if current price is outside the grid range
			if (currentPrice < lowerPrice || currentPrice > upperPrice) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Current price ${fmtPrice(currentPrice)} is outside the grid range [${fmtPrice(lowerPrice)} – ${fmtPrice(upperPrice)}]. Adjust your range to include the current price.`, tool: 'manage_grid_bot' }],
					textSummary: `Error: current price outside grid range.`,
				};
			}

			const input: CreateGridBotInput = { symbol, upperPrice, lowerPrice, gridLevels, investmentAmount };
			const bot = await dbCreateBot({ ...input, userId, initialPrice: currentPrice });
			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Failed to create grid bot. Make sure the grid_bots table exists in Supabase.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: Could not create grid bot.',
				};
			}

			const spacingAbs = calcGridSpacingAbs(lowerPrice, upperPrice, gridLevels);
			const amountPerGrid = calcAmountPerGrid(investmentAmount, gridLevels);
			const contentBlocks: ToolResult['contentBlocks'] = [];

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Grid Bot Created — ${bot.symbol}`,
				metrics: [
					{ label: 'Symbol',         value: bot.symbol,                               direction: 'neutral' },
					{ label: 'Range',           value: `${fmtPrice(lowerPrice)} – ${fmtPrice(upperPrice)}`, direction: 'neutral' },
					{ label: 'Grid Levels',     value: String(gridLevels),                       direction: 'neutral' },
					{ label: 'Grid Spacing',    value: fmtPrice(spacingAbs),                     direction: 'neutral' },
					{ label: 'Total Investment', value: fmtUSD(investmentAmount),                direction: 'neutral' },
					{ label: 'Per Grid',        value: fmtUSD(amountPerGrid),                    direction: 'neutral' },
					{ label: 'Current Price',   value: fmtPrice(currentPrice),                   direction: 'neutral' },
					{ label: 'Status',          value: 'Active',                                 direction: 'neutral' },
				],
			};
			contentBlocks.push(metricCard);

			// Regime warning on create
			const regimeWarn = await buildRegimeWarning(symbol);
			if (regimeWarn) {
				const warnBlock: TextBlock = { type: 'text', content: regimeWarn };
				contentBlocks.push(warnBlock);
			}

			return {
				success: true,
				contentBlocks,
				textSummary: `Grid bot created: ${describeGridBot(bot)}. Grid spacing: ${fmtPrice(spacingAbs)}, $${amountPerGrid.toFixed(2)}/grid. Use run_now to simulate fills. ID: ${bot.id.slice(0, 8)}.`,
			};
		}

		// ── LIST ────────────────────────────────────────────────────────────
		if (action === 'list') {
			const includeInactive = args.include_inactive === true;
			const cacheKey = toolCache.generateKey('manage_grid_bot_list', { userId, includeInactive });
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const bots = await dbListBots(userId, includeInactive);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: 'Grid Bots Summary',
				metrics: [
					{ label: 'Active Bots', value: String(bots.filter((b) => b.active).length), direction: 'neutral' },
					{ label: 'Total Bots',  value: String(bots.length),                         direction: 'neutral' },
				],
			};

			if (bots.length === 0) {
				return {
					success: true,
					contentBlocks: [metricCard],
					textSummary: 'No grid bots. Use manage_grid_bot with action=create to set one up.',
				};
			}

			const tableBlock: TableBlock = {
				type: 'table',
				title: `Grid Bots (${bots.length})`,
				headers: ['Symbol', 'Range', 'Grids', 'Investment', 'Profit', 'Fills', 'Status'],
				rows: bots.map((b) => [
					b.symbol,
					`${fmtPrice(b.lowerPrice)}–${fmtPrice(b.upperPrice)}`,
					String(b.gridLevels),
					fmtUSD(b.investmentAmount),
					fmtUSD(b.totalProfit),
					String(b.fillCount),
					b.active ? 'Active' : 'Inactive',
				]),
			};

			const result: ToolResult = {
				success: true,
				contentBlocks: [metricCard, tableBlock],
				textSummary: `${bots.length} grid bot(s): ${bots.map((b) => describeGridBot(b)).join(' | ')}.`,
			};
			toolCache.set(cacheKey, result, 60_000);
			return result;
		}

		// ── DELETE ──────────────────────────────────────────────────────────
		if (action === 'delete') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for delete.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}
			const ok = await dbDeleteBot(userId, String(args.bot_id));
			if (!ok) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found or could not be deleted.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: Could not delete bot.',
				};
			}
			toolCache.set(toolCache.generateKey('manage_grid_bot_list', { userId, includeInactive: false }), null as unknown as ToolResult, 0);
			return {
				success: true,
				contentBlocks: [],
				textSummary: `Grid bot ${String(args.bot_id).slice(0, 8)} deleted.`,
			};
		}

		// ── STATUS ──────────────────────────────────────────────────────────
		if (action === 'status') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for status.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}

			const cacheKey = toolCache.generateKey('manage_grid_bot_status', { userId, botId: args.bot_id });
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const [bot, executions] = await Promise.all([
				dbGetBot(userId, String(args.bot_id)),
				dbGetExecutions(String(args.bot_id), userId),
			]);

			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: Bot not found.',
				};
			}

			const currentPrice = await fetchCurrentPrice(bot.symbol);
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch current price for ${bot.symbol}.`, tool: 'manage_grid_bot' }],
					textSummary: `Error: Could not fetch price for ${bot.symbol}.`,
				};
			}

			const perf = calcGridPerformance(bot, executions);
			const levels = calcGridLevels(bot.lowerPrice, bot.upperPrice, bot.gridLevels, currentPrice);
			const contentBlocks: ToolResult['contentBlocks'] = [];

			// Performance metric card
			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Grid Bot Status — ${bot.symbol}`,
				metrics: [
					{ label: 'Symbol',          value: bot.symbol,                                            direction: 'neutral' },
					{ label: 'Range',           value: `${fmtPrice(bot.lowerPrice)} – ${fmtPrice(bot.upperPrice)}`, direction: 'neutral' },
					{ label: 'Grid Levels',     value: String(bot.gridLevels),                                direction: 'neutral' },
					{ label: 'Grid Spacing',    value: fmtPrice(perf.gridSpacingAbs),                         direction: 'neutral' },
					{ label: 'Spacing %',       value: fmtPct(perf.gridSpacing),                              direction: 'neutral' },
					{ label: 'Investment',      value: fmtUSD(bot.investmentAmount),                          direction: 'neutral' },
					{ label: 'Per Grid',        value: fmtUSD(perf.amountPerGrid),                            direction: 'neutral' },
					{ label: 'Current Price',   value: fmtPrice(currentPrice),                                direction: 'neutral' },
					{ label: 'Total Profit',    value: fmtUSD(perf.totalProfit),   direction: perf.totalProfit >= 0 ? 'up' : 'down' },
					{ label: 'Fill Count',      value: String(perf.fillCount),                                direction: 'neutral' },
					{ label: 'Completed Cycles', value: String(perf.completedCycles),                        direction: 'neutral' },
					{ label: 'Fill Rate',       value: fmtPct(perf.fillRate * 100),                           direction: 'neutral' },
					{ label: 'Est. APY',        value: perf.estimatedAPY > 0 ? fmtPct(perf.estimatedAPY) : 'N/A', direction: perf.estimatedAPY > 0 ? 'up' : 'neutral' },
					{ label: 'Status',          value: bot.active ? 'Active' : 'Paused',                     direction: 'neutral' },
				],
			};
			contentBlocks.push(metricCard);

			// Grid levels table
			const tableBlock: TableBlock = {
				type: 'table',
				title: `Grid Levels (${levels.length})`,
				headers: ['#', 'Price', 'Side', 'Status', 'Distance'],
				rows: levels.map((level) => {
					const distancePct = currentPrice > 0
						? ((level.price - currentPrice) / currentPrice) * 100
						: 0;
					const distStr = distancePct >= 0
						? `+${distancePct.toFixed(2)}%`
						: `${distancePct.toFixed(2)}%`;
					const status = Math.abs(level.price - currentPrice) < perf.gridSpacingAbs * 0.05
						? 'Active Zone'
						: level.status;
					return [
						String(level.index),
						fmtPrice(level.price),
						level.side === 'buy' ? 'Buy' : 'Sell',
						status,
						distStr,
					];
				}),
			};
			contentBlocks.push(tableBlock);

			// Regime warning
			const regimeWarn = await buildRegimeWarning(bot.symbol);
			if (regimeWarn) {
				contentBlocks.push({ type: 'text', content: regimeWarn });
			}

			const result: ToolResult = {
				success: true,
				contentBlocks,
				textSummary: `Grid bot ${bot.symbol}: ${perf.fillCount} fills, ${perf.completedCycles} completed cycles, profit ${fmtUSD(perf.totalProfit)}, fill rate ${fmtPct(perf.fillRate * 100)}, est APY ${perf.estimatedAPY > 0 ? fmtPct(perf.estimatedAPY) : 'N/A'}.`,
			};
			toolCache.set(cacheKey, result, 60_000);
			return result;
		}

		// ── RUN_NOW ─────────────────────────────────────────────────────────
		if (action === 'run_now') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for run_now.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}

			const bot = await dbGetBot(userId, String(args.bot_id));
			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: Bot not found.',
				};
			}
			if (!bot.active) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot is inactive.', tool: 'manage_grid_bot' }],
					textSummary: 'Error: Bot is inactive.',
				};
			}

			const currentPrice = await fetchCurrentPrice(bot.symbol);
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch price for ${bot.symbol}.`, tool: 'manage_grid_bot' }],
					textSummary: `Error: Could not fetch price for ${bot.symbol}.`,
				};
			}

			// If no last price, initialise and return (first run establishes position)
			if (bot.lastPrice === null) {
				await dbUpdateBotStats(bot.id, userId, currentPrice, 0, 0);
				return {
					success: true,
					contentBlocks: [{
						type: 'metric_card',
						title: `Grid Bot Initialised — ${bot.symbol}`,
						metrics: [
							{ label: 'Symbol',       value: bot.symbol,              direction: 'neutral' },
							{ label: 'Init Price',   value: fmtPrice(currentPrice),  direction: 'neutral' },
							{ label: 'Note',         value: 'Call run_now again to simulate fills after price moves.', direction: 'neutral' },
						],
					} satisfies MetricCardBlock],
					textSummary: `Grid bot ${bot.symbol} initialised at ${fmtPrice(currentPrice)}. Call run_now again after price moves to simulate fills.`,
				};
			}

			const lastPrice = bot.lastPrice;
			const levels = calcGridLevels(bot.lowerPrice, bot.upperPrice, bot.gridLevels, lastPrice);
			const crossed = detectGridCrossings(levels, lastPrice, currentPrice);

			if (crossed.length === 0) {
				return {
					success: true,
					contentBlocks: [{
						type: 'metric_card',
						title: `No Grid Fills — ${bot.symbol}`,
						metrics: [
							{ label: 'Last Price',    value: fmtPrice(lastPrice),    direction: 'neutral' },
							{ label: 'Current Price', value: fmtPrice(currentPrice), direction: 'neutral' },
							{ label: 'Grids Crossed', value: '0',                   direction: 'neutral' },
							{ label: 'Tip',           value: 'Price has not crossed any grid level since last run.', direction: 'neutral' },
						],
					} satisfies MetricCardBlock],
					textSummary: `No grid fills for ${bot.symbol}. Price moved from ${fmtPrice(lastPrice)} to ${fmtPrice(currentPrice)} — no grid levels crossed.`,
				};
			}

			const spacingAbs = calcGridSpacingAbs(bot.lowerPrice, bot.upperPrice, bot.gridLevels);
			const amountPerGrid = calcAmountPerGrid(bot.investmentAmount, bot.gridLevels);
			let newProfit = bot.totalProfit;
			let newFillCount = bot.fillCount;
			const fillRows: (string | number)[][] = [];

			// Process each crossed level
			for (const level of crossed) {
				const qty = level.price > 0 ? amountPerGrid / level.price : 0;
				const profit = level.side === 'sell' ? calcGridProfit(qty, spacingAbs) : 0;

				await dbRecordExecution(
					bot.id, userId, bot.symbol,
					level.index, level.price,
					level.side, qty, amountPerGrid, profit
				);

				// Also open a paper trade for portfolio tracking (buy fills only)
				if (level.side === 'buy') {
					await openPaperTrade(
						userId, bot.symbol, 'long', qty, level.price,
						`Grid buy at ${fmtPrice(level.price)} — bot ${bot.id.slice(0, 8)}`
					);
				}

				newProfit += profit;
				newFillCount += 1;

				fillRows.push([
					String(level.index),
					fmtPrice(level.price),
					level.side === 'buy' ? 'Buy' : 'Sell',
					qty.toFixed(6),
					fmtUSD(amountPerGrid),
					profit > 0 ? fmtUSD(profit) : '—',
				]);
			}

			await dbUpdateBotStats(bot.id, userId, currentPrice, newProfit, newFillCount);

			// Invalidate caches
			toolCache.set(toolCache.generateKey('manage_grid_bot_list', { userId, includeInactive: false }), null as unknown as ToolResult, 0);
			toolCache.set(toolCache.generateKey('manage_grid_bot_status', { userId, botId: bot.id }), null as unknown as ToolResult, 0);

			const completedCycles = crossed.filter((l) => l.side === 'sell').length;
			const cycleProfit = newProfit - bot.totalProfit;

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Grid Fills Executed — ${bot.symbol}`,
				metrics: [
					{ label: 'Grids Filled',     value: String(crossed.length),    direction: 'neutral' },
					{ label: 'Symbol',            value: bot.symbol,                direction: 'neutral' },
					{ label: 'Last Price',        value: fmtPrice(lastPrice),       direction: 'neutral' },
					{ label: 'Current Price',     value: fmtPrice(currentPrice),    direction: 'neutral' },
					{ label: 'Completed Cycles',  value: String(completedCycles),   direction: completedCycles > 0 ? 'up' : 'neutral' },
					{ label: 'Cycle Profit',      value: fmtUSD(cycleProfit),       direction: cycleProfit > 0 ? 'up' : 'neutral' },
					{ label: 'Total Profit',      value: fmtUSD(newProfit),         direction: newProfit >= 0 ? 'up' : 'down' },
					{ label: 'Total Fill Count',  value: String(newFillCount),      direction: 'neutral' },
				],
			};

			const tableBlock: TableBlock = {
				type: 'table',
				title: `Fills This Run (${crossed.length})`,
				headers: ['Grid #', 'Price', 'Side', 'Qty', 'Amount', 'Profit'],
				rows: fillRows,
			};

			const contentBlocks: ToolResult['contentBlocks'] = [metricCard, tableBlock];

			// Regime warning
			const regimeWarn = await buildRegimeWarning(bot.symbol);
			if (regimeWarn) {
				contentBlocks.push({ type: 'text', content: regimeWarn });
			}

			return {
				success: true,
				contentBlocks,
				textSummary: `Grid bot ${bot.symbol}: ${crossed.length} grid(s) filled. ${completedCycles} completed cycle(s). Cycle profit: ${fmtUSD(cycleProfit)}. Total profit: ${fmtUSD(newProfit)}. Total fills: ${newFillCount}.`,
			};
		}

		// ── Unknown action ─────────────────────────────────────────────────
		return {
			success: false,
			contentBlocks: [{ type: 'error', message: `Unknown action: ${action}. Use create, list, delete, status, or run_now.`, tool: 'manage_grid_bot' }],
			textSummary: `Error: unknown action "${action}".`,
		};
	},
});
