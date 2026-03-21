import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchGoldPriceData, fetchGoldOHLCV } from '$lib/server/data/gold.data';
import { fetchMacroData } from '$lib/server/data/macro.data';
import { fetchCotData } from '$lib/server/data/cot.data';
import { fetchBreadthSnapshot } from '$lib/server/data/breadth.data';
import type {
	DashboardAssessment,
	DashboardDriver,
	DashboardMeta,
	DashboardResponse,
	DashboardSignal,
	DashboardTimeframe,
	ErrorKind,
	SourceMeta
} from '$lib/types/dashboardMeta';
import { DASHBOARD_TIMEFRAMES } from '$lib/types/dashboardMeta';

const CACHE_TTL = 30_000;
const COT_STALE_MS = 8 * 24 * 3_600_000;
const MACRO_STALE_MS = 6 * 3_600_000;
const GOLD_STALE_MS = 5 * 60_000;
const CHART_STALE_MS = 30 * 60_000;
const DAY_MS = 86_400_000;

const timeframeSet = new Set<DashboardTimeframe>(DASHBOARD_TIMEFRAMES);
const cachedResults = new Map<DashboardTimeframe, { data: DashboardResponse; ts: number }>();

type Contribution = {
	key: DashboardDriver['key'];
	label: string;
	impact: number;
	detail: string;
	available: boolean;
};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeTimeframe(value: string | null): DashboardTimeframe {
	if (value && timeframeSet.has(value as DashboardTimeframe)) {
		return value as DashboardTimeframe;
	}
	return '1mo';
}

