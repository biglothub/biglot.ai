import { getClientForModel, resolveDefaultAIModel, type AIModel } from '$lib/server/aiProvider.server';
import { getSystemPrompt, type AgentMode } from '$lib/agent/systemPrompts';
import { getRecentChatMessages, saveChatMessage } from './chatPersistence.server';
import { getRelevantMemoryContext } from './memory.server';
import type { AssistantReply, InboundEnvelope } from './channels/types';

const DEFAULT_CONTEXT_MESSAGES = 30;

export async function runChannelChatRuntime(input: {
	biglotUserId: string;
	chatId: string;
	envelope: InboundEnvelope;
	mode?: AgentMode;
	model?: string;
	contextLimit?: number;
}): Promise<AssistantReply> {
	const mode = input.mode ?? 'coach';

	await saveChatMessage({
		chatId: input.chatId,
		biglotUserId: input.biglotUserId,
		role: 'user',
		content: input.envelope.message.text,
		mode,
		channel: input.envelope.channel,
		externalMessageId: input.envelope.message.externalMessageId
	});

	const contextRows = await getRecentChatMessages({
		chatId: input.chatId,
		limit: input.contextLimit ?? DEFAULT_CONTEXT_MESSAGES
	});

	const safeContext = contextRows
		.filter((row) => row && (row.role === 'user' || row.role === 'assistant' || row.role === 'system'))
		.map((row) => ({
			role: row.role,
			content: typeof row.content === 'string' ? row.content.slice(0, 8000) : ''
		}))
		.filter((row) => row.content.trim().length > 0);

	const memoryContext = await getRelevantMemoryContext({
		userId: input.biglotUserId,
		query: input.envelope.message.text
	}).catch(() => null);
	const systemPrompt = getSystemPrompt(mode);
	const model = (input.model ?? resolveDefaultAIModel()) as AIModel;
	const { client, apiModel, provider } = getClientForModel(model);

	const completion = await client.chat.completions.create({
		model: apiModel,
		messages: [
			{
				role: 'system',
				content: memoryContext ? `${systemPrompt}\n\n${memoryContext}` : systemPrompt
			},
			...safeContext
		],
		temperature: 0.5,
		max_tokens: 1200
	});

	const assistantContentRaw = completion.choices[0]?.message?.content;
	const assistantContent =
		typeof assistantContentRaw === 'string' && assistantContentRaw.trim().length > 0
			? assistantContentRaw
			: `(${provider}) didn't return a text response.`;

	await saveChatMessage({
		chatId: input.chatId,
		biglotUserId: input.biglotUserId,
		role: 'assistant',
		content: assistantContent,
		mode,
		channel: input.envelope.channel
	});

	return {
		plainText: assistantContent,
		blocks: [],
		toolEvents: [],
		final: true,
		citations: []
	};
}
