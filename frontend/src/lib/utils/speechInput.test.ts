// Tests for Speech Input utility — T-404
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isSpeechSupported, createSpeechInput } from './speechInput';

// Local type alias to avoid reliance on global Web Speech API types in test environment
type SpeechRecognitionEvent = Event & {
	results: SpeechRecognitionResultList;
	resultIndex: number;
};

// ─── Local event types (mirrors speechInput.ts internals) ─────────────────────

interface MockResultItem { transcript: string; confidence: number }
interface MockResult extends Array<MockResultItem> { isFinal: boolean }
interface MockResultEvent { results: MockResult[]; resultIndex: number }
interface MockErrorEvent { error: string }

// ─── Mock SpeechRecognition ───────────────────────────────────────────────────

class MockSpeechRecognition {
	lang = '';
	continuous = false;
	interimResults = false;
	onresult: ((e: MockResultEvent) => void) | null = null;
	onerror: ((e: MockErrorEvent) => void) | null = null;
	onend: (() => void) | null = null;
	start = vi.fn();
	stop = vi.fn();
	abort = vi.fn();
}

function installMock() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).window = globalThis;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).SpeechRecognition = MockSpeechRecognition;
}

function removeMock() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).SpeechRecognition;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).webkitSpeechRecognition;
}

// ─── isSpeechSupported ────────────────────────────────────────────────────────

describe('isSpeechSupported', () => {
	afterEach(removeMock);

	it('returns true when SpeechRecognition is available', () => {
		installMock();
		expect(isSpeechSupported()).toBe(true);
	});

	it('returns true when webkitSpeechRecognition is available', () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).window = globalThis;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).webkitSpeechRecognition = MockSpeechRecognition;
		expect(isSpeechSupported()).toBe(true);
	});

	it('returns false when neither API is present', () => {
		removeMock();
		expect(isSpeechSupported()).toBe(false);
	});
});

// ─── createSpeechInput ────────────────────────────────────────────────────────

describe('createSpeechInput', () => {
	beforeEach(installMock);
	afterEach(removeMock);

	it('returns null when SpeechRecognition is unavailable', () => {
		removeMock();
		const instance = createSpeechInput({ onResult: vi.fn() });
		expect(instance).toBeNull();
	});

	it('returns an instance with start/stop/abort when supported', () => {
		const instance = createSpeechInput({ onResult: vi.fn() });
		expect(instance).not.toBeNull();
		expect(typeof instance!.start).toBe('function');
		expect(typeof instance!.stop).toBe('function');
		expect(typeof instance!.abort).toBe('function');
	});

	it('sets lang to en-US by default (auto with no Thai navigator)', () => {
		const instances: MockSpeechRecognition[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); instances.push(this); }
		};
		createSpeechInput({ onResult: vi.fn() });
		expect(instances[0].lang).toBe('en-US');
	});

	it('sets lang explicitly to th-TH', () => {
		const instances: MockSpeechRecognition[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); instances.push(this); }
		};
		createSpeechInput({ lang: 'th-TH', onResult: vi.fn() });
		expect(instances[0].lang).toBe('th-TH');
	});

	it('sets lang explicitly to en-US', () => {
		const instances: MockSpeechRecognition[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); instances.push(this); }
		};
		createSpeechInput({ lang: 'en-US', onResult: vi.fn() });
		expect(instances[0].lang).toBe('en-US');
	});

	it('applies continuous and interimResults options', () => {
		const instances: MockSpeechRecognition[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); instances.push(this); }
		};
		createSpeechInput({ continuous: true, interimResults: false, onResult: vi.fn() });
		expect(instances[0].continuous).toBe(true);
		expect(instances[0].interimResults).toBe(false);
	});

	it('defaults continuous=false, interimResults=true', () => {
		const instances: MockSpeechRecognition[] = [];
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); instances.push(this); }
		};
		createSpeechInput({ onResult: vi.fn() });
		expect(instances[0].continuous).toBe(false);
		expect(instances[0].interimResults).toBe(true);
	});
});

// ─── Callbacks ────────────────────────────────────────────────────────────────

describe('createSpeechInput callbacks', () => {
	let recog: MockSpeechRecognition;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).window = globalThis;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); recog = this; }
		};
	});
	afterEach(removeMock);

	function makeEvent(transcript: string, isFinal: boolean, resultIndex = 0): MockResultEvent {
		const result = Object.assign([{ transcript, confidence: 1 }], { isFinal }) as MockResult;
		return { results: [result], resultIndex };
	}

	it('calls onResult with transcript and isFinal=true for final results', () => {
		const onResult = vi.fn();
		createSpeechInput({ onResult });
		recog.onresult?.(makeEvent('hello world', true));
		expect(onResult).toHaveBeenCalledWith('hello world', true);
	});

	it('calls onResult with isFinal=false for interim results', () => {
		const onResult = vi.fn();
		createSpeechInput({ onResult });
		recog.onresult?.(makeEvent('hell...', false));
		expect(onResult).toHaveBeenCalledWith('hell...', false);
	});

	it('calls onError with error string', () => {
		const onError = vi.fn();
		createSpeechInput({ onResult: vi.fn(), onError });
		recog.onerror?.({ error: 'not-allowed' });
		expect(onError).toHaveBeenCalledWith('not-allowed');
	});

	it('calls onEnd when recognition ends', () => {
		const onEnd = vi.fn();
		createSpeechInput({ onResult: vi.fn(), onEnd });
		recog.onend?.();
		expect(onEnd).toHaveBeenCalled();
	});

	it('does not throw when onError is omitted', () => {
		createSpeechInput({ onResult: vi.fn() });
		expect(() => recog.onerror?.({ error: 'network' })).not.toThrow();
	});

	it('does not throw when onEnd is omitted', () => {
		createSpeechInput({ onResult: vi.fn() });
		expect(() => recog.onend?.()).not.toThrow();
	});
});

// ─── Instance methods ─────────────────────────────────────────────────────────

describe('createSpeechInput instance methods', () => {
	let recog: MockSpeechRecognition;

	beforeEach(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).window = globalThis;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(globalThis as any).SpeechRecognition = class extends MockSpeechRecognition {
			constructor() { super(); recog = this; }
		};
	});
	afterEach(removeMock);

	it('start() calls recognition.start()', () => {
		const instance = createSpeechInput({ onResult: vi.fn() });
		instance!.start();
		expect(recog.start).toHaveBeenCalled();
	});

	it('stop() calls recognition.stop()', () => {
		const instance = createSpeechInput({ onResult: vi.fn() });
		instance!.stop();
		expect(recog.stop).toHaveBeenCalled();
	});

	it('abort() calls recognition.abort()', () => {
		const instance = createSpeechInput({ onResult: vi.fn() });
		instance!.abort();
		expect(recog.abort).toHaveBeenCalled();
	});
});
