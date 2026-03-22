// DCA Bot Engine Data Layer — T-1203
// Paper Dollar-Cost Averaging bot: config types, execution records, performance math

// ─── Types ────────────────────────────────────────────────────────────────────

export type DcaInterval = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export const VALID_DCA_INTERVALS: DcaInterval[] = ['daily', 'weekly', 'biweekly', 'monthly'];

export type DcaBot = {
	id: string;
	userId: string;
	symbol: string;
	amountPerInterval: number;  // USDT to spend per buy
	interval: DcaInterval;
	dipMultiplier: number | null;   // e.g. 2 = 2× amount when dip condition is met
	dipMaLength: number | null;     // MA period, e.g. 200
	dipThresholdPct: number | null; // % below MA to trigger dip buy, e.g. 5
	active: boolean;
	nextExecutionAt: string;        // ISO timestamp
	lastExecutionAt: string | null;
	totalInvested: number;          // cumulative USDT invested
	executionCount: number;
	createdAt: string;
};

export type DcaExecution = {
	id: string;
	botId: string;
	userId: string;
	symbol: string;
	price: number;
	amount: number;   // USDT spent
	qty: number;      // base asset units purchased (amount / price)
	isDipBuy: boolean;
	executedAt: string;
};

export type DcaPerformance = {
	totalInvested: number;
	totalQty: number;
	avgCostBasis: number;
	currentPrice: number;
	currentValue: number;
	unrealisedPnL: number;
	unrealisedPct: number;
	executionCount: number;
	lumpSumInvested: number | null; // total_invested if deployed all at first price
	lumpSumValue: number | null;    // lump sum qty × current price
	lumpSumPct: number | null;      // lump sum return %
};

export type CreateDcaBotInput = {
	symbol: string;
	amountPerInterval: number;
	interval: DcaInterval;
	dipMultiplier?: number | null;
	dipMaLength?: number | null;
	dipThresholdPct?: number | null;
};

// ─── DB Row Types (mirrors Supabase) ──────────────────────────────────────────

export type DcaBotRow = {
	id: string;
	user_id: string;
	symbol: string;
	amount_per_interval: number;
	interval: string;
	dip_multiplier: number | null;
	dip_ma_length: number | null;
	dip_threshold_pct: number | null;
	active: boolean;
	next_execution_at: string;
	last_execution_at: string | null;
	total_invested: number;
	execution_count: number;
	created_at: string;
};

