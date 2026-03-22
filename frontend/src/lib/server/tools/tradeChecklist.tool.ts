// Pre-Trade Checklist Enforcer Tool — T-1302
// Tool: check_trade — 8-point pre-trade checklist with regime, R:R, position sizing, event risk, journal checks

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import {
	runPreTradeChecklist,
	calcReadinessScore,
	getRecommendation,
} from '../data/tradeChecklist.data';
import { normalizeBinanceSymbol } from '../data/ohlcvProvider';
import type { ContentBlock, ChecklistBlock, MetricCardBlock, GaugeBlock } from '$lib/types/contentBlock';

// ─── Gauge thresholds ─────────────────────────────────────────────────────────

const READINESS_THRESHOLDS: GaugeBlock['thresholds'] = [
	{ value: 25,  color: '#ef4444', label: 'Abort'   },
	{ value: 50,  color: '#f97316', label: 'Caution' },
	{ value: 75,  color: '#eab308', label: 'Marginal'},
	{ value: 90,  color: '#22c55e', label: 'Good'    },
	{ value: 100, color: '#10b981', label: 'Proceed' },
];

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'check_trade',
	description:
		'Pre-Trade Checklist Enforcer — runs an 8-point checklist before any trade: (1) Clear edge? (2) Regime aligned? (3) R:R > 2:1? (4) Position size within limits? (5) Conflicting signals? (6) Event risk nearby? (7) In trading plan? (8) Revenge trading/tilted? Each item returns pass/fail/warning with explanation. Custom checklist context from trade journal. Returns ChecklistBlock (full checklist) + MetricCard (pass rate) + GaugeBlock (trade readiness score 0–100). Use when user asks to check a trade, validate a setup, or wants pre-trade analysis.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT). Default: BTCUSDT',
			},
			direction: {
				type: 'string',
				enum: ['long', 'short'],
				description: 'Proposed trade direction. Default: long',
			},
			timeframe: {
				type: 'string',
				description: 'Analysis timeframe: 1h, 4h, 1d. Default: 1d',
			},
			entry_price: {
				type: 'number',
				description: 'Planned entry price (enables R:R check)',
			},
			stop_price: {
				type: 'number',
				description: 'Stop-loss price (enables R:R + position sizing check)',
			},
			target_price: {
				type: 'number',
				description: 'Take-profit target price (enables R:R check)',
			},
			account_size: {
				type: 'number',
				description: 'Account size in USD (enables position sizing check)',
			},
			risk_pct: {
				type: 'number',
				description: 'Risk per trade as % of account (e.g. 1 = 1%). Enables position sizing check.',
			},
			user_id: {
				type: 'string',
				description: 'User ID for journal-based checks (plan adherence, revenge trading detection). Default: "default"',
			},
		},
		required: [],
	},
	timeout: 45_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol  = typeof args.symbol    === 'string' && args.symbol    ? args.symbol    : 'BTCUSDT';
		const direction  = args.direction === 'short' ? 'short' : 'long';
		const timeframe  = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : '1d';
		const symbol     = normalizeBinanceSymbol(rawSymbol);
		const entryPrice  = typeof args.entry_price  === 'number' ? args.entry_price  : undefined;
		const stopPrice   = typeof args.stop_price   === 'number' ? args.stop_price   : undefined;
		const targetPrice = typeof args.target_price === 'number' ? args.target_price : undefined;
		const accountSize = typeof args.account_size === 'number' ? args.account_size : undefined;
		const riskPct     = typeof args.risk_pct     === 'number' ? args.risk_pct     : undefined;
		const userId      = typeof args.user_id === 'string' && args.user_id ? args.user_id : 'default';

		const cacheKey = toolCache.generateKey('check_trade', {
			symbol, direction, timeframe, entryPrice, stopPrice, targetPrice, accountSize, riskPct, userId,
		});
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		// ── Run checklist ─────────────────────────────────────────────────────
		const items = await runPreTradeChecklist({
			symbol, direction, timeframe,
			entryPrice, stopPrice, targetPrice,
			accountSize, riskPct,
			userId,
		});

		// ── Score + recommendation ────────────────────────────────────────────
		const passCount    = items.filter(i => i.status === 'pass').length;
		const failCount    = items.filter(i => i.status === 'fail').length;
		const warningCount = items.filter(i => i.status === 'warning').length;
		const readinessScore = calcReadinessScore(items);
		const recommendation = getRecommendation(readinessScore, failCount);

		// ── ChecklistBlock ────────────────────────────────────────────────────
		const checklistBlock: ChecklistBlock = {
			type:            'checklist',
			symbol,
			direction,
			items,
			passCount,
			failCount,
			warningCount,
			readinessScore,
			recommendation,
		};

		// ── MetricCard ────────────────────────────────────────────────────────
		const scoredItems = items.filter(i => i.status !== 'skip').length;
		const passRate    = scoredItems > 0 ? Math.round((passCount / scoredItems) * 100) : 0;

		const recColor: 'up' | 'down' | 'neutral' =
			recommendation === 'PROCEED' ? 'up' :
			recommendation === 'ABORT'   ? 'down' : 'neutral';

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `Pre-Trade Checklist — ${symbol} (${direction.toUpperCase()})`,
			metrics: [
				{
					label:     'Recommendation',
					value:     recommendation,
					change:    `Readiness: ${readinessScore}/100`,
					direction: recColor,
				},
				{
					label:     'Pass Rate',
					value:     `${passRate}%`,
					change:    `${passCount} pass, ${warningCount} warn, ${failCount} fail`,
					direction: passRate >= 70 ? 'up' : passRate >= 40 ? 'neutral' : 'down',
				},
				{
					label:     'Hard Fails',
					value:     String(failCount),
					change:    failCount === 0 ? 'No blockers' : `${failCount} blocker(s) found`,
					direction: failCount === 0 ? 'up' : 'down',
				},
				{
					label:     'Timeframe',
					value:     timeframe,
					direction: 'neutral',
				},
			],
		};

		// ── Gauge ─────────────────────────────────────────────────────────────
		const gaugeLabel =
			readinessScore >= 90 ? 'Proceed' :
			readinessScore >= 75 ? 'Good'     :
			readinessScore >= 50 ? 'Marginal' :
			readinessScore >= 25 ? 'Caution'  : 'Abort';

		const gaugeBlock: GaugeBlock = {
			type:       'gauge',
			title:      'Trade Readiness Score',
			value:      readinessScore,
			label:      gaugeLabel,
			thresholds: READINESS_THRESHOLDS,
		};

		// ── Build result ──────────────────────────────────────────────────────
		const contentBlocks: ContentBlock[] = [metricBlock, checklistBlock, gaugeBlock];

		const textSummary =
			`${symbol} ${direction.toUpperCase()} pre-trade checklist: ${recommendation}. ` +
			`Readiness ${readinessScore}/100. Pass: ${passCount}, Warnings: ${warningCount}, Fails: ${failCount}. ` +
			(failCount > 0
				? `Blockers: ${items.filter(i => i.status === 'fail').map(i => i.question).join('; ')}.`
				: 'No hard blockers.');

		const result: ToolResult = {
			success: true,
			contentBlocks,
			textSummary,
			sources: [
				{ name: 'Binance OHLCV', accessedAt: Date.now() },
				{ name: 'Forex Factory Calendar', accessedAt: Date.now() },
				{ name: 'Trade Journal (Supabase)', accessedAt: Date.now() },
			],
		};

		toolCache.set(cacheKey, result, 5 * 60_000); // 5 min cache
		return result;
	},
});
