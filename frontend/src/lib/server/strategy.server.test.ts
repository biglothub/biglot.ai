import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseAdminClientMock } = vi.hoisted(() => ({
	getSupabaseAdminClientMock: vi.fn()
}));

vi.mock('$lib/server/supabaseAdmin.server', () => ({
	getSupabaseAdminClient: getSupabaseAdminClientMock
}));

import {
	validateStrategy,
	createStrategy,
	getStrategy,
	listStrategies,
	updateStrategy,
	deleteStrategy
} from './strategy.server';
import type { Strategy } from '$lib/types/strategy';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_ID = 'user12345678';

const VALID_STRATEGY: Strategy = {
	biglotUserId: USER_ID,
	name: 'MA Crossover',
	description: 'Golden cross strategy',
	version: 1,
	timeframe: '4h',
	isActive: true,
	entry: {
		direction: 'long',
		groups: [
			{
				logic: 'AND',
				conditions: [
					{
						indicator: 'ema',
						params: { period: 20 },
						operator: 'crosses_above',
						threshold: { indicator: 'ema', params: { period: 50 } }
					}
				]
			}
		]
	},
	exit: [
		{ type: 'stop_loss', value: 2, unit: 'pct' },
		{ type: 'take_profit', value: 4, unit: 'pct' }
	],
	positionSizing: { method: 'fixed_fractional', riskPerTrade: 1 },
	risk: { maxDrawdownPct: 20, maxOpenPositions: 3 }
};

// ─── Mock Supabase ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

class MockQueryBuilder {
	// primaryAction tracks the DML operation; select() after insert/update just means "return data"
	private primaryAction: 'select' | 'insert' | 'update' | 'delete' = 'select';
	private filters: Array<(row: Row) => boolean> = [];
	private isSingle = false;
	private insertData: Row | null = null;
	private updateData: Row | null = null;

	constructor(
		private readonly tableName: string,
		private readonly store: Map<string, Row[]>
	) {}