export type DcaExecutionRow = {
	id: string;
	bot_id: string;
	user_id: string;
	symbol: string;
	price: number;
	amount: number;
	qty: number;
	is_dip_buy: boolean;
	executed_at: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidDcaInterval(v: unknown): v is DcaInterval {
	return typeof v === 'string' && (VALID_DCA_INTERVALS as string[]).includes(v);
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export function mapDcaBotRow(row: DcaBotRow): DcaBot {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		amountPerInterval: Number(row.amount_per_interval),
		interval: isValidDcaInterval(row.interval) ? row.interval : 'weekly',
		dipMultiplier: row.dip_multiplier !== null ? Number(row.dip_multiplier) : null,
		dipMaLength: row.dip_ma_length !== null ? Number(row.dip_ma_length) : null,
		dipThresholdPct: row.dip_threshold_pct !== null ? Number(row.dip_threshold_pct) : null,
		active: row.active,
		nextExecutionAt: row.next_execution_at,
		lastExecutionAt: row.last_execution_at,
		totalInvested: Number(row.total_invested),
		executionCount: Number(row.execution_count),
		createdAt: row.created_at,
	};
}

export function mapDcaExecutionRow(row: DcaExecutionRow): DcaExecution {
	return {
		id: row.id,
		botId: row.bot_id,
		userId: row.user_id,
		symbol: row.symbol,
		price: Number(row.price),
		amount: Number(row.amount),
		qty: Number(row.qty),
		isDipBuy: Boolean(row.is_dip_buy),
		executedAt: row.executed_at,
	};
}

// ─── Pure Calculation Functions ───────────────────────────────────────────────

/**
 * Calculate average cost basis from a list of executions.
 * Returns 0 if no executions (no division by zero).
 */
export function calcAvgCostBasis(executions: DcaExecution[]): number {
	const totalQty = executions.reduce((s, e) => s + e.qty, 0);
	if (totalQty === 0) return 0;
	const totalCost = executions.reduce((s, e) => s + e.amount, 0);
	return totalCost / totalQty;
}

/**
 * Calculate full DCA performance metrics vs lump sum.
 * Lump sum baseline: total_invested deployed all at once at the first execution price.
 */
export function calcDcaPerformance(
	executions: DcaExecution[],
	currentPrice: number
): DcaPerformance {
	if (executions.length === 0) {
		return {
			totalInvested: 0,
			totalQty: 0,
			avgCostBasis: 0,
			currentPrice,
			currentValue: 0,
			unrealisedPnL: 0,
			unrealisedPct: 0,
			executionCount: 0,
			lumpSumInvested: null,
			lumpSumValue: null,
			lumpSumPct: null,
		};
	}

	const totalInvested = executions.reduce((s, e) => s + e.amount, 0);
	const totalQty = executions.reduce((s, e) => s + e.qty, 0);
	const avgCostBasis = totalQty > 0 ? totalInvested / totalQty : 0;
	const currentValue = totalQty * currentPrice;
	const unrealisedPnL = currentValue - totalInvested;
	const unrealisedPct = totalInvested > 0 ? (unrealisedPnL / totalInvested) * 100 : 0;

	// Lump sum: if you had invested all totalInvested at the first execution price
	const sortedByDate = [...executions].sort(
		(a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
	);
	const firstPrice = sortedByDate[0].price;
	const lumpSumQty = firstPrice > 0 ? totalInvested / firstPrice : 0;
	const lumpSumValue = lumpSumQty * currentPrice;
	const lumpSumPct = totalInvested > 0 ? ((lumpSumValue - totalInvested) / totalInvested) * 100 : 0;

	return {
		totalInvested,
		totalQty,
		avgCostBasis,
		currentPrice,
		currentValue,
		unrealisedPnL,
		unrealisedPct,
		executionCount: executions.length,
		lumpSumInvested: totalInvested,
		lumpSumValue,
		lumpSumPct,
	};
}

/**
 * Compute DCA equity curve and lump-sum equity curve for chart rendering.
 * Both curves are indexed by execution date and show portfolio value at each point.
 * NOTE: This uses each execution's price as a proxy for current value snapshot.
 */
export function buildEquityCurve(executions: DcaExecution[]): {
	timestamps: number[];
	dcaEquity: number[];
	lumpSumEquity: number[];
} {
	if (executions.length === 0) {
		return { timestamps: [], dcaEquity: [], lumpSumEquity: [] };
	}

	const sorted = [...executions].sort(
		(a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime()
	);

	const firstPrice = sorted[0].price;
	let totalInvestedSoFar = 0;

	const timestamps: number[] = [];
	const dcaEquity: number[] = [];
	const lumpSumEquity: number[] = [];

	// Track all qty purchased so far for each snapshot
	let cumulativeQty = 0;

	for (const exec of sorted) {
		totalInvestedSoFar += exec.amount;
		cumulativeQty += exec.qty;
		const price = exec.price;
		const ts = Math.floor(new Date(exec.executedAt).getTime() / 1000);

		// DCA equity at this point: qty so far × current price snapshot
		dcaEquity.push(cumulativeQty * price);

		// Lump sum: if you had bought all totalInvested at firstPrice, at same price snapshot
		const lumpSumQty = firstPrice > 0 ? totalInvestedSoFar / firstPrice : 0;
		lumpSumEquity.push(lumpSumQty * price);

		timestamps.push(ts);
	}

	return { timestamps, dcaEquity, lumpSumEquity };
}

/**
 * Return the next execution date from a given date for the given interval.
 */
export function calcNextExecution(interval: DcaInterval, fromDate: Date = new Date()): Date {
	const next = new Date(fromDate.getTime());
	switch (interval) {
		case 'daily':
			next.setDate(next.getDate() + 1);
			break;
		case 'weekly':
			next.setDate(next.getDate() + 7);
			break;
		case 'biweekly':
			next.setDate(next.getDate() + 14);
			break;
		case 'monthly':
			next.setMonth(next.getMonth() + 1);
			break;
	}
	return next;
}

/**
 * Returns true if current price is at least thresholdPct% below the MA price.
 */
export function isDipCondition(
	currentPrice: number,
	maPrice: number,
	thresholdPct: number
): boolean {
	if (maPrice <= 0) return false;
	const dropPct = ((maPrice - currentPrice) / maPrice) * 100;
	return dropPct >= thresholdPct;
}

/**
 * Human-readable description of a DCA bot config.
 */
export function describeDcaBot(bot: DcaBot): string {
	const base = `Buy $${bot.amountPerInterval} of ${bot.symbol} ${bot.interval}`;
	if (bot.dipMultiplier !== null && bot.dipMaLength !== null && bot.dipThresholdPct !== null) {
		return `${base} (${bot.dipMultiplier}× when price is ${bot.dipThresholdPct}% below MA${bot.dipMaLength})`;
	}
	return base;
}

/**
 * Format interval as human-readable label.
 */
export function formatInterval(interval: DcaInterval): string {
	switch (interval) {
		case 'daily':    return 'Daily';
		case 'weekly':   return 'Weekly';
		case 'biweekly': return 'Bi-weekly';
		case 'monthly':  return 'Monthly';
	}
}
