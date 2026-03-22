// Smart Alert Engine Tests — T-1201
import { describe, it, expect } from 'vitest';
import {
	isValidSmartAlertCondition,
	isValidPriceDirection,
	evaluateSmartAlertCondition,
	formatSmartAlertTelegram,
	describeSmartAlert,
	mapSmartAlertRow,
	VALID_CONDITIONS,
	type SmartAlert,
	type SmartAlertRow,
} from './smartAlerts.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseAlert: SmartAlert = {
	id: 'test-id',
	userId: 'user-1',
	symbol: 'BTCUSDT',
	condition: 'price_above',
	priceThreshold: 100000,
	priceDirection: null,
	rsiThreshold: null,
	rsiPeriod: 14,
	volumeMultiplier: null,
	correlationSymbolB: null,
	correlationThreshold: null,
	note: null,
	active: true,
	triggered: false,
	triggeredAt: null,
	lastCheckedAt: null,
	createdAt: '2026-03-22T00:00:00Z',
};

// ─── isValidSmartAlertCondition ───────────────────────────────────────────────

describe('isValidSmartAlertCondition', () => {
	it('accepts all valid conditions', () => {
		for (const c of VALID_CONDITIONS) {
			expect(isValidSmartAlertCondition(c)).toBe(true);
		}
	});

	it('rejects unknown strings', () => {
		expect(isValidSmartAlertCondition('price_crosses')).toBe(false);
		expect(isValidSmartAlertCondition('')).toBe(false);
		expect(isValidSmartAlertCondition('PRICE_ABOVE')).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidSmartAlertCondition(null)).toBe(false);
		expect(isValidSmartAlertCondition(123)).toBe(false);
		expect(isValidSmartAlertCondition(undefined)).toBe(false);
	});
});

// ─── isValidPriceDirection ────────────────────────────────────────────────────

describe('isValidPriceDirection', () => {
	it('accepts above and below', () => {
		expect(isValidPriceDirection('above')).toBe(true);
		expect(isValidPriceDirection('below')).toBe(true);
	});

	it('rejects other values', () => {
		expect(isValidPriceDirection('crosses')).toBe(false);
		expect(isValidPriceDirection(null)).toBe(false);
		expect(isValidPriceDirection(undefined)).toBe(false);
	});
});

// ─── evaluateSmartAlertCondition: price_above ─────────────────────────────────

describe('evaluateSmartAlertCondition — price_above', () => {
	const alert = { condition: 'price_above' as const, priceThreshold: 100000, priceDirection: null, rsiThreshold: null, volumeMultiplier: null, correlationThreshold: null };

	it('triggers when price >= threshold', () => {
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 100000 }).triggered).toBe(true);
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 101000 }).triggered).toBe(true);
	});

	it('does not trigger when price < threshold', () => {
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 99999 }).triggered).toBe(false);
	});

	it('returns no threshold error when priceThreshold is null', () => {
		const a = { ...alert, priceThreshold: null };
		const r = evaluateSmartAlertCondition(a, { currentPrice: 50000 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('No price threshold');
	});
});

// ─── evaluateSmartAlertCondition: price_below ─────────────────────────────────

describe('evaluateSmartAlertCondition — price_below', () => {
	const alert = { condition: 'price_below' as const, priceThreshold: 50000, priceDirection: null, rsiThreshold: null, volumeMultiplier: null, correlationThreshold: null };

	it('triggers when price <= threshold', () => {
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 50000 }).triggered).toBe(true);
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 49000 }).triggered).toBe(true);
	});

	it('does not trigger when price > threshold', () => {
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 50001 }).triggered).toBe(false);
	});
});

// ─── evaluateSmartAlertCondition: price_and_rsi_above ────────────────────────

describe('evaluateSmartAlertCondition — price_and_rsi_above', () => {
	const alert = {
		condition: 'price_and_rsi_above' as const,
		priceThreshold: 90000,
		priceDirection: 'above' as const,
		rsiThreshold: 70,
		volumeMultiplier: null,
		correlationThreshold: null,
	};

	it('triggers when both price and RSI conditions met', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 95000, rsi: 75 });
		expect(r.triggered).toBe(true);
	});

	it('does not trigger when only price met', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 95000, rsi: 65 });
		expect(r.triggered).toBe(false);
	});

	it('does not trigger when only RSI met', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 85000, rsi: 75 });
		expect(r.triggered).toBe(false);
	});

	it('does not trigger when RSI not available', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 95000 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('RSI not available');
	});

	it('works with price_direction = below', () => {
		const a = { ...alert, priceDirection: 'below' as const, priceThreshold: 90000 };
		// price 85000 < 90000 AND rsi > 70
		const r = evaluateSmartAlertCondition(a, { currentPrice: 85000, rsi: 75 });
		expect(r.triggered).toBe(true);
	});

	it('returns error when thresholds missing', () => {
		const a = { ...alert, priceThreshold: null };
		const r = evaluateSmartAlertCondition(a, { currentPrice: 95000, rsi: 75 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('Missing thresholds');
	});
});

