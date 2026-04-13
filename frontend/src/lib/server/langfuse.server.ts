import { env } from '$env/dynamic/private';
import { observeOpenAI } from '@langfuse/openai';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
	propagateAttributes,
	startActiveObservation,
	type LangfuseChain
} from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';

const LANGFUSE_SERVICE_NAME = 'biglot-ai-frontend';
const PROPAGATED_VALUE_LIMIT = 200;

type LangfuseRuntimeState = {
	initialized: boolean;
	enabled: boolean;
	sdk: NodeSDK | null;
	processHooksRegistered: boolean;
};

type ObserveOpenAIClientContext = {
	provider: string;
	apiModel: string;
	baseURL?: string;
};

export type BiglotTraceContext = {
	traceName: string;
	userId: string;
	sessionId: string;
	input: Record<string, unknown>;
	metadata: Record<string, unknown>;
	tags?: string[];
};

declare global {
	var __biglotLangfuseState: LangfuseRuntimeState | undefined;
}

const runtimeState: LangfuseRuntimeState =
	globalThis.__biglotLangfuseState ??
	(globalThis.__biglotLangfuseState = {
		initialized: false,
		enabled: false,
		sdk: null,
		processHooksRegistered: false
	});

function isLangfuseEnabledByConfig(): boolean {
	return env.LANGFUSE_ENABLED?.trim() === '1';
}

function getLangfuseEnvironment(): string {
	return env.LANGFUSE_ENV?.trim() || env.NODE_ENV?.trim() || 'development';
}

function registerShutdownHooks(): void {
	if (runtimeState.processHooksRegistered || !runtimeState.sdk) return;

	const shutdown = () => {
		void runtimeState.sdk?.shutdown().catch((error) => {
			console.warn('[BigLot.ai] Langfuse shutdown failed:', error);
		});
	};

	process.once('beforeExit', shutdown);
	process.once('SIGINT', shutdown);
	process.once('SIGTERM', shutdown);
	runtimeState.processHooksRegistered = true;
}

function toPropagatedMetadata(metadata: Record<string, unknown>): Record<string, string> {
	const propagated: Record<string, string> = {};

	for (const [key, value] of Object.entries(metadata)) {
		const serialized = serializePropagatedValue(value);
		if (!serialized) continue;
		propagated[key] = serialized;
	}

	return propagated;
}

function serializePropagatedValue(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed ? trimmed.slice(0, PROPAGATED_VALUE_LIMIT) : null;
	}

	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
		return String(value).slice(0, PROPAGATED_VALUE_LIMIT);
	}

	if (Array.isArray(value)) {
		const joined = value
			.map((entry) => serializePropagatedValue(entry))
			.filter((entry): entry is string => !!entry)
			.join(',');
		return joined ? joined.slice(0, PROPAGATED_VALUE_LIMIT) : null;
	}

	if (!value) return null;

	try {
		const serialized = JSON.stringify(value);
		return serialized ? serialized.slice(0, PROPAGATED_VALUE_LIMIT) : null;
	} catch {
		return null;
	}
}

export function ensureLangfuseTracing(): boolean {
	if (runtimeState.initialized) {
		return runtimeState.enabled;
	}

	runtimeState.initialized = true;

	if (!isLangfuseEnabledByConfig()) {
		runtimeState.enabled = false;
		return false;
	}

	const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
	const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
	const baseUrl = env.LANGFUSE_BASE_URL?.trim();

	if (!publicKey || !secretKey || !baseUrl) {
		console.warn(
			'[BigLot.ai] Langfuse tracing is enabled but LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, or LANGFUSE_BASE_URL is missing. Tracing is disabled.'
		);
		runtimeState.enabled = false;
		return false;
	}

	try {
		runtimeState.sdk = new NodeSDK({
			serviceName: LANGFUSE_SERVICE_NAME,
			spanProcessors: [
				new LangfuseSpanProcessor({
					publicKey,
					secretKey,
					baseUrl,
					environment: getLangfuseEnvironment(),
					exportMode: 'immediate'
				})
			]
		});
		runtimeState.sdk.start();
		runtimeState.enabled = true;
		registerShutdownHooks();
	} catch (error) {
		runtimeState.enabled = false;
		console.error('[BigLot.ai] Failed to initialize Langfuse tracing:', error);
	}

	return runtimeState.enabled;
}

export function observeOpenAIClient<SDKType extends object>(
	sdk: SDKType,
	context: ObserveOpenAIClientContext
): SDKType {
	if (!ensureLangfuseTracing()) {
		return sdk;
	}

	return observeOpenAI(sdk, {
		generationMetadata: {
			provider: context.provider,
			apiModel: context.apiModel,
			baseUrl: context.baseURL ?? 'https://api.openai.com/v1'
		}
	});
}

export async function withLangfuseChatTrace<T>(
	traceContext: BiglotTraceContext,
	fn: (rootObservation: LangfuseChain | null) => Promise<T>
): Promise<T> {
	if (!ensureLangfuseTracing()) {
		return fn(null);
	}

	return startActiveObservation(
		'chat.request',
		(rootObservation) =>
			propagateAttributes(
				{
					userId: traceContext.userId,
					sessionId: traceContext.sessionId,
					traceName: traceContext.traceName,
					metadata: toPropagatedMetadata(traceContext.metadata),
					tags: traceContext.tags
				},
				() => {
					rootObservation.update({
						input: traceContext.input,
						metadata: traceContext.metadata
					});
					return fn(rootObservation);
				}
			),
		{ asType: 'chain' }
	);
}
