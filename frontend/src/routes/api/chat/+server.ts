import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSystemPrompt, getCustomBotSystemPrompt, normalizeAgentMode } from '$lib/agent/systemPrompts';
import { StreamingThinkFilter } from '$lib/server/aiProvider.server';
import { getSupabaseAdminClient } from '$lib/server/supabaseAdmin.server';
import { checkRateLimit, RATE_LIMITS } from '$lib/server/rateLimiter.server';
import { runAgentLoop } from '$lib/server/agentLoop.server';
import { runDiscussionLoop } from '$lib/server/discussionLoop.server';
import { resolveChatModelRuntime } from '$lib/server/chatModelRuntime.server';
import {
	createAgentRun,
	logToolExecution,
	updateAgentRun,
	upsertAgentStepRun
} from '$lib/server/agentObservability.server';
import { classifyChatRoute, shouldEnablePlanning } from '$lib/server/chatRouting.server';
import {
	buildChatTitle,
	createChatRecord,
	deleteChatRecord,
	saveChatMessage,
	validateBiglotUserId
} from '$lib/server/chatPersistence.server';
import { getRelevantMemoryContext } from '$lib/server/memory.server';
import {
	buildDifyWorkflowInputs,
	getDifyWorkflowRuntime,
	runDifyWorkflow
} from '$lib/server/difyWorkflow.server';
import { buildResearchReportBlock } from '$lib/server/researchReport.server';
import { runWithMemoryToolUserId } from '$lib/server/tools/memory.tool';
import type { AgentRouteType, ContentBlock } from '$lib/types/contentBlock';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

type JsonObject = Record<string, unknown>;

type IncomingMessage = {
	role: 'user' | 'assistant' | 'system';
	content?: unknown;
	image_url?: unknown;
	file_name?: unknown;
	file_content?: unknown;
};

function isRole(value: unknown): value is IncomingMessage['role'] {
	return value === 'user' || value === 'assistant' || value === 'system';
}

function isRecord(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null;
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
	return isRecord(value) && isRole(value.role);
}

