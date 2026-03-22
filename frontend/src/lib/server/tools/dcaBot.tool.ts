// DCA Bot Engine Tool — T-1203
// Tool: manage_dca_bot
// Paper Dollar-Cost Averaging: create/list/delete/status/run_now

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { fetchBinanceOHLCV } from '../data/ohlcvProvider';
import { sma } from '../indicators/engine';
import { openPaperTrade } from '../paperTrading/paperTrader';
import {
	isValidDcaInterval,
	mapDcaBotRow,
	mapDcaExecutionRow,
	calcDcaPerformance,
	calcNextExecution,
	isDipCondition,
	describeDcaBot,
	formatInterval,
	buildEquityCurve,
	type DcaBot,
	type DcaExecution,
	type DcaBotRow,
	type DcaExecutionRow,
	type CreateDcaBotInput,
} from '../data/dcaBot.data';
import type { MetricCardBlock, TableBlock, ChartBlock, OHLCV } from '$lib/types/contentBlock';

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

async function dbCreateBot(input: CreateDcaBotInput & { userId: string }): Promise<DcaBot | null> {
	const db = getSupabaseAdminClient();
	const nextAt = calcNextExecution(input.interval).toISOString();

	const { data, error } = await db
		.from('dca_bots')
		.insert({
			user_id:              input.userId,
			symbol:               input.symbol.toUpperCase(),
			amount_per_interval:  input.amountPerInterval,
			interval:             input.interval,
			dip_multiplier:       input.dipMultiplier ?? null,
			dip_ma_length:        input.dipMaLength ?? null,
			dip_threshold_pct:    input.dipThresholdPct ?? null,
			active:               true,
			next_execution_at:    nextAt,
			last_execution_at:    null,
			total_invested:       0,
			execution_count:      0,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapDcaBotRow(data as DcaBotRow);
}

async function dbListBots(userId: string, includeInactive = false): Promise<DcaBot[]> {
	const db = getSupabaseAdminClient();
	let q = db.from('dca_bots').select().eq('user_id', userId);
	if (!includeInactive) q = (q as typeof q).eq('active', true);
	const { data, error } = await (q as typeof q).order('created_at', { ascending: false });
	if (error || !data) return [];
	return (data as DcaBotRow[]).map(mapDcaBotRow);
}

async function dbGetBot(userId: string, botId: string): Promise<DcaBot | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('dca_bots')
		.select()
		.eq('id', botId)
		.eq('user_id', userId)
		.single();
	if (error || !data) return null;
	return mapDcaBotRow(data as DcaBotRow);
}

async function dbDeleteBot(userId: string, botId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('dca_bots')
		.delete()
		.eq('id', botId)
		.eq('user_id', userId);
	return !error;
}

async function dbGetExecutions(userId: string, botId: string): Promise<DcaExecution[]> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('dca_executions')
		.select()
		.eq('bot_id', botId)
		.eq('user_id', userId)
		.order('executed_at', { ascending: true });
	if (error || !data) return [];
	return (data as DcaExecutionRow[]).map(mapDcaExecutionRow);
}

async function dbRecordExecution(
	botId: string,
	userId: string,
	symbol: string,
	price: number,
	amount: number,
	qty: number,
	isDipBuy: boolean
): Promise<DcaExecution | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('dca_executions')
		.insert({
			bot_id:      botId,
			user_id:     userId,
			symbol:      symbol.toUpperCase(),
			price,
			amount,
			qty,
			is_dip_buy:  isDipBuy,
		})
		.select()
		.single();
	if (error || !data) return null;
	return mapDcaExecutionRow(data as DcaExecutionRow);
}

async function dbUpdateBotStats(
	botId: string,
	userId: string,
	totalInvested: number,
	executionCount: number,
	nextExecutionAt: string
): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('dca_bots')
		.update({
			total_invested:    totalInvested,
			execution_count:   executionCount,
			last_execution_at: new Date().toISOString(),
			next_execution_at: nextExecutionAt,
		})
		.eq('id', botId)
		.eq('user_id', userId);
}

