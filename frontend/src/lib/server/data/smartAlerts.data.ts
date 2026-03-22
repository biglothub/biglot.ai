// Smart Alert Engine Data Layer — T-1201
// Compound alert conditions: price+RSI, price+volume spike, correlation break

// ─── Types ────────────────────────────────────────────────────────────────────

export type SmartAlertCondition =
	| 'price_above'
	| 'price_below'
	| 'price_and_rsi_above'    // price condition AND RSI > rsiThreshold
	| 'price_and_rsi_below'    // price condition AND RSI < rsiThreshold
	| 'price_and_volume_spike' // price condition AND volume > volumeMultiplier × avg
	| 'correlation_break';     // correlation < correlationThreshold

export const VALID_CONDITIONS: SmartAlertCondition[] = [
	'price_above',
	'price_below',
	'price_and_rsi_above',
	'price_and_rsi_below',
	'price_and_volume_spike',
	'correlation_break',
];

export type SmartAlert = {
	id: string;
	userId: string;
	symbol: string;
	condition: SmartAlertCondition;
	priceThreshold: number | null;
	priceDirection: 'above' | 'below' | null; // for compound conditions
	rsiThreshold: number | null;
	rsiPeriod: number;
	volumeMultiplier: number | null;
	correlationSymbolB: string | null;
	correlationThreshold: number | null;
	note: string | null;
	active: boolean;
	triggered: boolean;
	triggeredAt: string | null;
	lastCheckedAt: string | null;
	createdAt: string;
};

export type CreateSmartAlertInput = {
	symbol: string;
	condition: SmartAlertCondition;
	priceThreshold?: number | null;
	priceDirection?: 'above' | 'below' | null;
	rsiThreshold?: number | null;
	rsiPeriod?: number;
	volumeMultiplier?: number | null;
	correlationSymbolB?: string | null;
	correlationThreshold?: number | null;
	note?: string | null;
};

export type SmartAlertEvalInput = {
	currentPrice: number;
	rsi?: number;
	volumeRatio?: number;   // currentVolume / 20d-avg-volume
	correlation?: number;   // Pearson r between symbol and correlationSymbolB
};

export type EvalResult = {
	triggered: boolean;
	reason: string;
};

// ─── DB Row Type (mirrors Supabase table) ─────────────────────────────────────