	private rows(): Row[] {
		return this.store.get(this.tableName) ?? [];
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	select(_cols?: string) {
		// Only set action to 'select' if no DML has been specified yet
		if (this.primaryAction === 'select') {
			this.primaryAction = 'select';
		}
		// After insert/update, .select() means "return the affected row" — don't change primaryAction
		return this;
	}

	insert(data: Row) {
		this.primaryAction = 'insert';
		this.insertData = data;
		return this;
	}

	update(data: Row) {
		this.primaryAction = 'update';
		this.updateData = data;
		return this;
	}

	delete() {
		this.primaryAction = 'delete';
		return this;
	}

	eq(col: string, val: unknown) {
		this.filters.push((row) => row[col] === val);
		return this;
	}

	order() {
		return this;
	}

	single() {
		this.isSingle = true;
		return this;
	}

	then(resolve: (result: { data: unknown; error: unknown }) => void) {
		const rows = this.rows();
		const filtered = rows.filter((row) => this.filters.every((f) => f(row)));

		if (this.primaryAction === 'insert' && this.insertData) {
			const newRow: Row = {
				id: `id_${Date.now()}_${Math.random()}`,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				...this.insertData
			};
			this.store.set(this.tableName, [...rows, newRow]);
			const result = this.isSingle
				? { data: newRow, error: null }
				: { data: [newRow], error: null };
			return resolve(result);
		}

		if (this.primaryAction === 'update' && this.updateData) {
			const updated = filtered.map((row) => ({ ...row, ...this.updateData }));
			const unchanged = rows.filter((row) => !this.filters.every((f) => f(row)));
			this.store.set(this.tableName, [...unchanged, ...updated]);
			const result = this.isSingle
				? { data: updated[0] ?? null, error: updated[0] ? null : { message: 'not found' } }
				: { data: updated, error: null };
			return resolve(result);
		}

		if (this.primaryAction === 'delete') {
			this.store.set(this.tableName, rows.filter((row) => !this.filters.every((f) => f(row))));
			return resolve({ data: null, error: null });
		}

		// select
		if (this.isSingle) {
			const row = filtered[0] ?? null;
			return resolve({ data: row, error: row ? null : { message: 'not found' } });
		}
		return resolve({ data: filtered, error: null });
	}
}

function createMockSupabase() {
	const store = new Map<string, Row[]>();
	store.set('strategies', []);
	return {
		from: (table: string) => new MockQueryBuilder(table, store),
		_store: store
	};
}

// ─── validateStrategy ─────────────────────────────────────────────────────────

describe('validateStrategy', () => {
	it('accepts a fully valid strategy', () => {
		const result = validateStrategy(VALID_STRATEGY);
		expect(result.valid).toBe(true);
	});

	it('rejects non-object input', () => {
		for (const bad of [null, 'string', 42, undefined]) {
			const r = validateStrategy(bad);
			expect(r.valid).toBe(false);
		}
	});

	it('rejects short biglotUserId', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, biglotUserId: 'short' });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('biglotUserId'))).toBe(true);
	});

	it('rejects empty name', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, name: '' });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('name'))).toBe(true);
	});

	it('rejects name exceeding 100 chars', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, name: 'x'.repeat(101) });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('name'))).toBe(true);
	});

	it('rejects invalid timeframe', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, timeframe: '3h' });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('timeframe'))).toBe(true);
	});

	it('accepts all valid timeframes', () => {
		const timeframes = ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M'];
		for (const tf of timeframes) {
			const r = validateStrategy({ ...VALID_STRATEGY, timeframe: tf });
			expect(r.valid, `expected valid for timeframe ${tf}`).toBe(true);
		}
	});

	it('rejects non-positive version', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, version: 0 });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('version'))).toBe(true);
	});

	it('rejects non-boolean isActive', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, isActive: 'yes' });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('isActive'))).toBe(true);
	});

	// Entry condition tests
	it('rejects missing entry', () => {
		const { entry: _, ...rest } = VALID_STRATEGY;
		const r = validateStrategy({ ...rest });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('entry'))).toBe(true);
	});

	it('rejects invalid entry direction', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: { ...VALID_STRATEGY.entry, direction: 'sideways' }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('direction'))).toBe(true);
	});

	it('rejects empty entry groups', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: { direction: 'long', groups: [] }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('groups'))).toBe(true);
	});

	it('rejects invalid group logic', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: {
				direction: 'long',
				groups: [{ logic: 'XOR' as 'AND', conditions: VALID_STRATEGY.entry.groups[0].conditions }]
			}
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('logic'))).toBe(true);
	});

	it('rejects empty conditions array in group', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: { direction: 'long', groups: [{ logic: 'AND', conditions: [] }] }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('conditions'))).toBe(true);
	});

	it('rejects invalid indicator name', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: {
				direction: 'long',
				groups: [
					{
						logic: 'AND',
						conditions: [
							{ indicator: 'super_secret_indicator' as 'rsi', operator: '>', threshold: 50 }
						]
					}
				]
			}
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('indicator'))).toBe(true);
	});

	it('rejects invalid comparison operator', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: {
				direction: 'long',
				groups: [
					{
						logic: 'AND',
						conditions: [
							{ indicator: 'rsi', operator: 'is_amazing' as '>', threshold: 70 }
						]
					}
				]
			}
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('operator'))).toBe(true);
	});

	it('rejects non-finite threshold', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: {
				direction: 'long',
				groups: [
					{ logic: 'AND', conditions: [{ indicator: 'rsi', operator: '>', threshold: NaN }] }
				]
			}
		});
		expect(r.valid).toBe(false);
	});

	it('accepts indicator reference as threshold', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			entry: {
				direction: 'long',
				groups: [
					{
						logic: 'AND',
						conditions: [
							{
								indicator: 'close',
								operator: 'crosses_above',
								threshold: { indicator: 'sma', params: { period: 200 } }
							}
						]
					}
				]
			}
		});
		expect(r.valid).toBe(true);
	});

	// Exit condition tests
	it('rejects empty exit array', () => {
		const r = validateStrategy({ ...VALID_STRATEGY, exit: [] });
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('exit'))).toBe(true);
	});

	it('rejects exit without stop_loss', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			exit: [{ type: 'take_profit', value: 4, unit: 'pct' }]
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('stop_loss'))).toBe(true);
	});

	it('rejects stop_loss with non-positive value', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			exit: [{ type: 'stop_loss', value: 0, unit: 'pct' }]
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('value'))).toBe(true);
	});

	it('rejects time_based exit with non-integer bars', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			exit: [
				...VALID_STRATEGY.exit,
				{ type: 'time_based', bars: 1.5 }
			]
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('bars'))).toBe(true);
	});

	it('accepts indicator exit condition', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			exit: [
				...VALID_STRATEGY.exit,
				{
					type: 'indicator',
					condition: { indicator: 'rsi', operator: '>', threshold: 70 }
				}
			]
		});
		expect(r.valid).toBe(true);
	});

	it('accepts trailing stop exit', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			exit: [
				...VALID_STRATEGY.exit,
				{ type: 'trailing_stop', value: 1.5, unit: 'pct' }
			]
		});
		expect(r.valid).toBe(true);
	});

	// Position sizing tests
	it('rejects invalid sizing method', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			positionSizing: { method: 'magic' as 'kelly', riskPerTrade: 1 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('method'))).toBe(true);
	});

	it('rejects zero riskPerTrade', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			positionSizing: { method: 'fixed_fractional', riskPerTrade: 0 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('riskPerTrade'))).toBe(true);
	});

	it('rejects riskPerTrade > 100', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			positionSizing: { method: 'fixed_fractional', riskPerTrade: 101 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('riskPerTrade'))).toBe(true);
	});

	it('accepts all valid sizing methods', () => {
		const methods = ['fixed_fractional', 'kelly', 'volatility_adjusted', 'equal_risk'] as const;
		for (const method of methods) {
			const r = validateStrategy({
				...VALID_STRATEGY,
				positionSizing: { method, riskPerTrade: 1 }
			});
			expect(r.valid, `expected valid for method ${method}`).toBe(true);
		}
	});

	// Risk params tests
	it('rejects zero maxDrawdownPct', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			risk: { maxDrawdownPct: 0, maxOpenPositions: 3 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('maxDrawdownPct'))).toBe(true);
	});

	it('rejects maxDrawdownPct > 100', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			risk: { maxDrawdownPct: 101, maxOpenPositions: 3 }
		});
		expect(r.valid).toBe(false);
	});

	it('rejects non-integer maxOpenPositions', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			risk: { maxDrawdownPct: 20, maxOpenPositions: 1.5 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('maxOpenPositions'))).toBe(true);
	});

	it('rejects correlationLimit > 1', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			risk: { maxDrawdownPct: 20, maxOpenPositions: 3, correlationLimit: 1.1 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('correlationLimit'))).toBe(true);
	});

	it('accepts correlationLimit = 0', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			risk: { maxDrawdownPct: 20, maxOpenPositions: 3, correlationLimit: 0 }
		});
		expect(r.valid).toBe(true);
	});

	// Asset filter tests
	it('accepts strategy with assetFilter', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			assetFilter: {
				symbols: ['BTCUSDT', 'ETHUSDT'],
				minVolume24hUsd: 1_000_000,
				assetClass: ['crypto']
			}
		});
		expect(r.valid).toBe(true);
	});

	it('rejects assetFilter with invalid assetClass', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			assetFilter: { assetClass: ['crypto', 'nft' as 'crypto'] }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('assetClass'))).toBe(true);
	});

	it('rejects assetFilter with negative minVolume24hUsd', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			assetFilter: { minVolume24hUsd: -1 }
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.some((e) => e.includes('minVolume24hUsd'))).toBe(true);
	});

	it('collects all errors, not just the first', () => {
		const r = validateStrategy({
			...VALID_STRATEGY,
			name: '',
			timeframe: 'bad',
			version: 0
		});
		expect(r.valid).toBe(false);
		if (!r.valid) expect(r.errors.length).toBeGreaterThan(1);
	});
});

