// TradingView Alerts Tool — T-805
// Tool: list_tv_alerts

import { registerTool, type ToolResult } from './registry';
import { listAlerts } from '../data/tvAlerts.data';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import type { ContentBlock, MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

// ─── Tool ─────────────────────────────────────────────────────────────────────

registerTool({
	name: 'list_tv_alerts',
	description:
		'Lists recent TradingView webhook alerts received by the system. Shows symbol, action (buy/sell/close/alert), price, message, and timestamp. Use when asked about recent TradingView signals, alerts fired, or trading automation activity.',
	parameters: {
		type: 'object',
		properties: {
			limit: {
				type: 'number',
				description: 'Number of recent alerts to show (default: 20, max: 50)',
			},
		},
		required: [],
	},
	timeout: 15_000,
	execute: async (args): Promise<ToolResult> => {
		const limit = Math.min(50, Math.max(1, typeof args.limit === 'number' ? args.limit : 20));

		let supabase: ReturnType<typeof getSupabaseAdminClient>;
		try {
			supabase = getSupabaseAdminClient();
		} catch {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Database not configured.', tool: 'list_tv_alerts' }],
				textSummary: 'Error: Supabase not configured.',
			};
		}

		const alerts = await listAlerts(supabase as unknown as Parameters<typeof listAlerts>[0], limit);

		if (alerts.length === 0) {
			const contentBlocks: ContentBlock[] = [{
				type:    'table',
				title:   'TradingView Alerts',
				headers: ['Result'],
				rows:    [['No TradingView alerts received yet. Configure a webhook at /api/tradingview in your TradingView alert settings.']],
			}];
			return {
				success: true,
				contentBlocks,
				textSummary: 'No TradingView alerts received yet.',
			};
		}

		// ── MetricCard ─────────────────────────────────────────────────────────
		const buys    = alerts.filter(a => a.action === 'buy').length;
		const sells   = alerts.filter(a => a.action === 'sell').length;
		const closeds = alerts.filter(a => a.action === 'close').length;

		const metricBlock: MetricCardBlock = {
			type:  'metric_card',
			title: `TradingView Alerts (last ${alerts.length})`,
			metrics: [
				{
					label:     'Total Alerts',
					value:     alerts.length.toString(),
					change:    `Most recent: ${new Date(alerts[0].triggeredAt).toLocaleString()}`,
					direction: 'neutral',
				},
				{
					label:     'Buy Signals',
					value:     buys.toString(),
					direction: 'up',
				},
				{
					label:     'Sell Signals',
					value:     sells.toString(),
					direction: 'down',
				},
				{
					label:     'Closed Positions',
					value:     closeds.toString(),
					direction: 'neutral',
				},
			],
		};

		// ── Table ──────────────────────────────────────────────────────────────
		const tableBlock: TableBlock = {
			type:    'table',
			title:   'Recent TradingView Alerts',
			headers: ['Time', 'Symbol', 'Action', 'Price', 'Paper Trade', 'Message'],
			rows:    alerts.map(a => [
				new Date(a.triggeredAt).toLocaleString(),
				a.symbol,
				a.action.toUpperCase(),
				a.price.toLocaleString('en-US', { maximumFractionDigits: 4 }),
				a.paperTrade ? 'Yes' : 'No',
				a.message || '—',
			]),
		};

		const contentBlocks: ContentBlock[] = [metricBlock, tableBlock];

		return {
			success: true,
			contentBlocks,
			textSummary: `${alerts.length} TradingView alerts: ${buys} buy, ${sells} sell, ${closeds} close. Latest: ${alerts[0].symbol} ${alerts[0].action.toUpperCase()} @ ${alerts[0].price}.`,
		};
	},
});
