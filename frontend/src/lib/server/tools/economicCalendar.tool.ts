// Economic Calendar Tool — get_economic_calendar
// Source: Forex Factory public JSON feed (no auth required)
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import type { TableBlock } from '$lib/types/contentBlock';

// ─── Forex Factory JSON shape ─────────────────────────────────────────────────

interface FFEvent {
	title: string;
	country: string;
	date: string; // ISO 8601, e.g. "2024-01-05T13:30:00-0500"
	impact: 'High' | 'Medium' | 'Low' | 'Non-Economic' | 'Holiday';
	forecast: string;
	previous: string;
	actual?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseFFDate(dateStr: string): Date {
	return new Date(dateStr);
}

export function formatEventDate(date: Date, timezone = 'UTC'): string {
	return date.toLocaleString('en-US', {
		timeZone: timezone,
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
}

export function impactEmoji(impact: string): string {
	if (impact === 'High') return '🔴 High';
	if (impact === 'Medium') return '🟡 Med';
	if (impact === 'Low') return '⚪ Low';
	return impact;
}

export function isHighPriority(event: FFEvent): boolean {
	return event.impact === 'High';
}

export function filterByDaysAhead(events: FFEvent[], daysAhead: number): FFEvent[] {
	const now = Date.now();
	const cutoff = now + daysAhead * 86_400_000;
	return events.filter((e) => {
		const t = parseFFDate(e.date).getTime();
		return t >= now - 3_600_000 && t <= cutoff; // include events up to 1h in the past
	});
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchFFWeek(url: string): Promise<FFEvent[]> {
	const resp = await fetch(url, {
		headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
		signal: AbortSignal.timeout(10_000),
	});
	if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
	const raw: unknown = await resp.json();
	if (!Array.isArray(raw)) throw new Error('Unexpected response shape');
	return raw as FFEvent[];
}

async function fetchCalendarEvents(): Promise<{ events: FFEvent[]; anySuccess: boolean }> {
	const [thisWeek, nextWeek] = await Promise.allSettled([
		fetchFFWeek('https://nfs.faireconomy.media/ff_calendar_thisweek.json'),
		fetchFFWeek('https://nfs.faireconomy.media/ff_calendar_nextweek.json'),
	]);

	const events: FFEvent[] = [];
	let anySuccess = false;
	if (thisWeek.status === 'fulfilled') { events.push(...thisWeek.value); anySuccess = true; }
	if (nextWeek.status === 'fulfilled') { events.push(...nextWeek.value); anySuccess = true; }
	return { events, anySuccess };
}

// ─── Tool registration ────────────────────────────────────────────────────────

registerTool({
	name: 'get_economic_calendar',
	description:
		'Fetch upcoming high-impact economic events: FOMC, NFP, CPI, PCE, GDP, ECB, BOJ, BOE rate decisions, and other market-moving releases. Returns a table with date/time, currency, event name, impact, forecast, previous, and actual values. Use when user asks about upcoming events, economic calendar, scheduled releases, or macro event risk.',
	parameters: {
		type: 'object',
		properties: {
			days_ahead: {
				type: 'number',
				description: 'How many calendar days ahead to show events (default: 7, max: 14)',
			},
			impact_filter: {
				type: 'string',
				enum: ['high', 'medium_and_high', 'all'],
				description: 'Filter by impact level. Default: high',
			},
			currency_filter: {
				type: 'string',
				description: 'Comma-separated currency codes to filter, e.g. "USD,EUR,JPY". Omit for all.',
			},
		},
		required: [],
	},
	timeout: 20_000,
	execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
		const daysAhead = Math.min(Number(args.days_ahead ?? 7), 14);
		const impactFilter = String(args.impact_filter ?? 'high');
		const currencyFilter = args.currency_filter
			? String(args.currency_filter)
					.toUpperCase()
					.split(',')
					.map((c) => c.trim())
					.filter(Boolean)
			: null;

		const cacheKey = toolCache.generateKey('get_economic_calendar', {
			daysAhead,
			impactFilter,
			currencyFilter,
		});
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		let rawEvents: FFEvent[];
		try {
			const { events, anySuccess } = await fetchCalendarEvents();
			if (!anySuccess) {
				return {
					success: false,
					contentBlocks: [
						{
							type: 'error',
							message: 'Failed to fetch economic calendar: all data sources unavailable.',
							tool: 'get_economic_calendar',
						},
					],
					textSummary: 'Error: Could not fetch economic calendar data.',
				};
			}
			rawEvents = events;
		} catch (err) {
			return {
				success: false,
				contentBlocks: [
					{
						type: 'error',
						message: `Failed to fetch economic calendar: ${err instanceof Error ? err.message : String(err)}`,
						tool: 'get_economic_calendar',
					},
				],
				textSummary: 'Error: Could not fetch economic calendar data.',
			};
		}

		// Apply time window
		let events = filterByDaysAhead(rawEvents, daysAhead);

		// Apply impact filter
		events = events.filter((e) => {
			if (impactFilter === 'high') return e.impact === 'High';
			if (impactFilter === 'medium_and_high') return e.impact === 'High' || e.impact === 'Medium';
			return e.impact !== 'Holiday' && e.impact !== 'Non-Economic';
		});

		// Apply currency filter
		if (currencyFilter && currencyFilter.length > 0) {
			events = events.filter((e) => currencyFilter.includes(e.country));
		}

		// Sort by date ascending
		events.sort((a, b) => parseFFDate(a.date).getTime() - parseFFDate(b.date).getTime());

		if (events.length === 0) {
			const result: ToolResult = {
				success: true,
				contentBlocks: [
					{
						type: 'error',
						message: `No ${impactFilter === 'high' ? 'high-impact ' : ''}economic events found in the next ${daysAhead} day(s).`,
						tool: 'get_economic_calendar',
					},
				],
				textSummary: `No matching economic events in the next ${daysAhead} days.`,
			};
			toolCache.set(cacheKey, result, 30 * 60_000);
			return result;
		}

		const now = new Date();
		const rows: (string | number)[][] = events.map((e) => {
			const date = parseFFDate(e.date);
			const isPast = date.getTime() < Date.now();
			const dateStr = formatEventDate(date, 'UTC') + ' UTC';
			return [
				isPast ? `✓ ${dateStr}` : dateStr,
				e.country,
				e.title,
				impactEmoji(e.impact),
				e.forecast || '—',
				e.previous || '—',
				e.actual || (isPast ? '—' : ''),
			];
		});

		const tableBlock: TableBlock = {
			type: 'table',
			title: `Economic Calendar — Next ${daysAhead} Days (as of ${now.toUTCString().replace(':00 GMT', ' UTC')})`,
			headers: ['Date/Time', 'CCY', 'Event', 'Impact', 'Forecast', 'Previous', 'Actual'],
			rows,
		};

		const textLines = events.slice(0, 10).map((e) => {
			const date = parseFFDate(e.date);
			const dateStr = formatEventDate(date, 'UTC');
			return `${dateStr} UTC | ${e.country} | ${e.title}${e.forecast ? ` | fcst: ${e.forecast}` : ''}${e.previous ? ` | prev: ${e.previous}` : ''}${e.actual ? ` | actual: ${e.actual}` : ''}`;
		});

		const result: ToolResult = {
			success: true,
			contentBlocks: [tableBlock],
			textSummary: `Economic calendar: ${events.length} event(s) in the next ${daysAhead} days.\n${textLines.join('\n')}`,
			sources: [
				{
					name: 'Forex Factory Economic Calendar',
					url: 'https://www.forexfactory.com/calendar',
					accessedAt: Date.now(),
				},
			],
		};

		// Cache for 30 min — calendar doesn't change often, but actuals get released
		toolCache.set(cacheKey, result, 30 * 60_000);
		return result;
	},
});