// ─── evaluateSmartAlertCondition: price_and_rsi_below ────────────────────────

describe('evaluateSmartAlertCondition — price_and_rsi_below', () => {
	const alert = {
		condition: 'price_and_rsi_below' as const,
		priceThreshold: 60000,
		priceDirection: 'below' as const,
		rsiThreshold: 30,
		volumeMultiplier: null,
		correlationThreshold: null,
	};

	it('triggers when price below threshold AND RSI below threshold', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 55000, rsi: 25 });
		expect(r.triggered).toBe(true);
	});

	it('does not trigger when RSI is above threshold', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 55000, rsi: 35 });
		expect(r.triggered).toBe(false);
	});

	it('does not trigger when price is above threshold', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 65000, rsi: 25 });
		expect(r.triggered).toBe(false);
	});
});

// ─── evaluateSmartAlertCondition: price_and_volume_spike ─────────────────────

describe('evaluateSmartAlertCondition — price_and_volume_spike', () => {
	const alert = {
		condition: 'price_and_volume_spike' as const,
		priceThreshold: 80000,
		priceDirection: 'above' as const,
		rsiThreshold: null,
		volumeMultiplier: 3,
		correlationThreshold: null,
	};

	it('triggers when price above threshold AND volume > 3x', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 85000, volumeRatio: 3.5 });
		expect(r.triggered).toBe(true);
	});

	it('does not trigger when volume below multiplier', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 85000, volumeRatio: 2.5 });
		expect(r.triggered).toBe(false);
	});

	it('does not trigger when price condition not met', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 75000, volumeRatio: 5 });
		expect(r.triggered).toBe(false);
	});

	it('returns error when volume not available', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 85000 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('Volume data not available');
	});

	it('defaults to 3x multiplier when volumeMultiplier is null', () => {
		const a = { ...alert, volumeMultiplier: null };
		// exactly at 3x should trigger (>=3)
		const r = evaluateSmartAlertCondition(a, { currentPrice: 85000, volumeRatio: 3 });
		expect(r.triggered).toBe(true);
	});
});

// ─── evaluateSmartAlertCondition: correlation_break ──────────────────────────

describe('evaluateSmartAlertCondition — correlation_break', () => {
	const alert = {
		condition: 'correlation_break' as const,
		priceThreshold: null,
		priceDirection: null,
		rsiThreshold: null,
		volumeMultiplier: null,
		correlationThreshold: 0.5,
	};

	it('triggers when correlation drops below threshold', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 100, correlation: 0.3 });
		expect(r.triggered).toBe(true);
	});

	it('does not trigger when correlation is at or above threshold', () => {
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 100, correlation: 0.5 }).triggered).toBe(false);
		expect(evaluateSmartAlertCondition(alert, { currentPrice: 100, correlation: 0.8 }).triggered).toBe(false);
	});

	it('returns error when correlation not available', () => {
		const r = evaluateSmartAlertCondition(alert, { currentPrice: 100 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('Correlation not available');
	});

	it('returns error when correlationThreshold is null', () => {
		const a = { ...alert, correlationThreshold: null };
		const r = evaluateSmartAlertCondition(a, { currentPrice: 100, correlation: 0.2 });
		expect(r.triggered).toBe(false);
		expect(r.reason).toContain('No correlation threshold');
	});
});

// ─── formatSmartAlertTelegram ─────────────────────────────────────────────────