// ─── CRUD tests ───────────────────────────────────────────────────────────────

describe('createStrategy', () => {
	beforeEach(() => {
		getSupabaseAdminClientMock.mockReturnValue(createMockSupabase());
	});

	it('creates a strategy and returns it with an id', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		expect(created.id).toBeDefined();
		expect(created.biglotUserId).toBe(USER_ID);
		expect(created.name).toBe('MA Crossover');
		expect(created.version).toBe(1);
		expect(created.isActive).toBe(true);
		expect(created.createdAt).toBeDefined();
	});

	it('throws when strategy is invalid', async () => {
		const bad = { ...VALID_STRATEGY, name: '' };
		await expect(createStrategy(bad)).rejects.toThrow('Invalid strategy');
	});
});

describe('getStrategy', () => {
	beforeEach(() => {
		getSupabaseAdminClientMock.mockReturnValue(createMockSupabase());
	});

	it('returns null for non-existent id', async () => {
		const r = await getStrategy(USER_ID, 'nonexistent');
		expect(r).toBeNull();
	});

	it('retrieves a created strategy', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		const fetched = await getStrategy(USER_ID, created.id!);
		expect(fetched).not.toBeNull();
		expect(fetched!.id).toBe(created.id);
		expect(fetched!.name).toBe('MA Crossover');
	});

	it('does not return strategies of another user', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		const r = await getStrategy('other_user_id', created.id!);
		expect(r).toBeNull();
	});
});

