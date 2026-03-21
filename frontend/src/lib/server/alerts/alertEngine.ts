// Alert Engine — T-401
// CRUD for price alerts + trigger evaluation

import { getSupabaseAdminClient } from '../supabaseAdmin.server';
import type { PriceAlert, AlertCondition } from '$lib/types/alert';

// ─── Type mapping ─────────────────────────────────────────────────────────────

type DbAlert = {
	id: string;
	user_id: string;
	symbol: string;
	condition: AlertCondition;
	target: number;
	note: string | null;
	triggered: boolean;
	triggered_at: string | null;
	active: boolean;
	created_at: string;
};

function mapAlert(row: DbAlert): PriceAlert {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		condition: row.condition,
		target: row.target,
		note: row.note,
		triggered: row.triggered,
		triggeredAt: row.triggered_at,
		active: row.active,
		createdAt: row.created_at,
	};
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Evaluate whether an alert should trigger given the current price.
 * For 'crosses': triggers when prevPrice was on the opposite side of target.
 */
export function shouldTrigger(
	alert: Pick<PriceAlert, 'condition' | 'target'>,
	currentPrice: number,
	prevPrice?: number
): boolean {
	const { condition, target } = alert;
	if (condition === 'above') return currentPrice >= target;
	if (condition === 'below') return currentPrice <= target;
	if (condition === 'crosses') {
		if (prevPrice === undefined) return false;
		const wasAbove = prevPrice > target;
		const isAbove = currentPrice > target;
		return wasAbove !== isAbove;
	}
	return false;
}

/**
 * Format a trigger message for a fired alert.
 */
export function formatTriggerMessage(alert: PriceAlert, currentPrice: number): string {
	const conditionStr = alert.condition === 'above'
		? `rose above ${alert.target}`
		: alert.condition === 'below'
		? `fell below ${alert.target}`
		: `crossed ${alert.target}`;
	return `Alert: ${alert.symbol} ${conditionStr} (current: ${currentPrice})${alert.note ? ` — ${alert.note}` : ''}`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export type CreateAlertInput = {
	symbol: string;
	condition: AlertCondition;
	target: number;
	note?: string | null;
};

export async function createAlert(userId: string, input: CreateAlertInput): Promise<PriceAlert | null> {
	const db = getSupabaseAdminClient();
	const { data, error } = await db
		.from('price_alerts')
		.insert({
			user_id: userId,
			symbol: input.symbol.toUpperCase(),
			condition: input.condition,
			target: input.target,
			note: input.note ?? null,
		})
		.select()
		.single();

	if (error || !data) return null;
	return mapAlert(data as DbAlert);
}

export async function listAlerts(userId: string, includeTriggered = false): Promise<PriceAlert[]> {
	const db = getSupabaseAdminClient();
	let query = db
		.from('price_alerts')
		.select()
		.eq('user_id', userId);

	if (!includeTriggered) {
		query = (query as typeof query).eq('active', true).eq('triggered', false);
	}

	const { data, error } = await (query as typeof query).order('created_at', { ascending: false });
	if (error || !data) return [];
	return (data as DbAlert[]).map(mapAlert);
}

export async function deleteAlert(userId: string, alertId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('price_alerts')
		.delete()
		.eq('id', alertId)
		.eq('user_id', userId);
	return !error;
}

export async function markAlertTriggered(alertId: string): Promise<boolean> {
	const db = getSupabaseAdminClient();
	const { error } = await db
		.from('price_alerts')
		.update({ triggered: true, triggered_at: new Date().toISOString(), active: false })
		.eq('id', alertId);
	return !error;
}

/**
 * Check all active alerts for a user against a price map.
 * Returns alerts that fired.
 */
export async function checkAlerts(
	userId: string,
	priceMap: Map<string, number>,
	prevPriceMap?: Map<string, number>
): Promise<PriceAlert[]> {
	const alerts = await listAlerts(userId, false);
	const fired: PriceAlert[]= [];

	for (const alert of alerts) {
		const current = priceMap.get(alert.symbol);
		if (current === undefined) continue;
		const prev = prevPriceMap?.get(alert.symbol);
		if (shouldTrigger(alert, current, prev)) {
			await markAlertTriggered(alert.id);
			fired.push(alert);
		}
	}

	return fired;
}
