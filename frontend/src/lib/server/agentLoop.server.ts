// Agent Loop - handles OpenAI tool calling with plan-then-execute strategy (Manus-like)
import type OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionChunk
} from 'openai/resources/chat/completions';
import type { ContentBlock, PlanBlock, PlanStep, PlanStepStatus, SourcesBlock } from '$lib/types/contentBlock';
import { getOpenAIToolSchemas, getFilteredToolSchemas, executeTool, getTool, type ToolResult, type DataSource } from './tools/registry';

// Import tools to register them
import './tools/marketData.tool';
import './tools/charts.tool';
import './tools/planning.tool';
import './tools/gold.tool';
import './tools/macro.tool';
import './tools/cot.tool';
import './tools/crossAsset.tool';
import './tools/webSearch.tool';
import './tools/webExtract.tool';
import './tools/webCrawl.tool';
import './tools/memory.tool';
import './tools/handoff.tool';
import './tools/signals.tool';
import './tools/backtest.tool';
import './tools/economicCalendar.tool';
import './tools/sentiment.tool';
import './tools/onchain.tool';
import './tools/derivatives.tool';
import './tools/positionSize.tool';
import './tools/portfolio.tool';
import './tools/riskMonitor.tool';
import './tools/tradeJournal.tool';
import './tools/alerts.tool';
import { getSystemPrompt, normalizeAgentMode, type AgentMode } from '$lib/agent/systemPrompts';
import { StreamingThinkFilter } from '$lib/server/aiProvider.server';

export type AgentCallbacks = {
	onTextDelta: (text: string) => void;
	onToolStart: (toolCallId: string, name: string, args: Record<string, unknown>) => void;
	onToolResult: (toolCallId: string, name: string, result: ToolResult) => void;
	onPlanCreate: (plan: PlanBlock) => void;
	onPlanStepUpdate: (
		planId: string,
		stepId: string,
		status: PlanStepStatus,
		result?: string,
		stepMeta?: { title?: string; toolName?: string }
	) => void;
	onPlanComplete: (planId: string, status: 'complete' | 'error') => void;
	onHandoff: (targetMode: string, reason: string) => void;
	onError: (message: string) => void;
};

export type AgentLoopConfig = {
	client: OpenAI;
	apiModel: string;
	messages: ChatCompletionMessageParam[];
	maxIterations?: number;
	maxPlanSteps?: number;
	planningEnabled?: boolean;
	currentMode?: AgentMode;
	allowedTools?: string[];
	callbacks: AgentCallbacks;
};

