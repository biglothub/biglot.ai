// Tests for Chat Export utility — T-405
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	messagesToMarkdown,
	downloadMarkdown,
	downloadJson,
	buildShareUrl,
	type ExportMessage,
} from './chatExport';

// ─── messagesToMarkdown ───────────────────────────────────────────────────────

describe('messagesToMarkdown', () => {
	it('includes the title as H1', () => {
		const md = messagesToMarkdown([], 'Test Chat');
		expect(md).toContain('# Test Chat');
	});

	it('defaults title to "BigLot.ai Chat Export"', () => {
		const md = messagesToMarkdown([]);
		expect(md).toContain('# BigLot.ai Chat Export');
	});

	it('includes today\'s date in export header', () => {
		const md = messagesToMarkdown([]);
		const today = new Date().toISOString().slice(0, 10);
		expect(md).toContain(today);
	});

	it('renders user message with You label', () => {
		const msgs: ExportMessage[] = [{ role: 'user', content: 'Hello there' }];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('**You**');
		expect(md).toContain('Hello there');
	});

	it('renders assistant message with BigLot.ai label', () => {
		const msgs: ExportMessage[] = [{ role: 'assistant', content: 'Hi back' }];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('**BigLot.ai**');
		expect(md).toContain('Hi back');
	});

	it('skips system messages', () => {
		const msgs: ExportMessage[] = [{ role: 'system', content: 'You are helpful' }];
		const md = messagesToMarkdown(msgs);
		expect(md).not.toContain('You are helpful');
	});

	it('serializes metric_card block', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{ type: 'metric_card', label: 'BTC Price', value: '$50,000' }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('**BTC Price**');
		expect(md).toContain('$50,000');
	});

	it('serializes gauge block', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{ type: 'gauge', label: 'Fear & Greed', value: 72, max: 100 }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('**Fear & Greed**');
		expect(md).toContain('72');
		expect(md).toContain('100');
	});

	it('serializes trade_setup block', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{
				type: 'trade_setup',
				asset: 'BTCUSDT',
				direction: 'long',
				entryZone: { low: 49000, high: 51000 },
				stopLoss: 47000,
				thesis: 'Bullish confluence',
			}],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('BTCUSDT');
		expect(md).toContain('LONG');
		expect(md).toContain('49000');
		expect(md).toContain('47000');
		expect(md).toContain('Bullish confluence');
	});

	it('serializes chart block with placeholder', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{ type: 'chart', symbol: 'BTC', interval: '4h' }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('[Chart: BTC 4h]');
	});

	it('serializes error block', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{ type: 'error', message: 'API failed' }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('API failed');
	});

	it('serializes sources block', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{
				type: 'sources',
				sources: [{ title: 'CoinDesk', url: 'https://coindesk.com' }],
			}],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('Sources');
		expect(md).toContain('CoinDesk');
		expect(md).toContain('https://coindesk.com');
	});

	it('renders unknown block type with placeholder', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: '',
			contentBlocks: [{ type: 'heatmap' }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('[heatmap block]');
	});

	it('renders both content blocks and text content', () => {
		const msgs: ExportMessage[] = [{
			role: 'assistant',
			content: 'Summary text',
			contentBlocks: [{ type: 'gauge', label: 'Score', value: 8 }],
		}];
		const md = messagesToMarkdown(msgs);
		expect(md).toContain('Score');
		expect(md).toContain('Summary text');
	});

	it('handles multiple messages in order', () => {
		const msgs: ExportMessage[] = [
			{ role: 'user', content: 'First' },
			{ role: 'assistant', content: 'Second' },
		];
		const md = messagesToMarkdown(msgs);
		const firstIdx = md.indexOf('First');
		const secondIdx = md.indexOf('Second');
		expect(firstIdx).toBeLessThan(secondIdx);
	});
});

// ─── buildShareUrl ────────────────────────────────────────────────────────────

describe('buildShareUrl', () => {
	it('builds path /share/<chatId>', () => {
		expect(buildShareUrl('abc123')).toBe('/share/abc123');
	});

	it('prepends origin when provided', () => {
		expect(buildShareUrl('abc123', 'https://biglot.ai')).toBe('https://biglot.ai/share/abc123');
	});
});

// ─── downloadMarkdown / downloadJson ─────────────────────────────────────────

// ─── Browser-side download helpers ───────────────────────────────────────────
// These tests mock the DOM APIs that are not available in the Node test runner.

function installDomMocks(anchorClick: unknown, anchor: Record<string, unknown>) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).document = {
		createElement: vi.fn().mockReturnValue(anchor),
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).URL = {
		createObjectURL: vi.fn().mockReturnValue('blob:fake'),
		revokeObjectURL: vi.fn(),
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).Blob = class {
		constructor(public parts: unknown[], public opts?: unknown) {}
	};
	void anchorClick;
}

function removeDomMocks() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).document;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).URL;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delete (globalThis as any).Blob;
}

describe('downloadMarkdown', () => {
	let anchorClick: ReturnType<typeof vi.fn>;
	let anchor: Record<string, unknown>;

	beforeEach(() => {
		anchorClick = vi.fn();
		anchor = { href: '', download: '', click: anchorClick };
		installDomMocks(anchorClick, anchor);
	});
	afterEach(removeDomMocks);

	it('triggers a click on an anchor element', () => {
		downloadMarkdown('test', '# Hello');
		expect(anchorClick).toHaveBeenCalled();
	});

	it('appends .md extension if missing', () => {
		downloadMarkdown('myfile', '# content');
		expect(anchor.download).toBe('myfile.md');
	});

	it('preserves .md extension if already present', () => {
		downloadMarkdown('myfile.md', '# content');
		expect(anchor.download).toBe('myfile.md');
	});

	it('creates and revokes object URL', () => {
		downloadMarkdown('test', 'content');
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((globalThis as any).URL.createObjectURL).toHaveBeenCalled();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		expect((globalThis as any).URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
	});
});

describe('downloadJson', () => {
	let anchorClick: ReturnType<typeof vi.fn>;
	let anchor: Record<string, unknown>;

	beforeEach(() => {
		anchorClick = vi.fn();
		anchor = { href: '', download: '', click: anchorClick };
		installDomMocks(anchorClick, anchor);
	});
	afterEach(removeDomMocks);

	it('triggers download', () => {
		downloadJson('export', { key: 'value' });
		expect(anchorClick).toHaveBeenCalled();
	});

	it('appends .json extension if missing', () => {
		downloadJson('myfile', {});
		expect(anchor.download).toBe('myfile.json');
	});
});
