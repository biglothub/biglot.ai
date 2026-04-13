import { env } from '$env/dynamic/private';
import { parseSSEStream } from '$lib/utils/sseParser';

export type DifyChatMode = 'agent' | 'research';

export type DifyNormalizedMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
	image_url?: string;
	file_name?: string;
	file_content?: string;
};

export type DifyWorkflowRuntime = {
	baseUrl: string;
	apiKey: string;
	timeoutMs: number;
	runModelLabel: `dify-workflow:${DifyChatMode}`;
	runProviderLabel: 'dify';
};

export type DifyWorkflowResult = {
	workflowRunId: string | null;
	text: string;
	outputs: Record<string, unknown> | null;
	status: string | null;
};

export class DifyWorkflowError extends Error {
	code: 'http' | 'timeout' | 'stream' | 'workflow_failed';
	status?: number;

	constructor(
		message: string,
		code: DifyWorkflowError['code'],
		options?: { status?: number }
	) {
		super(message);
		this.name = 'DifyWorkflowError';
		this.code = code;
		this.status = options?.status;
	}
}

function isEnabledFlag(value: string | undefined): boolean {
	return value === '1' || value?.toLowerCase() === 'true';
}

function parseTimeoutMs(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(parsed) || parsed < 1) return 60_000;
	return parsed;
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, '');
}

export function getDifyWorkflowRuntime(
	chatMode: DifyChatMode,
	options?: {
		hasImageInput?: boolean;
		hasCustomBot?: boolean;
	}
): DifyWorkflowRuntime | null {
	if (options?.hasImageInput || options?.hasCustomBot) {
		return null;
	}

	const enabled =
		chatMode === 'agent'
			? isEnabledFlag(env.DIFY_AGENT_ENABLED)
			: isEnabledFlag(env.DIFY_RESEARCH_ENABLED);

	if (!enabled) return null;

	const baseUrl = env.DIFY_BASE_URL?.trim();
	const apiKey =
		chatMode === 'agent'
			? env.DIFY_AGENT_API_KEY?.trim()
			: env.DIFY_RESEARCH_API_KEY?.trim();

	if (!baseUrl || !apiKey) {
		return null;
	}

	return {
		baseUrl: trimTrailingSlash(baseUrl),
		apiKey,
		timeoutMs: parseTimeoutMs(env.DIFY_TIMEOUT_MS),
		runModelLabel: `dify-workflow:${chatMode}`,
		runProviderLabel: 'dify'
	};
}

function formatMessageContent(message: DifyNormalizedMessage): string {
	const parts: string[] = [];

	if (message.file_content) {
		const fileLabel = message.file_name ?? 'attachment';
		parts.push(`[File: ${fileLabel}]`);
		parts.push(message.file_content);
	}

	if (message.image_url) {
		parts.push(`[Image URL: ${message.image_url}]`);
	}

	if (message.content.trim()) {
		parts.push(message.content.trim());
	}

	return parts.join('\n');
}

export function buildDifyWorkflowInputs(input: {
	chatMode: DifyChatMode;
	mode: string;
	biglotUserId: string;
	messages: DifyNormalizedMessage[];
	query: string;
	context?: string | null;
	routeType?: string;
}): Record<string, unknown> {
	const historyMessages = input.messages.slice(0, -1);
	const latestMessage = input.messages.at(-1);
	const chatHistory = historyMessages
		.map((message) => `${message.role.toUpperCase()}: ${formatMessageContent(message)}`)
		.filter((line) => line.trim().length > 0)
		.join('\n\n');
	const normalizedLatestQuery =
		latestMessage?.role === 'user' ? formatMessageContent(latestMessage) || input.query : input.query;

	return {
		query: normalizedLatestQuery,
		chat_history: chatHistory,
		mode: input.chatMode,
		agent_mode: input.mode,
		biglot_user_id: input.biglotUserId,
		context: input.context ?? '',
		route_type: input.routeType ?? null
	};
}

function parseJsonObject(value: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(value);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function getStringCandidate(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) {
		return value;
	}
	return null;
}

function findOutputText(value: unknown): string | null {
	const direct = getStringCandidate(value);
	if (direct) return direct;

	if (!value || typeof value !== 'object') {
		return null;
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			const candidate = findOutputText(item);
			if (candidate) return candidate;
		}
		return null;
	}

	const record = value as Record<string, unknown>;
	for (const key of ['text', 'answer', 'content', 'output', 'result', 'markdown']) {
		const candidate = findOutputText(record[key]);
		if (candidate) return candidate;
	}

	for (const nested of Object.values(record)) {
		const candidate = findOutputText(nested);
		if (candidate) return candidate;
	}

	return null;
}

