// Thin HTTP client for the tradingview-mcp FastAPI wrapper.
//
// One endpoint pattern: POST {BASE_URL}/tools/{name}  with JSON body of args
// → returns { tool, result } where `result` is the tool's native return shape.
//
// We deliberately keep this client minimal — no business logic, no parsing of
// individual tool shapes. Each BigLot tool wrapper handles its own response
// formatting and content block construction.

import { env } from '$env/dynamic/private';

export type TradingviewCallOptions = {
	timeoutMs?: number;
	signal?: AbortSignal;
};

export class TradingviewClientError extends Error {
	status: number;
	body: string;
	constructor(message: string, status: number, body: string) {
		super(message);
		this.name = 'TradingviewClientError';
		this.status = status;
		this.body = body;
	}
}

function getBaseUrl(): string {
	const raw = env.TRADINGVIEW_MCP_URL?.trim();
	if (!raw) {
		throw new Error(
			'TRADINGVIEW_MCP_URL is not set. Add it to .env (e.g. https://your-app.up.railway.app).'
		);
	}
	return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function buildHeaders(): Record<string, string> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		Accept: 'application/json'
	};
	const key = env.TRADINGVIEW_MCP_KEY?.trim();
	if (key) headers.Authorization = `Bearer ${key}`;
	return headers;
}

/**
 * Call a tradingview-mcp tool by name. Returns the unwrapped `result` field.
 * Throws TradingviewClientError on HTTP errors and the underlying error on
 * network/timeout.
 */
export async function callTradingviewTool<T = unknown>(
	toolName: string,
	args: Record<string, unknown> = {},
	options: TradingviewCallOptions = {}
): Promise<T> {
	const baseUrl = getBaseUrl();
	const timeoutMs = options.timeoutMs ?? 30_000;

	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

	const composedSignal = options.signal
		? anySignal([controller.signal, options.signal])
		: controller.signal;

	try {
		const response = await fetch(`${baseUrl}/tools/${encodeURIComponent(toolName)}`, {
			method: 'POST',
			headers: buildHeaders(),
			body: JSON.stringify(args),
			signal: composedSignal
		});

		const text = await response.text();

		if (!response.ok) {
			throw new TradingviewClientError(
				`tradingview-mcp ${toolName} returned ${response.status}: ${truncate(text, 200)}`,
				response.status,
				text
			);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new TradingviewClientError(
				`tradingview-mcp ${toolName} returned non-JSON response`,
				response.status,
				text
			);
		}

		if (parsed && typeof parsed === 'object' && 'result' in parsed) {
			return (parsed as { result: T }).result;
		}
		return parsed as T;
	} finally {
		clearTimeout(timeoutHandle);
	}
}

/**
 * Fetch the manifest of every tool exposed by the HTTP wrapper. Useful for
 * runtime introspection / debugging.
 */
export async function listTradingviewTools(options: TradingviewCallOptions = {}): Promise<{
	count: number;
	tools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
}> {
	const baseUrl = getBaseUrl();
	const timeoutMs = options.timeoutMs ?? 10_000;
	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${baseUrl}/tools`, {
			method: 'GET',
			headers: buildHeaders(),
			signal: controller.signal
		});
		const text = await response.text();
		if (!response.ok) {
			throw new TradingviewClientError(
				`tradingview-mcp /tools returned ${response.status}: ${truncate(text, 200)}`,
				response.status,
				text
			);
		}
		return JSON.parse(text);
	} finally {
		clearTimeout(timeoutHandle);
	}
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return s.slice(0, max) + '...';
}

function anySignal(signals: AbortSignal[]): AbortSignal {
	const controller = new AbortController();
	const abort = (reason: unknown) => controller.abort(reason);
	for (const s of signals) {
		if (s.aborted) {
			controller.abort(s.reason);
			break;
		}
		s.addEventListener('abort', () => abort(s.reason), { once: true });
	}
	return controller.signal;
}
