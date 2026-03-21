// Content Block Type System for Agent Mode
// Each assistant message can contain multiple content blocks of different types

export type OHLCV = {
	time: number; // Unix timestamp in seconds
	open: number;
	high: number;
	low: number;
	close: number;
	volume: number;
};

export type IndicatorDataPoint = {
	time: number;
	value: number;
	label?: string;
};

// --- Block Types ---

export type TextBlock = {
	type: 'text';
	content: string; // markdown
};

export type ImageBlock = {
	type: 'image';
	url: string;
	alt?: string;
	caption?: string;
};

export type PatternType =
	| 'head_and_shoulders'
	| 'inverse_head_and_shoulders'
	| 'double_top'
	| 'double_bottom'
	| 'ascending_triangle'
	| 'descending_triangle'
	| 'symmetric_triangle'
	| 'bull_flag'
	| 'bear_flag'
	| 'rising_wedge'
	| 'falling_wedge';

export type PatternAnnotation = {
	patternType: PatternType;
	label: string;
	startIndex: number;
	endIndex: number;
	keyPoints: { index: number; price: number; label: string }[];
	direction: 'bullish' | 'bearish' | 'neutral';
	confidence: number;   // 0–1
};

export type ChartBlock = {
	type: 'chart';
	chartType: 'candlestick' | 'line' | 'bar';
	symbol: string;
	interval: string;
	data: OHLCV[];
	indicators?: {
		name: string;
		data: IndicatorDataPoint[];
		color?: string;
		overlay: boolean; // true = on price chart, false = separate panel
	}[];
	patterns?: PatternAnnotation[];
};

export type TableBlock = {
	type: 'table';
	title?: string;
	headers: string[];
	rows: (string | number)[][];
};

export type MetricCardBlock = {
	type: 'metric_card';
	title: string;
	metrics: {
		label: string;
		value: string;
		change?: string;
		direction?: 'up' | 'down' | 'neutral';
	}[];
};

export type NewsListBlock = {
	type: 'news_list';
	items: {
		title: string;
		url: string;
		source: string;
		publishedAt: string;
		sentiment?: 'bullish' | 'bearish' | 'neutral';
	}[];
};

export type EmbedBlock = {
	type: 'embed';
	url: string;
	height?: number;
	title?: string;
};

export type ErrorBlock = {
	type: 'error';
	message: string;
	tool?: string;
};

// --- Plan Block Types (Manus-like planning) ---

export type PlanStepStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

export type PlanStep = {
	id: string;
	title: string;
	description?: string;
	status: PlanStepStatus;
	toolName?: string;
	result?: string;
	startedAt?: number;
	completedAt?: number;
};

export type PlanBlock = {
	type: 'plan';
	planId: string;
	title: string;
	steps: PlanStep[];
	status: 'planning' | 'executing' | 'complete' | 'error';
	createdAt: number;
	updatedAt: number;
};

// --- Gauge Block (arc speedometer — COT positioning, RSI sentiment) ---

export type GaugeBlock = {
	type: 'gauge';
	title: string;
	value: number;   // 0–100
	label: string;   // e.g. "Extreme Long"
	thresholds: { value: number; color: string; label: string }[];
};

// --- Heatmap Block (multi-asset performance table) ---

export type HeatmapBlock = {
	type: 'heatmap';
	title: string;
	assets: string[];      // column headers
	timeframes: string[];  // row headers
	data: number[][];      // performance % [timeframe][asset]
	colorScale: 'redgreen' | 'goldblue';
};

// --- Trade Setup Block (institutional-grade trade plan) ---

export type TradeSetupBlock = {
	type: 'trade_setup';
	asset: string;
	direction: 'long' | 'short';
	thesis: string;
	entryZone: { low: number; high: number };
	stopLoss: number;
	targets: { price: number; label: string; rMultiple: number }[];
	riskRewardRatio: number;
	maxRiskPct: number;
	invalidation: string;
	timeframe: string;
};

// --- Discussion Block Types (multi-AI debate) ---

export type DiscussionPanelistId = 'bull' | 'bear' | 'moderator';

export type DiscussionPanelist = {
	id: DiscussionPanelistId;
	name: string;
	model: string;
	color: string;
	emoji: string;
};

export type DiscussionTurn = {
	turnId: string;
	panelistId: DiscussionPanelistId;
	round: number; // 0=intro, 1-2=debate, 99=synthesis
	content: string;
	model: string;
	startedAt: number;
	completedAt?: number;
	usage?: { promptTokens: number; completionTokens: number };
};

export type DiscussionBlock = {
	type: 'discussion';
	discussionId: string;
	topic: string;
	panelists: DiscussionPanelist[];
	turns: DiscussionTurn[];
	skippedRounds?: number[];
	totalUsage?: { promptTokens: number; completionTokens: number };
	status: 'running' | 'complete' | 'error';
	createdAt: number;
	updatedAt: number;
};

// --- Research Report Block (deep research output) ---

export type ResearchSection = {
	id: string;
	title: string;
	content: string; // markdown
};

export type ResearchReportBlock = {
	type: 'research_report';
	reportId: string;
	title: string;
	query: string;
	sections: ResearchSection[];
	status: 'researching' | 'synthesizing' | 'complete' | 'error';
	toolCallCount: number;
	totalDurationMs: number;
	createdAt: number;
	updatedAt: number;
};

