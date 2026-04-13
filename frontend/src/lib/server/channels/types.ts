import type { ContentBlock } from '$lib/types/contentBlock';

export type ChannelSender = {
	externalUserId: string;
	username?: string | null;
	displayName?: string | null;
};

export type ChannelAttachment = {
	type: 'image' | 'file';
	url?: string;
	fileName?: string;
	mimeType?: string;
};

export type InboundEnvelope = {
	channel: string;
	accountId?: string;
	conversationId: string;
	threadId?: string;
	sender: ChannelSender;
	message: {
		externalMessageId?: string;
		text: string;
		replyToExternalMessageId?: string;
	};
	attachments: ChannelAttachment[];
	receivedAt: number;
	raw?: unknown;
};

export type AssistantCitation = {
	title: string;
	url?: string;
	source?: string;
};

export type AssistantToolEvent = {
	type: 'start' | 'result';
	toolName: string;
	message?: string;
};

export type AssistantReply = {
	plainText: string;
	blocks: ContentBlock[];
	toolEvents: AssistantToolEvent[];
	final: boolean;
	citations: AssistantCitation[];
};

export type ChannelConversation = {
	chatId: string;
	externalConversationId: string;
};
