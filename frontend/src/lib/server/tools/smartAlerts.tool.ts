// Smart Alert Engine Tool — T-1201
// Tool: manage_smart_alerts
// Compound conditions: price+RSI, price+volume spike, correlation break
// Checks + pushes via Telegram

import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import { fetchOHLCV } from '../data/ohlcvProvider';
import { rsi as calcRSI } from '../indicators/engine';
import { sendTelegramMessage } from '../telegram.server';
import {
	isValidSmartAlertCondition,
	isValidPriceDirection,
	mapSmartAlertRow,
	evaluateSmartAlertCondition,
	formatSmartAlertTelegram,
	describeSmartAlert,
	type SmartAlert,
	type SmartAlertRow,
	type CreateSmartAlertInput,
} from '../data/smartAlerts.data';
import type { MetricCardBlock, TableBlock } from '$lib/types/contentBlock';

const DEFAULT_USER = 'default';
const OHLCV_LIMIT = 200; // candles for RSI + volume avg

// ─── DB Helpers ───────────────────────────────────────────────────────────────

async function dbCreateSmartAlert(input: CreateSmartAlertInput & { userId: string }): Promise<SmartAlert | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('smart_alerts')
		.insert({
			user_id: input.userId,
			symbol: input.symbol.toUpperCase(),
			condition: input.condition,
			price_threshold: input.priceThreshold ?? null,
			price_direction: input.priceDirection ?? null,
			rsi_threshold: input.rsiThreshold ?? null,
			rsi_period: input.rsiPeriod ?? 14,
			volume_multiplier: input.volumeMultiplier ?? null,
			correlation_symbol_b: input.correlationSymbolB ? input.correlationSymbolB.toUpperCase() : null,
			correlation_threshold: input.correlationThreshold ?? null,
			note: input.note ?? null,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapSmartAlertRow(data as SmartAlertRow);
}

async function dbListSmartAlerts(userId: string, includeTriggered = false): Promise<SmartAlert[]> {
	const db = getSupabaseAdminClient();
	let q = db.from('smart_alerts').select().eq('user_id', userId);
	if (!includeTriggered) {
		q = (q as typeof q).eq('active', true).eq('triggered', false);
	}
	const { data, error } = await (q as typeof q).order('created_at', { ascending: false });
	if (error || !data) return [];
	return (data as SmartAlertRow[]).map(mapSmartAlertRow);
}

async function dbDeleteSmartAlert(userId: string, alertId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('smart_alerts')
		.delete()
		.eq('id', alertId)
		.eq('user_id', userId);
	return !error;
}

async function dbMarkTriggered(alertId: string): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('smart_alerts')
		.update({ triggered: true, triggered_at: new Date().toISOString(), active: false })
		.eq('id', alertId);
}

async function dbMarkChecked(alertId: string): Promise<void> {
	const db = getSupabaseAdminClient();
	await db
		.from('smart_alerts')
		.update({ last_checked_at: new Date().toISOString() })
		.eq('id', alertId);
}

async function getTelegramChatId(userId: string): Promise<number | null> {
	try {
		const db = getSupabaseAdminClient();
		const { data } = await db
			.from('telegram_links')
			.select('telegram_chat_id')
			.eq('biglot_user_id', userId)
			.eq('is_active', true)
			.limit(1);
		const chatId = (data as { telegram_chat_id: number }[] | null)?.[0]?.telegram_chat_id;
		return typeof chatId === 'number' ? chatId : null;
	} catch {
		return null;
	}
}

// ─── Market Data Helpers ──────────────────────────────────────────────────────

/** Pearson correlation coefficient between two arrays */
function pearsonCorr(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	if (n < 2) return 0;
	let sumA = 0, sumB = 0, sumAB = 0, sumA2 = 0, sumB2 = 0;
	for (let i = 0; i < n; i++) {
		sumA += a[i]; sumB += b[i]; sumAB += a[i] * b[i];
		sumA2 += a[i] * a[i]; sumB2 += b[i] * b[i];
	}
	const num = n * sumAB - sumA * sumB;
	const den = Math.sqrt((n * sumA2 - sumA ** 2) * (n * sumB2 - sumB ** 2));
	return den === 0 ? 0 : num / den;
}

type SymbolSnapshot = {
	price: number;
	rsi: number | undefined;
	volumeRatio: number | undefined;
	closes: number[];
};

