import { env } from '$env/dynamic/private';
import {
	getClientForModel,
	getModelConfig,
	isAIModel,
	StreamingThinkFilter,
	type AIModel
} from './aiProvider.server';
import type {
	DiscussionBlock,
	DiscussionPanelist,
	DiscussionPanelistId,
	ContentBlock
} from '$lib/types/contentBlock';
import { startActiveObservation } from '@langfuse/tracing';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// --- Types ---

export type DiscussionCallbacks = {
	onDiscussionStart: (block: DiscussionBlock) => void;
	onTurnStart: (event: {
		discussionId: string;
		turnId: string;
		panelistId: DiscussionPanelistId;
		round: number;
		model: string;
	}) => void;
	onTextDelta: (event: {
		discussionId: string;
		turnId: string;
		panelistId: DiscussionPanelistId;
		round: number;
		text: string;
	}) => void;
	onTurnEnd: (event: {
		discussionId: string;
		turnId: string;
		panelistId: DiscussionPanelistId;
		round: number;
	}) => void;
	onRoundSkipped: (round: number, reason: string) => void;
	onError: (message: string) => void;
};

export type DiscussionConfig = {
	topic: string;
	conversationHistory: ChatCompletionMessageParam[];
	callbacks: DiscussionCallbacks;
};

type PanelistConfig = {
	id: DiscussionPanelistId;
	model: AIModel;
	temperature: number;
};

export type ResolvedDiscussionModel = PanelistConfig;

type TurnExecutionResult =
	| {
			ok: true;
			model: AIModel;
			text: string;
			usage: { promptTokens: number; completionTokens: number };
	  }
	| {
			ok: false;
			model: AIModel;
			error: unknown;
			partialText: boolean;
	  };

type TurnRuntime = TurnDef & {
	discussionId: string;
	turnId: string;
	language: DiscussionLanguage;
};

type DiscussionLanguage = 'thai' | 'english';

// --- Panelist Definitions ---

const PANELIST_META: Record<DiscussionPanelistId, Omit<DiscussionPanelist, 'model'>> = {
	bull: { id: 'bull', name: 'Bull Analyst', color: 'green', emoji: '🐂' },
	bear: { id: 'bear', name: 'Bear Analyst', color: 'red', emoji: '🐻' },
	moderator: { id: 'moderator', name: 'Judge', color: 'amber', emoji: '⚖️' }
};

// --- Max Tokens Per Turn Role ---

const MAX_TOKENS_PER_ROLE: Record<string, number> = {
	intro: 200,
	argument: 600,
	rebuttal: 500,
	synthesis: 1200
};

const MAX_TURN_CONTINUATIONS = 2;
const THAI_CHAR_RE = /[\u0E00-\u0E7F]/;

// --- Turn Schedule ---

type TurnDef = { panelistId: DiscussionPanelistId; round: number; role: string };

const INTRO_TURN: TurnDef = { panelistId: 'moderator', round: 0, role: 'intro' };

const ROUND_1_ARGUMENTS: TurnDef[] = [
	{ panelistId: 'bull', round: 1, role: 'argument' },
	{ panelistId: 'bear', round: 1, role: 'argument' }
];

const ROUND_2_TURNS: TurnDef[] = [
	{ panelistId: 'bull', round: 2, role: 'rebuttal' },
	{ panelistId: 'bear', round: 2, role: 'rebuttal' }
];

const SYNTHESIS_TURN: TurnDef = { panelistId: 'moderator', round: 99, role: 'synthesis' };

const DISCUSSION_MODEL_FALLBACKS: Record<DiscussionPanelistId, AIModel[]> = {
	bull: [
		'gpt-4o',
		'deepseek',
		'claude-sonnet',
		'gemini-2.5-flash',
		'gpt-4o-mini',
		'o3-mini',
		'minimax-m2.5',
		'minimax-m2.5-highspeed',
		'minimax-text-01'
	],
	bear: [
		'deepseek',
		'gpt-4o-mini',
		'gpt-4o',
		'claude-haiku',
		'gemini-2.5-flash',
		'o3-mini',
		'minimax-m2.5-highspeed',
		'minimax-m2.5',
		'minimax-text-01'
	],
	moderator: [
		'deepseek-r1',
		'gpt-4o',
		'o3-mini',
		'gpt-4o-mini',
		'claude-sonnet',
		'gemini-2.5-pro',
		'deepseek',
		'minimax-m2.5',
		'minimax-m1'
	]
};

