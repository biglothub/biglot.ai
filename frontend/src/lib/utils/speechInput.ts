// Speech Input utility — T-404
// Wraps Web Speech API (SpeechRecognition) with Thai + English support.

export type SpeechLang = 'th-TH' | 'en-US' | 'auto';

export type SpeechInputOptions = {
	lang?: SpeechLang;
	continuous?: boolean;
	interimResults?: boolean;
	onResult: (transcript: string, isFinal: boolean) => void;
	onError?: (error: string) => void;
	onEnd?: () => void;
};

export type SpeechInputInstance = {
	start(): void;
	stop(): void;
	abort(): void;
};

// Local interfaces for Web Speech API (not always present in TypeScript's DOM lib).
interface SpeechResultItem {
	transcript: string;
	confidence: number;
}

interface SpeechResult extends ArrayLike<SpeechResultItem> {
	isFinal: boolean;
}

interface SpeechResultList extends ArrayLike<SpeechResult> {}

interface SpeechResultEvent {
	results: SpeechResultList;
	resultIndex: number;
}

interface SpeechErrorEvent {
	error: string;
}

interface SpeechRecognitionInstance {
	lang: string;
	continuous: boolean;
	interimResults: boolean;
	onresult: ((e: SpeechResultEvent) => void) | null;
	onerror: ((e: SpeechErrorEvent) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}

// Resolve language: 'auto' maps to browser language preference, falling back to 'en-US'.
function resolveLang(lang: SpeechLang): string {
	if (lang === 'auto') {
		const nav = typeof navigator !== 'undefined' ? navigator.language : '';
		if (nav.startsWith('th')) return 'th-TH';
		return 'en-US';
	}
	return lang;
}

/**
 * Returns true if SpeechRecognition is available in the current environment.
 */
export function isSpeechSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
	);
}

// Internal: get the SpeechRecognition constructor.
function getSpeechRecognitionCtor(): (new () => SpeechRecognitionInstance) | null {
	if (typeof window === 'undefined') return null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const w = window as unknown as Record<string, unknown>;
	return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition'] ?? null) as (new () => SpeechRecognitionInstance) | null;
}

/**
 * Creates a SpeechInput instance. Returns null if the browser does not support
 * the Web Speech API (e.g. server-side, Firefox without flag, etc.).
 */
export function createSpeechInput(options: SpeechInputOptions): SpeechInputInstance | null {
	const Ctor = getSpeechRecognitionCtor();
	if (!Ctor) return null;

	const {
		lang = 'auto',
		continuous = false,
		interimResults = true,
		onResult,
		onError,
		onEnd,
	} = options;

	const recognition = new Ctor();
	recognition.lang = resolveLang(lang);
	recognition.continuous = continuous;
	recognition.interimResults = interimResults;

	recognition.onresult = (event: SpeechResultEvent) => {
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			const transcript = result[0].transcript;
			const isFinal = result.isFinal;
			onResult(transcript, isFinal);
		}
	};

	recognition.onerror = (event: SpeechErrorEvent) => {
		onError?.(event.error);
	};

	recognition.onend = () => {
		onEnd?.();
	};

	return {
		start() { recognition.start(); },
		stop() { recognition.stop(); },
		abort() { recognition.abort(); },
	};
}