describe('listStrategies', () => {
	beforeEach(() => {
		getSupabaseAdminClientMock.mockReturnValue(createMockSupabase());
	});

	it('returns empty array when no strategies exist', async () => {
		const list = await listStrategies(USER_ID);
		expect(list).toEqual([]);
	});

	it('returns all strategies for the user', async () => {
		await createStrategy(VALID_STRATEGY);
		await createStrategy({ ...VALID_STRATEGY, name: 'RSI Strategy' });
		const list = await listStrategies(USER_ID);
		expect(list).toHaveLength(2);
	});

	it('isolates strategies by user', async () => {
		await createStrategy(VALID_STRATEGY);
		await createStrategy({
			...VALID_STRATEGY,
			biglotUserId: 'other_user_id',
			name: 'Other Strategy'
		});
		const list = await listStrategies(USER_ID);
		expect(list).toHaveLength(1);
		expect(list[0].name).toBe('MA Crossover');
	});
});

describe('updateStrategy', () => {
	beforeEach(() => {
		getSupabaseAdminClientMock.mockReturnValue(createMockSupabase());
	});

	it('updates strategy fields', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		const updated = await updateStrategy(USER_ID, created.id!, { name: 'Updated Strategy', version: 2 });
		expect(updated.name).toBe('Updated Strategy');
		expect(updated.version).toBe(2);
		expect(updated.id).toBe(created.id);
	});

	it('throws when strategy not found', async () => {
		await expect(updateStrategy(USER_ID, 'nonexistent', { name: 'x' })).rejects.toThrow(
			'Strategy not found'
		);
	});

	it('throws when updated strategy would be invalid', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		await expect(
			updateStrategy(USER_ID, created.id!, { name: '', version: 2 })
		).rejects.toThrow('Invalid strategy');
	});
});

describe('deleteStrategy', () => {
	beforeEach(() => {
		getSupabaseAdminClientMock.mockReturnValue(createMockSupabase());
	});

	it('deletes a strategy', async () => {
		const created = await createStrategy(VALID_STRATEGY);
		await deleteStrategy(USER_ID, created.id!);
		const fetched = await getStrategy(USER_ID, created.id!);
		expect(fetched).toBeNull();
	});

	it('does not throw when deleting non-existent strategy', async () => {
		await expect(deleteStrategy(USER_ID, 'nonexistent')).resolves.not.toThrow();
	});
});
