// Chart Tools - get_crypto_chart, get_technical_analysis
import { registerTool, type ToolResult } from './registry';
import { toolCache } from '../cache.server';
import type { OHLCV } from '$lib/types/contentBlock';
import { fetchOHLCV } from '../data/ohlcvProvider';
import { sma, ema, rsi, macd, bollingerBands } from '../indicators/engine';

const VALID_INTERVALS = new Set(['1m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','1w','1M']);

function normalizeInterval(interval: string): string {
	const lower = interval.toLowerCase().trim();
	return VALID_INTERVALS.has(lower) ? lower : '4h';
}

// Indicator calculations delegated to engine

// --- Get Crypto Chart Tool ---

registerTool({
	name: 'get_crypto_chart',
	description:
		'Fetch price chart data (OHLCV candlestick data). Supports crypto (BTC, ETH, SOL), forex (EURUSD, GBPJPY), and commodities (XAUUSD for Gold, XAGUSD for Silver). Returns an interactive candlestick chart.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTC, ETHUSDT, SOLUSDT, XAUUSD, EURUSD)'
			},
			interval: {
				type: 'string',
				description: 'Candlestick interval',
				enum: ['1m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d', '1w']
			},
			limit: {
				type: 'number',
				description: 'Number of candles to return (default: 100, max: 500)'
			}
		},
		required: ['symbol']
	},
	timeout: 15_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol = String(args.symbol || 'BTCUSDT');
		const interval = normalizeInterval(String(args.interval || '4h'));
		const limit = Math.min(Math.max(Number(args.limit) || 100, 10), 500);

		const cacheKey = toolCache.generateKey('get_crypto_chart', { rawSymbol, interval, limit });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const providerResult = await fetchOHLCV(rawSymbol, interval, limit);
		if ('error' in providerResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: providerResult.error, tool: 'get_crypto_chart' }],
				textSummary: `Error: ${providerResult.error}`
			};
		}

		const { ohlcv, displayName, source } = providerResult;
		if (ohlcv.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `No chart data available for ${displayName}`, tool: 'get_crypto_chart' }],
				textSummary: `Error: No chart data for ${displayName}.`
			};
		}

		const lastCandle = ohlcv[ohlcv.length - 1];
		const firstCandle = ohlcv[0];
		const priceChange = ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100;
		const sourceLabel = source === 'binance' ? 'Binance API' : source === 'yahoo' ? 'Yahoo Finance' : 'CoinGecko';
		const sourceUrl = source === 'binance' ? 'https://api.binance.com' : source === 'yahoo' ? 'https://finance.yahoo.com' : 'https://api.coingecko.com';

		const result: ToolResult = {
			success: true,
			contentBlocks: [{ type: 'chart', chartType: 'candlestick', symbol: displayName, interval, data: ohlcv }],
			textSummary: `${displayName} ${interval} chart: ${ohlcv.length} candles, Latest close: ${lastCandle.close}, Price change over period: ${priceChange.toFixed(2)}%, High: ${Math.max(...ohlcv.map((c) => c.high)).toFixed(2)}, Low: ${Math.min(...ohlcv.map((c) => c.low)).toFixed(2)}`,
			sources: [{ name: sourceLabel, url: sourceUrl, accessedAt: Date.now() }]
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});

// --- Technical Analysis Tool ---

