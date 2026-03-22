// Scheduled Briefing Data Layer — T-1208
// Types, pure functions, and DB row mapping for scheduled morning briefing.

// ─── Types ────────────────────────────────────────────────────────────────────

export type BriefingSection = 'crypto' | 'macro' | 'gold' | 'portfolio';
export type BriefingChannel = 'in_app' | 'telegram' | 'both';

export const VALID_SECTIONS: BriefingSection[] = ['crypto', 'macro', 'gold', 'portfolio'];
export const VALID_CHANNELS: BriefingChannel[] = ['in_app', 'telegram', 'both'];

export const SECTION_DESCRIPTIONS: Record<BriefingSection, string> = {
	crypto:    'Top crypto movers (24h gainers & losers)',
	macro:     'Macro indicators (DXY, yields, SPX)',
	gold:      'Gold price & XAU/USD analysis',
	portfolio: 'Paper portfolio PnL summary',
};

export const TIMEZONE_LABELS: Record<string, string> = {
	'Asia/Bangkok':      'ICT (UTC+7)',
	'Asia/Singapore':    'SGT (UTC+8)',
	'Asia/Tokyo':        'JST (UTC+9)',
	'Asia/Shanghai':     'CST (UTC+8)',
	'America/New_York':  'ET',
	'America/Chicago':   'CT',
	'America/Los_Angeles': 'PT',
	'Europe/London':     'GMT/BST',
	'Europe/Paris':      'CET/CEST',
	'UTC':               'UTC',
};

export type ScheduledBriefing = {
	id:           string;
	userId:       string;
	deliveryTime: string;       // "HH:MM" 24h format
	timezone:     string;       // IANA timezone e.g. "Asia/Bangkok"
	watchlist:    string[];     // custom symbols to include
	sections:     BriefingSection[];
	channel:      BriefingChannel;
	active:       boolean;
	lastSentAt:   string | null;
	createdAt:    string;
	updatedAt:    string;
};

export type CreateBriefingInput = {
	deliveryTime: string;
	timezone?:    string;
	watchlist?:   string[];
	sections?:    BriefingSection[];
	channel?:     BriefingChannel;
};

// ─── DB Row Type (mirrors Supabase table) ─────────────────────────────────────

export type ScheduledBriefingRow = {
	id:            string;
	user_id:       string;
	delivery_time: string;
	timezone:      string;
	watchlist:     string[];
	sections:      string[];
	channel:       string;
	active:        boolean;
	last_sent_at:  string | null;
	created_at:    string;
	updated_at:    string;
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidBriefingSection(v: unknown): v is BriefingSection {
	return typeof v === 'string' && (VALID_SECTIONS as string[]).includes(v);
}

export function isValidBriefingChannel(v: unknown): v is BriefingChannel {
	return typeof v === 'string' && (VALID_CHANNELS as string[]).includes(v);
}

/** Validate "HH:MM" 24h format */
export function isValidDeliveryTime(v: unknown): v is string {
	if (typeof v !== 'string') return false;
	const m = v.match(/^(\d{1,2}):(\d{2})$/);
	if (!m) return false;
	const h = parseInt(m[1], 10);
	const min = parseInt(m[2], 10);
	return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/** Normalise "7:00" → "07:00" */
export function normaliseDeliveryTime(t: string): string {
	const [h, m] = t.split(':');
	return `${String(parseInt(h, 10)).padStart(2, '0')}:${m}`;
}

// ─── Mapping ──────────────────────────────────────────────────────────────────

export function mapScheduledBriefingRow(row: ScheduledBriefingRow): ScheduledBriefing {
	return {
		id:           row.id,
		userId:       row.user_id,
		deliveryTime: row.delivery_time,
		timezone:     row.timezone,
		watchlist:    Array.isArray(row.watchlist) ? row.watchlist : [],
		sections:     (Array.isArray(row.sections) ? row.sections : []).filter(isValidBriefingSection),
		channel:      isValidBriefingChannel(row.channel) ? row.channel : 'both',
		active:       row.active,
		lastSentAt:   row.last_sent_at,
		createdAt:    row.created_at,
		updatedAt:    row.updated_at,
	};
}

// ─── Timezone Helpers ─────────────────────────────────────────────────────────

/**
 * Get the current hour and minute in the given IANA timezone.
 * Returns {hour: 0, minute: 0} on invalid timezone.
 */
export function getCurrentTimeInTz(timezone: string, date: Date = new Date()): { hour: number; minute: number } {
	try {
		const fmt = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			hour:     'numeric',
			minute:   '2-digit',
			hour12:   false,
		});
		const parts = fmt.formatToParts(date);
		const h   = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0', 10);
		const min = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
		return { hour: isNaN(h) ? 0 : h % 24, minute: isNaN(min) ? 0 : min };
	} catch {
		return { hour: 0, minute: 0 };
	}
}

