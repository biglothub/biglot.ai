// Scheduled Briefing Data Layer Tests — T-1208

import { describe, it, expect } from 'vitest';
import {
	isValidBriefingSection,
	isValidBriefingChannel,
	isValidDeliveryTime,
	normaliseDeliveryTime,
	mapScheduledBriefingRow,
	isBriefingDue,
	formatNextDelivery,
	getCurrentTimeInTz,
	tzLabel,
	VALID_SECTIONS,
	VALID_CHANNELS,
	type ScheduledBriefing,
	type ScheduledBriefingRow,
} from './scheduledBriefing.data';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseBriefing: ScheduledBriefing = {
	id:           'test-id',
	userId:       'user-1',
	deliveryTime: '07:00',
	timezone:     'Asia/Bangkok',
	watchlist:    ['BTCUSDT', 'ETHUSDT'],
	sections:     ['crypto', 'portfolio'],
	channel:      'both',
	active:       true,
	lastSentAt:   null,
	createdAt:    '2026-03-22T00:00:00.000Z',
	updatedAt:    '2026-03-22T00:00:00.000Z',
};

const baseRow: ScheduledBriefingRow = {
	id:            'row-id',
	user_id:       'user-2',
	delivery_time: '08:30',
	timezone:      'UTC',
	watchlist:     ['XAUUSD'],
	sections:      ['crypto', 'macro', 'gold'],
	channel:       'telegram',
	active:        true,
	last_sent_at:  null,
	created_at:    '2026-03-22T00:00:00.000Z',
	updated_at:    '2026-03-22T00:00:00.000Z',
};

// ─── isValidBriefingSection ────────────────────────────────────────────────────

describe('isValidBriefingSection', () => {
	it('accepts all valid sections', () => {
		for (const s of VALID_SECTIONS) {
			expect(isValidBriefingSection(s)).toBe(true);
		}
	});

	it('rejects invalid strings', () => {
		expect(isValidBriefingSection('news')).toBe(false);
		expect(isValidBriefingSection('')).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidBriefingSection(123)).toBe(false);
		expect(isValidBriefingSection(null)).toBe(false);
		expect(isValidBriefingSection(undefined)).toBe(false);
	});
});

// ─── isValidBriefingChannel ───────────────────────────────────────────────────

describe('isValidBriefingChannel', () => {
	it('accepts all valid channels', () => {
		for (const c of VALID_CHANNELS) {
			expect(isValidBriefingChannel(c)).toBe(true);
		}
	});

	it('rejects invalid strings', () => {
		expect(isValidBriefingChannel('email')).toBe(false);
		expect(isValidBriefingChannel('')).toBe(false);
	});

	it('rejects non-strings', () => {
		expect(isValidBriefingChannel(null)).toBe(false);
		expect(isValidBriefingChannel(undefined)).toBe(false);
	});
});

// ─── isValidDeliveryTime ─────────────────────────────────────────────────────

describe('isValidDeliveryTime', () => {
	it('accepts valid HH:MM formats', () => {
		expect(isValidDeliveryTime('07:00')).toBe(true);
		expect(isValidDeliveryTime('00:00')).toBe(true);
		expect(isValidDeliveryTime('23:59')).toBe(true);
		expect(isValidDeliveryTime('7:30')).toBe(true);
	});

	it('rejects invalid hours', () => {
		expect(isValidDeliveryTime('24:00')).toBe(false);
		expect(isValidDeliveryTime('25:00')).toBe(false);
	});

	it('rejects invalid minutes', () => {
		expect(isValidDeliveryTime('07:60')).toBe(false);
		expect(isValidDeliveryTime('07:99')).toBe(false);
	});

	it('rejects non-time strings', () => {
		expect(isValidDeliveryTime('not-a-time')).toBe(false);
		expect(isValidDeliveryTime('')).toBe(false);
		expect(isValidDeliveryTime(700)).toBe(false);
	});
});

// ─── normaliseDeliveryTime ────────────────────────────────────────────────────

describe('normaliseDeliveryTime', () => {
	it('pads single-digit hours', () => {
		expect(normaliseDeliveryTime('7:00')).toBe('07:00');
		expect(normaliseDeliveryTime('9:30')).toBe('09:30');
	});

	it('leaves already-padded times unchanged', () => {
		expect(normaliseDeliveryTime('07:00')).toBe('07:00');
		expect(normaliseDeliveryTime('23:45')).toBe('23:45');
	});
});

// ─── mapScheduledBriefingRow ──────────────────────────────────────────────────