registerTool({
	name: 'get_technical_analysis',
	description:
		'Calculate technical indicators (RSI, MACD, Bollinger Bands, SMA, EMA) for any asset. Supports crypto (BTC, ETH), forex (EURUSD), and commodities (XAUUSD for Gold, XAGUSD for Silver). Returns a chart with indicators overlaid and a data table.',
	parameters: {
		type: 'object',
		properties: {
			symbol: {
				type: 'string',
				description: 'Trading pair symbol (e.g. BTC, ETHUSDT, SOLUSDT, XAUUSD, EURUSD)'
			},
			indicators: {
				type: 'array',
				items: {
					type: 'string',
					enum: ['rsi', 'macd', 'bb', 'sma_20', 'sma_50', 'sma_200', 'ema_12', 'ema_26']
				},
				description: 'Which indicators to calculate (default: rsi, sma_20, sma_50)'
			},
			interval: {
				type: 'string',
				description: 'Timeframe for analysis',
				enum: ['1h', '4h', '1d']
			}
		},
		required: ['symbol']
	},
	timeout: 20_000,
	execute: async (args): Promise<ToolResult> => {
		const rawSymbol = String(args.symbol || 'BTCUSDT');
		const interval = normalizeInterval(String(args.interval || '1d'));
		const indicators = Array.isArray(args.indicators)
			? (args.indicators as string[])
			: ['rsi', 'sma_20', 'sma_50'];

		const cacheKey = toolCache.generateKey('get_technical_analysis', { rawSymbol, interval, indicators });
		const cached = toolCache.get<ToolResult>(cacheKey);
		if (cached) return cached;

		const providerResult = await fetchOHLCV(rawSymbol, interval, 300);
		if ('error' in providerResult) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: providerResult.error, tool: 'get_technical_analysis' }],
				textSummary: `Error: ${providerResult.error}`
			};
		}

		const { ohlcv, displayName: symbol } = providerResult;

		if (ohlcv.length === 0) {
			return {
				success: false,
				contentBlocks: [{ type: 'error', message: `No data available for ${symbol}`, tool: 'get_technical_analysis' }],
				textSummary: `Error: No data for ${symbol}.`
			};
		}

		const closes = ohlcv.map((c) => c.close);

		const chartIndicators: {
			name: string;
			data: { time: number; value: number }[];
			color?: string;
			overlay: boolean;
		}[] = [];
		const tableRows: (string | number)[][] = [];
		const summaryParts: string[] = [];

		const lastClose = closes[closes.length - 1];

		for (const ind of indicators) {
			switch (ind) {
				case 'rsi': {
					const rsiValues = rsi(ohlcv);
					const lastRSI = rsiValues[rsiValues.length - 1];
					chartIndicators.push({
						name: 'RSI (14)',
						data: rsiValues,
						color: '#8b5cf6',
						overlay: false
					});
					tableRows.push(['RSI (14)', lastRSI?.value?.toFixed(2) ?? 'N/A']);
					summaryParts.push(`RSI(14): ${lastRSI?.value?.toFixed(2) ?? 'N/A'}`);
					break;
				}
				case 'macd': {
					const macdResult = macd(ohlcv);
					const lastMACD = macdResult.macd[macdResult.macd.length - 1];
					const lastSignal = macdResult.signal[macdResult.signal.length - 1];
					const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
					chartIndicators.push({
						name: 'MACD',
						data: macdResult.macd,
						color: '#3b82f6',
						overlay: false
					});
					chartIndicators.push({
						name: 'MACD Signal',
						data: macdResult.signal,
						color: '#ef4444',
						overlay: false
					});
					tableRows.push(['MACD', lastMACD?.value?.toFixed(4) ?? 'N/A']);
					tableRows.push(['MACD Signal', lastSignal?.value?.toFixed(4) ?? 'N/A']);
					tableRows.push(['MACD Histogram', lastHist?.value?.toFixed(4) ?? 'N/A']);
					summaryParts.push(
						`MACD: ${lastMACD?.value?.toFixed(4)}, Signal: ${lastSignal?.value?.toFixed(4)}, Hist: ${lastHist?.value?.toFixed(4)}`
					);
					break;
				}
				case 'bb': {
					const bbResult = bollingerBands(ohlcv);
					const lastUpper = bbResult.upper[bbResult.upper.length - 1];
					const lastMiddle = bbResult.middle[bbResult.middle.length - 1];
					const lastLower = bbResult.lower[bbResult.lower.length - 1];
					chartIndicators.push({
						name: 'BB Upper',
						data: bbResult.upper,
						color: '#94a3b8',
						overlay: true
					});
					chartIndicators.push({
						name: 'BB Middle',
						data: bbResult.middle,
						color: '#64748b',
						overlay: true
					});
					chartIndicators.push({
						name: 'BB Lower',
						data: bbResult.lower,
						color: '#94a3b8',
						overlay: true
					});
					tableRows.push(['BB Upper', lastUpper?.value?.toFixed(2) ?? 'N/A']);
					tableRows.push(['BB Middle (SMA20)', lastMiddle?.value?.toFixed(2) ?? 'N/A']);
					tableRows.push(['BB Lower', lastLower?.value?.toFixed(2) ?? 'N/A']);
					summaryParts.push(
						`BB: Upper ${lastUpper?.value?.toFixed(2)}, Middle ${lastMiddle?.value?.toFixed(2)}, Lower ${lastLower?.value?.toFixed(2)}`
					);
					break;
				}
				case 'sma_20':
				case 'sma_50':
				case 'sma_200': {
					const period = parseInt(ind.split('_')[1], 10);
					const smaValues = sma(ohlcv, period);
					const lastSMA = smaValues[smaValues.length - 1];
					const colors: Record<number, string> = {
						20: '#f59e0b',
						50: '#10b981',
						200: '#ef4444'
					};
					chartIndicators.push({
						name: `SMA ${period}`,
						data: smaValues,
						color: colors[period] || '#6b7280',
						overlay: true
					});
					tableRows.push([`SMA ${period}`, lastSMA?.value?.toFixed(2) ?? 'N/A']);
					summaryParts.push(`SMA${period}: ${lastSMA?.value?.toFixed(2) ?? 'N/A'}`);
					break;
				}
				case 'ema_12':
				case 'ema_26': {
					const period = parseInt(ind.split('_')[1], 10);
					const emaValues = ema(ohlcv, period);
					const lastEMA = emaValues[emaValues.length - 1];
					chartIndicators.push({
						name: `EMA ${period}`,
						data: emaValues,
						color: period === 12 ? '#8b5cf6' : '#ec4899',
						overlay: true
					});
					tableRows.push([`EMA ${period}`, lastEMA?.value?.toFixed(2) ?? 'N/A']);
					summaryParts.push(`EMA${period}: ${lastEMA?.value?.toFixed(2) ?? 'N/A'}`);
					break;
				}
			}
		}

		// Use last 100 candles for display
		const displayData = ohlcv.slice(-100);

		const result: ToolResult = {
			success: true,
			contentBlocks: [
				{
					type: 'chart',
					chartType: 'candlestick',
					symbol,
					interval,
					data: displayData,
					indicators: chartIndicators.map((ind) => ({
						...ind,
						data: ind.data.filter(
							(d) => d.time >= displayData[0].time
						)
					}))
				},
				{
					type: 'table',
					title: `${symbol} Technical Analysis (${interval})`,
					headers: ['Indicator', 'Value'],
					rows: [['Current Price', lastClose?.toFixed(2) ?? 'N/A'], ...tableRows]
				}
			],
			textSummary: `${symbol} ${interval} Technical Analysis: Price ${lastClose?.toFixed(2)}, ${summaryParts.join(', ')}`,
			sources: [{ name: 'Market Data', url: 'https://api.binance.com', accessedAt: Date.now() }]
		};

		toolCache.set(cacheKey, result, 60_000);
		return result;
	}
});
