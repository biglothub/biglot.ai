import { env } from '$env/dynamic/private';
import { getClientForModel, isAIModel, resolveDefaultAIModel, type AIModel } from './aiProvider.server';
import { describeDiscussionModels } from './discussionLoop.server';

export type ChatMode = 'normal' | 'agent' | 'discussion' | 'research';

export type ChatModelRuntime = {
	selectedModel: AIModel;
	runModelLabel: string;
	runProviderLabel: string;
	clientBundle: ReturnType<typeof getClientForModel> | null;
};

export function resolveChatModelRuntime(chatMode: ChatMode): ChatModelRuntime {
	const sharedModel = resolveDefaultAIModel();
	const normalModel = isAIModel(env.NORMAL_AI_MODEL) ? env.NORMAL_AI_MODEL : sharedModel;
	const agentModel = isAIModel(env.AGENT_AI_MODEL) ? env.AGENT_AI_MODEL : sharedModel;

	const selectedModel = chatMode === 'agent' ? agentModel : normalModel;

	if (chatMode === 'discussion') {
		const summary = describeDiscussionModels();
		return {
			selectedModel,
			runModelLabel: summary.modelLabel,
			runProviderLabel: summary.providerLabel,
			clientBundle: null
		};
	}

	const clientBundle = getClientForModel(selectedModel);
	return {
		selectedModel,
		runModelLabel: selectedModel,
		runProviderLabel: clientBundle.provider,
		clientBundle
	};
}