export type SmartAlertRow = {
	id: string;
	user_id: string;
	symbol: string;
	condition: string;
	price_threshold: number | null;
	price_direction: string | null;
	rsi_threshold: number | null;
	rsi_period: number;
	volume_multiplier: number | null;
	correlation_symbol_b: string | null;
	correlation_threshold: number | null;
	note: string | null;
	active: boolean;
	triggered: boolean;
	triggered_at: string | null;
	last_checked_at: string | null;
	created_at: string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidSmartAlertCondition(v: unknown): v is SmartAlertCondition {
	return typeof v === 'string' && (VALID_CONDITIONS as string[]).includes(v);
}

export function isValidPriceDirection(v: unknown): v is 'above' | 'below' {
	return v === 'above' || v === 'below';
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export function mapSmartAlertRow(row: SmartAlertRow): SmartAlert {
	return {
		id: row.id,
		userId: row.user_id,
		symbol: row.symbol,
		condition: row.condition as SmartAlertCondition,
		priceThreshold: row.price_threshold,
		priceDirection: isValidPriceDirection(row.price_direction) ? row.price_direction : null,
		rsiThreshold: row.rsi_threshold,
		rsiPeriod: row.rsi_period ?? 14,
		volumeMultiplier: row.volume_multiplier,
		correlationSymbolB: row.correlation_symbol_b,
		correlationThreshold: row.correlation_threshold,
		note: row.note,
		active: row.active,
		triggered: row.triggered,
		triggeredAt: row.triggered_at,
		lastCheckedAt: row.last_checked_at,
		createdAt: row.created_at,
	};
}

// ─── Pure Evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate whether a smart alert should fire given current market data.
 * Pure function — no side effects, fully testable.
 */
export function evaluateSmartAlertCondition(
	alert: Pick<
		SmartAlert,
		| 'condition'
		| 'priceThreshold'
		| 'priceDirection'
		| 'rsiThreshold'
		| 'volumeMultiplier'
		| 'correlationThreshold'
	>,
	input: SmartAlertEvalInput
): EvalResult {
	const { currentPrice, rsi, volumeRatio, correlation } = input;

	switch (alert.condition) {
		case 'price_above': {
			const t = alert.priceThreshold;
			if (t === null) return { triggered: false, reason: 'No price threshold set' };
			const triggered = currentPrice >= t;
			return {
				triggered,
				reason: `Price ${currentPrice.toLocaleString()} ${triggered ? '>=' : '<'} ${t.toLocaleString()}`,
			};
		}

		case 'price_below': {
			const t = alert.priceThreshold;
			if (t === null) return { triggered: false, reason: 'No price threshold set' };
			const triggered = currentPrice <= t;
			return {
				triggered,
				reason: `Price ${currentPrice.toLocaleString()} ${triggered ? '<=' : '>'} ${t.toLocaleString()}`,
			};
		}

		case 'price_and_rsi_above': {
			const pt = alert.priceThreshold;
			const rt = alert.rsiThreshold;
			const pd = alert.priceDirection;
			if (pt === null || rt === null || pd === null) {
				return { triggered: false, reason: 'Missing thresholds for price_and_rsi_above' };
			}
			if (rsi === undefined) return { triggered: false, reason: 'RSI not available' };
			const priceOk = pd === 'above' ? currentPrice >= pt : currentPrice <= pt;
			const rsiOk = rsi > rt;
			const triggered = priceOk && rsiOk;
			return {
				triggered,
				reason: `Price ${currentPrice.toLocaleString()} ${pd} ${pt.toLocaleString()} (${priceOk ? 'ok' : 'no'}) AND RSI ${rsi.toFixed(1)} > ${rt} (${rsiOk ? 'ok' : 'no'})`,
			};
		}

		case 'price_and_rsi_below': {
			const pt = alert.priceThreshold;
			const rt = alert.rsiThreshold;
			const pd = alert.priceDirection;
			if (pt === null || rt === null || pd === null) {
				return { triggered: false, reason: 'Missing thresholds for price_and_rsi_below' };
			}
			if (rsi === undefined) return { triggered: false, reason: 'RSI not available' };
			const priceOk = pd === 'above' ? currentPrice >= pt : currentPrice <= pt;
			const rsiOk = rsi < rt;
			const triggered = priceOk && rsiOk;
			return {
				triggered,
				reason: `Price ${currentPrice.toLocaleString()} ${pd} ${pt.toLocaleString()} (${priceOk ? 'ok' : 'no'}) AND RSI ${rsi.toFixed(1)} < ${rt} (${rsiOk ? 'ok' : 'no'})`,
			};
		}

		case 'price_and_volume_spike': {
			const pt = alert.priceThreshold;
			const pd = alert.priceDirection;
			const vm = alert.volumeMultiplier ?? 3;
			if (pt === null || pd === null) {
				return { triggered: false, reason: 'Missing thresholds for price_and_volume_spike' };
			}
			if (volumeRatio === undefined) return { triggered: false, reason: 'Volume data not available' };
			const priceOk = pd === 'above' ? currentPrice >= pt : currentPrice <= pt;
			const volOk = volumeRatio >= vm;
			const triggered = priceOk && volOk;
			return {
				triggered,
				reason: `Price ${currentPrice.toLocaleString()} ${pd} ${pt.toLocaleString()} (${priceOk ? 'ok' : 'no'}) AND volume ${volumeRatio.toFixed(1)}x avg (need ${vm}x) (${volOk ? 'ok' : 'no'})`,
			};
		}

		case 'correlation_break': {
			const ct = alert.correlationThreshold;
			if (ct === null) return { triggered: false, reason: 'No correlation threshold set' };
			if (correlation === undefined) return { triggered: false, reason: 'Correlation not available' };
			const triggered = correlation < ct;
			return {
				triggered,
				reason: `Correlation ${correlation.toFixed(2)} ${triggered ? '<' : '>='} threshold ${ct}`,
			};
		}

		default:
			return { triggered: false, reason: 'Unknown condition type' };
	}
}

// ─── Telegram Formatting ──────────────────────────────────────────────────────

const CONDITION_LABELS: Record<SmartAlertCondition, string> = {
	price_above: 'Price Above',
	price_below: 'Price Below',
	price_and_rsi_above: 'Price + RSI Above',
	price_and_rsi_below: 'Price + RSI Below',
	price_and_volume_spike: 'Price + Volume Spike',
	correlation_break: 'Correlation Break',
};

export function formatSmartAlertTelegram(alert: SmartAlert, reason: string): string {
	const condLabel = CONDITION_LABELS[alert.condition] ?? alert.condition;
	const lines = [
		`\u{1F514} <b>Smart Alert Triggered</b>`,
		``,
		`<b>Symbol:</b> ${alert.symbol}`,
		`<b>Condition:</b> ${condLabel}`,
		`<b>Reason:</b> ${reason}`,
	];
	if (alert.correlationSymbolB) {
		lines.push(`<b>vs:</b> ${alert.correlationSymbolB}`);
	}
	if (alert.note) lines.push(`<b>Note:</b> ${alert.note}`);
	return lines.join('\n');
}

// ─── Condition Description ────────────────────────────────────────────────────

export function describeSmartAlert(alert: SmartAlert): string {
	switch (alert.condition) {
		case 'price_above':
			return `${alert.symbol} price >= ${alert.priceThreshold}`;
		case 'price_below':
			return `${alert.symbol} price <= ${alert.priceThreshold}`;
		case 'price_and_rsi_above':
			return `${alert.symbol} price ${alert.priceDirection} ${alert.priceThreshold} AND RSI(${alert.rsiPeriod}) > ${alert.rsiThreshold}`;
		case 'price_and_rsi_below':
			return `${alert.symbol} price ${alert.priceDirection} ${alert.priceThreshold} AND RSI(${alert.rsiPeriod}) < ${alert.rsiThreshold}`;
		case 'price_and_volume_spike':
			return `${alert.symbol} price ${alert.priceDirection} ${alert.priceThreshold} AND volume > ${alert.volumeMultiplier ?? 3}x avg`;
		case 'correlation_break':
			return `${alert.symbol}/${alert.correlationSymbolB} correlation < ${alert.correlationThreshold}`;
		default:
			return alert.condition;
	}
}
