// TradingView Alerts Data — T-805
// Persistence and retrieval of TradingView webhook alerts

// ─── Types ────────────────────────────────────────────────────────────────────

export type TVAlertAction = 'buy' | 'sell' | 'close' | 'alert';

export type TVAlertPayload = {
	symbol:  string;
	action:  TVAlertAction;
	price:   number;
	message: string;
	auto_paper_trade?: boolean;
	ticker?: string;   // raw ticker from TV alert (may differ from symbol)
	time?:  string;    // ISO timestamp from TradingView
};

export type TVAlert = {
	id:          string;
	symbol:      string;
	action:      TVAlertAction;
	price:       number;
	message:     string;
	triggeredAt: number;   // unix ms
	paperTrade:  boolean;  // whether a paper trade was executed
};

// ─── Supabase client type ─────────────────────────────────────────────────────

export type SupabaseClient = {
	from: (table: string) => {
		insert: (data: Record<string, unknown>) => { error: unknown };
		select: (cols?: string) => {
			order: (col: string, opts?: { ascending?: boolean }) => {
				limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null; error: unknown }>;
			};
		};
	};
};

// ─── Validation ───────────────────────────────────────────────────────────────

export function isValidAction(a: unknown): a is TVAlertAction {
	return typeof a === 'string' && ['buy', 'sell', 'close', 'alert'].includes(a);
}

export function parseTVPayload(body: unknown): TVAlertPayload | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;

	const symbol  = typeof b.symbol  === 'string' ? b.symbol.toUpperCase().trim()    : null;
	const action  = isValidAction(b.action) ? b.action                               : null;
	const price   = typeof b.price   === 'number' ? b.price :
	                typeof b.price   === 'string'  ? parseFloat(b.price)             : null;
	const message = typeof b.message === 'string' ? b.message.trim()                 : '';

	if (!symbol || !action || price === null || isNaN(price)) return null;

	return {
		symbol,
		action,
		price,
		message,
		auto_paper_trade: b.auto_paper_trade === true || b.auto_paper_trade === 'true',
		ticker:  typeof b.ticker === 'string' ? b.ticker : symbol,
		time:    typeof b.time   === 'string' ? b.time   : new Date().toISOString(),
	};
}

// ─── Persistence ──────────────────────────────────────────────────────────────

export async function saveAlert(
	supabase: SupabaseClient,
	payload: TVAlertPayload,
	paperTradeExecuted = false,
): Promise<string> {
	const id = crypto.randomUUID();
	const row = {
		id,
		symbol:       payload.symbol,
		action:       payload.action,
		price:        payload.price,
		message:      payload.message,
		paper_trade:  paperTradeExecuted,
		triggered_at: payload.time ?? new Date().toISOString(),
	};
	await supabase.from('tv_alerts').insert(row);
	return id;
}

export async function listAlerts(
	supabase: SupabaseClient,
	limit = 20,
): Promise<TVAlert[]> {
	const { data, error } = await supabase
		.from('tv_alerts')
		.select('id, symbol, action, price, message, triggered_at, paper_trade')
		.order('triggered_at', { ascending: false })
		.limit(limit);

	if (error || !data) return [];

	return data.map(r => ({
		id:          r.id as string,
		symbol:      r.symbol as string,
		action:      r.action as TVAlertAction,
		price:       r.price as number,
		message:     r.message as string,
		triggeredAt: new Date(r.triggered_at as string).getTime(),
		paperTrade:  r.paper_trade as boolean,
	}));
}

// ─── Telegram formatting ──────────────────────────────────────────────────────

const ACTION_EMOJI: Record<TVAlertAction, string> = {
	buy:   '🟢',
	sell:  '🔴',
	close: '⚪',
	alert: '📢',
};

export function formatTelegramAlert(payload: TVAlertPayload): string {
	const emoji = ACTION_EMOJI[payload.action] ?? '📢';
	const lines = [
		`${emoji} <b>TradingView Alert</b>`,
		``,
		`<b>Symbol:</b> ${payload.symbol}`,
		`<b>Action:</b> ${payload.action.toUpperCase()}`,
		`<b>Price:</b> ${payload.price.toLocaleString('en-US', { maximumFractionDigits: 4 })}`,
	];
	if (payload.message) lines.push(`<b>Message:</b> ${payload.message}`);
	if (payload.auto_paper_trade) lines.push(`<b>Paper trade:</b> Executed`);
	return lines.join('\n');
}
