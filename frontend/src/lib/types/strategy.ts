// Strategy Definition Schema - T-103
// JSON schema for defining algorithmic trading strategies

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type Timeframe =
	| '1m' | '5m' | '15m' | '30m'
	| '1h' | '2h' | '4h' | '6h' | '12h'
	| '1d' | '1w' | '1M';

export type ComparisonOperator =
	| '>'
	| '<'
	| '>='
	| '<='
	| '=='
	| 'crosses_above'
	| 'crosses_below';

export type IndicatorName =
	| 'sma' | 'ema' | 'rsi'
	| 'macd' | 'macd_signal' | 'macd_histogram'
	| 'bollinger_upper' | 'bollinger_lower' | 'bollinger_middle'
	| 'atr' | 'stochastic_k' | 'stochastic_d'
	| 'adx' | 'obv' | 'vwap'
	| 'williams_r' | 'cci' | 'mfi' | 'supertrend'
	| 'close' | 'open' | 'high' | 'low' | 'volume';

export type PositionSizingMethod =
	| 'fixed_fractional'
	| 'kelly'
	| 'volatility_adjusted'
	| 'equal_risk';

export type RiskUnit = 'pct' | 'atr_multiple' | 'absolute';
export type ProfitUnit = 'pct' | 'atr_multiple' | 'r_multiple' | 'absolute';
export type AssetClass = 'crypto' | 'forex' | 'equity' | 'commodity';

// ─── Indicator Condition ──────────────────────────────────────────────────────

/** Reference to another indicator used as a threshold */
export type IndicatorRef = {
	indicator: IndicatorName;
	params?: Record<string, number>;
};

/**
 * A single condition comparing an indicator to a fixed value or another indicator.
 * Example: RSI(14) > 70   |   close crosses_above sma(200)
 */
export type IndicatorCondition = {
	indicator: IndicatorName;
	params?: Record<string, number>;
	operator: ComparisonOperator;
	threshold: number | IndicatorRef;
};

// ─── Condition Groups ─────────────────────────────────────────────────────────

export type ConditionGroup = {
	logic: 'AND' | 'OR';
	conditions: IndicatorCondition[];
};

// ─── Entry ────────────────────────────────────────────────────────────────────

export type EntryCondition = {
	direction: 'long' | 'short' | 'both';
	/** Groups are combined with AND between each other */
	groups: ConditionGroup[];
};

// ─── Exit ─────────────────────────────────────────────────────────────────────

export type StopLossExit = {
	type: 'stop_loss';
	value: number;
	unit: RiskUnit;
};

export type TakeProfitExit = {
	type: 'take_profit';
	value: number;
	unit: ProfitUnit;
};

export type TrailingStopExit = {
	type: 'trailing_stop';
	value: number;
	unit: 'pct' | 'atr_multiple';
};

export type IndicatorExit = {
	type: 'indicator';
	condition: IndicatorCondition;
};

export type TimeBasedExit = {
	type: 'time_based';
	bars: number;
};

export type ExitCondition =
	| StopLossExit
	| TakeProfitExit
	| TrailingStopExit
	| IndicatorExit
	| TimeBasedExit;

// ─── Position Sizing ──────────────────────────────────────────────────────────

export type PositionSizing = {
	method: PositionSizingMethod;
	riskPerTrade: number; // % of account to risk per trade (0 < x ≤ 100)
	maxPositionPct?: number; // max % of account in one position (0 < x ≤ 100)
};

// ─── Risk Parameters ──────────────────────────────────────────────────────────

export type RiskParams = {
	maxDrawdownPct: number; // stop trading when portfolio drawdown exceeds this % (> 0, ≤ 100)
	maxOpenPositions: number; // max simultaneous open trades (positive integer)
	maxDailyLossPct?: number; // stop for the day if daily loss exceeds this % (0 < x ≤ 100)
	correlationLimit?: number; // 0–1, max allowed pairwise correlation between open positions
};

// ─── Asset Filter ─────────────────────────────────────────────────────────────

export type AssetFilter = {
	symbols?: string[];
	minVolume24hUsd?: number;
	minMarketCapUsd?: number;
	assetClass?: AssetClass[];
};

// ─── Strategy ─────────────────────────────────────────────────────────────────

