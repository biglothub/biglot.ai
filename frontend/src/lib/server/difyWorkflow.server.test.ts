import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env as privateEnv } from '$env/dynamic/private';
import {
	buildDifyWorkflowInputs,
	getDifyWorkflowRuntime,
	runDifyWorkflow
} from './difyWorkflow.server';

function setEnv(vars: Record<string, string | undefined>) {
	for (const [key, value] of Object.entries(vars)) {
		if (value === undefined) {
			delete (privateEnv as Record<string, string | undefined>)[key];
		} else {
			(privateEnv as Record<string, string | undefined>)[key] = value;
		}
	}
}

function createStream(chunks: string[]) {
	const encoder = new TextEncoder();
	let index = 0;
	return new ReadableStream<Uint8Array>({
		pull(controller) {
			if (index >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(chunks[index++]));
		}
	});
}

describe('difyWorkflow.server', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		setEnv({
			DIFY_BASE_URL: undefined,
			DIFY_AGENT_ENABLED: undefined,
			DIFY_AGENT_API_KEY: undefined,
			DIFY_RESEARCH_ENABLED: undefined,
			DIFY_RESEARCH_API_KEY: undefined,
			DIFY_TIMEOUT_MS: undefined
		});
	});

	it('builds workflow inputs from BigLot chat history', () => {
		const inputs = buildDifyWorkflowInputs({
			chatMode: 'agent',
			mode: 'coach',
			biglotUserId: 'user-1',
			query: 'latest question',
			context: 'memory',
			routeType: 'direct_answer',
			messages: [
				{ role: 'user', content: 'first question' },
				{ role: 'assistant', content: 'first answer' },
				{ role: 'user', content: 'latest question', file_name: 'notes.md', file_content: 'alpha' }
			]
		});

		expect(inputs).toEqual({
			query: '[File: notes.md]\nalpha\nlatest question',
			chat_history: 'USER: first question\n\nASSISTANT: first answer',
			mode: 'agent',
			agent_mode: 'coach',
			biglot_user_id: 'user-1',
			context: 'memory',
			route_type: 'direct_answer'
		});
	});

	it('reads runtime config from env flags', () => {
		setEnv({
			DIFY_BASE_URL: 'http://localhost:5001/v1/',
			DIFY_AGENT_ENABLED: '1',
			DIFY_AGENT_API_KEY: 'agent-key',
			DIFY_TIMEOUT_MS: '45000'
		});

		expect(getDifyWorkflowRuntime('agent')).toEqual({
			baseUrl: 'http://localhost:5001/v1',
			apiKey: 'agent-key',
			timeoutMs: 45000,
			runModelLabel: 'dify-workflow:agent',
			runProviderLabel: 'dify'
		});
	});

	it('streams text chunks and returns workflow metadata', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				createStream([
					'event: workflow_started\ndata: {"workflow_run_id":"run-1","data":{"id":"run-1"}}\n\n',
					'event: text_chunk\ndata: {"data":{"text":"Hello "}}\n\n',
					'event: text_chunk\ndata: {"data":{"text":"world"}}\n\n',
					'event: workflow_finished\ndata: {"data":{"status":"succeeded","outputs":{"text":"Hello world"}}}\n\n'
				]),
				{ status: 200 }
			)
		);
		vi.stubGlobal('fetch', fetchMock);

		const chunks: string[] = [];
		const result = await runDifyWorkflow({
			runtime: {
				baseUrl: 'http://localhost:5001/v1',
				apiKey: 'app-key',
				timeoutMs: 1000,
				runModelLabel: 'dify-workflow:agent',
				runProviderLabel: 'dify'
			},
			user: 'user-1',
			inputs: { query: 'hi' },
			onTextDelta: (text) => chunks.push(text)
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(chunks).toEqual(['Hello ', 'world']);
		expect(result).toEqual({
			workflowRunId: 'run-1',
			text: 'Hello world',
			outputs: { text: 'Hello world' },
			status: 'succeeded'
		});
	});
});