// --- Model Resolution ---

function parseDiscussionEnvModel(value: string | undefined): AIModel | null {
	const normalized = value?.trim();
	if (!normalized) return null;
	if (normalized === 'deepseek-chat') return 'deepseek';
	return isAIModel(normalized) ? normalized : null;
}

export function resolveDiscussionModels(): ResolvedDiscussionModel[] {
	// Check env overrides first
	const envBull = parseDiscussionEnvModel(env.DISCUSSION_BULL_MODEL);
	const envBear = parseDiscussionEnvModel(env.DISCUSSION_BEAR_MODEL);
	const envMod = parseDiscussionEnvModel(env.DISCUSSION_MODERATOR_MODEL);

	if (envBull || envBear || envMod) {
		const fallback = envBull || envBear || envMod;
		return [
			{ id: 'bull', model: envBull || fallback!, temperature: 0.7 },
			{ id: 'bear', model: envBear || fallback!, temperature: 0.7 },
			{ id: 'moderator', model: envMod || fallback!, temperature: 0.5 }
		];
	}

	// Auto-detect from available API keys
	const hasOpenAI = !!env.OPENAI_API_KEY;
	const hasDeepSeek = !!env.DEEPSEEK_API_KEY;
	const hasMiniMax = !!env.MINIMAX_API_KEY;

	if (hasOpenAI && hasDeepSeek) {
		return [
			{ id: 'bull', model: 'gpt-4o', temperature: 0.7 },
			{ id: 'bear', model: 'deepseek', temperature: 0.7 },
			{ id: 'moderator', model: 'deepseek-r1', temperature: 0.5 }
		];
	}

	if (hasOpenAI) {
		return [
			{ id: 'bull', model: 'gpt-4o', temperature: 0.8 },
			{ id: 'bear', model: 'gpt-4o-mini', temperature: 0.6 },
			{ id: 'moderator', model: 'gpt-4o', temperature: 0.4 }
		];
	}

	if (hasDeepSeek) {
		return [
			{ id: 'bull', model: 'deepseek', temperature: 0.8 },
			{ id: 'bear', model: 'deepseek', temperature: 0.5 },
			{ id: 'moderator', model: 'deepseek-r1', temperature: 0.4 }
		];
	}

	if (hasMiniMax) {
		return [
			{ id: 'bull', model: 'minimax-text-01', temperature: 0.8 },
			{ id: 'bear', model: 'minimax-text-01', temperature: 0.5 },
			{ id: 'moderator', model: 'minimax-m1', temperature: 0.4 }
		];
	}

	throw new Error('No AI provider available. Set OPENAI_API_KEY, DEEPSEEK_API_KEY, or MINIMAX_API_KEY in .env');
}

export function describeDiscussionModels(
	panelistConfigs: ReadonlyArray<Pick<ResolvedDiscussionModel, 'id' | 'model'>> = resolveDiscussionModels()
): {
	modelLabel: string;
	providerLabel: string;
} {
	const providerLabel = Array.from(
		new Set(panelistConfigs.map((panelist) => getModelConfig(panelist.model).provider))
	).join('+');
	const modelLabel = panelistConfigs
		.map((panelist) => `${panelist.id}=${panelist.model}`)
		.join(' | ');

	return { modelLabel, providerLabel };
}