function fmtSignedPct(value: number): string {
	return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function fmtSignedK(value: number): string {
	const sign = value >= 0 ? '+' : '';
	return `${sign}${(value / 1000).toFixed(1)}K`;
}

function asErrorDetails(error: unknown): string[] | undefined {
	if (!error) return undefined;
	return [String(error)];
}

function buildGoldMeta(
	result: PromiseSettledResult<Awaited<ReturnType<typeof fetchGoldPriceData>>>,
	fetchedAt: string
): SourceMeta {
	if (result.status === 'rejected') {
		return {
			source: 'gold',
			fetchedAt,
			staleAfterMs: GOLD_STALE_MS,
			status: 'error',
			summary: 'Gold feed unavailable',
			details: asErrorDetails(result.reason),
			errorKind: 'network',
			errorMessage: String(result.reason)
		};
	}

	const gold = result.value;
	if (!gold) {
		return {
			source: 'gold',
			fetchedAt,
			staleAfterMs: GOLD_STALE_MS,
			status: 'error',
			summary: 'Gold feed returned no data',
			errorKind: 'parse',
			errorMessage: 'gold returned null'
		};
	}

	const usesBinance = gold.priceSource === 'binance';
	const usesCachedThb = gold.thbIsLive === false;
	const details = gold.warnings.length ? gold.warnings : undefined;

	if (usesBinance || usesCachedThb) {
		const summaryParts = [
			usesBinance ? 'Using Binance fallback' : 'COMEX live',
			usesCachedThb ? 'THB cached' : 'THB live'
		];

		return {
			source: 'gold',
			fetchedAt,
			staleAfterMs: GOLD_STALE_MS,
			status: 'fallback',
			summary: summaryParts.join(' · '),
			details,
			errorKind: 'fallback'
		};
	}

	return {
		source: 'gold',
		fetchedAt,
		staleAfterMs: GOLD_STALE_MS,
		status: 'healthy',
		summary: 'COMEX live · THB live',
		details,
		errorKind: 'none'
	};
}

function buildMacroMeta(
	result: PromiseSettledResult<Awaited<ReturnType<typeof fetchMacroData>>>,
	fetchedAt: string
): SourceMeta {
	if (result.status === 'rejected') {
		return {
			source: 'macro',
			fetchedAt,
			staleAfterMs: MACRO_STALE_MS,
			status: 'error',
			summary: 'Macro inputs unavailable',
			details: asErrorDetails(result.reason),
			errorKind: 'network',
			errorMessage: String(result.reason)
		};
	}

	const macro = result.value;
	if (!macro) {
		return {
			source: 'macro',
			fetchedAt,
			staleAfterMs: MACRO_STALE_MS,
			status: 'error',
			summary: 'Macro inputs returned no data',
			errorKind: 'parse',
			errorMessage: 'macro returned null'
		};
	}

	const missingFields = [
		!macro.dxy ? 'DXY' : null,
		!macro.tnx ? '10Y' : null,
		macro.realYield === null ? 'Real Yield' : null,
		!macro.spx ? 'SPX' : null
	].filter(Boolean) as string[];

	const coreMissing = !macro.dxy && !macro.tnx && macro.realYield === null;
	const details = [...missingFields.map(field => `Missing ${field}`), ...macro.warnings];

	if (coreMissing) {
		return {
			source: 'macro',
			fetchedAt,
			staleAfterMs: MACRO_STALE_MS,
			status: 'error',
			summary: 'Core macro inputs unavailable',
			details: details.length ? details : undefined,
			errorKind: 'parse',
			errorMessage: 'dxy, 10Y, and real yield unavailable'
		};
	}

	if (missingFields.length > 0) {
		return {
			source: 'macro',
			fetchedAt,
			staleAfterMs: MACRO_STALE_MS,
			status: 'fallback',
			summary: `Missing: ${missingFields.join(', ')}`,
			details: details.length ? details : undefined,
			errorKind: 'fallback'
		};
	}

	return {
		source: 'macro',
		fetchedAt,
		staleAfterMs: MACRO_STALE_MS,
		status: 'healthy',
		summary: 'All macro inputs loaded',
		details: macro.warnings.length ? macro.warnings : undefined,
		errorKind: 'none'
	};
}

function buildCotMeta(
	result: PromiseSettledResult<Awaited<ReturnType<typeof fetchCotData>>>,
	fetchedAt: string
): SourceMeta {
	if (result.status === 'rejected') {
		return {
			source: 'cot',
			fetchedAt,
			staleAfterMs: COT_STALE_MS,
			status: 'error',
			summary: 'COT feed unavailable',
			details: asErrorDetails(result.reason),
			errorKind: 'network',
			errorMessage: String(result.reason)
		};
	}

	const cot = result.value;
	if (!cot) {
		return {
			source: 'cot',
			fetchedAt,
			staleAfterMs: COT_STALE_MS,
			status: 'error',
			summary: 'COT data unavailable',
			errorKind: 'parse',
			errorMessage: 'cot returned null'
		};
	}

	const lagDays = Math.max(0, Math.floor(cot.reportAgeMs / DAY_MS));
	const details = [`Classification: ${cot.classification}`, `Net Spec: ${fmtSignedK(cot.netSpec)}`];

	if (cot.reportAgeMs > COT_STALE_MS) {
		return {
			source: 'cot',
			fetchedAt,
			staleAfterMs: COT_STALE_MS,
			status: 'stale',
			summary: `Report lag ${lagDays}d`,
			details,
			errorKind: 'stale',
			errorMessage: `COT report is ${lagDays}d old`
		};
	}

	return {
		source: 'cot',
		fetchedAt,
		staleAfterMs: COT_STALE_MS,
		status: 'healthy',
		summary: `Report lag ${lagDays}d`,
		details,
		errorKind: 'none'
	};
}

function buildChartMeta(
	result: PromiseSettledResult<Awaited<ReturnType<typeof fetchGoldOHLCV>>>,
	fetchedAt: string,
	requestedTimeframe: DashboardTimeframe
): SourceMeta {
	if (result.status === 'rejected') {
		return {
			source: 'chart',
			fetchedAt,
			staleAfterMs: CHART_STALE_MS,
			status: 'error',
			summary: 'Chart feed unavailable',
			details: asErrorDetails(result.reason),
			errorKind: 'network',
			errorMessage: String(result.reason)
		};
	}

	const chart = result.value;
	if (!chart) {
		return {
			source: 'chart',
			fetchedAt,
			staleAfterMs: CHART_STALE_MS,
			status: 'error',
			summary: 'Chart unavailable',
			details: [`Requested timeframe: ${requestedTimeframe}`],
			errorKind: 'parse',
			errorMessage: 'chart returned null'
		};
	}

	return {
		source: 'chart',
		fetchedAt,
		staleAfterMs: CHART_STALE_MS,
		status: 'healthy',
		summary: `${chart.timeframe.toUpperCase()} loaded`,
		details: [`Interval: ${chart.interval}`],
		errorKind: 'none'
	};
}

function buildAssessment(
	macro: Awaited<ReturnType<typeof fetchMacroData>> | null,
	cot: Awaited<ReturnType<typeof fetchCotData>> | null
): DashboardAssessment {
	const dxyScore = macro?.dxy ? clamp((-macro.dxy.change / 0.5), -1, 1) * 20 : 0;
	const realYieldScore =
		macro?.realYield !== null && macro?.realYield !== undefined
			? clamp((1.75 - macro.realYield) / 0.75, -1, 1) * 20
			: 0;
	const tnxScore = macro?.tnx ? clamp((-macro.tnx.change / 0.6), -1, 1) * 10 : 0;

	const cotClassMap: Record<string, number> = {
		'Extreme Short': 15,
		Short: 10,
		Neutral: 0,
		Long: 6,
		'Extreme Long': -15
	};
	const cotClassScore = cot ? (cotClassMap[cot.classification] ?? 0) : 0;
	const cotFlowScore = cot ? clamp((-cot.wowChange / 25_000), -1, 1) * 5 : 0;

	const rawScore = 50 + dxyScore + realYieldScore + tnxScore + cotClassScore + cotFlowScore;
	const score = Math.round(clamp(rawScore, 0, 100));

	let signal: DashboardSignal = 'neutral';
	if (score >= 60) signal = 'bullish';
	if (score <= 40) signal = 'bearish';

	const distanceFromCenter = Math.abs(score - 50);
	const confidence = distanceFromCenter >= 25 ? 'high' : distanceFromCenter >= 15 ? 'medium' : 'low';

	const contributions: Contribution[] = [
		{
			key: 'dxy',
			label: 'DXY',
			impact: dxyScore,
			detail: macro?.dxy
				? `DXY ${fmtSignedPct(macro.dxy.change)} at ${macro.dxy.price.toFixed(2)}`
				: 'DXY unavailable',
			available: !!macro?.dxy
		},
		{
			key: 'realYield',
			label: 'Real Yield',
			impact: realYieldScore,
			detail:
				macro?.realYield !== null && macro?.realYield !== undefined
					? `Real yield ${macro.realYield.toFixed(2)}%`
					: 'Real yield unavailable',
			available: macro?.realYield !== null && macro?.realYield !== undefined
		},
		{
			key: 'tnx',
			label: 'US 10Y',
			impact: tnxScore,
			detail: macro?.tnx
				? `US 10Y ${fmtSignedPct(macro.tnx.change)} at ${macro.tnx.price.toFixed(2)}%`
				: 'US 10Y unavailable',
			available: !!macro?.tnx
		},
		{
			key: 'cotClass',
			label: 'COT Positioning',
			impact: cotClassScore,
			detail: cot ? `COT classification ${cot.classification}` : 'COT positioning unavailable',
			available: !!cot
		},
		{
			key: 'cotFlow',
			label: 'Spec Flow',
			impact: cotFlowScore,
			detail: cot ? `Spec flow ${fmtSignedK(cot.wowChange)} WoW` : 'Spec flow unavailable',
			available: !!cot
		}
	];

	const drivers = contributions
		.filter((entry) => entry.available)
		.sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
		.slice(0, 3)
		.map<DashboardDriver>((entry) => ({
			key: entry.key,
			label: entry.label,
			impact: Math.round(entry.impact * 10) / 10,
			direction: entry.impact > 0 ? 'bullish' : entry.impact < 0 ? 'bearish' : 'neutral',
			detail: entry.detail
		}));

	const signalLabel =
		signal === 'bullish' ? 'Bullish bias' : signal === 'bearish' ? 'Bearish bias' : 'Neutral bias';
	const topDriverLabels = drivers.slice(0, 2).map((driver) => driver.label);
	const summary =
		topDriverLabels.length > 0
			? `${signalLabel}. Top drivers: ${topDriverLabels.join(' and ')}.`
			: `${signalLabel}. Key inputs unavailable.`;

	return { score, signal, confidence, summary, drivers };
}

function buildWarnings(sources: SourceMeta[], goldWarnings: string[], macroWarnings: string[]): string[] {
	const warnings = new Set<string>([...goldWarnings, ...macroWarnings]);
	for (const source of sources) {
		if (source.status === 'stale' || source.status === 'error') {
			warnings.add(`${source.source}: ${source.summary}`);
		}
	}
	return Array.from(warnings);
}

export const GET: RequestHandler = async ({ url }) => {
	const requestedTimeframe = normalizeTimeframe(url.searchParams.get('timeframe') ?? url.searchParams.get('tf'));
	const cached = cachedResults.get(requestedTimeframe);
	if (cached && Date.now() - cached.ts < CACHE_TTL) {
		return json(cached.data);
	}

	const [goldResult, macroResult, cotResult, chartResult, breadthResult] = await Promise.allSettled([
		fetchGoldPriceData(),
		fetchMacroData(),
		fetchCotData(),
		fetchGoldOHLCV(requestedTimeframe),
		fetchBreadthSnapshot()
	]);

	const gold = goldResult.status === 'fulfilled' ? goldResult.value : null;
	const macro = macroResult.status === 'fulfilled' ? macroResult.value : null;
	const cot = cotResult.status === 'fulfilled' ? cotResult.value : null;
	const rawChart = chartResult.status === 'fulfilled' ? chartResult.value : null;
	const breadth = breadthResult.status === 'fulfilled' ? breadthResult.value : null;
	const chart = rawChart
		? {
			ohlcv: rawChart.ohlcv,
			interval: rawChart.interval,
			timeframe: normalizeTimeframe(rawChart.timeframe)
		}
		: null;

	const fetchedAt = new Date().toISOString();
	const sources: SourceMeta[] = [
		buildGoldMeta(goldResult, fetchedAt),
		buildMacroMeta(macroResult, fetchedAt),
		buildCotMeta(cotResult, fetchedAt),
		buildChartMeta(chartResult, fetchedAt, requestedTimeframe)
	];

	const _meta: DashboardMeta = {
		sources,
		warnings: buildWarnings(sources, gold?.warnings ?? [], macro?.warnings ?? [])
	};

	const assessment = buildAssessment(macro, cot);
	const data: DashboardResponse = {
		gold,
		macro,
		cot,
		chart,
		breadth,
		assessment,
		updatedAt: fetchedAt,
		_meta
	};

	cachedResults.set(requestedTimeframe, { data, ts: Date.now() });
	return json(data);
};