// ─── Price + MA helpers ───────────────────────────────────────────────────────

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
	try {
		const result = await fetchBinanceOHLCV(symbol.toUpperCase(), '1d', 1);
		if ('error' in result || result.ohlcv.length === 0) return null;
		return result.ohlcv[result.ohlcv.length - 1].close;
	} catch {
		return null;
	}
}

async function fetchMA(symbol: string, maLength: number): Promise<number | null> {
	try {
		const result = await fetchBinanceOHLCV(symbol.toUpperCase(), '1d', maLength + 10);
		if ('error' in result || result.ohlcv.length < maLength) return null;
		const points = sma(result.ohlcv, maLength);
		if (points.length === 0) return null;
		return points[points.length - 1].value;
	} catch {
		return null;
	}
}

// ─── Equity chart builder ─────────────────────────────────────────────────────

function buildEquityChart(
	executions: DcaExecution[],
	symbol: string
): ChartBlock | null {
	if (executions.length < 2) return null;

	const { timestamps, dcaEquity, lumpSumEquity } = buildEquityCurve(executions);
	if (timestamps.length === 0) return null;

	// Use DCA equity as the OHLCV line data
	const ohlcvData: OHLCV[] = timestamps.map((ts, i) => ({
		time:   ts,
		open:   dcaEquity[i],
		high:   dcaEquity[i],
		low:    dcaEquity[i],
		close:  dcaEquity[i],
		volume: 0,
	}));

	return {
		type:      'chart',
		chartType: 'line',
		symbol:    `DCA ${symbol}`,
		interval:  'execution',
		data:      ohlcvData,
		indicators: [{
			name:    'Lump Sum Value',
			data:    timestamps.map((ts, i) => ({ time: ts, value: lumpSumEquity[i] })),
			color:   '#f59e0b',
			overlay: true,
		}],
	};
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'manage_dca_bot',
	description:
		'Manage paper Dollar-Cost Averaging (DCA) bots. Actions: create (set up a new DCA schedule), list (show all active bots with performance), delete (remove a bot), status (detailed view of a bot with execution history and equity chart), run_now (execute a DCA buy immediately for testing). Tracks avg cost basis, total invested, unrealised PnL, and compares vs lump sum. Optional dip multiplier buys extra when price drops below an MA by a threshold. Returns MetricCard (avg cost, total invested, current value, PnL%) + TableBlock (execution history) + ChartBlock (DCA equity vs lump sum).',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['create', 'list', 'delete', 'status', 'run_now'],
				description: 'Action to perform',
			},
			// create / run_now
			symbol: {
				type: 'string',
				description: 'Trading symbol, e.g. BTCUSDT, ETHUSDT',
			},
			amount_per_interval: {
				type: 'number',
				description: 'USD amount to invest per DCA interval (e.g. 100 for $100 per buy)',
			},
			interval: {
				type: 'string',
				enum: ['daily', 'weekly', 'biweekly', 'monthly'],
				description: 'DCA frequency',
			},
			dip_multiplier: {
				type: 'number',
				description: 'Optional multiplier applied when dip condition is met (e.g. 2 for double buy)',
			},
			dip_ma_length: {
				type: 'number',
				description: 'MA period for dip detection (e.g. 200 for MA200)',
			},
			dip_threshold_pct: {
				type: 'number',
				description: 'Percentage below MA to trigger dip buy (e.g. 5 for 5% below MA)',
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
			if (!args.symbol || typeof args.symbol !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: symbol required.',
				};
			}
			if (typeof args.amount_per_interval !== 'number' || args.amount_per_interval <= 0) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'amount_per_interval must be a positive number.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: amount_per_interval required.',
				};
			}
			if (!isValidDcaInterval(args.interval)) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'interval must be one of: daily, weekly, biweekly, monthly.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: invalid interval.',
				};
			}

			const input: CreateDcaBotInput = {
				symbol:             String(args.symbol),
				amountPerInterval:  args.amount_per_interval,
				interval:           args.interval,
				dipMultiplier:      typeof args.dip_multiplier === 'number' ? args.dip_multiplier : null,
				dipMaLength:        typeof args.dip_ma_length === 'number' ? Math.max(5, Math.min(500, args.dip_ma_length)) : null,
				dipThresholdPct:    typeof args.dip_threshold_pct === 'number' ? args.dip_threshold_pct : null,
			};

			const bot = await dbCreateBot({ ...input, userId });
			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Failed to create DCA bot. Make sure the dca_bots table exists in Supabase.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Could not create DCA bot.',
				};
			}

			const desc = describeDcaBot(bot);
			const nextDate = new Date(bot.nextExecutionAt).toISOString().slice(0, 10);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `DCA Bot Created — ${bot.symbol}`,
				metrics: [
					{ label: 'Symbol',         value: bot.symbol,                    direction: 'neutral' },
					{ label: 'Amount',          value: fmtUSD(bot.amountPerInterval), direction: 'neutral' },
					{ label: 'Frequency',       value: formatInterval(bot.interval),  direction: 'neutral' },
					{ label: 'Strategy',        value: desc,                          direction: 'neutral' },
					{ label: 'First Buy At',    value: nextDate,                      direction: 'neutral' },
					{ label: 'Status',          value: 'Active',                      direction: 'neutral' },
				],
			};

			return {
				success: true,
				contentBlocks: [metricCard],
				textSummary: `DCA bot created: ${desc}. Next buy: ${nextDate}. ID: ${bot.id.slice(0, 8)}.`,
			};
		}

		// ── LIST ────────────────────────────────────────────────────────────
		if (action === 'list') {
			const includeInactive = args.include_inactive === true;
			const cacheKey = toolCache.generateKey('manage_dca_bot_list', { userId, includeInactive });
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const bots = await dbListBots(userId, includeInactive);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: 'DCA Bots Summary',
				metrics: [
					{ label: 'Active Bots', value: String(bots.filter(b => b.active).length), direction: 'neutral' },
					{ label: 'Total Bots',  value: String(bots.length),                       direction: 'neutral' },
				],
			};

			if (bots.length === 0) {
				return {
					success: true,
					contentBlocks: [metricCard],
					textSummary: 'No DCA bots. Use manage_dca_bot with action=create to set one up.',
				};
			}

			const tableBlock: TableBlock = {
				type: 'table',
				title: `DCA Bots (${bots.length})`,
				headers: ['Symbol', 'Interval', 'Amount', 'Total Invested', 'Executions', 'Next Buy', 'Status'],
				rows: bots.map(b => [
					b.symbol,
					formatInterval(b.interval),
					fmtUSD(b.amountPerInterval),
					fmtUSD(b.totalInvested),
					String(b.executionCount),
					b.nextExecutionAt.slice(0, 10),
					b.active ? 'Active' : 'Inactive',
				]),
			};

			const result: ToolResult = {
				success: true,
				contentBlocks: [metricCard, tableBlock],
				textSummary: `${bots.length} DCA bot(s): ${bots.map(b => describeDcaBot(b)).join(' | ')}.`,
			};
			toolCache.set(cacheKey, result, 60_000);
			return result;
		}

		// ── DELETE ──────────────────────────────────────────────────────────
		if (action === 'delete') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for delete action.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}
			const ok = await dbDeleteBot(userId, String(args.bot_id));
			if (!ok) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found or could not be deleted.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Could not delete bot.',
				};
			}
			// Invalidate list cache
			toolCache.set(toolCache.generateKey('manage_dca_bot_list', { userId, includeInactive: false }), null as unknown as ToolResult, 0);
			return {
				success: true,
				contentBlocks: [],
				textSummary: `DCA bot ${String(args.bot_id).slice(0, 8)} deleted.`,
			};
		}

		// ── STATUS ──────────────────────────────────────────────────────────
		if (action === 'status') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for status action.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}

			const cacheKey = toolCache.generateKey('manage_dca_bot_status', { userId, botId: args.bot_id });
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const [bot, executions] = await Promise.all([
				dbGetBot(userId, String(args.bot_id)),
				dbGetExecutions(userId, String(args.bot_id)),
			]);

			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Bot not found.',
				};
			}

			const currentPrice = await fetchCurrentPrice(bot.symbol);
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch current price for ${bot.symbol}.`, tool: 'manage_dca_bot' }],
					textSummary: `Error: Could not fetch price for ${bot.symbol}.`,
				};
			}

			const perf = calcDcaPerformance(executions, currentPrice);
			const contentBlocks: ToolResult['contentBlocks'] = [];

			// Summary metric card
			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `DCA Bot Status — ${bot.symbol}`,
				metrics: [
					{ label: 'Symbol',         value: bot.symbol,                    direction: 'neutral' },
					{ label: 'Interval',        value: formatInterval(bot.interval),  direction: 'neutral' },
					{ label: 'Amount/Buy',      value: fmtUSD(bot.amountPerInterval), direction: 'neutral' },
					{ label: 'Total Invested',  value: fmtUSD(perf.totalInvested),    direction: 'neutral' },
					{ label: 'Avg Cost',        value: perf.avgCostBasis > 0 ? fmtPrice(perf.avgCostBasis) : 'N/A', direction: 'neutral' },
					{ label: 'Current Price',   value: fmtPrice(currentPrice),        direction: 'neutral' },
					{ label: 'Current Value',   value: fmtUSD(perf.currentValue),     direction: 'neutral' },
					{ label: 'Unrealised PnL',  value: fmtUSD(perf.unrealisedPnL),    direction: perf.unrealisedPnL >= 0 ? 'up' : 'down' },
					{ label: 'Return %',        value: fmtPct(perf.unrealisedPct),    direction: perf.unrealisedPct >= 0 ? 'up' : 'down' },
					...(perf.lumpSumPct !== null ? [{
						label: 'Lump Sum Return',
						value: fmtPct(perf.lumpSumPct),
						direction: (perf.lumpSumPct >= 0 ? 'up' : 'down') as 'up' | 'down' | 'neutral',
					}] : []),
					{ label: 'Executions',      value: String(perf.executionCount),   direction: 'neutral' },
					{ label: 'Next Buy',        value: bot.nextExecutionAt.slice(0, 10), direction: 'neutral' },
					{ label: 'Status',          value: bot.active ? 'Active' : 'Paused', direction: 'neutral' },
				],
			};
			contentBlocks.push(metricCard);

			// Execution history table
			if (executions.length > 0) {
				const tableBlock: TableBlock = {
					type: 'table',
					title: 'Execution History',
					headers: ['Date', 'Price', 'Amount', 'Qty', 'Type', 'Cum. Cost Basis'],
					rows: (() => {
						let cumCost = 0, cumQty = 0;
						return executions.map(e => {
							cumCost += e.amount;
							cumQty  += e.qty;
							const avgBasis = cumQty > 0 ? cumCost / cumQty : 0;
							return [
								e.executedAt.slice(0, 10),
								fmtPrice(e.price),
								fmtUSD(e.amount),
								e.qty.toFixed(6),
								e.isDipBuy ? 'Dip Buy' : 'Regular',
								fmtPrice(avgBasis),
							];
						});
					})(),
				};
				contentBlocks.push(tableBlock);
			} else {
				contentBlocks.push({
					type: 'metric_card',
					title: 'No Executions Yet',
					metrics: [{ label: 'Use run_now to execute the first DCA buy', value: '', direction: 'neutral' }],
				});
			}

			// Equity chart (DCA vs lump sum)
			const chart = buildEquityChart(executions, bot.symbol);
			if (chart) contentBlocks.push(chart);

			const result: ToolResult = {
				success: true,
				contentBlocks,
				textSummary: `DCA bot ${bot.symbol}: ${perf.executionCount} executions, invested ${fmtUSD(perf.totalInvested)}, avg cost ${perf.avgCostBasis > 0 ? fmtPrice(perf.avgCostBasis) : 'N/A'}, current value ${fmtUSD(perf.currentValue)}, PnL ${fmtUSD(perf.unrealisedPnL)} (${fmtPct(perf.unrealisedPct)}).${perf.lumpSumPct !== null ? ` Lump sum return would be ${fmtPct(perf.lumpSumPct)}.` : ''}`,
			};
			toolCache.set(cacheKey, result, 60_000);
			return result;
		}

		// ── RUN_NOW ─────────────────────────────────────────────────────────
		if (action === 'run_now') {
			if (!args.bot_id || typeof args.bot_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'bot_id is required for run_now action.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: bot_id required.',
				};
			}

			const bot = await dbGetBot(userId, String(args.bot_id));
			if (!bot) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot not found.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Bot not found.',
				};
			}
			if (!bot.active) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Bot is inactive.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Bot is inactive.',
				};
			}

			// Fetch current price
			const currentPrice = await fetchCurrentPrice(bot.symbol);
			if (currentPrice === null) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Could not fetch price for ${bot.symbol}.`, tool: 'manage_dca_bot' }],
					textSummary: `Error: Could not fetch price for ${bot.symbol}.`,
				};
			}

			// Determine buy amount (dip multiplier if conditions met)
			let buyAmount = bot.amountPerInterval;
			let isDipBuy = false;

			if (
				bot.dipMultiplier !== null &&
				bot.dipMaLength !== null &&
				bot.dipThresholdPct !== null
			) {
				const maPrice = await fetchMA(bot.symbol, bot.dipMaLength);
				if (maPrice !== null && isDipCondition(currentPrice, maPrice, bot.dipThresholdPct)) {
					buyAmount = bot.amountPerInterval * bot.dipMultiplier;
					isDipBuy = true;
				}
			}

			// Compute quantity
			const qty = buyAmount / currentPrice;

			// Record execution
			const execution = await dbRecordExecution(
				bot.id, userId, bot.symbol,
				currentPrice, buyAmount, qty, isDipBuy
			);
			if (!execution) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Failed to record DCA execution. Make sure dca_executions table exists in Supabase.', tool: 'manage_dca_bot' }],
					textSummary: 'Error: Could not record execution.',
				};
			}

			// Also open a paper trade for portfolio tracking
			await openPaperTrade(
				userId,
				bot.symbol,
				'long',
				qty,
				currentPrice,
				`DCA ${isDipBuy ? '(dip buy)' : '(regular)'} — bot ${bot.id.slice(0, 8)}`
			);

			// Update bot stats
			const newTotalInvested = bot.totalInvested + buyAmount;
			const newExecutionCount = bot.executionCount + 1;
			const nextAt = calcNextExecution(bot.interval).toISOString();
			await dbUpdateBotStats(bot.id, userId, newTotalInvested, newExecutionCount, nextAt);

			// Invalidate caches
			toolCache.set(toolCache.generateKey('manage_dca_bot_list', { userId, includeInactive: false }), null as unknown as ToolResult, 0);
			toolCache.set(toolCache.generateKey('manage_dca_bot_status', { userId, botId: bot.id }), null as unknown as ToolResult, 0);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `DCA Buy Executed — ${bot.symbol}`,
				metrics: [
					{ label: 'Type',             value: isDipBuy ? 'Dip Buy' : 'Regular DCA', direction: isDipBuy ? 'up' : 'neutral' },
					{ label: 'Symbol',           value: bot.symbol,                            direction: 'neutral' },
					{ label: 'Price',            value: fmtPrice(currentPrice),                direction: 'neutral' },
					{ label: 'Amount Invested',  value: fmtUSD(buyAmount),                     direction: 'neutral' },
					{ label: 'Qty Purchased',    value: qty.toFixed(6),                        direction: 'neutral' },
					{ label: 'Total Invested',   value: fmtUSD(newTotalInvested),              direction: 'neutral' },
					{ label: 'Execution #',      value: String(newExecutionCount),             direction: 'neutral' },
					{ label: 'Next Buy',         value: nextAt.slice(0, 10),                   direction: 'neutral' },
				],
			};

			return {
				success: true,
				contentBlocks: [metricCard],
				textSummary: `DCA buy executed: ${qty.toFixed(6)} ${bot.symbol} at ${fmtPrice(currentPrice)} for ${fmtUSD(buyAmount)}${isDipBuy ? ' (dip buy)' : ''}. Total invested: ${fmtUSD(newTotalInvested)}. Next buy: ${nextAt.slice(0, 10)}.`,
			};
		}

		// ── Unknown action ─────────────────────────────────────────────────
		return {
			success: false,
			contentBlocks: [{ type: 'error', message: `Unknown action: ${action}. Use create, list, delete, status, or run_now.`, tool: 'manage_dca_bot' }],
			textSummary: `Error: unknown action "${action}".`,
		};
	},
});