function sseEvent(event: string, data: unknown): string {
	return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	const clientIp = getClientAddress() || 'unknown';
	const rateLimitResult = checkRateLimit(clientIp, RATE_LIMITS.chat);

	if (!rateLimitResult.allowed) {
		return json(
			{ error: 'Too many requests. Please try again later.' },
			{
				status: 429,
				headers: {
					'X-RateLimit-Remaining': '0',
					'X-RateLimit-Reset': String(Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000))
				}
			}
		);
	}

	let payload: JsonObject;
	try {
		const requestBody = await request.json();
		if (!isRecord(requestBody)) {
			return json({ error: 'JSON body must be an object' }, { status: 400 });
		}
		payload = requestBody;
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const messagesRaw = payload.messages;
	if (!Array.isArray(messagesRaw)) {
		return json({ error: '`messages` must be an array' }, { status: 400 });
	}

	const initialChatId = typeof payload.chatId === 'string' ? payload.chatId : null;
	const rawBiglotUserId = typeof payload.biglotUserId === 'string' ? payload.biglotUserId : null;
	const botId = typeof payload.botId === 'string' ? payload.botId : null;

	let biglotUserId: string;
	try {
		biglotUserId = validateBiglotUserId(rawBiglotUserId);
	} catch {
		return json({ error: 'Invalid biglotUserId' }, { status: 400 });
	}

	const MAX_MESSAGES = 50;
	const MAX_CHARS = 8000;
	const MAX_FILE_CHARS = 40_000;

	const safeMessages = messagesRaw
		.filter(isIncomingMessage)
		.map((message) => ({
			role: message.role,
			content: typeof message.content === 'string' ? message.content.slice(0, MAX_CHARS) : '',
			image_url: typeof message.image_url === 'string' ? message.image_url : undefined,
			file_name: typeof message.file_name === 'string' ? message.file_name : undefined,
			file_content: typeof message.file_content === 'string'
				? message.file_content.slice(0, MAX_FILE_CHARS)
				: undefined
		}))
		.filter(
			(message) =>
				message.content.trim().length > 0 ||
				(message.role === 'user' && message.image_url) ||
				(message.role === 'user' && message.file_content)
		)
		.slice(-MAX_MESSAGES);

	let customBot: { system_prompt: string; tools: string[]; default_model: string | null } | null = null;
	if (botId && biglotUserId) {
		try {
			const supabase = getSupabaseAdminClient();
			const { data, error: botError } = await supabase
				.from('custom_bots')
				.select('system_prompt, tools, default_model, biglot_user_id')
				.eq('id', botId)
				.eq('is_active', true)
				.single();

			if (!botError && data && data.biglot_user_id === biglotUserId) {
				customBot = {
					system_prompt: data.system_prompt,
					tools: data.tools ?? [],
					default_model: data.default_model
				};
			}
		} catch {
			// Ignore bot lookup failures and keep default behavior.
		}
	}

	const mode = normalizeAgentMode(payload.mode);
	const chatMode = customBot
		? 'agent'
		: payload.chatMode === 'agent'
			? 'agent'
			: payload.chatMode === 'discussion'
				? 'discussion'
				: payload.chatMode === 'research'
					? 'research'
					: 'normal';

	const latestUserMessage = [...safeMessages].reverse().find((message) => message.role === 'user');
	if (!latestUserMessage) {
		return json({ error: 'At least one user message is required' }, { status: 400 });
	}

	const lastUserMessage = latestUserMessage.content;
	const hasImageInput = safeMessages.some((message) => message.role === 'user' && !!message.image_url);
	const pendingChatTitle = buildChatTitle({
		content: latestUserMessage.content,
		fileName: latestUserMessage.file_name,
		hasImage: hasImageInput
	});
	const routeType: AgentRouteType =
		chatMode === 'discussion'
			? 'discussion'
			: classifyChatRoute({
					chatMode,
					mode,
					lastUserMessage,
					hasImageInput
				});
	const isDeepResearch = routeType === 'deep_research';
	const planningEnabled = shouldEnablePlanning(chatMode, routeType);

	const systemPrompt = customBot
		? getCustomBotSystemPrompt(customBot.system_prompt, customBot.tools, planningEnabled, isDeepResearch)
		: getSystemPrompt(mode, planningEnabled, isDeepResearch);

	const difyRuntime =
		chatMode === 'agent' || chatMode === 'research'
			? getDifyWorkflowRuntime(chatMode, {
					hasImageInput,
					hasCustomBot: !!customBot
				})
			: null;

	let legacyRuntimeCache: ReturnType<typeof resolveChatModelRuntime> | null = null;
	const getLegacyRuntime = () => {
		if (!legacyRuntimeCache) {
			legacyRuntimeCache = resolveChatModelRuntime(chatMode, customBot?.default_model ?? null);
		}
		return legacyRuntimeCache;
	};

	const runModelLabel = difyRuntime ? difyRuntime.runModelLabel : getLegacyRuntime().runModelLabel;
	const runProviderLabel = difyRuntime ? difyRuntime.runProviderLabel : getLegacyRuntime().runProviderLabel;

	if (env.BIGLOT_CHAT_ECHO_MODE === '1') {
		return new Response(`Mode: ${mode}\nModel: ${runModelLabel}\n`, {
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'no-cache',
				'X-BigLot-Mode': mode,
				'X-BigLot-Model': runModelLabel
			}
		});
	}

	const legacyRuntime = difyRuntime ? null : getLegacyRuntime();
	if (legacyRuntime?.clientBundle && hasImageInput && !legacyRuntime.clientBundle.supportsImageInput) {
		const configuredKey =
			chatMode === 'normal'
				? 'NORMAL_AI_MODEL'
				: chatMode === 'research'
					? 'RESEARCH_AI_MODEL'
					: 'AGENT_AI_MODEL';

		return json(
			{
				error: `Model '${legacyRuntime.selectedModel}' does not support image input. Switch ${configuredKey} or AI_MODEL to 'gpt-4o' or 'gpt-4o-mini'.`
			},
			{ status: 400, headers: { 'X-BigLot-Mode': mode, 'X-BigLot-Model': runModelLabel } }
		);
	}

	const memoryContext = await getRelevantMemoryContext({
		userId: biglotUserId,
		query: lastUserMessage
	}).catch(() => null);

	const formattedMessages: ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: memoryContext ? `${systemPrompt}\n\n${memoryContext}` : systemPrompt
		},
		...safeMessages.map((message): ChatCompletionMessageParam => {
			if (message.role === 'user' && message.file_content) {
				const ext = message.file_name?.split('.').pop()?.toLowerCase() ?? '';
				const langMap: Record<string, string> = {
					py: 'python',
					js: 'javascript',
					ts: 'typescript',
					json: 'json',
					csv: 'csv',
					md: 'markdown',
					html: 'html',
					css: 'css',
					xml: 'xml',
					yaml: 'yaml',
					yml: 'yaml',
					pdf: 'text',
					xlsx: 'csv',
					xls: 'csv',
					docx: 'text'
				};
				const lang = langMap[ext] ?? ext;
				const isParsed = ['pdf', 'xlsx', 'xls', 'docx'].includes(ext);
				const fileHeader = isParsed
					? `[Extracted text from: ${message.file_name ?? 'attachment'}]`
					: `[File: ${message.file_name ?? 'attachment'}]`;
				const fileBlock = `${fileHeader}\n\`\`\`${lang}\n${message.file_content}\n\`\`\``;
				const userText = message.content ? `\n\n${message.content}` : '';
				const fullText = fileBlock + userText;

				return {
					role: 'user',
					content: message.image_url
						? [
								{ type: 'text' as const, text: fullText },
								{ type: 'image_url' as const, image_url: { url: message.image_url } }
							]
						: fullText
				};
			}

			if (message.role === 'user' && message.image_url) {
				return {
					role: 'user',
					content: [
						{ type: 'text' as const, text: message.content || 'Analyze this image.' },
						{ type: 'image_url' as const, image_url: { url: message.image_url } }
					]
				};
			}

			return { role: message.role, content: message.content };
		})
	];

	const difyInputs =
		difyRuntime && (chatMode === 'agent' || chatMode === 'research')
			? buildDifyWorkflowInputs({
					chatMode,
					mode,
					biglotUserId,
					messages: safeMessages,
					query: lastUserMessage,
					context: memoryContext,
					routeType
				})
			: null;

	let effectiveChatId = initialChatId;
	let createdChat: { id: string; title: string | null } | null = null;

	try {
		if (!effectiveChatId) {
			const chat = await createChatRecord({
				biglotUserId,
				title: pendingChatTitle
			});
			effectiveChatId = chat.id;
			createdChat = { id: chat.id, title: chat.title };
		}

		if (!effectiveChatId) {
			throw new Error('Failed to create chat');
		}

		await saveChatMessage({
			chatId: effectiveChatId,
			biglotUserId,
			role: 'user',
			content: latestUserMessage.content,
			imageUrl: latestUserMessage.image_url,
			fileName: latestUserMessage.file_name,
			mode,
			channel: 'web'
		});
	} catch (error) {
		if (createdChat) {
			await Promise.resolve(deleteChatRecord({ chatId: createdChat.id, biglotUserId })).catch(() => null);
		}

		return json(
			{
				error: error instanceof Error ? error.message : 'Failed to save user message'
			},
			{ status: 500, headers: { 'X-BigLot-Mode': mode, 'X-BigLot-Model': runModelLabel } }
		);
	}

	if (!effectiveChatId) {
		return json(
			{ error: 'Failed to create chat' },
			{ status: 500, headers: { 'X-BigLot-Mode': mode, 'X-BigLot-Model': runModelLabel } }
		);
	}

	const activeChatId = effectiveChatId;
	const encoder = new TextEncoder();
	const readableStream = new ReadableStream({
			async start(controller) {
				let runId: string | null = null;
				let runIdPromise: Promise<string | null> | null = null;
				let rootObservation: LangfuseChain | null = null;
				let planUsed = false;
				let toolCallCount = 0;
				let streamedText = '';
				let assistantMessageId: string | undefined;
				let finalContentBlocks: ContentBlock[] = [];
				const toolStarts = new Map<string, { name: string; args: Record<string, unknown>; startedAt: number }>();
				const toolObservations = new Map<string, LangfuseTool>();

			const completeRun = async (status: 'complete' | 'error', errorMessage?: string) => {
				await runIdPromise?.catch(() => null);
				if (!runId) return;

				await updateAgentRun({
					runId,
					status,
					planUsed,
					toolCallCount,
					textOutputLength: streamedText.length,
					errorMessage
				});
			};

			const persistAssistantMessage = async (contentBlocks?: ContentBlock[]) => {
				try {
					const persisted = await saveChatMessage({
						chatId: activeChatId,
						biglotUserId,
						role: 'assistant',
						content: streamedText,
						mode,
						channel: 'web',
						runId,
						contentBlocks
					});
					assistantMessageId = persisted.id;
				} catch (persistError) {
					controller.enqueue(
						encoder.encode(
							sseEvent('error', {
								message:
									persistError instanceof Error
										? persistError.message
										: 'Failed to save assistant message'
							})
						)
					);
				}
			};

				const finishSuccess = async (contentBlocks: ContentBlock[] = []) => {
					await completeRun('complete');
					await persistAssistantMessage(contentBlocks.length > 0 ? contentBlocks : undefined);
					rootObservation?.update({
						output: {
							status: 'complete',
							runId,
							assistantMessageId,
							toolCallCount,
							planUsed,
							contentBlockCount: contentBlocks.length,
							streamedTextLength: streamedText.length,
							assistantPreview: summarizeText(streamedText, 1000)
						}
					});
					controller.enqueue(
						encoder.encode(
							sseEvent('done', {
							runId,
							routeType,
							contentBlocks,
							messageId: assistantMessageId
						})
					)
				);
			};

			const appendResearchReportIfNeeded = (startedAt: number, contentBlocks: ContentBlock[]) => {
				if (!isDeepResearch || streamedText.length === 0) return;

				const report = buildResearchReportBlock({
					query: lastUserMessage,
					text: streamedText,
					toolCallCount,
					startedAt
				});
				contentBlocks.push(report);
				controller.enqueue(encoder.encode(sseEvent('research_report', { report })));
			};

			const runLegacyAgentOrResearch = async () => {
				const runtime = getLegacyRuntime();
				if (!runtime.clientBundle) {
					throw new Error('Single-model runtime is not available for this chat mode');
				}

				const { client, apiModel } = runtime.clientBundle;
				const allBlocks = finalContentBlocks;
				const researchStartTime = Date.now();
				const keepAliveInterval = isDeepResearch
					? setInterval(() => {
							try {
								controller.enqueue(encoder.encode(': keepalive\n\n'));
							} catch {
								// Ignore closed stream writes.
							}
						}, 15_000)
					: null;

				try {
					const deepResearchMaxIterations = parseInt(env.DEEP_RESEARCH_MAX_ITERATIONS || '8', 10);
					const resultBlocks = await runWithMemoryToolUserId(biglotUserId, () =>
						runAgentLoop({
							client,
							apiModel,
							messages: formattedMessages,
							maxIterations: isDeepResearch ? deepResearchMaxIterations : 5,
							maxPlanSteps: isDeepResearch ? 10 : 6,
							planningEnabled,
							currentMode: mode,
							allowedTools: customBot?.tools.length ? customBot.tools : undefined,
							callbacks: {
								onTextDelta: (text) => {
									streamedText += text;
									controller.enqueue(encoder.encode(sseEvent('text_delta', { content: text })));
								},
								onToolStart: (toolCallId, tool, args) => {
									toolCallCount += 1;
									toolStarts.set(toolCallId, { name: tool, args, startedAt: Date.now() });
									controller.enqueue(
										encoder.encode(sseEvent('tool_start', { toolCallId, tool, args }))
									);
								},
								onToolResult: (toolCallId, tool, result) => {
									const started = toolStarts.get(toolCallId);
									const executionTimeMs = started ? Date.now() - started.startedAt : null;
									allBlocks.push(...result.contentBlocks);
									controller.enqueue(
										encoder.encode(
											sseEvent('tool_result', {
												toolCallId,
												tool,
												blocks: result.contentBlocks,
												success: result.success,
												textSummary: result.textSummary
											})
										)
									);

									void logToolExecution({
										runId,
										chatId: activeChatId,
										toolCallId,
										toolName: tool,
										toolArgs: started?.args ?? {},
										resultStatus: result.success ? 'success' : 'error',
										resultData: {
											textSummary: result.textSummary,
											blockCount: result.contentBlocks.length,
											blockTypes: result.contentBlocks.map((block) => block.type)
										},
										errorMessage: result.success ? null : result.textSummary,
										executionTimeMs
									});
								},
								onPlanCreate: (plan) => {
									planUsed = true;
									allBlocks.push(plan);
									controller.enqueue(encoder.encode(sseEvent('plan_create', { plan })));
								},
								onPlanStepUpdate: (planId, stepId, status, result, stepMeta) => {
									controller.enqueue(
										encoder.encode(sseEvent('plan_update', { planId, stepId, status, result }))
									);
									void upsertAgentStepRun({
										runId,
										planId,
										stepId,
										title: stepMeta?.title,
										toolName: stepMeta?.toolName,
										status,
										result
									});
								},
								onPlanComplete: (planId, status) => {
									controller.enqueue(encoder.encode(sseEvent('plan_complete', { planId, status })));
								},
								onHandoff: (targetMode, reason) => {
									controller.enqueue(encoder.encode(sseEvent('agent_handoff', { targetMode, reason })));
								},
								onError: (message) => {
									controller.enqueue(encoder.encode(sseEvent('error', { message })));
								}
							}
						})
					);

					for (const block of resultBlocks) {
						if (!allBlocks.includes(block)) {
							allBlocks.push(block);
						}
					}

					appendResearchReportIfNeeded(researchStartTime, allBlocks);
					await finishSuccess(allBlocks);
				} finally {
					if (keepAliveInterval) clearInterval(keepAliveInterval);
				}
			};

			const runDifyAgentOrResearch = async () => {
				if (!difyRuntime || !difyInputs) return false;

				const allBlocks = finalContentBlocks;
				const researchStartTime = Date.now();

				await runDifyWorkflow({
					runtime: difyRuntime,
					user: biglotUserId,
					inputs: difyInputs,
					onTextDelta: (text) => {
						streamedText += text;
						controller.enqueue(encoder.encode(sseEvent('text_delta', { content: text })));
					}
				});

				appendResearchReportIfNeeded(researchStartTime, allBlocks);
				await finishSuccess(allBlocks);
				return true;
			};

			const runDiscussion = async () => {
				const discussionBlocks = await runDiscussionLoop({
					topic: lastUserMessage,
					conversationHistory: formattedMessages,
					callbacks: {
						onDiscussionStart: (block) => {
							controller.enqueue(encoder.encode(sseEvent('discussion_start', { block })));
						},
						onTurnStart: ({ discussionId, turnId, panelistId, round, model }) => {
							controller.enqueue(
								encoder.encode(
									sseEvent('discussion_turn_start', { discussionId, turnId, panelistId, round, model })
								)
							);
						},
						onTextDelta: ({ discussionId, turnId, panelistId, round, text }) => {
							streamedText += text;
							controller.enqueue(
								encoder.encode(
									sseEvent('discussion_text_delta', {
										discussionId,
										turnId,
										panelistId,
										round,
										content: text
									})
								)
							);
						},
						onTurnEnd: ({ discussionId, turnId, panelistId, round }) => {
							controller.enqueue(
								encoder.encode(
									sseEvent('discussion_turn_end', { discussionId, turnId, panelistId, round })
								)
							);
						},
						onRoundSkipped: (round, reason) => {
							controller.enqueue(encoder.encode(sseEvent('discussion_round_skipped', { round, reason })));
						},
						onError: (message) => {
							controller.enqueue(encoder.encode(sseEvent('error', { message })));
						}
					}
				});

				finalContentBlocks = discussionBlocks;
				await finishSuccess(discussionBlocks);
			};

			const runNormal = async () => {
				const runtime = getLegacyRuntime();
				if (!runtime.clientBundle) {
					throw new Error('Single-model runtime is not available for this chat mode');
				}

				const { client, apiModel } = runtime.clientBundle;
				const stream = await client.chat.completions.create({
					model: apiModel,
					messages: formattedMessages,
					stream: true
				});

				const thinkFilter = new StreamingThinkFilter();
				for await (const chunk of stream) {
					const raw = chunk.choices[0]?.delta?.content;
					if (!raw) continue;

					const text = thinkFilter.process(raw);
					if (text) {
						streamedText += text;
						controller.enqueue(encoder.encode(sseEvent('text_delta', { content: text })));
					}
				}

				await finishSuccess([]);
			};

			try {
				if (createdChat) {
					controller.enqueue(
						encoder.encode(
							sseEvent('chat_created', {
								chatId: createdChat.id,
								title: createdChat.title ?? pendingChatTitle
							})
						)
					);
				}

				runIdPromise = createAgentRun({
					chatId: activeChatId,
					biglotUserId,
					mode,
					chatMode,
					routeType,
					provider: runProviderLabel,
					model: runModelLabel,
					clientIp,
					messageCount: safeMessages.length,
					hasImageInput,
					lastUserMessage
				})
					.then((id) => {
						runId = id;
						if (id) {
							controller.enqueue(encoder.encode(sseEvent('run_id', { runId: id })));
						}
						return id;
					})
					.catch(() => null);

				controller.enqueue(
					encoder.encode(
						sseEvent('run_start', {
							runId: null,
							routeType,
							mode,
							chatMode,
							model: runModelLabel
						})
					)
				);

				if (chatMode === 'agent' || chatMode === 'research') {
					if (difyRuntime && difyInputs) {
						try {
							await runDifyAgentOrResearch();
						} catch (difyError) {
							if (streamedText.length === 0) {
								await runLegacyAgentOrResearch();
							} else {
								throw difyError;
							}
						}
					} else {
						await runLegacyAgentOrResearch();
					}
				} else if (chatMode === 'discussion') {
					await runDiscussion();
				} else {
					await runNormal();
				}
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : `Failed to call ${runProviderLabel}`;
				await completeRun('error', message);
				controller.enqueue(encoder.encode(sseEvent('error', { message })));
			} finally {
				controller.close();
			}
		}
	});

	return new Response(readableStream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive',
			'X-BigLot-Mode': mode,
			'X-BigLot-Model': runModelLabel
		}
	});
};