type ParsedToolCall = { id: string; name: string; arguments: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseJsonObject(input: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(input || '{}');
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Stream one LLM call and collect text + tool calls.
 */
async function streamLLMCall(
	client: OpenAI,
	apiModel: string,
	messages: ChatCompletionMessageParam[],
	tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
	onTextDelta: (text: string) => void
): Promise<{ fullText: string; toolCalls: ParsedToolCall[]; finishReason: string | null }> {
	const stream = await client.chat.completions.create({
		model: apiModel,
		messages,
		tools: tools && tools.length > 0 ? tools : undefined,
		stream: true
	});

	let fullText = '';
	const toolCallMap = new Map<number, ParsedToolCall>();
	let finishReason: string | null = null;
	const thinkFilter = new StreamingThinkFilter();

	for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
		const choice = chunk.choices[0];
		if (!choice) continue;

		const raw = choice.delta?.content;
		if (raw) {
			const textDelta = thinkFilter.process(raw);
			if (textDelta) {
				fullText += textDelta;
				onTextDelta(textDelta);
			}
		}

		const deltaToolCalls = choice.delta?.tool_calls;
		if (deltaToolCalls) {
			for (const tc of deltaToolCalls) {
				const existing = toolCallMap.get(tc.index);
				if (existing) {
					if (tc.function?.arguments) {
						existing.arguments += tc.function.arguments;
					}
				} else {
					toolCallMap.set(tc.index, {
						id: tc.id || '',
						name: tc.function?.name || '',
						arguments: tc.function?.arguments || ''
					});
				}
			}
		}

		if (choice.finish_reason) {
			finishReason = choice.finish_reason;
		}
	}

	const trailingText = thinkFilter.flush();
	if (trailingText) {
		fullText += trailingText;
		onTextDelta(trailingText);
	}

	return { fullText, toolCalls: Array.from(toolCallMap.values()), finishReason };
}

/**
 * Parse create_plan arguments into a PlanBlock.
 */
function buildPlanBlock(args: Record<string, unknown>, maxSteps = 6): PlanBlock {
	const title = typeof args.title === 'string' ? args.title : 'Execution Plan';
	const rawSteps = Array.isArray(args.steps) ? args.steps : [];

	const steps: PlanStep[] = rawSteps
		.slice(0, maxSteps)
		.map((stepValue, i) => {
			const step = isRecord(stepValue) ? stepValue : {};
			return {
				id: typeof step.id === 'string' ? step.id : `step_${i + 1}`,
				title: typeof step.title === 'string' ? step.title : `Step ${i + 1}`,
				description: typeof step.description === 'string' ? step.description : undefined,
				status: 'pending' as const,
				toolName: typeof step.toolName === 'string' ? step.toolName : undefined
			};
		})
		.filter((step) => step.title.trim().length > 0);

	return {
		type: 'plan',
		planId: `plan_${Date.now()}`,
		title,
		steps,
		status: 'planning',
		createdAt: Date.now(),
		updatedAt: Date.now()
	};
}

/** Validate and normalize plan — auto-appends a synthesis step if missing */
function normalizePlan(plan: PlanBlock, maxSteps = 6): string | null {
	if (plan.steps.length === 0) return 'Plan had no steps';
	if (plan.steps.length > maxSteps) return `Plan exceeded the ${maxSteps} step limit`;

	for (const step of plan.steps) {
		if (step.toolName && step.toolName !== 'reasoning' && !getTool(step.toolName)) {
			return `Plan referenced unknown tool "${step.toolName}"`;
		}
	}

	// Auto-append reasoning step if plan doesn't end with one
	const lastStep = plan.steps[plan.steps.length - 1];
	if (lastStep.toolName && lastStep.toolName !== 'reasoning') {
		if (plan.steps.length >= maxSteps) {
			return `Plan exceeded the ${maxSteps} step limit with required synthesis step`;
		}
		plan.steps.push({
			id: `step_${plan.steps.length + 1}`,
			title: 'Synthesize findings',
			description: 'Combine all gathered data into a comprehensive analysis',
			status: 'pending' as const,
			toolName: 'reasoning'
		});
	}

	return null;
}

/**
 * Execute a single plan step that involves a tool call.
 */
async function executeToolStep(
	client: OpenAI,
	apiModel: string,
	messages: ChatCompletionMessageParam[],
	step: PlanStep,
	callbacks: AgentCallbacks
): Promise<{ blocks: ContentBlock[]; textSummary: string; sources?: DataSource[] }> {
	const toolName = step.toolName!;
	const tool = getTool(toolName);
	if (!tool) {
		return { blocks: [], textSummary: `Tool "${toolName}" not found` };
	}

	// Ask the LLM to call the specific tool with appropriate arguments
	const stepTools = getOpenAIToolSchemas().filter(
		(t): t is OpenAI.Chat.Completions.ChatCompletionFunctionTool =>
			t.type === 'function' && t.function.name === toolName
	);
	const stepMessages: ChatCompletionMessageParam[] = [
		...messages,
		{
			role: 'system',
			content: `Execute this step: "${step.title}". Call the ${toolName} tool with the most appropriate arguments based on the conversation context. Only call this one tool.`
		}
	];

	const { fullText, toolCalls, finishReason } = await streamLLMCall(
		client,
		apiModel,
		stepMessages,
		stepTools,
		() => {} // Don't stream text during tool steps
	);

	// If the model called the tool, execute it
	if (finishReason === 'tool_calls' && toolCalls.length > 0) {
		const tc = toolCalls[0];
		const toolCallId = tc.id || `${toolName}_${Date.now()}`;
		const parsedArgs = parseJsonObject(tc.arguments);

		callbacks.onToolStart(toolCallId, toolName, parsedArgs);
		const result = await executeTool(toolName, parsedArgs);
		callbacks.onToolResult(toolCallId, toolName, result);

		return { blocks: result.contentBlocks, textSummary: result.textSummary, sources: result.sources };
	}

	// Fallback: model responded with text instead of calling the tool
	return { blocks: [], textSummary: fullText || `Step "${step.title}" completed` };
}

/**
 * Execute a reasoning/synthesis step (no tools).
 */
async function executeReasoningStep(
	client: OpenAI,
	apiModel: string,
	messages: ChatCompletionMessageParam[],
	step: PlanStep,
	callbacks: AgentCallbacks,
	isFinalSynthesis: boolean
): Promise<string> {
	const instruction = isFinalSynthesis
		? `Based on all the data gathered above, provide a comprehensive and well-structured analysis. Synthesize all findings into actionable insights.`
		: `Perform this analysis step: "${step.title}". Be concise but thorough.`;

	const stepMessages: ChatCompletionMessageParam[] = [
		...messages,
		{ role: 'system', content: instruction }
	];

	const { fullText } = await streamLLMCall(
		client,
		apiModel,
		stepMessages,
		undefined, // No tools for reasoning
		(text) => callbacks.onTextDelta(text)
	);

	return fullText;
}

/**
 * Deduplicate collected sources and append a SourcesBlock to content blocks.
 */
function appendSourcesBlock(blocks: ContentBlock[], sources: DataSource[]): void {
	if (sources.length === 0) return;

	const sourceMap = new Map<string, DataSource>();
	for (const s of sources) {
		const existing = sourceMap.get(s.name);
		if (!existing || s.accessedAt < existing.accessedAt) {
			sourceMap.set(s.name, s);
		}
	}

	const sourcesBlock: SourcesBlock = {
		type: 'sources',
		sources: Array.from(sourceMap.values()).map((s) => ({
			name: s.name,
			url: s.url,
			accessedAt: s.accessedAt
		}))
	};
	blocks.push(sourcesBlock);
}

/**
 * Check if tool calls include a handoff request and apply it.
 * Returns the target mode if handoff was requested, null otherwise.
 */
function detectHandoff(
	toolCalls: ParsedToolCall[],
	callbacks: AgentCallbacks
): { targetMode: AgentMode; reason: string; contextSummary: string } | null {
	const handoffCall = toolCalls.find((tc) => tc.name === 'handoff_to_agent');
	if (!handoffCall) return null;

	const args = parseJsonObject(handoffCall.arguments);

	const targetMode = normalizeAgentMode(args.target_mode);
	const reason = typeof args.reason === 'string' ? args.reason : 'Switching specialist';
	const contextSummary = typeof args.context_summary === 'string' ? args.context_summary : '';

	return { targetMode, reason, contextSummary };
}

/**
 * Apply a handoff: swap the system prompt in the messages array.
 */
function applyHandoff(
	messages: ChatCompletionMessageParam[],
	targetMode: AgentMode,
	planningEnabled: boolean,
	contextSummary: string
): void {
	const newSystemPrompt = getSystemPrompt(targetMode, planningEnabled);

	// Replace the first system message (system prompt)
	if (messages.length > 0 && messages[0].role === 'system') {
		const suffix = contextSummary ? `\n\n[Handoff Context]: ${contextSummary}` : '';
		messages[0] = { role: 'system', content: newSystemPrompt + suffix };
	}
}

/**
 * Main agent loop with Manus-like planning support.
 */
export async function runAgentLoop(config: AgentLoopConfig): Promise<ContentBlock[]> {
	const { client, apiModel, callbacks, maxIterations = 5, maxPlanSteps = 6, planningEnabled = false, allowedTools } = config;
	let currentMode = config.currentMode ?? 'coach';
	const messages = [...config.messages];
	const allContentBlocks: ContentBlock[] = [];
	const collectedSources: DataSource[] = [];
	const tools = allowedTools ? getFilteredToolSchemas(allowedTools) : getOpenAIToolSchemas();

	// Phase 1: Initial LLM call (may produce a plan or direct response)
	const { fullText, toolCalls, finishReason } = await streamLLMCall(
		client,
		apiModel,
		messages,
		tools,
		(text) => callbacks.onTextDelta(text)
	);

	// Check if model requested a handoff
	const handoff = detectHandoff(toolCalls, callbacks);
	if (handoff) {
		callbacks.onHandoff(handoff.targetMode, handoff.reason);
		applyHandoff(messages, handoff.targetMode, planningEnabled, handoff.contextSummary);
		currentMode = handoff.targetMode;

		// Provide tool result for the handoff call so the model can continue
		const handoffCall = toolCalls.find((tc) => tc.name === 'handoff_to_agent')!;
		messages.push({
			role: 'assistant',
			content: fullText || null,
			tool_calls: [{
				id: handoffCall.id,
				type: 'function' as const,
				function: { name: 'handoff_to_agent', arguments: handoffCall.arguments }
			}]
		});
		messages.push({
			role: 'tool',
			tool_call_id: handoffCall.id,
			content: `Handoff complete. You are now in "${handoff.targetMode}" mode. Reason: ${handoff.reason}. Continue responding to the user's query in this new mode.`
		} as ChatCompletionMessageParam);

		// Re-run LLM with the new mode's system prompt — recurse with reduced iterations
		const handoffResult = await runAgentLoop({
			...config,
			messages,
			currentMode: handoff.targetMode,
			maxIterations: Math.max(maxIterations - 1, 2),
			callbacks
		});
		return handoffResult;
	}

	// Check if model called create_plan
	const planCall = planningEnabled
		? toolCalls.find((tc) => tc.name === 'create_plan')
		: undefined;

	if (planCall) {
		// ===== PLAN MODE: Two-phase execution =====
		const planArgs = parseJsonObject(planCall.arguments);

		const plan = buildPlanBlock(planArgs, maxPlanSteps);
		const planValidationError = normalizePlan(plan, maxPlanSteps);
		if (planValidationError) {
			// Invalid plan, fall through to standard mode
			callbacks.onError(`${planValidationError}, falling back to standard mode`);
		} else {
			plan.status = 'executing';
			callbacks.onPlanCreate(plan);
			allContentBlocks.push(plan);

			// Build message history with plan context
			messages.push({
				role: 'assistant',
				content: fullText || null,
				tool_calls: [
					{
						id: planCall.id,
						type: 'function' as const,
						function: { name: 'create_plan', arguments: planCall.arguments }
					}
				]
			});
			messages.push({
				role: 'tool',
				tool_call_id: planCall.id,
				content: `Plan created: "${plan.title}" with ${plan.steps.length} steps. Executing now.`
			} as ChatCompletionMessageParam);

			// Track results for synthesis
			const stepResults: string[] = [];

			// Phase 2: Execute each step
			for (const step of plan.steps) {
				callbacks.onPlanStepUpdate(plan.planId, step.id, 'running', undefined, {
					title: step.title,
					toolName: step.toolName
				});
				step.status = 'running';
				step.startedAt = Date.now();

				try {
					const isReasoning = !step.toolName || step.toolName === 'reasoning';
					const isLastStep = step === plan.steps[plan.steps.length - 1];
					const isFinalSynthesis = isReasoning && isLastStep;

					if (isReasoning) {
						// Add prior results context
						if (stepResults.length > 0) {
							messages.push({
								role: 'system',
								content: `Data gathered so far:\n${stepResults.join('\n---\n')}`
							} as ChatCompletionMessageParam);
						}

						const text = await executeReasoningStep(
							client,
							apiModel,
							messages,
							step,
							callbacks,
							isFinalSynthesis
						);

						stepResults.push(`[${step.title}]: ${text}`);
						step.status = 'complete';
						step.result = isFinalSynthesis ? 'Analysis complete' : text.slice(0, 100);
						step.completedAt = Date.now();
						callbacks.onPlanStepUpdate(plan.planId, step.id, 'complete', step.result, {
							title: step.title,
							toolName: step.toolName
						});
					} else {
						// Tool step
						const { blocks, textSummary, sources: stepSources } = await executeToolStep(
							client,
							apiModel,
							messages,
							step,
							callbacks
						);

						for (const block of blocks) {
							allContentBlocks.push(block);
						}
						if (stepSources) collectedSources.push(...stepSources);

						// Add tool result to message history for subsequent steps
						messages.push({
							role: 'system',
							content: `Result of "${step.title}" (${step.toolName}): ${textSummary}`
						} as ChatCompletionMessageParam);

						stepResults.push(`[${step.title}]: ${textSummary}`);
						step.status = 'complete';
						step.result = textSummary.slice(0, 100);
						step.completedAt = Date.now();
						callbacks.onPlanStepUpdate(plan.planId, step.id, 'complete', step.result, {
							title: step.title,
							toolName: step.toolName
						});
					}
				} catch (err: unknown) {
					const errMsg = err instanceof Error ? err.message : 'Step failed';
					step.status = 'error';
					step.result = errMsg;
					step.completedAt = Date.now();
					callbacks.onPlanStepUpdate(plan.planId, step.id, 'error', errMsg, {
						title: step.title,
						toolName: step.toolName
					});
					stepResults.push(`[${step.title}]: ERROR - ${errMsg}`);
					// Continue to next step
				}
			}

			// Mark plan as complete
			const hasErrors = plan.steps.some((s) => s.status === 'error');
			const allErrors = plan.steps.every((s) => s.status === 'error');
			plan.status = allErrors ? 'error' : 'complete';
			plan.updatedAt = Date.now();
			callbacks.onPlanComplete(plan.planId, allErrors ? 'error' : 'complete');

			// Append deduplicated sources block
			appendSourcesBlock(allContentBlocks, collectedSources);

			return allContentBlocks;
		}
	}

	// ===== STANDARD MODE: Original iterative tool calling (fallback) =====
	if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
		return allContentBlocks;
	}

	// Process tool calls from first iteration
	const assistantToolCalls = toolCalls.map((tc) => ({
		id: tc.id,
		type: 'function' as const,
		function: { name: tc.name, arguments: tc.arguments }
	}));

	messages.push({
		role: 'assistant',
		content: fullText || null,
		tool_calls: assistantToolCalls
	});

	for (const tc of toolCalls) {
		if (tc.name === 'create_plan' || tc.name === 'handoff_to_agent') continue; // Skip pseudo-tools

		const toolCallId = tc.id || `${tc.name}_${Date.now()}`;
		const parsedArgs = parseJsonObject(tc.arguments);

		callbacks.onToolStart(toolCallId, tc.name, parsedArgs);
		const result = await executeTool(tc.name, parsedArgs);
		for (const block of result.contentBlocks) {
			allContentBlocks.push(block);
		}
		if (result.sources) collectedSources.push(...result.sources);
		callbacks.onToolResult(toolCallId, tc.name, result);

		messages.push({
			role: 'tool',
			tool_call_id: tc.id,
			content: result.textSummary
		} as ChatCompletionMessageParam);
	}

	// Continue iterating (standard mode)
	const effectiveMax = maxIterations;
	for (let iteration = 1; iteration < effectiveMax; iteration++) {
		const result = await streamLLMCall(
			client,
			apiModel,
			messages,
			tools,
			(text) => callbacks.onTextDelta(text)
		);

		if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
			break;
		}

		const assistantCalls = result.toolCalls.map((tc) => ({
			id: tc.id,
			type: 'function' as const,
			function: { name: tc.name, arguments: tc.arguments }
		}));

		messages.push({
			role: 'assistant',
			content: result.fullText || null,
			tool_calls: assistantCalls
		});

		for (const tc of result.toolCalls) {
			const toolCallId = tc.id || `${tc.name}_${Date.now()}`;
			const parsedArgs = parseJsonObject(tc.arguments);

			callbacks.onToolStart(toolCallId, tc.name, parsedArgs);
			const toolResult = await executeTool(tc.name, parsedArgs);
			for (const block of toolResult.contentBlocks) {
				allContentBlocks.push(block);
			}
			if (toolResult.sources) collectedSources.push(...toolResult.sources);
			callbacks.onToolResult(toolCallId, tc.name, toolResult);

			messages.push({
				role: 'tool',
				tool_call_id: tc.id,
				content: toolResult.textSummary
			} as ChatCompletionMessageParam);
		}
	}

	// Append deduplicated sources block
	appendSourcesBlock(allContentBlocks, collectedSources);

	return allContentBlocks;
}