// --- Sources Block (data provenance / citations) ---

export type SourcesBlock = {
	type: 'sources';
	sources: {
		name: string;
		url?: string;
		accessedAt: number; // Unix ms timestamp
	}[];
};

// --- Backtest Block (T-105) ---

export type BacktestTrade = {
	entryTime: number;
	exitTime: number;
	direction: 'long' | 'short';
	entryPrice: number;
	exitPrice: number;
	size: number;
	pnl: number;
	pnlPct: number;
	rMultiple: number;
	exitReason: 'stop_loss' | 'take_profit' | 'trailing_stop' | 'indicator' | 'time_based' | 'end_of_data' | 'max_drawdown';
};

export type BacktestEquityPoint = {
	time: number;
	equity: number;
	drawdownPct: number;
};

export type BacktestMetricsSummary = {
	totalReturn: number;
	maxDrawdown: number;
	sharpe: number;
	winRate: number;
	totalTrades: number;
	profitFactor: number;
	avgRMultiple: number;
	expectancy: number;
	maxConsecutiveLosses: number;
};

export type BacktestBlock = {
	type: 'backtest';
	symbol: string;
	timeframe: string;
	initialCapital: number;
	finalCapital: number;
	startTime: number;
	endTime: number;
	trades: BacktestTrade[];
	equity: BacktestEquityPoint[];
	metrics: BacktestMetricsSummary;
	/** In-sample metrics if walk-forward was run */
	inSampleMetrics?: BacktestMetricsSummary;
	/** Out-of-sample metrics if walk-forward was run */
	outOfSampleMetrics?: BacktestMetricsSummary;
	degradationPct?: number;
};

export type ContentBlock =
	| TextBlock
	| ImageBlock
	| ChartBlock
	| TableBlock
	| MetricCardBlock
	| NewsListBlock
	| EmbedBlock
	| ErrorBlock
	| PlanBlock
	| GaugeBlock
	| HeatmapBlock
	| TradeSetupBlock
	| SourcesBlock
	| DiscussionBlock
	| ResearchReportBlock
	| BacktestBlock;

export type ContentBlockType = ContentBlock['type'];

export type AgentRouteType = 'direct_answer' | 'single_tool' | 'plan_then_execute' | 'discussion' | 'deep_research';

// --- Tool Call Status (for UI progress tracking) ---

export type ToolCallStatus = {
	id: string;
	name: string;
	args?: Record<string, unknown>;
	status: 'running' | 'complete' | 'error';
	startedAt: number;
	latencyMs?: number;
	resultSummary?: string;
};

// --- SSE Event Types ---

export type SSERunStart = {
	event: 'run_start';
	runId: string | null;
	routeType: AgentRouteType;
	mode: string;
	chatMode: 'normal' | 'agent' | 'discussion' | 'research';
	model: string;
};

export type SSERunId = {
	event: 'run_id';
	runId: string;
};

export type SSEChatCreated = {
	event: 'chat_created';
	chatId: string;
	title: string;
};

export type SSETextDelta = {
	event: 'text_delta';
	content: string;
};

export type SSEToolStart = {
	event: 'tool_start';
	toolCallId: string;
	tool: string;
	args: Record<string, unknown>;
};

export type SSEToolResult = {
	event: 'tool_result';
	toolCallId: string;
	tool: string;
	blocks: ContentBlock[];
	success: boolean;
	textSummary: string;
};

export type SSEError = {
	event: 'error';
	message: string;
};

export type SSEDone = {
	event: 'done';
	runId?: string | null;
	routeType?: AgentRouteType;
	contentBlocks: ContentBlock[];
	messageId?: string;
};

export type SSEPlanCreate = {
	event: 'plan_create';
	plan: PlanBlock;
};

export type SSEPlanUpdate = {
	event: 'plan_update';
	planId: string;
	stepId: string;
	status: PlanStepStatus;
	result?: string;
};

export type SSEPlanComplete = {
	event: 'plan_complete';
	planId: string;
	status: 'complete' | 'error';
};

export type SSEDiscussionTurnStart = {
	event: 'discussion_turn_start';
	discussionId: string;
	turnId: string;
	panelistId: DiscussionPanelistId;
	round: number;
	model: string;
};

export type SSEDiscussionTextDelta = {
	event: 'discussion_text_delta';
	discussionId: string;
	turnId: string;
	panelistId: DiscussionPanelistId;
	round: number;
	content: string;
};

export type SSEDiscussionTurnEnd = {
	event: 'discussion_turn_end';
	discussionId: string;
	turnId: string;
	panelistId: DiscussionPanelistId;
	round: number;
};

export type SSEDiscussionRoundSkipped = {
	event: 'discussion_round_skipped';
	round: number;
	reason: string;
};

export type SSEResearchReport = {
	event: 'research_report';
	report: ResearchReportBlock;
};

export type SSEEvent =
	| SSERunStart
	| SSERunId
	| SSEChatCreated
	| SSETextDelta
	| SSEToolStart
	| SSEToolResult
	| SSEError
	| SSEDone
	| SSEPlanCreate
	| SSEPlanUpdate
	| SSEPlanComplete
	| SSEDiscussionTurnStart
	| SSEDiscussionTextDelta
	| SSEDiscussionTurnEnd
	| SSEDiscussionRoundSkipped
	| SSEResearchReport;