describe('formatSmartAlertTelegram', () => {
	it('includes symbol', () => {
		const msg = formatSmartAlertTelegram(baseAlert, 'Price crossed threshold');
		expect(msg).toContain('BTCUSDT');
	});

	it('includes condition label', () => {
		const msg = formatSmartAlertTelegram(baseAlert, 'test reason');
		expect(msg).toContain('Price Above');
	});

	it('includes reason', () => {
		const reason = 'Price 105000 >= 100000';
		const msg = formatSmartAlertTelegram(baseAlert, reason);
		expect(msg).toContain(reason);
	});

	it('includes note when set', () => {
		const alert = { ...baseAlert, note: 'All-time high breakout' };
		const msg = formatSmartAlertTelegram(alert, 'triggered');
		expect(msg).toContain('All-time high breakout');
	});

	it('omits note when null', () => {
		const msg = formatSmartAlertTelegram(baseAlert, 'triggered');
		expect(msg).not.toContain('Note');
	});

	it('includes correlation symbol when set', () => {
		const alert = { ...baseAlert, condition: 'correlation_break' as const, correlationSymbolB: 'ETHUSDT' };
		const msg = formatSmartAlertTelegram(alert, 'corr 0.2 < 0.5');
		expect(msg).toContain('ETHUSDT');
	});

	it('is valid HTML for Telegram', () => {
		const msg = formatSmartAlertTelegram(baseAlert, 'test');
		expect(msg).toContain('<b>');
		expect(msg).toContain('</b>');
	});
});

// ─── describeSmartAlert ───────────────────────────────────────────────────────

describe('describeSmartAlert', () => {
	it('describes price_above', () => {
		const d = describeSmartAlert({ ...baseAlert, condition: 'price_above', priceThreshold: 100000 });
		expect(d).toContain('BTCUSDT');
		expect(d).toContain('100000');
	});

	it('describes price_below', () => {
		const d = describeSmartAlert({ ...baseAlert, condition: 'price_below', priceThreshold: 50000 });
		expect(d).toContain('50000');
		expect(d).toContain('<=');
	});

	it('describes price_and_rsi_above with direction', () => {
		const d = describeSmartAlert({
			...baseAlert,
			condition: 'price_and_rsi_above',
			priceThreshold: 90000,
			priceDirection: 'above',
			rsiThreshold: 70,
			rsiPeriod: 14,
		});
		expect(d).toContain('90000');
		expect(d).toContain('RSI(14)');
		expect(d).toContain('70');
	});

	it('describes price_and_volume_spike', () => {
		const d = describeSmartAlert({
			...baseAlert,
			condition: 'price_and_volume_spike',
			priceThreshold: 80000,
			priceDirection: 'above',
			volumeMultiplier: 3,
		});
		expect(d).toContain('volume');
		expect(d).toContain('3x');
	});

	it('describes correlation_break', () => {
		const d = describeSmartAlert({
			...baseAlert,
			condition: 'correlation_break',
			correlationSymbolB: 'ETHUSDT',
			correlationThreshold: 0.5,
		});
		expect(d).toContain('ETHUSDT');
		expect(d).toContain('0.5');
	});
});

// ─── mapSmartAlertRow ─────────────────────────────────────────────────────────

describe('mapSmartAlertRow', () => {
	const row: SmartAlertRow = {
		id: 'row-1',
		user_id: 'user-1',
		symbol: 'ETHUSDT',
		condition: 'price_and_rsi_below',
		price_threshold: 2500,
		price_direction: 'below',
		rsi_threshold: 30,
		rsi_period: 14,
		volume_multiplier: null,
		correlation_symbol_b: null,
		correlation_threshold: null,
		note: 'Oversold entry',
		active: true,
		triggered: false,
		triggered_at: null,
		last_checked_at: null,
		created_at: '2026-03-22T00:00:00Z',
	};

	it('maps all fields correctly', () => {
		const a = mapSmartAlertRow(row);
		expect(a.id).toBe('row-1');
		expect(a.userId).toBe('user-1');
		expect(a.symbol).toBe('ETHUSDT');
		expect(a.condition).toBe('price_and_rsi_below');
		expect(a.priceThreshold).toBe(2500);
		expect(a.priceDirection).toBe('below');
		expect(a.rsiThreshold).toBe(30);
		expect(a.rsiPeriod).toBe(14);
		expect(a.note).toBe('Oversold entry');
		expect(a.active).toBe(true);
		expect(a.triggered).toBe(false);
	});

	it('defaults invalid priceDirection to null', () => {
		const a = mapSmartAlertRow({ ...row, price_direction: 'invalid' });
		expect(a.priceDirection).toBeNull();
	});

	it('defaults rsiPeriod to 14 when missing', () => {
		const a = mapSmartAlertRow({ ...row, rsi_period: undefined as unknown as number });
		expect(a.rsiPeriod).toBe(14);
	});
});