/**
 * Return short timezone abbreviation or offset label for display.
 */
export function tzLabel(timezone: string): string {
	return TIMEZONE_LABELS[timezone] ?? timezone;
}

// ─── Scheduling Logic ─────────────────────────────────────────────────────────

/**
 * Check if a briefing should be delivered now.
 * Fires if current local time in the briefing's timezone is within a 5-minute
 * window after the scheduled delivery time, and hasn't been sent in the last 23h.
 * Pure function — fully testable.
 */
export function isBriefingDue(briefing: ScheduledBriefing, now: Date = new Date()): boolean {
	if (!briefing.active) return false;

	// Prevent double-delivery: skip if sent within the last 23 hours
	if (briefing.lastSentAt) {
		const lastSent     = new Date(briefing.lastSentAt);
		const hoursSinceSent = (now.getTime() - lastSent.getTime()) / (60 * 60 * 1000);
		if (hoursSinceSent < 23) return false;
	}

	const [hourStr, minStr] = briefing.deliveryTime.split(':');
	const deliveryH   = parseInt(hourStr, 10);
	const deliveryMin = parseInt(minStr, 10);
	if (isNaN(deliveryH) || isNaN(deliveryMin)) return false;

	const { hour: currentH, minute: currentMin } = getCurrentTimeInTz(briefing.timezone, now);
	const currentTotal  = currentH * 60 + currentMin;
	const deliveryTotal = deliveryH * 60 + deliveryMin;

	// Fire within a 5-minute window after the scheduled time
	return currentTotal >= deliveryTotal && currentTotal < deliveryTotal + 5;
}

/**
 * Compute human-readable label for the next delivery time.
 * e.g. "07:00 ICT (in 14h 30m)"
 */
export function formatNextDelivery(briefing: ScheduledBriefing, now: Date = new Date()): string {
	const label = tzLabel(briefing.timezone);
	if (!briefing.active) return `${briefing.deliveryTime} ${label} (paused)`;

	const [hourStr, minStr] = briefing.deliveryTime.split(':');
	const deliveryH   = parseInt(hourStr, 10);
	const deliveryMin = parseInt(minStr, 10);
	if (isNaN(deliveryH) || isNaN(deliveryMin)) return `${briefing.deliveryTime} ${label}`;

	const { hour: currentH, minute: currentMin } = getCurrentTimeInTz(briefing.timezone, now);
	const currentTotal  = currentH * 60 + currentMin;
	const deliveryTotal = deliveryH * 60 + deliveryMin;

	let minsUntil = deliveryTotal - currentTotal;
	if (minsUntil <= 0) minsUntil += 24 * 60; // next day

	const h   = Math.floor(minsUntil / 60);
	const min = minsUntil % 60;
	const rel = h > 0 ? (min > 0 ? `in ${h}h ${min}m` : `in ${h}h`) : `in ${min}m`;

	return `${briefing.deliveryTime} ${label} (${rel})`;
}