async function fetchSymbolSnapshot(symbol: string): Promise<SymbolSnapshot | null> {
	const result = await fetchOHLCV(symbol, '1d', OHLCV_LIMIT);
	if ('error' in result || result.ohlcv.length < 2) return null;

	const ohlcv = result.ohlcv;
	const price = ohlcv[ohlcv.length - 1].close;
	const closes = ohlcv.map(c => c.close);

	// RSI
	const rsiPoints = calcRSI(ohlcv, 14);
	const rsiVal = rsiPoints.length > 0 ? rsiPoints[rsiPoints.length - 1].value : undefined;

	// Volume ratio: current vs 20-candle avg
	let volumeRatio: number | undefined;
	if (ohlcv.length >= 21) {
		const recent = ohlcv[ohlcv.length - 1].volume;
		const avg20 = ohlcv.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
		volumeRatio = avg20 > 0 ? recent / avg20 : undefined;
	}

	return { price, rsi: rsiVal, volumeRatio, closes };
}

// ─── check_now: evaluate all active alerts ───────────────────────────────────

async function runCheckNow(userId: string): Promise<{
	fired: SmartAlert[];
	checked: number;
	telegramSent: number;
}> {
	const alerts = await dbListSmartAlerts(userId, false);
	if (alerts.length === 0) return { fired: [], checked: 0, telegramSent: 0 };

	// Collect unique symbols (primary + correlation partner)
	const symbolSet = new Set<string>();
	for (const a of alerts) {
		symbolSet.add(a.symbol);
		if (a.correlationSymbolB) symbolSet.add(a.correlationSymbolB);
	}

	// Fetch snapshots in parallel
	const snapshotMap = new Map<string, SymbolSnapshot>();
	const fetches = await Promise.allSettled(
		[...symbolSet].map(async (sym) => {
			const snap = await fetchSymbolSnapshot(sym);
			if (snap) snapshotMap.set(sym, snap);
		})
	);
	void fetches; // results captured via snapshotMap

	// Evaluate alerts
	const fired: SmartAlert[] = [];
	const chatId = await getTelegramChatId(userId);
	let telegramSent = 0;

	for (const alert of alerts) {
		const snap = snapshotMap.get(alert.symbol);
		if (!snap) {
			await dbMarkChecked(alert.id);
			continue;
		}

		// Compute correlation if needed
		let correlation: number | undefined;
		if (alert.condition === 'correlation_break' && alert.correlationSymbolB) {
			const snapB = snapshotMap.get(alert.correlationSymbolB);
			if (snapB) {
				const n = Math.min(snap.closes.length, snapB.closes.length, 30);
				correlation = pearsonCorr(snap.closes.slice(-n), snapB.closes.slice(-n));
			}
		}

		const evalResult = evaluateSmartAlertCondition(alert, {
			currentPrice: snap.price,
			rsi: snap.rsi,
			volumeRatio: snap.volumeRatio,
			correlation,
		});

		await dbMarkChecked(alert.id);

		if (evalResult.triggered) {
			await dbMarkTriggered(alert.id);
			fired.push({ ...alert, triggered: true, triggeredAt: new Date().toISOString() });

			if (chatId) {
				const msg = formatSmartAlertTelegram(alert, evalResult.reason);
				try {
					await sendTelegramMessage(chatId, msg, { parseMode: 'HTML' });
					telegramSent++;
				} catch {
					// Telegram push failed — continue silently
				}
			}
		}
	}

	return { fired, checked: alerts.length, telegramSent };
}

// ─── Tool Registration ────────────────────────────────────────────────────────

