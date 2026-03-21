// Alerts Tool — T-401
// Tools: set_alert, list_alerts, delete_alert
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { createAlert, listAlerts, deleteAlert } from '../alerts/alertEngine';

const DEFAULT_USER = 'default';

// ─── set_alert ────────────────────────────────────────────────────────────────

registerTool({
	name: 'set_alert',
	description:
		'Set a price alert for a symbol. Triggers when price goes above, below, or crosses a target level. Use when user says "alert me when BTC hits X", "notify me if gold falls below Y".',
	parameters: {
		type: 'object',
		properties: {
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT, XAUUSD)' },
			condition: {
				type: 'string',
				enum: ['above', 'below', 'crosses'],
				description: 'Trigger condition: above (price >= target), below (price <= target), crosses (price crosses target in either direction)'
			},
			target: { type: 'number', description: 'Target price level' },
			note: { type: 'string', description: 'Optional note about why this alert is set' },
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: ['symbol', 'condition', 'target']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.symbol || !args.condition || args.target === undefined) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Missing required fields: symbol, condition, target.', tool: 'set_alert' }],
				textSummary: 'Error: Missing alert fields.'
			};
		}
		if (!['above', 'below', 'crosses'].includes(String(args.condition))) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'condition must be above, below, or crosses.', tool: 'set_alert' }],
				textSummary: 'Error: Invalid condition.'
			};
		}

		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const alert = await createAlert(userId, {
			symbol: String(args.symbol),
			condition: args.condition as 'above' | 'below' | 'crosses',
			target: Number(args.target),
			note: typeof args.note === 'string' ? args.note : null,
		});

		if (!alert) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Failed to save alert.', tool: 'set_alert' }],
				textSummary: 'Error: Could not create alert.'
			};
		}

		// Invalidate list cache
		toolCache.set(toolCache.generateKey('list_alerts', { userId }), null as unknown as ToolResult, 0);

		const conditionLabel = alert.condition === 'above' ? '≥' : alert.condition === 'below' ? '≤' : '×';
		return {
			success: true,
			contentBlocks: [{
				type: 'metric_card',
				title: `Alert Set — ${alert.symbol}`,
				metrics: [
					{ label: 'Symbol', value: alert.symbol, direction: 'neutral' },
					{ label: 'Condition', value: `price ${conditionLabel} ${alert.target}`, direction: 'neutral' },
					{ label: 'Target', value: String(alert.target), direction: 'neutral' },
					...(alert.note ? [{ label: 'Note', value: alert.note, direction: 'neutral' as const }] : []),
					{ label: 'Status', value: 'Active', direction: 'neutral' },
				]
			}],
			textSummary: `Alert set: ${alert.symbol} ${alert.condition} ${alert.target}${alert.note ? ` (${alert.note})` : ''}. ID: ${alert.id.slice(0, 8)}.`
		};
	}
});

// ─── list_alerts ──────────────────────────────────────────────────────────────

registerTool({
	name: 'list_alerts',
	description: 'List active price alerts. Use when user asks about their alerts or what price levels they are watching.',
	parameters: {
		type: 'object',
		properties: {
			include_triggered: { type: 'boolean', description: 'Include already-triggered alerts (default false)' },
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: []
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const includeTriggered = args.include_triggered === true;

		const cacheKey = toolCache.generateKey('list_alerts', { userId });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached && !includeTriggered) return cached;

		const alerts = await listAlerts(userId, includeTriggered);

		if (alerts.length === 0) {
			return {
				success: true,
				contentBlocks: [{
					type: 'metric_card',
					title: 'Price Alerts',
					metrics: [{ label: 'Active Alerts', value: '0', direction: 'neutral' }]
				}],
				textSummary: 'No active alerts. Use set_alert to create one.'
			};
		}

		const result: ToolResult = {
			success: true,
			contentBlocks: [{
				type: 'table',
				title: `Price Alerts (${alerts.length})`,
				headers: ['Symbol', 'Condition', 'Target', 'Status', 'Note'],
				rows: alerts.map(a => [
					a.symbol,
					a.condition,
					a.target,
					a.triggered ? `Triggered ${a.triggeredAt?.slice(0, 10) ?? ''}` : 'Active',
					a.note ?? '',
				])
			}],
			textSummary: `${alerts.length} alert${alerts.length > 1 ? 's' : ''}: ${alerts.map(a => `${a.symbol} ${a.condition} ${a.target}`).join(', ')}.`
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});

// ─── delete_alert ─────────────────────────────────────────────────────────────

registerTool({
	name: 'delete_alert',
	description: 'Delete a price alert by ID. Use when user wants to cancel or remove an alert.',
	parameters: {
		type: 'object',
		properties: {
			alert_id: { type: 'string', description: 'Alert ID to delete (from list_alerts)' },
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
		},
		required: ['alert_id']
	},
	timeout: 10_000,
	execute: async (args): Promise<ToolResult> => {
		if (!args.alert_id) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'alert_id is required.', tool: 'delete_alert' }],
				textSummary: 'Error: alert_id required.'
			};
		}

		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;
		const ok = await deleteAlert(userId, String(args.alert_id));

		if (!ok) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: 'Alert not found or could not be deleted.', tool: 'delete_alert' }],
				textSummary: 'Error: Could not delete alert.'
			};
		}

		toolCache.set(toolCache.generateKey('list_alerts', { userId }), null as unknown as ToolResult, 0);

		return {
			success: true,
			contentBlocks: [],
			textSummary: `Alert ${String(args.alert_id).slice(0, 8)} deleted.`
		};
	}
});