function buildTurnFallbackChain(panelistId: DiscussionPanelistId, primary: AIModel): AIModel[] {
	return [primary, ...DISCUSSION_MODEL_FALLBACKS[panelistId]].filter(
		(model, index, chain) => chain.indexOf(model) === index
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function summarizeText(value: string, limit = 400): string {
	const trimmed = value.trim();
	return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function shouldRetryWithFallback(error: unknown): boolean {
	const message = getErrorMessage(error).toLowerCase();

	return [
		'insufficient balance',
		'insufficient_balance',
		'quota',
		'billing',
		'credit',
		'rate limit',
		'rate-limit',
		'too many requests',
		'temporarily unavailable',
		'service unavailable',
		'overloaded',
		'capacity',
		'model unavailable',
		'model_not_found',
		'authentication',
		'unauthorized',
		'forbidden',
		'permission',
		'api key',
		'is not configured'
	].some((pattern) => message.includes(pattern));
}

function createTurnRuntime(
	discussionId: string,
	turnDef: TurnDef,
	language: DiscussionLanguage
): TurnRuntime {
	return {
		...turnDef,
		discussionId,
		turnId: `${discussionId}:${turnDef.panelistId}:r${turnDef.round}:${turnDef.role}`,
		language
	};
}

// --- System Prompts ---

function extractMessageText(content: ChatCompletionMessageParam['content'] | undefined): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';

	return content
		.map((part) => {
			if (part && typeof part === 'object' && 'type' in part && part.type === 'text' && 'text' in part) {
				return typeof part.text === 'string' ? part.text : '';
			}
			return '';
		})
		.join('\n')
		.trim();
}

function resolveDiscussionLanguage(
	topic: string,
	conversationHistory: ChatCompletionMessageParam[]
): DiscussionLanguage {
	const normalizedTopic = topic.trim();
	if (normalizedTopic.length > 0) {
		return THAI_CHAR_RE.test(normalizedTopic) ? 'thai' : 'english';
	}

	const latestUserMessage = [...conversationHistory]
		.reverse()
		.find((message) => message.role === 'user');
	const latestUserText = extractMessageText(latestUserMessage?.content);
	return THAI_CHAR_RE.test(latestUserText) ? 'thai' : 'english';
}

function buildLangInstruction(language: DiscussionLanguage): string {
	if (language === 'thai') {
		return 'ตอบเป็นภาษาไทยตลอดทั้งคำตอบ หากจำเป็นต้องใช้คำอังกฤษ ให้ใช้เฉพาะชื่อสินทรัพย์ สัญลักษณ์ หรือคำเฉพาะที่หลีกเลี่ยงไม่ได้ และอย่าเปลี่ยนหัวข้อหรือคำอธิบายหลักเป็นภาษาอังกฤษ.';
	}

	return 'Always respond in English throughout the entire answer unless a quoted term or ticker must remain in another language.';
}

function buildContinueTurnPrompt(language: DiscussionLanguage): string {
	if (language === 'thai') {
		return 'ตอบต่อจากจุดที่ค้างไว้ทันที โดยเริ่มจากประโยคที่ยังไม่จบ ห้ามเริ่มใหม่ ห้ามสรุปซ้ำ ห้ามแปลเป็นภาษาอังกฤษ และให้คงภาษาไทยกับโครงสร้าง markdown เดิมไว้.';
	}

	return 'Continue exactly from where you stopped. Do not restart, summarize, or repeat prior points. Begin with the unfinished sentence and keep the same language and markdown structure.';
}

function buildRoundLabel(round: number, language: DiscussionLanguage): string {
	if (language === 'thai') {
		if (round === 0) return 'คำเปิดการพิจารณา';
		if (round === 99) return 'คำตัดสิน';
		return `รอบ ${round}`;
	}

	if (round === 0) return 'Introduction';
	if (round === 99) return 'Ruling';
	return `Round ${round}`;
}

function buildContextMessage(context: string, language: DiscussionLanguage): string {
	return language === 'thai'
		? `บริบทการสนทนาก่อนหน้า:\n${context}`
		: `Previous conversation context:\n${context}`;
}

function buildTranscriptTurnMessage(transcript: string, language: DiscussionLanguage): string {
	return language === 'thai'
		? `นี่คือการอภิปรายก่อนหน้าทั้งหมด:${transcript}\n\nตอนนี้ถึงตาของคุณ ให้ตอบตามบทบาทของคุณ`
		: `Here is the debate so far:${transcript}\n\nNow it's your turn. Respond as your role.`;
}

function buildSystemPrompt(
	panelistId: DiscussionPanelistId,
	topic: string,
	turnRole: string,
	language: DiscussionLanguage
): string {
	const langInstruction = buildLangInstruction(language);

	if (panelistId === 'moderator' && turnRole === 'intro') {
		if (language === 'thai') {
			return [
				'คุณเป็นผู้พิพากษาที่กำลังเปิดการอภิปรายแบบ Bull vs Bear ในหัวข้อการเงิน/การเทรด.',
				`ประเด็นที่ศาลจะพิจารณา: "${topic}"`,
				'ภายใน 2-3 ประโยค: เปิดการพิจารณา วางกรอบคำถามหลัก และแจ้งทั้งสองฝ่ายว่าหลังรับฟังครบแล้วคุณจะตัดสินชี้ขาด.',
				'ต้องวางตัวเป็นกลางในคำเปิดการพิจารณา อย่าแสดงธงล่วงหน้าว่าจะตัดสินฝ่ายใด.',
				'ใช้น้ำเสียงหนักแน่น กระชับ และเป็นทางการ.',
				langInstruction
			].join('\n');
		}

		return [
			'You are a presiding judge opening a formal Bull vs Bear proceeding on a financial/trading topic.',
			`The matter before the court: "${topic}"`,
			'In 2-3 sentences: open the proceeding, frame the central question, and inform both sides that after hearing all arguments you will deliver a definitive ruling.',
			'Maintain judicial impartiality in the opening — do not signal which way you will rule.',
			'Be authoritative and concise.',
			langInstruction
		].join('\n');
	}

	if (panelistId === 'moderator' && turnRole === 'synthesis') {
		if (language === 'thai') {
			return [
				'คุณเป็นผู้พิพากษาที่กำลังอ่านคำตัดสินสุดท้ายในการอภิปรายแบบ Bull vs Bear.',
				`ประเด็นที่ศาลพิจารณาคือ: "${topic}"`,
				'คุณได้อ่านข้อโต้แย้งและคำโต้กลับทั้งหมดแล้ว คำตัดสินของคุณต้อง:',
				'1. **ชั่งน้ำหนักหลักฐาน**: ประเมินคุณภาพ ความเฉพาะเจาะจง และความสมเหตุสมผลของแต่ละฝ่าย ไม่ใช่แค่สรุปรายการประเด็น',
				'2. **ชี้ฝ่ายที่เหนือกว่า**: ระบุให้ชัดว่าฝ่าย Bull หรือ Bear มีภาพรวมที่น่าเชื่อถือกว่าพร้อมเหตุผล',
				'3. **อ่านคำตัดสิน**: เริ่มต้นด้วยคำตัดสินที่ชัดเจน เช่น "ศาลตัดสินให้เหตุผลของฝ่าย [Bull/Bear] มีน้ำหนักมากกว่า" แล้วให้เหตุผลหลัก 2-3 ข้อ',
				'4. **ยอมรับจุดที่อีกฝ่ายยกได้ดี**: ระบุ 1-2 จุดแข็งจากฝ่ายที่แพ้ซึ่งทำให้ศาลต้องชั่งใจ',
				'5. **ให้คำแนะนำ**: ปิดท้ายด้วยข้อสรุปเชิงปฏิบัติที่ผู้อ่านนำไปใช้ได้',
				'ต้องตัดสินอย่างชัดเจน หลีกเลี่ยงคำตอบกึ่งกลางแบบ "ทั้งสองฝ่ายมีเหตุผลพอ ๆ กัน".',
				'จัดโครงสร้างผลลัพธ์ด้วย markdown headers ภาษาไทย: ## คำตัดสิน, ## เหตุผล, ## จุดที่อีกฝ่ายยกได้ดี, ## คำแนะนำ',
				langInstruction
			].join('\n');
		}

		return [
			'You are a presiding judge delivering your final ruling in a Bull vs Bear proceeding.',
			`The matter before the court was: "${topic}"`,
			'You have reviewed the full transcript of arguments and rebuttals. Your ruling must:',
			'1. **Weigh the evidence**: Evaluate the quality, specificity, and logical strength of each side\'s arguments — not just list them.',
			'2. **Identify the stronger case**: State explicitly which side (Bull or Bear) made the more compelling overall argument and why.',
			'3. **Deliver the verdict**: Begin with a clear declaration, e.g. "The court rules in favor of the [Bull/Bear] case." Give 2-3 primary reasons for the ruling.',
			'4. **Acknowledge dissent**: Note the 1-2 strongest points from the losing side that gave the court pause — a fair ruling acknowledges minority merit.',
			'5. **Issue guidance**: Close with a concrete, actionable conclusion for the reader based on the ruling.',
			'Be decisive. Avoid wishy-washy "both sides have merit" non-conclusions. A court must rule.',
			'Structure your output with clear markdown headers: ## Verdict, ## Reasoning, ## Dissenting Points, ## Guidance',
			langInstruction
		].join('\n');
	}

	if (panelistId === 'bull') {
		const base =
			language === 'thai'
				? [
						'คุณเป็นนักวิเคราะห์ตลาดสายกระทิงที่กำลังเข้าร่วมการอภิปรายแบบมีโครงสร้าง.',
						`หัวข้อคือ: "${topic}"`,
						'ให้เหตุผลฝั่งบวก/ฝั่งกระทิงอย่างเฉพาะเจาะจง ใช้ข้อมูล สมมติฐาน และตรรกะที่ชัดเจน.',
						'โน้มน้าวอย่างมืออาชีพ กล่าวถึงความเสี่ยงสั้น ๆ ได้ แต่ให้น้ำหนักกับปัจจัยหนุนขาขึ้นเป็นหลัก.',
						langInstruction
					]
				: [
						'You are a bullish market analyst participating in a structured debate.',
						`The topic is: "${topic}"`,
						'Argue the optimistic/bullish case. Be specific with data points, scenarios, and reasoning.',
						'Be persuasive but professional. Acknowledge risks briefly but focus on upside catalysts.',
						langInstruction
					];
		if (turnRole === 'rebuttal') {
			base.push(
				language === 'thai'
					? 'นี่คือรอบโต้กลับ คุณต้องตอบโต้ข้อโต้แย้งเฉพาะของฝ่าย Bear จากรอบก่อนหน้าโดยตรง ห้ามแค่พูดซ้ำประเด็นเดิม.'
					: 'This is the REBUTTAL round. You must directly address and counter the Bear analyst\'s specific arguments from the previous round. Do not simply repeat your initial points.'
			);
		}
		return base.join('\n');
	}

	if (panelistId === 'bear') {
		const base =
			language === 'thai'
				? [
						'คุณเป็นนักวิเคราะห์ตลาดสายหมีหรือสายระวังความเสี่ยงที่กำลังเข้าร่วมการอภิปรายแบบมีโครงสร้าง.',
						`หัวข้อคือ: "${topic}"`,
						'ให้เหตุผลฝั่งลบ/ฝั่งระวังความเสี่ยง โดยเน้นความเสี่ยง มูลค่าที่ตึงตัว ปัจจัยมหภาคกดดัน และภาพ downside อย่างชัดเจน.',
						'โน้มน้าวอย่างมืออาชีพ กล่าวถึงโอกาสขาขึ้นได้สั้น ๆ แต่ให้น้ำหนักกับปัจจัยเสี่ยงเป็นหลัก.',
						langInstruction
					]
				: [
						'You are a bearish/risk-aware market analyst participating in a structured debate.',
						`The topic is: "${topic}"`,
						'Argue the cautious/pessimistic case. Highlight risks, overvaluations, macro headwinds, and downside scenarios.',
						'Be persuasive but professional. Acknowledge potential upside briefly but focus on risk factors.',
						langInstruction
					];
		if (turnRole === 'rebuttal') {
			base.push(
				language === 'thai'
					? 'นี่คือรอบโต้กลับ คุณต้องตอบโต้ข้อโต้แย้งเฉพาะของฝ่าย Bull จากรอบก่อนหน้าโดยตรง ห้ามแค่พูดซ้ำประเด็นเดิม.'
					: 'This is the REBUTTAL round. You must directly address and counter the Bull analyst\'s specific arguments from the previous round. Do not simply repeat your initial points.'
			);
		}
		return base.join('\n');
	}

	return language === 'thai'
		? `คุณเป็นนักวิเคราะห์การเงินที่กำลังอภิปรายเรื่อง "${topic}". ${langInstruction}`
		: `You are a financial analyst discussing "${topic}". ${langInstruction}`;
}

function formatTranscript(
	completedTurns: { panelistId: DiscussionPanelistId; round: number; content: string }[],
	language: DiscussionLanguage
): string {
	if (completedTurns.length === 0) return '';

	const lines = completedTurns.map((t) => {
		const meta = PANELIST_META[t.panelistId];
		const roundLabel = buildRoundLabel(t.round, language);
		return `[${meta.emoji} ${meta.name} — ${roundLabel}]:\n${t.content}`;
	});

	return language === 'thai'
		? '\n\n--- บันทึกการอภิปราย ---\n' + lines.join('\n\n')
		: '\n\n--- Debate Transcript ---\n' + lines.join('\n\n');
}

// --- AI Auto-Stop: evaluate whether Round 2 is needed ---

async function shouldContinueDebate(
	topic: string,
	completedTurns: { panelistId: DiscussionPanelistId; round: number; content: string }[],
	moderatorConfig: PanelistConfig,
	language: DiscussionLanguage
): Promise<boolean> {
	const transcript = formatTranscript(completedTurns, language);

	// Use a fast, cheap model for the evaluation call
	// Prefer gpt-4o-mini or the moderator's own model
	let evalModel: AIModel = moderatorConfig.model;
	// If moderator is deepseek-r1, use deepseek instead (faster for simple classification)
	if (evalModel === 'deepseek-r1') evalModel = 'deepseek';

	let client, apiModel;
	try {
		({ client, apiModel } = getClientForModel(evalModel));
	} catch {
		// If the eval model isn't available, default to continuing
		return true;
	}

	const evalPrompt = [
		'You are evaluating a Bull vs Bear debate to decide if a rebuttal round is needed.',
		`Topic: "${topic}"`,
		'',
		transcript,
		'',
		'Evaluate:',
		'1. Do Bull and Bear substantially AGREE on the key points? (If yes → skip rebuttal)',
		'2. Are there clear contradictions or opposing claims that need to be addressed? (If yes → continue)',
		'3. Would a rebuttal round add meaningful new insight? (If no → skip)',
		'',
		'Respond with ONLY one word: CONTINUE or SKIP',
		'CONTINUE = rebuttal round needed (positions are clearly opposed)',
		'SKIP = go straight to the judge\'s ruling (positions are similar or rebuttal would not add value)'
	].join('\n');

	try {
		const response = await client.chat.completions.create({
			model: apiModel,
			messages: [{ role: 'user', content: evalPrompt }],
			max_tokens: 10,
			temperature: 0
		});

		const answer = (response.choices[0]?.message?.content ?? '').trim().toUpperCase();
		return answer.includes('CONTINUE');
	} catch {
		// On error, default to continuing the debate
		return true;
	}
}

async function streamTurnWithModel(
	model: AIModel,
	messages: ChatCompletionMessageParam[],
	turnRole: string,
	temperature: number,
	callbacks: DiscussionCallbacks,
	turnRuntime: TurnRuntime
): Promise<TurnExecutionResult> {
	let turnText = '';
	const turnUsage = { promptTokens: 0, completionTokens: 0 };

	try {
		const { client, apiModel } = getClientForModel(model);
		let finishReason: string | null = null;
		let requestMessages = messages;

		for (let continuationIndex = 0; continuationIndex <= MAX_TURN_CONTINUATIONS; continuationIndex++) {
			const createParams: Record<string, unknown> = {
				model: apiModel,
				messages: requestMessages,
				stream: true,
				stream_options: { include_usage: true }
			};
			if (apiModel !== 'deepseek-reasoner') {
				createParams.temperature = temperature;
			}
			createParams.max_tokens = MAX_TOKENS_PER_ROLE[turnRole] ?? 600;

			const stream = await (client.chat.completions.create as Function)(createParams);

			const thinkFilter = new StreamingThinkFilter();
			finishReason = null;
			for await (const chunk of stream as AsyncIterable<any>) {
				const raw = chunk.choices?.[0]?.delta?.content;
				if (raw) {
					const text = thinkFilter.process(raw);
					if (text) {
						turnText += text;
						callbacks.onTextDelta({
							discussionId: turnRuntime.discussionId,
							turnId: turnRuntime.turnId,
							panelistId: turnRuntime.panelistId,
							round: turnRuntime.round,
							text
						});
					}
				}
				const choiceFinishReason = chunk.choices?.[0]?.finish_reason;
				if (choiceFinishReason) {
					finishReason = choiceFinishReason;
				}
				if (chunk.usage) {
					turnUsage.promptTokens += chunk.usage.prompt_tokens ?? 0;
					turnUsage.completionTokens += chunk.usage.completion_tokens ?? 0;
				}
			}

			const trailingText = thinkFilter.flush();
			if (trailingText) {
				turnText += trailingText;
				callbacks.onTextDelta({
					discussionId: turnRuntime.discussionId,
					turnId: turnRuntime.turnId,
					panelistId: turnRuntime.panelistId,
					round: turnRuntime.round,
					text: trailingText
				});
			}

			if (finishReason !== 'length') {
				break;
			}

			if (continuationIndex === MAX_TURN_CONTINUATIONS) {
				console.warn(
					`[BigLot.ai] Discussion turn ${turnRuntime.turnId} hit max token limit ${MAX_TURN_CONTINUATIONS + 1} times; returning partial output.`
				);
				break;
			}

			requestMessages = [
				...messages,
				{ role: 'assistant', content: turnText },
				{ role: 'user', content: buildContinueTurnPrompt(turnRuntime.language) }
			];
		}

		return {
			ok: true,
			model,
			text: turnText,
			usage: turnUsage
		};
	} catch (error) {
		return {
			ok: false,
			model,
			error,
			partialText: turnText.length > 0
		};
	}
}

// --- Execute a single turn ---

async function executeTurn(
	turnDef: TurnDef,
	topic: string,
	pConfig: PanelistConfig,
	conversationHistory: ChatCompletionMessageParam[],
	completedTurns: { panelistId: DiscussionPanelistId; round: number; content: string }[],
	discussionBlock: DiscussionBlock,
	discussionId: string,
	discussionLanguage: DiscussionLanguage,
	callbacks: DiscussionCallbacks
): Promise<void> {
	const startedAt = Date.now();
	const turnRuntime = createTurnRuntime(discussionId, turnDef, discussionLanguage);
	callbacks.onTurnStart({
		discussionId,
		turnId: turnRuntime.turnId,
		panelistId: turnDef.panelistId,
		round: turnDef.round,
		model: pConfig.model
	});

	await startActiveObservation(
		`discussion.turn.${turnDef.panelistId}`,
		async (turnObservation) => {
			turnObservation.update({
				input: {
					topic: summarizeText(topic, 300),
					role: turnDef.role,
					round: turnDef.round
				},
				metadata: {
					discussionId,
					turnId: turnRuntime.turnId,
					panelistId: turnDef.panelistId,
					model: pConfig.model,
					language: discussionLanguage
				}
			});

			try {
				const systemPrompt = buildSystemPrompt(
					turnDef.panelistId,
					topic,
					turnDef.role,
					discussionLanguage
				);
				const transcript = formatTranscript(completedTurns, discussionLanguage);

				const messages: ChatCompletionMessageParam[] = [
					{ role: 'system', content: systemPrompt }
				];

				const recentHistory = conversationHistory
					.filter((m) => m.role === 'user' || m.role === 'assistant')
					.slice(-5);

				if (recentHistory.length > 0) {
					const contextStr = recentHistory
						.map((m) => {
							const content = extractMessageText(m.content);
							return `[${m.role}]: ${content}`;
						})
						.join('\n')
						.slice(0, 2000);

					messages.push({
						role: 'user',
						content: buildContextMessage(contextStr, discussionLanguage)
					});
				}

				if (transcript) {
					messages.push({
						role: 'user',
						content: buildTranscriptTurnMessage(transcript, discussionLanguage)
					});
				}

				const modelChain = buildTurnFallbackChain(turnDef.panelistId, pConfig.model);
				let result: TurnExecutionResult | null = null;

				for (let index = 0; index < modelChain.length; index++) {
					const model = modelChain[index];
					const attempt = await streamTurnWithModel(
						model,
						messages,
						turnDef.role,
						pConfig.temperature,
						callbacks,
						turnRuntime
					);

					if (attempt.ok) {
						result = attempt;
						break;
					}

					const nextModel = modelChain[index + 1];
					if (!nextModel || attempt.partialText || !shouldRetryWithFallback(attempt.error)) {
						result = attempt;
						break;
					}

					console.warn(
						`[BigLot.ai] Discussion fallback for ${turnDef.panelistId}: ${model} failed (${getErrorMessage(attempt.error)}). Retrying with ${nextModel}.`
					);
				}

				if (!result || !result.ok) {
					throw result?.error ?? new Error('Unknown error during discussion turn');
				}

				if (result.model !== pConfig.model) {
					pConfig.model = result.model;
					const panelist = discussionBlock.panelists.find((entry) => entry.id === turnDef.panelistId);
					if (panelist) panelist.model = result.model;
				}

				completedTurns.push({
					panelistId: turnDef.panelistId,
					round: turnDef.round,
					content: result.text
				});

				discussionBlock.turns.push({
					turnId: turnRuntime.turnId,
					panelistId: turnDef.panelistId,
					round: turnDef.round,
					content: result.text,
					model: result.model,
					usage: result.usage,
					startedAt,
					completedAt: Date.now()
				});

				turnObservation.update({
					output: {
						model: result.model,
						usage: result.usage,
						contentPreview: summarizeText(result.text, 600)
					}
				});
			} catch (err) {
				const message = getErrorMessage(err);
				callbacks.onError(`${PANELIST_META[turnDef.panelistId].name} error: ${message}`);

				completedTurns.push({
					panelistId: turnDef.panelistId,
					round: turnDef.round,
					content: `[Error: ${message}]`
				});

				discussionBlock.turns.push({
					turnId: turnRuntime.turnId,
					panelistId: turnDef.panelistId,
					round: turnDef.round,
					content: `[Error: ${message}]`,
					model: pConfig.model,
					startedAt,
					completedAt: Date.now()
				});

				turnObservation.update({
					output: {
						error: message
					},
					level: 'ERROR',
					statusMessage: message
				});
			}
		},
		{ asType: 'span' }
	);

	callbacks.onTurnEnd({
		discussionId,
		turnId: turnRuntime.turnId,
		panelistId: turnDef.panelistId,
		round: turnDef.round
	});
}

// --- Main Loop ---

export async function runDiscussionLoop(config: DiscussionConfig): Promise<ContentBlock[]> {
	const { topic, conversationHistory, callbacks } = config;
	const panelistConfigs = resolveDiscussionModels();
	const modelMap = new Map(panelistConfigs.map((p) => [p.id, p]));
	const discussionLanguage = resolveDiscussionLanguage(topic, conversationHistory);

	const discussionId = `disc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

	const panelists: DiscussionPanelist[] = panelistConfigs.map((p) => ({
		...PANELIST_META[p.id],
		model: p.model
	}));

	const discussionBlock: DiscussionBlock = {
		type: 'discussion',
		discussionId,
		topic,
		panelists,
		turns: [],
		status: 'running',
		createdAt: Date.now(),
		updatedAt: Date.now()
	};

	callbacks.onDiscussionStart(discussionBlock);

	const completedTurns: { panelistId: DiscussionPanelistId; round: number; content: string }[] = [];

	// Phase 1a: Moderator intro (sequential)
	const introConfig = modelMap.get(INTRO_TURN.panelistId)!;
	await executeTurn(
		INTRO_TURN,
		topic,
		introConfig,
		conversationHistory,
		completedTurns,
		discussionBlock,
		discussionId,
		discussionLanguage,
		callbacks
	);

	// Phase 1b: Bull → Bear Round 1 (sequential — Bear sees Bull's argument before responding)
	for (const turnDef of ROUND_1_ARGUMENTS) {
		const pConfig = modelMap.get(turnDef.panelistId)!;
		await executeTurn(
			turnDef,
			topic,
			pConfig,
			conversationHistory,
			completedTurns,
			discussionBlock,
			discussionId,
			discussionLanguage,
			callbacks
		);
	}

	// Phase 2: AI evaluates whether Round 2 (rebuttal) is needed
	const moderatorConfig = modelMap.get('moderator')!;
	const needsRebuttal = await shouldContinueDebate(
		topic,
		completedTurns,
		moderatorConfig,
		discussionLanguage
	);

	if (needsRebuttal) {
		for (const turnDef of ROUND_2_TURNS) {
			const pConfig = modelMap.get(turnDef.panelistId)!;
			await executeTurn(
				turnDef,
				topic,
				pConfig,
				conversationHistory,
				completedTurns,
				discussionBlock,
				discussionId,
				discussionLanguage,
				callbacks
			);
		}
	} else {
		discussionBlock.skippedRounds = [2];
		callbacks.onRoundSkipped(2, 'AI determined positions are similar enough to skip rebuttal');
	}

	// Phase 3: Judge's Ruling (always runs)
	const synthConfig = modelMap.get(SYNTHESIS_TURN.panelistId)!;
	await executeTurn(
		SYNTHESIS_TURN,
		topic,
		synthConfig,
		conversationHistory,
		completedTurns,
		discussionBlock,
		discussionId,
		discussionLanguage,
		callbacks
	);

	// Accumulate total usage
	discussionBlock.totalUsage = discussionBlock.turns.reduce(
		(acc, t) => ({
			promptTokens: acc.promptTokens + (t.usage?.promptTokens ?? 0),
			completionTokens: acc.completionTokens + (t.usage?.completionTokens ?? 0)
		}),
		{ promptTokens: 0, completionTokens: 0 }
	);

	discussionBlock.status = 'complete';
	discussionBlock.updatedAt = Date.now();

	return [discussionBlock];
}