export async function runDifyWorkflow(input: {
	runtime: DifyWorkflowRuntime;
	user: string;
	inputs: Record<string, unknown>;
	onWorkflowStart?: (workflowRunId: string) => void;
	onTextDelta?: (text: string) => void;
}): Promise<DifyWorkflowResult> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), input.runtime.timeoutMs);

	try {
		const response = await fetch(`${input.runtime.baseUrl}/workflows/run`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${input.runtime.apiKey}`
			},
			body: JSON.stringify({
				inputs: input.inputs,
				user: input.user,
				response_mode: 'streaming'
			}),
			signal: controller.signal
		});

		if (!response.ok) {
			let details = `Dify workflow request failed (${response.status})`;
			try {
				const payload = await response.json();
				const message = typeof payload?.message === 'string' ? payload.message : null;
				if (message) details = `${details}: ${message}`;
			} catch {
				// Preserve the status-only message when the body is not JSON.
			}
			throw new DifyWorkflowError(details, 'http', { status: response.status });
		}

		if (!response.body) {
			throw new DifyWorkflowError('Dify workflow response body is empty', 'stream');
		}

		let workflowRunId: string | null = null;
		let text = '';
		let outputs: Record<string, unknown> | null = null;
		let status: string | null = null;

		for await (const event of parseSSEStream(response.body)) {
			const payload = parseJsonObject(event.data);
			if (!payload) continue;

			switch (event.event) {
				case 'workflow_started': {
					const candidate =
						typeof payload.workflow_run_id === 'string'
							? payload.workflow_run_id
							: typeof payload.data === 'object' &&
								  payload.data &&
								  typeof (payload.data as Record<string, unknown>).id === 'string'
								? ((payload.data as Record<string, unknown>).id as string)
								: null;
					if (candidate) {
						workflowRunId = candidate;
						input.onWorkflowStart?.(candidate);
					}
					break;
				}
				case 'text_chunk': {
					const chunk =
						typeof payload.data === 'object' &&
						payload.data &&
						typeof (payload.data as Record<string, unknown>).text === 'string'
							? ((payload.data as Record<string, unknown>).text as string)
							: null;
					if (chunk) {
						text += chunk;
						input.onTextDelta?.(chunk);
					}
					break;
				}
				case 'text_replace': {
					const replacement =
						typeof payload.data === 'object' &&
						payload.data &&
						typeof (payload.data as Record<string, unknown>).text === 'string'
							? ((payload.data as Record<string, unknown>).text as string)
							: null;
					if (!replacement) break;
					if (replacement.startsWith(text)) {
						const delta = replacement.slice(text.length);
						if (delta) {
							text += delta;
							input.onTextDelta?.(delta);
						}
					} else {
						text = replacement;
					}
					break;
				}
				case 'workflow_finished': {
					const data =
						typeof payload.data === 'object' && payload.data
							? (payload.data as Record<string, unknown>)
							: null;
					outputs =
						data && typeof data.outputs === 'object' && data.outputs
							? (data.outputs as Record<string, unknown>)
							: null;
					status = data && typeof data.status === 'string' ? data.status : null;
					const errorMessage = data && typeof data.error === 'string' ? data.error : null;
					if (status && !['succeeded', 'success', 'completed'].includes(status)) {
						throw new DifyWorkflowError(
							errorMessage || `Dify workflow finished with status ${status}`,
							'workflow_failed'
						);
					}
					break;
				}
				case 'error': {
					const message =
						typeof payload.message === 'string'
							? payload.message
							: typeof payload.err === 'string'
								? payload.err
								: 'Dify workflow returned an error';
					throw new DifyWorkflowError(message, 'stream');
				}
			}
		}

		if (!text.trim()) {
			const outputText = findOutputText(outputs);
			if (outputText) {
				text = outputText;
			}
		}

		if (!text.trim()) {
			throw new DifyWorkflowError('Dify workflow completed without any text output', 'stream');
		}

		return { workflowRunId, text, outputs, status };
	} catch (error) {
		if (error instanceof DifyWorkflowError) {
			throw error;
		}

		if (error instanceof Error && error.name === 'AbortError') {
			throw new DifyWorkflowError('Dify workflow request timed out', 'timeout');
		}

		throw new DifyWorkflowError(
			error instanceof Error ? error.message : 'Failed to call Dify workflow',
			'stream'
		);
	} finally {
		clearTimeout(timeoutId);
	}
}