export type Strategy = {
	id?: string;
	biglotUserId: string;
	name: string; // 1–100 chars
	description?: string;
	version: number; // positive integer, auto-incremented on update
	timeframe: Timeframe;
	entry: EntryCondition;
	exit: ExitCondition[]; // must contain at least one stop_loss
	positionSizing: PositionSizing;
	risk: RiskParams;
	assetFilter?: AssetFilter;
	isActive: boolean;
	createdAt?: string;
	updatedAt?: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidationResult =
	| { valid: true }
	| { valid: false; errors: string[] };

const VALID_TIMEFRAMES = new Set<string>([
	'1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w', '1M'
]);

const VALID_OPERATORS = new Set<string>([
	'>', '<', '>=', '<=', '==', 'crosses_above', 'crosses_below'
]);

const VALID_INDICATORS = new Set<string>([
	'sma', 'ema', 'rsi', 'macd', 'macd_signal', 'macd_histogram',
	'bollinger_upper', 'bollinger_lower', 'bollinger_middle',
	'atr', 'stochastic_k', 'stochastic_d', 'adx', 'obv', 'vwap',
	'williams_r', 'cci', 'mfi', 'supertrend',
	'close', 'open', 'high', 'low', 'volume'
]);

const VALID_SIZING_METHODS = new Set<string>([
	'fixed_fractional', 'kelly', 'volatility_adjusted', 'equal_risk'
]);

const VALID_ASSET_CLASSES = new Set<string>(['crypto', 'forex', 'equity', 'commodity']);

function isPositiveFinite(v: unknown): v is number {
	return typeof v === 'number' && isFinite(v) && v > 0;
}

function isNonNegativeFinite(v: unknown): v is number {
	return typeof v === 'number' && isFinite(v) && v >= 0;
}

function validateIndicatorCondition(cond: unknown, path: string, errors: string[]): void {
	if (!cond || typeof cond !== 'object') {
		errors.push(`${path}: must be an object`);
		return;
	}
	const c = cond as Record<string, unknown>;

	if (!VALID_INDICATORS.has(c.indicator as string)) {
		errors.push(`${path}.indicator: invalid value "${c.indicator}"`);
	}
	if (!VALID_OPERATORS.has(c.operator as string)) {
		errors.push(`${path}.operator: invalid value "${c.operator}"`);
	}

	const t = c.threshold;
	if (typeof t === 'number') {
		if (!isFinite(t)) errors.push(`${path}.threshold: must be a finite number`);
	} else if (t && typeof t === 'object') {
		const tr = t as Record<string, unknown>;
		if (!VALID_INDICATORS.has(tr.indicator as string)) {
			errors.push(`${path}.threshold.indicator: invalid value "${tr.indicator}"`);
		}
	} else {
		errors.push(`${path}.threshold: must be a number or an indicator reference`);
	}
}

function validateEntry(entry: unknown, errors: string[]): void {
	if (!entry || typeof entry !== 'object') {
		errors.push('entry: must be an object');
		return;
	}
	const e = entry as Record<string, unknown>;

	if (!['long', 'short', 'both'].includes(e.direction as string)) {
		errors.push(`entry.direction: must be "long", "short", or "both"`);
	}
	if (!Array.isArray(e.groups) || e.groups.length === 0) {
		errors.push('entry.groups: must be a non-empty array');
		return;
	}
	for (let gi = 0; gi < e.groups.length; gi++) {
		const group = e.groups[gi] as Record<string, unknown>;
		if (!['AND', 'OR'].includes(group.logic as string)) {
			errors.push(`entry.groups[${gi}].logic: must be "AND" or "OR"`);
		}
		if (!Array.isArray(group.conditions) || group.conditions.length === 0) {
			errors.push(`entry.groups[${gi}].conditions: must be a non-empty array`);
		} else {
			for (let ci = 0; ci < group.conditions.length; ci++) {
				validateIndicatorCondition(
					group.conditions[ci],
					`entry.groups[${gi}].conditions[${ci}]`,
					errors
				);
			}
		}
	}
}

function validateExit(exits: unknown, errors: string[]): void {
	if (!Array.isArray(exits) || exits.length === 0) {
		errors.push('exit: must be a non-empty array');
		return;
	}
	const hasStopLoss = exits.some(
		(e) => e && typeof e === 'object' && (e as Record<string, unknown>).type === 'stop_loss'
	);
	if (!hasStopLoss) {
		errors.push('exit: must contain at least one stop_loss condition');
	}

	const validTypes = ['stop_loss', 'take_profit', 'trailing_stop', 'indicator', 'time_based'];
	for (let i = 0; i < exits.length; i++) {
		const ex = exits[i] as Record<string, unknown>;
		if (!ex || typeof ex !== 'object') {
			errors.push(`exit[${i}]: must be an object`);
			continue;
		}
		if (!validTypes.includes(ex.type as string)) {
			errors.push(`exit[${i}].type: must be one of ${validTypes.join(', ')}`);
			continue;
		}
		if (['stop_loss', 'take_profit', 'trailing_stop'].includes(ex.type as string)) {
			if (!isPositiveFinite(ex.value)) {
				errors.push(`exit[${i}].value: must be a positive number`);
			}
		}
		if (ex.type === 'time_based') {
			if (typeof ex.bars !== 'number' || !Number.isInteger(ex.bars) || ex.bars < 1) {
				errors.push(`exit[${i}].bars: must be a positive integer`);
			}
		}
		if (ex.type === 'indicator') {
			validateIndicatorCondition(ex.condition, `exit[${i}].condition`, errors);
		}
	}
}

function validatePositionSizing(sizing: unknown, errors: string[]): void {
	if (!sizing || typeof sizing !== 'object') {
		errors.push('positionSizing: must be an object');
		return;
	}
	const s = sizing as Record<string, unknown>;

	if (!VALID_SIZING_METHODS.has(s.method as string)) {
		errors.push(
			`positionSizing.method: must be one of ${Array.from(VALID_SIZING_METHODS).join(', ')}`
		);
	}
	if (!isPositiveFinite(s.riskPerTrade)) {
		errors.push('positionSizing.riskPerTrade: must be a positive number');
	} else if ((s.riskPerTrade as number) > 100) {
		errors.push('positionSizing.riskPerTrade: cannot exceed 100%');
	}
	if (s.maxPositionPct !== undefined) {
		if (!isPositiveFinite(s.maxPositionPct) || (s.maxPositionPct as number) > 100) {
			errors.push('positionSizing.maxPositionPct: must be a positive number ≤ 100');
		}
	}
}

function validateRisk(risk: unknown, errors: string[]): void {
	if (!risk || typeof risk !== 'object') {
		errors.push('risk: must be an object');
		return;
	}
	const r = risk as Record<string, unknown>;

	if (!isPositiveFinite(r.maxDrawdownPct)) {
		errors.push('risk.maxDrawdownPct: must be a positive number');
	} else if ((r.maxDrawdownPct as number) > 100) {
		errors.push('risk.maxDrawdownPct: cannot exceed 100%');
	}
	if (typeof r.maxOpenPositions !== 'number' || !Number.isInteger(r.maxOpenPositions) || r.maxOpenPositions < 1) {
		errors.push('risk.maxOpenPositions: must be a positive integer');
	}
	if (r.maxDailyLossPct !== undefined) {
		if (!isPositiveFinite(r.maxDailyLossPct) || (r.maxDailyLossPct as number) > 100) {
			errors.push('risk.maxDailyLossPct: must be a positive number ≤ 100');
		}
	}
	if (r.correlationLimit !== undefined) {
		if (!isNonNegativeFinite(r.correlationLimit) || (r.correlationLimit as number) > 1) {
			errors.push('risk.correlationLimit: must be between 0 and 1');
		}
	}
}

function validateAssetFilter(filter: unknown, errors: string[]): void {
	if (!filter || typeof filter !== 'object') {
		errors.push('assetFilter: must be an object');
		return;
	}
	const f = filter as Record<string, unknown>;

	if (f.symbols !== undefined) {
		if (
			!Array.isArray(f.symbols) ||
			f.symbols.some((s) => typeof s !== 'string' || s.trim() === '')
		) {
			errors.push('assetFilter.symbols: must be an array of non-empty strings');
		}
	}
	if (f.minVolume24hUsd !== undefined && !isNonNegativeFinite(f.minVolume24hUsd)) {
		errors.push('assetFilter.minVolume24hUsd: must be a non-negative number');
	}
	if (f.minMarketCapUsd !== undefined && !isNonNegativeFinite(f.minMarketCapUsd)) {
		errors.push('assetFilter.minMarketCapUsd: must be a non-negative number');
	}
	if (f.assetClass !== undefined) {
		if (
			!Array.isArray(f.assetClass) ||
			f.assetClass.some((c) => !VALID_ASSET_CLASSES.has(c as string))
		) {
			errors.push(
				`assetFilter.assetClass: must be an array of valid classes (${Array.from(VALID_ASSET_CLASSES).join(', ')})`
			);
		}
	}
}

export function validateStrategy(raw: unknown): ValidationResult {
	const errors: string[] = [];

	if (!raw || typeof raw !== 'object') {
		return { valid: false, errors: ['Strategy must be an object'] };
	}
	const s = raw as Record<string, unknown>;

	if (typeof s.biglotUserId !== 'string' || s.biglotUserId.trim().length < 8) {
		errors.push('biglotUserId: must be a string of at least 8 characters');
	}
	if (typeof s.name !== 'string' || s.name.trim().length === 0) {
		errors.push('name: must be a non-empty string');
	} else if (s.name.length > 100) {
		errors.push('name: must not exceed 100 characters');
	}
	if (s.description !== undefined && typeof s.description !== 'string') {
		errors.push('description: must be a string');
	}
	if (!VALID_TIMEFRAMES.has(s.timeframe as string)) {
		errors.push(`timeframe: must be one of ${Array.from(VALID_TIMEFRAMES).join(', ')}`);
	}
	if (typeof s.version !== 'number' || !Number.isInteger(s.version) || s.version < 1) {
		errors.push('version: must be a positive integer');
	}
	if (typeof s.isActive !== 'boolean') {
		errors.push('isActive: must be a boolean');
	}

	validateEntry(s.entry, errors);
	validateExit(s.exit, errors);
	validatePositionSizing(s.positionSizing, errors);
	validateRisk(s.risk, errors);
	if (s.assetFilter !== undefined) {
		validateAssetFilter(s.assetFilter, errors);
	}

	return errors.length === 0 ? { valid: true } : { valid: false, errors };
}