registerTool({
	name: 'manage_smart_alerts',
	description:
		'Manage compound smart alerts with multi-condition triggers: price threshold, price AND RSI, price AND volume spike (>3x avg), or correlation break between two assets. Actions: create (set a new alert), list (show active alerts), delete (remove an alert), check_now (evaluate all alerts and push Telegram notifications for triggered ones). Returns MetricCard (active count, triggered today) + TableBlock (alert list with status and conditions).',
	parameters: {
		type: 'object',
		properties: {
			action: {
				type: 'string',
				enum: ['create', 'list', 'delete', 'check_now'],
				description: 'Action to perform',
			},
			// create params
			symbol: { type: 'string', description: 'Trading symbol (e.g. BTCUSDT, XAUUSD)' },
			condition: {
				type: 'string',
				enum: ['price_above', 'price_below', 'price_and_rsi_above', 'price_and_rsi_below', 'price_and_volume_spike', 'correlation_break'],
				description: 'Alert condition type',
			},
			price_threshold: { type: 'number', description: 'Price level for the alert' },
			price_direction: {
				type: 'string',
				enum: ['above', 'below'],
				description: 'For compound conditions: price must be above or below the threshold',
			},
			rsi_threshold: { type: 'number', description: 'RSI threshold for price_and_rsi_* conditions' },
			rsi_period: { type: 'number', description: 'RSI period (default 14)' },
			volume_multiplier: { type: 'number', description: 'Volume multiplier threshold (default 3x)' },
			correlation_symbol_b: { type: 'string', description: 'Second symbol for correlation_break condition' },
			correlation_threshold: { type: 'number', description: 'Correlation r below which alert fires (e.g. 0.3)' },
			note: { type: 'string', description: 'Optional note about this alert' },
			// delete params
			alert_id: { type: 'string', description: 'Alert ID to delete (from list action)' },
			// shared
			user_id: { type: 'string', description: 'User ID (defaults to "default")' },
			include_triggered: { type: 'boolean', description: 'Include triggered alerts in list (default false)' },
		},
		required: ['action'],
	},
	timeout: 60_000,
	execute: async (args): Promise<ToolResult> => {
		const action = String(args.action ?? '');
		const userId = typeof args.user_id === 'string' ? args.user_id : DEFAULT_USER;

		// ── CREATE ────────────────────────────────────────────────────────────
		if (action === 'create') {
			if (!args.symbol || typeof args.symbol !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'symbol is required.', tool: 'manage_smart_alerts' }],
					textSummary: 'Error: symbol required.',
				};
			}
			if (!isValidSmartAlertCondition(args.condition)) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: `condition must be one of: ${['price_above', 'price_below', 'price_and_rsi_above', 'price_and_rsi_below', 'price_and_volume_spike', 'correlation_break'].join(', ')}.`, tool: 'manage_smart_alerts' }],
					textSummary: 'Error: invalid condition.',
				};
			}

			const input: CreateSmartAlertInput = {
				symbol: String(args.symbol),
				condition: args.condition,
				priceThreshold: typeof args.price_threshold === 'number' ? args.price_threshold : null,
				priceDirection: isValidPriceDirection(args.price_direction) ? args.price_direction : null,
				rsiThreshold: typeof args.rsi_threshold === 'number' ? args.rsi_threshold : null,
				rsiPeriod: typeof args.rsi_period === 'number' ? Math.max(2, Math.min(50, args.rsi_period)) : 14,
				volumeMultiplier: typeof args.volume_multiplier === 'number' ? args.volume_multiplier : null,
				correlationSymbolB: typeof args.correlation_symbol_b === 'string' ? args.correlation_symbol_b : null,
				correlationThreshold: typeof args.correlation_threshold === 'number' ? args.correlation_threshold : null,
				note: typeof args.note === 'string' ? args.note : null,
			};

			const alert = await dbCreateSmartAlert({ ...input, userId });
			if (!alert) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Failed to save smart alert. Make sure the smart_alerts table exists in Supabase.', tool: 'manage_smart_alerts' }],
					textSummary: 'Error: Could not create smart alert.',
				};
			}

			const desc = describeSmartAlert(alert);
			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: `Smart Alert Created — ${alert.symbol}`,
				metrics: [
					{ label: 'Symbol', value: alert.symbol, direction: 'neutral' },
					{ label: 'Condition', value: alert.condition.replace(/_/g, ' '), direction: 'neutral' },
					{ label: 'Description', value: desc, direction: 'neutral' },
					{ label: 'Status', value: 'Active', direction: 'neutral' },
					...(alert.note ? [{ label: 'Note', value: alert.note, direction: 'neutral' as const }] : []),
				],
			};

			return {
				success: true,
				contentBlocks: [metricCard],
				textSummary: `Smart alert created: ${desc}. ID: ${alert.id.slice(0, 8)}.`,
			};
		}

		// ── LIST ──────────────────────────────────────────────────────────────
		if (action === 'list') {
			const includeTriggered = args.include_triggered === true;
			const cacheKey = toolCache.generateKey('manage_smart_alerts_list', { userId, includeTriggered });
			const cached = toolCache.get<ToolResult>(cacheKey);
			if (cached) return cached;

			const alerts = await dbListSmartAlerts(userId, includeTriggered);
			const todayStart = new Date();
			todayStart.setHours(0, 0, 0, 0);
			const triggeredToday = alerts.filter(
				a => a.triggeredAt && new Date(a.triggeredAt) >= todayStart
			).length;
			const activeCount = alerts.filter(a => a.active && !a.triggered).length;

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: 'Smart Alerts Summary',
				metrics: [
					{ label: 'Active Alerts', value: String(activeCount), direction: 'neutral' },
					{ label: 'Triggered Today', value: String(triggeredToday), direction: triggeredToday > 0 ? 'up' : 'neutral' },
					{ label: 'Total Shown', value: String(alerts.length), direction: 'neutral' },
				],
			};

			if (alerts.length === 0) {
				return {
					success: true,
					contentBlocks: [metricCard],
					textSummary: 'No smart alerts. Use manage_smart_alerts with action=create to set one.',
				};
			}

			const tableBlock: TableBlock = {
				type: 'table',
				title: `Smart Alerts (${alerts.length})`,
				headers: ['Symbol', 'Condition', 'Description', 'Status', 'Last Triggered', 'Note'],
				rows: alerts.map(a => [
					a.symbol,
					a.condition.replace(/_/g, ' '),
					describeSmartAlert(a),
					a.triggered ? 'Triggered' : a.active ? 'Active' : 'Inactive',
					a.triggeredAt ? a.triggeredAt.slice(0, 16).replace('T', ' ') : '-',
					a.note ?? '',
				]),
			};

			const result: ToolResult = {
				success: true,
				contentBlocks: [metricCard, tableBlock],
				textSummary: `${activeCount} active smart alert(s), ${triggeredToday} triggered today. Alerts: ${alerts.map(a => describeSmartAlert(a)).join(' | ')}.`,
			};

			toolCache.set(cacheKey, result, 60_000); // 1 min cache
			return result;
		}

		// ── DELETE ────────────────────────────────────────────────────────────
		if (action === 'delete') {
			if (!args.alert_id || typeof args.alert_id !== 'string') {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'alert_id is required for delete action.', tool: 'manage_smart_alerts' }],
					textSummary: 'Error: alert_id required.',
				};
			}
			const ok = await dbDeleteSmartAlert(userId, String(args.alert_id));
			if (!ok) {
				return {
					success: false,
					contentBlocks: [{ type: 'error', message: 'Alert not found or could not be deleted.', tool: 'manage_smart_alerts' }],
					textSummary: 'Error: Could not delete alert.',
				};
			}
			// Invalidate list cache
			toolCache.set(toolCache.generateKey('manage_smart_alerts_list', { userId, includeTriggered: false }), null as unknown as ToolResult, 0);
			return {
				success: true,
				contentBlocks: [],
				textSummary: `Smart alert ${String(args.alert_id).slice(0, 8)} deleted.`,
			};
		}

		// ── CHECK_NOW ─────────────────────────────────────────────────────────
		if (action === 'check_now') {
			const { fired, checked, telegramSent } = await runCheckNow(userId);

			const metricCard: MetricCardBlock = {
				type: 'metric_card',
				title: 'Smart Alert Check Results',
				metrics: [
					{ label: 'Alerts Checked', value: String(checked), direction: 'neutral' },
					{ label: 'Triggered', value: String(fired.length), direction: fired.length > 0 ? 'up' : 'neutral' },
					{ label: 'Telegram Notifications Sent', value: String(telegramSent), direction: telegramSent > 0 ? 'up' : 'neutral' },
					{ label: 'Checked At', value: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', direction: 'neutral' },
				],
			};

			if (fired.length === 0) {
				return {
					success: true,
					contentBlocks: [metricCard],
					textSummary: `Checked ${checked} alert(s). None triggered.`,
				};
			}

			const tableBlock: TableBlock = {
				type: 'table',
				title: `Triggered Alerts (${fired.length})`,
				headers: ['Symbol', 'Condition', 'Description', 'Triggered At'],
				rows: fired.map(a => [
					a.symbol,
					a.condition.replace(/_/g, ' '),
					describeSmartAlert(a),
					a.triggeredAt ? a.triggeredAt.slice(0, 16).replace('T', ' ') : 'now',
				]),
			};

			// Invalidate list cache
			toolCache.set(toolCache.generateKey('manage_smart_alerts_list', { userId, includeTriggered: false }), null as unknown as ToolResult, 0);

			return {
				success: true,
				contentBlocks: [metricCard, tableBlock],
				textSummary: `Checked ${checked} alert(s). ${fired.length} triggered: ${fired.map(a => describeSmartAlert(a)).join(', ')}. ${telegramSent > 0 ? `${telegramSent} Telegram notification(s) sent.` : 'No Telegram linked.'}`,
			};
		}

		// ── Unknown action ────────────────────────────────────────────────────
		return {
			success: false,
			contentBlocks: [{ type: 'error', message: `Unknown action: ${action}. Use create, list, delete, or check_now.`, tool: 'manage_smart_alerts' }],
			textSummary: `Error: unknown action "${action}".`,
		};
	},
});
