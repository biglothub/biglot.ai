// Strategy CRUD - T-103
// Supabase CRUD for trading strategy definitions

import { getSupabaseAdminClient } from './supabaseAdmin.server';
import { validateStrategy, type Strategy, type ValidationResult } from '$lib/types/strategy';

export { validateStrategy };
export type { ValidationResult };

// ─── DB row shape ─────────────────────────────────────────────────────────────

type StrategyRow = {
	id: string;
	biglot_user_id: string;
	name: string;
	description: string | null;
	version: number;
	is_active: boolean;
	definition: Strategy;
	created_at: string;
	updated_at: string;
};

function rowToStrategy(row: StrategyRow): Strategy {
	return {
		...row.definition,
		id: row.id,
		biglotUserId: row.biglot_user_id,
		name: row.name,
		description: row.description ?? undefined,
		version: row.version,
		isActive: row.is_active,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createStrategy(strategy: Strategy): Promise<Strategy> {
	const result = validateStrategy(strategy);
	if (!result.valid) {
		throw new Error(`Invalid strategy: ${result.errors.join('; ')}`);
	}

	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('strategies')
		.insert({
			biglot_user_id: strategy.biglotUserId,
			name: strategy.name,
			description: strategy.description ?? null,
			version: strategy.version,
			is_active: strategy.isActive,
			definition: strategy
		})
		.select('*')
		.single();

	if (error || !data) throw new Error(`Failed to create strategy: ${error?.message ?? 'no data'}`);
	return rowToStrategy(data as StrategyRow);
}

export async function getStrategy(
	biglotUserId: string,
	id: string
): Promise<Strategy | null> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('strategies')
		.select('*')
		.eq('biglot_user_id', biglotUserId)
		.eq('id', id)
		.single();

	if (error || !data) return null;
	return rowToStrategy(data as StrategyRow);
}

export async function listStrategies(biglotUserId: string): Promise<Strategy[]> {
	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('strategies')
		.select('*')
		.eq('biglot_user_id', biglotUserId)
		.order('created_at', { ascending: false });

	if (error) throw new Error(`Failed to list strategies: ${error.message}`);
	return ((data as StrategyRow[]) ?? []).map(rowToStrategy);
}

export async function updateStrategy(
	biglotUserId: string,
	id: string,
	updates: Partial<Omit<Strategy, 'id' | 'biglotUserId' | 'createdAt' | 'updatedAt'>>
): Promise<Strategy> {
	const existing = await getStrategy(biglotUserId, id);
	if (!existing) throw new Error(`Strategy not found: ${id}`);

	const merged: Strategy = { ...existing, ...updates };
	const result = validateStrategy(merged);
	if (!result.valid) {
		throw new Error(`Invalid strategy: ${result.errors.join('; ')}`);
	}

	const supabase = getSupabaseAdminClient();
	const { data, error } = await supabase
		.from('strategies')
		.update({
			name: merged.name,
			description: merged.description ?? null,
			version: merged.version,
			is_active: merged.isActive,
			definition: merged,
			updated_at: new Date().toISOString()
		})
		.eq('biglot_user_id', biglotUserId)
		.eq('id', id)
		.select('*')
		.single();

	if (error || !data) throw new Error(`Failed to update strategy: ${error?.message ?? 'no data'}`);
	return rowToStrategy(data as StrategyRow);
}

export async function deleteStrategy(biglotUserId: string, id: string): Promise<void> {
	const supabase = getSupabaseAdminClient();
	const { error } = await supabase
		.from('strategies')
		.delete()
		.eq('biglot_user_id', biglotUserId)
		.eq('id', id);

	if (error) throw new Error(`Failed to delete strategy: ${error.message}`);
}
