// Post-Trade Analyst Tool — T-1303
// Tool: analyze_trade — deep post-mortem on completed trade

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	fetchJournalEntryById,
	gatherPostTradeData,
	buildPostTradePrompt,
	parseCoachingResponse,
	buildFallbackCoaching,
} from '../data/postTradeAnalyst.data';
import { getClientWithFallback } from '../aiProvider.server';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';
import type { JournalEntry } from '../portfolio/journal';
import type { ContentBlock, ChartBlock, MetricCardBlock, TableBlock, TextBlock, ChartMarker } from '$lib/types/contentBlock';

const DEFAULT_USER = 'default';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
	if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
	if (Math.abs(n) >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`;
	return `$${n.toFixed(2)}`;
}

function fmtPct(n: number): string { return `${n.toFixed(1)}%`; }
function fmtN(n: number | null, decimals = 2): string {
	return n !== null ? n.toFixed(decimals) : 'N/A';
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'analyze_trade',
	description:
		'AI Post-Trade Analyst — deep post-mortem on a completed trade. Fetches the chart for the trade period, replays indicator signals at entry/exit timestamps, checks if the thesis held, compares actual vs optimal execution (timing efficiency), calculates slippage, and generates AI coaching feedback. Returns ChartBlock (trade period with entry/exit markers) + MetricCard (R-multiple, timing efficiency, thesis accuracy) + TableBlock (signal replay) + TextBlock (AI coaching). Use when user wants to review a trade, analyse execution quality, or get coaching feedback on a completed position.',
	parameters: {
		type: 'object',
		properties: {
			trade_id: {
				type: 'string',
				description: 'Journal entry ID to analyse. If provided, all other trade params are ignored.',
			},
			symbol: {
				type: 'string',
				description: 'Trading symbol (e.g. BTCUSDT). Required if trade_id is not provided.',
			},
			direction: {
				type: 'string',
				enum: ['long', 'short'],
				description: 'Trade direction.',
			},
			entry_price: {
				type: 'number',
				description: 'Entry price.',
			},
			exit_price: {
				type: 'number',
				description: 'Exit price (for closed trades).',
			},
			entry_date: {
				type: 'string',
				description: 'Trade entry date YYYY-MM-DD.',
			},
			size: {
				type: 'number',
				description: 'Position size in units.',
			},
			r_multiple: {
				type: 'number',
				description: 'R-multiple outcome (e.g. 2.5 for 2.5R win, -1 for 1R loss).',
			},
			pnl_usd: {
				type: 'number',
				description: 'Realised P&L in USD.',
			},
			setup_type: {
				type: 'string',
				description: 'Setup type (e.g. breakout, pullback, reversal).',
			},
			pre_notes: {
				type: 'string',
				description: 'Pre-trade thesis or analysis notes.',
			},
			post_notes: {
				type: 'string',
				description: 'Post-trade review notes.',
			},
			timeframe: {
				type: 'string',
				description: 'Chart timeframe for analysis: 1h, 4h, 1d (default: 1d).',
			},
			user_id: {
				type: 'string',
				description: 'User ID (defaults to "default").',
			},
		},
		required: [],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const userId    = typeof args.user_id  === 'string' ? args.user_id  : DEFAULT_USER;
		const timeframe = typeof args.timeframe === 'string' ? args.timeframe : '1d';

		// ── Resolve journal entry ─────────────────────────────────────────────
		let entry: JournalEntry | null = null;

		if (typeof args.trade_id === 'string' && args.trade_id) {
			entry = await fetchJournalEntryById(userId, args.trade_id);
			if (!entry) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `Trade ID "${args.trade_id}" not found.`, tool: 'analyze_trade' }],
					textSummary: `Error: Trade "${args.trade_id}" not found in journal.`,
				};
			}
		} else {
			// Build entry from inline params
			const symbol    = typeof args.symbol      === 'string' ? args.symbol    : '';
			const direction = args.direction === 'short' ? 'short' : 'long';
			const entryPrice = typeof args.entry_price === 'number' ? args.entry_price : 0;

			if (!symbol || entryPrice === 0) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Provide either trade_id or symbol + entry_price.', tool: 'analyze_trade' }],
					textSummary: 'Error: Missing trade_id or required inline fields (symbol, entry_price).',
				};
			}

			const today = new Date().toISOString().slice(0, 10);
			entry = {
				id:           'inline',
				userId,
				symbol:       normalizeBinanceSymbol(symbol),
				direction,
				entryPrice,
				exitPrice:    typeof args.exit_price === 'number' ? args.exit_price : null,
				size:         typeof args.size      === 'number'  ? args.size       : 1,
				pnlUSD:       typeof args.pnl_usd   === 'number'  ? args.pnl_usd    : null,
				rMultiple:    typeof args.r_multiple === 'number' ? args.r_multiple : null,
				setupType:    typeof args.setup_type === 'string' ? args.setup_type : null,
				emotion:      null,
				preNotes:     typeof args.pre_notes  === 'string' ? args.pre_notes  : null,
				postNotes:    typeof args.post_notes === 'string' ? args.post_notes : null,
				mistakes:     [],
				followedPlan: null,
				tradeDate:    typeof args.entry_date === 'string' ? args.entry_date : today,
				createdAt:    new Date().toISOString(),
			};
		}

		const cacheKey = toolCache.generateKey('analyze_trade', {
			id: entry.id, symbol: entry.symbol, tradeDate: entry.tradeDate, exitPrice: entry.exitPrice,
		});
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Gather data ───────────────────────────────────────────────────────
		const bundle = await gatherPostTradeData(entry, timeframe);

		// ── Call LLM for coaching ─────────────────────────────────────────────
		let coaching = null;
		try {
			const prompt = buildPostTradePrompt(entry, bundle.timing, bundle.entrySignals, bundle.exitSignals);
			const { client, apiModel } = getClientWithFallback('gpt-4o', ['claude-sonnet', 'deepseek']);
			const completion = await client.chat.completions.create({
				model: apiModel,
				temperature: 0.4,
				max_tokens: 1000,
				messages: [{ role: 'user', content: prompt }],
			});
			const raw = completion.choices[0]?.message?.content ?? '';
			coaching = parseCoachingResponse(raw);
		} catch {
			// LLM failed — use fallback
		}
		if (!coaching) coaching = buildFallbackCoaching(entry, bundle.timing);

		// ── MetricCard ────────────────────────────────────────────────────────
		const isWin = bundle.timing.actualPnlUSD !== null
			? bundle.timing.actualPnlUSD > 0
			: (entry.rMultiple !== null ? entry.rMultiple > 0 : null);

		const metricBlock: MetricCardBlock = {
			type: 'metric_card',
			title: `Post-Trade Analysis — ${entry.symbol} ${entry.direction.toUpperCase()} (${entry.tradeDate})`,
			metrics: [
				{
					label: 'R-Multiple',
					value: entry.rMultiple !== null ? `${entry.rMultiple.toFixed(2)}R` : 'N/A',
					direction: entry.rMultiple === null ? 'neutral' : entry.rMultiple > 0 ? 'up' : 'down',
				},
				{
					label: 'Realised P&L',
					value: bundle.timing.actualPnlUSD !== null ? fmt(bundle.timing.actualPnlUSD) : 'N/A',
					direction: isWin === null ? 'neutral' : isWin ? 'up' : 'down',
				},
				{
					label: 'Timing Efficiency',
					value: fmtPct(bundle.timing.timingEfficiencyPct),
					change: `${fmt(bundle.timing.actualPnlUSD ?? 0)} of max ${fmt(bundle.timing.maxPossiblePnL)}`,
					direction: bundle.timing.timingEfficiencyPct >= 60 ? 'up' : bundle.timing.timingEfficiencyPct >= 30 ? 'neutral' : 'down',
				},
				{
					label: 'Thesis Accuracy',
					value: `${coaching.thesisAccuracyScore}/100`,
					direction: coaching.thesisAccuracyScore >= 60 ? 'up' : coaching.thesisAccuracyScore >= 40 ? 'neutral' : 'down',
				},
				{
					label: 'Entry Slippage',
					value: fmtPct(bundle.timing.entrySlippagePct),
					direction: bundle.timing.entrySlippagePct < 0.3 ? 'up' : bundle.timing.entrySlippagePct < 1 ? 'neutral' : 'down',
				},
				{
					label: 'Setup',
					value: entry.setupType ?? 'unspecified',
					direction: 'neutral',
				},
			],
		};

		// ── ChartBlock with entry/exit markers ────────────────────────────────
		const contentBlocks: ContentBlock[] = [metricBlock];

		if (bundle.tradePeriodOhlcv.length > 0) {
			const markers: ChartMarker[] = [
				{
					time:  bundle.entrySignals.timestamp,
					price: entry.entryPrice,
					label: `Entry @${entry.entryPrice}`,
					color: entry.direction === 'long' ? '#22c55e' : '#ef4444',
					shape: entry.direction === 'long' ? 'arrow_up' : 'arrow_down',
				},
			];

			if (entry.exitPrice !== null) {
				markers.push({
					time:  bundle.exitSignals.timestamp,
					price: entry.exitPrice,
					label: `Exit @${entry.exitPrice}`,
					color: isWin ? '#22c55e' : '#ef4444',
					shape: isWin ? 'arrow_up' : 'arrow_down',
				});
			}

			const chartBlock: ChartBlock = {
				type: 'chart',
				chartType: 'candlestick',
				symbol: entry.symbol,
				interval: timeframe,
				data: bundle.tradePeriodOhlcv,
				markers,
				indicators: [
					{
						name: 'EMA 20',
						data: bundle.ohlcv
							.slice(0, bundle.exitIndex + 6)
							.map((c, i, arr) => {
								if (i < 19) return null;
								// Simple EMA approximation for overlay (use bundle's ema20 at exit as reference)
								return { time: c.time, value: c.close };
							})
							.filter((x): x is NonNullable<typeof x> => false), // skip indicator overlay — keep chart clean
						color: '#f59e0b',
						overlay: true,
					},
				].filter(ind => ind.data.length > 0),
			};

			contentBlocks.push(chartBlock);
		}

		// ── TableBlock — Signal Replay ─────────────────────────────────────────
		const { entrySignals, exitSignals } = bundle;
		const hasExit = entry.exitPrice !== null;

		const signalTable: TableBlock = {
			type: 'table',
			title: 'Signal Replay at Entry vs Exit',
			headers: ['Indicator', 'At Entry', hasExit ? 'At Exit' : 'Current', 'Interpretation'],
			rows: [
				[
					'Price',
					fmtN(entrySignals.price, 4),
					fmtN(exitSignals.price, 4),
					entry.exitPrice !== null
						? (isWin ? `+${((exitSignals.price - entrySignals.price) / entrySignals.price * 100).toFixed(2)}% move` : `${((exitSignals.price - entrySignals.price) / entrySignals.price * 100).toFixed(2)}% move`)
						: 'N/A',
				],
				[
					'RSI(14)',
					fmtN(entrySignals.rsi14, 1),
					fmtN(exitSignals.rsi14, 1),
					entrySignals.rsi14 !== null
						? (entrySignals.rsi14 > 70 ? 'Overbought at entry' : entrySignals.rsi14 < 30 ? 'Oversold at entry' : 'Neutral at entry')
						: 'N/A',
				],
				[
					'EMA 20',
					fmtN(entrySignals.ema20, 4),
					fmtN(exitSignals.ema20, 4),
					entrySignals.ema20 !== null && entrySignals.price !== null
						? (entrySignals.price > entrySignals.ema20 ? 'Price above EMA20' : 'Price below EMA20')
						: 'N/A',
				],
				[
					'EMA 50',
					fmtN(entrySignals.ema50, 4),
					fmtN(exitSignals.ema50, 4),
					entrySignals.ema50 !== null && entrySignals.price !== null
						? (entrySignals.price > entrySignals.ema50 ? 'Price above EMA50' : 'Price below EMA50')
						: 'N/A',
				],
				[
					'MACD Line',
					fmtN(entrySignals.macdLine, 4),
					fmtN(exitSignals.macdLine, 4),
					entrySignals.macdLine !== null && entrySignals.macdSignal !== null
						? (entrySignals.macdLine > entrySignals.macdSignal ? 'Bullish crossover at entry' : 'Bearish crossover at entry')
						: 'N/A',
				],
				[
					'ATR(14)',
					fmtN(entrySignals.atr14, 4),
					fmtN(exitSignals.atr14, 4),
					entrySignals.atr14 !== null && entry.entryPrice > 0
						? `Volatility: ${(entrySignals.atr14 / entry.entryPrice * 100).toFixed(2)}% of price`
						: 'N/A',
				],
			].filter(row => row[1] !== 'N/A'),
		};

		contentBlocks.push(signalTable);

		// ── TextBlock — AI Coaching ────────────────────────────────────────────
		const coachingBlock: TextBlock = {
			type: 'text',
			content: coaching.coachingFeedback,
		};
		contentBlocks.push(coachingBlock);

		// ── Text Summary ──────────────────────────────────────────────────────
		const rStr = entry.rMultiple !== null ? ` ${entry.rMultiple.toFixed(2)}R` : '';
		const pnlStr = bundle.timing.actualPnlUSD !== null ? ` (${fmt(bundle.timing.actualPnlUSD)})` : '';
		const textSummary =
			`Post-trade analysis: ${entry.symbol} ${entry.direction.toUpperCase()}${rStr}${pnlStr}. ` +
			`Timing efficiency ${fmtPct(bundle.timing.timingEfficiencyPct)}, thesis accuracy ${coaching.thesisAccuracyScore}/100. ` +
			`Key lesson: ${coaching.keyLesson}`;

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
		};

		toolCache.set(cacheKey, result, 15 * 60_000);
		return result;
	},
});