describe('mapScheduledBriefingRow', () => {
	it('maps all fields correctly', () => {
		const result = mapScheduledBriefingRow(baseRow);
		expect(result.id).toBe('row-id');
		expect(result.userId).toBe('user-2');
		expect(result.deliveryTime).toBe('08:30');
		expect(result.timezone).toBe('UTC');
		expect(result.watchlist).toEqual(['XAUUSD']);
		expect(result.sections).toEqual(['crypto', 'macro', 'gold']);
		expect(result.channel).toBe('telegram');
		expect(result.active).toBe(true);
		expect(result.lastSentAt).toBeNull();
	});

	it('filters invalid sections', () => {
		const row: ScheduledBriefingRow = { ...baseRow, sections: ['crypto', 'invalid', 'portfolio'] };
		const result = mapScheduledBriefingRow(row);
		expect(result.sections).toEqual(['crypto', 'portfolio']);
	});

	it('falls back to "both" for invalid channel', () => {
		const row: ScheduledBriefingRow = { ...baseRow, channel: 'email' };
		const result = mapScheduledBriefingRow(row);
		expect(result.channel).toBe('both');
	});

	it('handles null/undefined watchlist', () => {
		const row = { ...baseRow, watchlist: null as unknown as string[] };
		const result = mapScheduledBriefingRow(row);
		expect(result.watchlist).toEqual([]);
	});
});

// ─── getCurrentTimeInTz ───────────────────────────────────────────────────────

describe('getCurrentTimeInTz', () => {
	it('returns hour and minute for UTC', () => {
		const date = new Date('2026-03-22T12:30:00.000Z');
		const { hour, minute } = getCurrentTimeInTz('UTC', date);
		expect(hour).toBe(12);
		expect(minute).toBe(30);
	});

	it('applies UTC+7 offset for Asia/Bangkok', () => {
		// UTC 00:00 → ICT 07:00
		const date = new Date('2026-03-22T00:00:00.000Z');
		const { hour, minute } = getCurrentTimeInTz('Asia/Bangkok', date);
		expect(hour).toBe(7);
		expect(minute).toBe(0);
	});

	it('returns zeros for invalid timezone', () => {
		const { hour, minute } = getCurrentTimeInTz('Invalid/Zone', new Date());
		expect(hour).toBe(0);
		expect(minute).toBe(0);
	});
});

// ─── isBriefingDue ────────────────────────────────────────────────────────────

describe('isBriefingDue', () => {
	// Briefing: 07:00 ICT = 00:00 UTC
	it('fires when current time equals delivery time in timezone', () => {
		const now = new Date('2026-03-22T00:00:00.000Z'); // 07:00 ICT
		expect(isBriefingDue(baseBriefing, now)).toBe(true);
	});

	it('fires within 5-minute window', () => {
		const now = new Date('2026-03-22T00:04:00.000Z'); // 07:04 ICT
		expect(isBriefingDue(baseBriefing, now)).toBe(true);
	});

	it('does not fire outside the 5-minute window', () => {
		const now = new Date('2026-03-22T00:05:00.000Z'); // 07:05 ICT (window closed)
		expect(isBriefingDue(baseBriefing, now)).toBe(false);
	});

	it('does not fire when inactive', () => {
		const paused = { ...baseBriefing, active: false };
		const now    = new Date('2026-03-22T00:00:00.000Z'); // 07:00 ICT
		expect(isBriefingDue(paused, now)).toBe(false);
	});

	it('does not fire if sent within the last 23 hours', () => {
		const recentlySent = {
			...baseBriefing,
			lastSentAt: new Date('2026-03-21T22:00:00.000Z').toISOString(), // 2h ago
		};
		const now = new Date('2026-03-22T00:00:00.000Z'); // 07:00 ICT
		expect(isBriefingDue(recentlySent, now)).toBe(false);
	});

	it('fires if sent more than 23 hours ago', () => {
		const oldSent = {
			...baseBriefing,
			lastSentAt: new Date('2026-03-20T23:00:00.000Z').toISOString(), // >23h ago
		};
		const now = new Date('2026-03-22T00:00:00.000Z'); // 07:00 ICT
		expect(isBriefingDue(oldSent, now)).toBe(true);
	});

	it('does not fire at the wrong time of day', () => {
		const now = new Date('2026-03-22T06:00:00.000Z'); // 13:00 ICT (not delivery time)
		expect(isBriefingDue(baseBriefing, now)).toBe(false);
	});
});

// ─── formatNextDelivery ───────────────────────────────────────────────────────

describe('formatNextDelivery', () => {
	it('includes delivery time and timezone label', () => {
		const now    = new Date('2026-03-22T06:00:00.000Z'); // 13:00 ICT
		const result = formatNextDelivery(baseBriefing, now);
		expect(result).toContain('07:00');
		expect(result).toContain('ICT');
	});

	it('shows "paused" when inactive', () => {
		const paused = { ...baseBriefing, active: false };
		const result = formatNextDelivery(paused, new Date());
		expect(result).toContain('paused');
	});

	it('includes a relative time hint', () => {
		const now    = new Date('2026-03-22T06:00:00.000Z'); // 13:00 ICT, delivery is next day 07:00
		const result = formatNextDelivery(baseBriefing, now);
		expect(result).toMatch(/in \d+h/);
	});
});

// ─── tzLabel ─────────────────────────────────────────────────────────────────

describe('tzLabel', () => {
	it('returns known abbreviation for known timezone', () => {
		expect(tzLabel('Asia/Bangkok')).toBe('ICT (UTC+7)');
		expect(tzLabel('UTC')).toBe('UTC');
	});

	it('falls back to the timezone string for unknown zones', () => {
		expect(tzLabel('America/Nowhere')).toBe('America/Nowhere');
	});
});
