import type { OHLCV } from '$lib/types/contentBlock';

export const DASHBOARD_TIMEFRAMES = ['1d', '1wk', '1mo', '3mo', '6mo', '1y'] as const;

export type DashboardTimeframe = (typeof DASHBOARD_TIMEFRAMES)[number];
export type ErrorKind = 'network' | 'parse' | 'stale' | 'range' | 'fallback' | 'none';
export type SourceStatus = 'healthy' | 'fallback' | 'stale' | 'error';
export type DashboardSource = 'gold' | 'macro' | 'cot' | 'chart';
export type DashboardSignal = 'bullish' | 'bearish' | 'neutral';
export type DashboardConfidence = 'low' | 'medium' | 'high';

export interface GoldPriceData {
	comexPrice: number | null;
	comexPrevClose: number | null;
	comexHigh52w: number | null;
	comexLow52w: number | null;
	binancePrice: number | null;
	binanceChange24h: number | null;
	thbRate: number;
	thaiGoldPrice: number;
	spotPrice: number;
	change24hPct: number;
	priceSource: 'comex' | 'binance';
	thbIsLive: boolean;
	warnings: string[];
}

export interface QuoteData {
	price: number;
	change: number;
	name: string;
}

export interface MacroData {
	dxy: QuoteData | null;
	tnx: QuoteData | null;
	spx: QuoteData | null;
	realYield: number | null;
	goldSignal: DashboardSignal;
	goldContext: string;
	warnings: string[];
}

export interface CotData {
	reportDate: string;
	specLong: number;
	specShort: number;
	commLong: number;
	commShort: number;
	netSpec: number;
	netComm: number;
	wowChange: number;
	classification: string;
	signal: 'up' | 'down' | 'neutral';
	reportAgeMs: number;
}

export interface SourceMeta {
	source: DashboardSource;
	fetchedAt: string;
	staleAfterMs: number;
	status: SourceStatus;
	summary: string;
	details?: string[];
	errorKind: ErrorKind;
	errorMessage?: string;
}

export interface DashboardMeta {
	sources: SourceMeta[];
	warnings: string[];
}

export interface DashboardDriver {
	key: 'dxy' | 'realYield' | 'tnx' | 'cotClass' | 'cotFlow';
	label: string;
	impact: number;
	direction: DashboardSignal;
	detail: string;
}

export interface DashboardAssessment {
	score: number;
	signal: DashboardSignal;
	confidence: DashboardConfidence;
	summary: string;
	drivers: DashboardDriver[];
}

export interface DashboardChartData {
	ohlcv: OHLCV[];
	interval: string;
	timeframe: DashboardTimeframe;
}

export interface SectorPerformance {
	ticker: string;
	name: string;
	price: number;
	change1d: number;
	change1w: number;
	change1m: number;
	vsSpY1m: number;
}

export interface BreadthData {
	sectors: SectorPerformance[];
	spyChange1m: number;
	fetchedAt: string;
}

export interface DashboardResponse {
	gold: GoldPriceData | null;
	macro: MacroData | null;
	cot: CotData | null;
	chart: DashboardChartData | null;
	breadth: BreadthData | null;
	assessment: DashboardAssessment;
	updatedAt: string;
	_meta: DashboardMeta;
}
