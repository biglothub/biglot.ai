// Chat Export utility — T-405
// Serializes chat messages to Markdown and triggers browser downloads.

export type ExportMessage = {
	role: 'user' | 'assistant' | 'system';
	content: string;
	contentBlocks?: Array<{ type: string; [key: string]: unknown }> | null;
};

// ─── Markdown serializer ──────────────────────────────────────────────────────

/**
 * Serializes a content block to a Markdown string summary.
 * Provides text descriptions for structured blocks (tables, gauges, etc.).
 */
function blockToMarkdown(block: { type: string; [key: string]: unknown }): string {
	switch (block.type) {
		case 'text':
			return String(block.content ?? '');

		case 'table': {
			const headers = (block.headers as string[]) ?? [];
			const rows = (block.rows as string[][]) ?? [];
			if (!headers.length) return '';
			const sep = headers.map(() => '---').join(' | ');
			const headerRow = headers.join(' | ');
			const dataRows = rows.map(r => r.join(' | ')).join('\n');
			return `| ${headerRow} |\n| ${sep} |\n${rows.length ? `| ${dataRows.split('\n').join(' |\n| ')} |` : ''}`;
		}

		case 'metric_card': {
			const label = block.label ?? block.title ?? '';
			const value = block.value ?? '';
			const change = block.change ? ` (${block.change})` : '';
			return `**${label}**: ${value}${change}`;
		}

		case 'gauge': {
			const label = block.label ?? '';
			const value = block.value ?? '';
			return `**${label}**: ${value}${typeof block.max === 'number' ? ` / ${block.max}` : ''}`;
		}

		case 'trade_setup': {
			const dir = String(block.direction ?? '').toUpperCase();
			const asset = block.asset ?? '';
			const entry = block.entryZone as { low?: number; high?: number } | undefined;
			const sl = block.stopLoss;
			const lines = [
				`**Trade Setup — ${asset} ${dir}**`,
				entry ? `Entry Zone: ${entry.low} – ${entry.high}` : '',
				sl != null ? `Stop Loss: ${sl}` : '',
				block.thesis ? `Thesis: ${block.thesis}` : '',
			].filter(Boolean);
			return lines.join('\n');
		}

		case 'chart':
			return `*[Chart: ${block.symbol ?? ''} ${block.interval ?? ''}]*`;

		case 'error':
			return `> Error: ${block.message ?? ''}`;

		case 'sources': {
			const sources = (block.sources as Array<{ title?: string; url?: string }>) ?? [];
			if (!sources.length) return '';
			return '**Sources:**\n' + sources.map(s => `- [${s.title ?? s.url ?? ''}](${s.url ?? ''})`).join('\n');
		}

		default:
			return `*[${block.type} block]*`;
	}
}

/**
 * Converts an array of messages to a Markdown string.
 */
export function messagesToMarkdown(messages: ExportMessage[], title = 'BigLot.ai Chat Export'): string {
	const date = new Date().toISOString().slice(0, 10);
	const lines: string[] = [
		`# ${title}`,
		`*Exported from BigLot.ai on ${date}*`,
		'',
	];

	for (const msg of messages) {
		if (msg.role === 'system') continue;
		const role = msg.role === 'user' ? '**You**' : '**BigLot.ai**';
		lines.push(`---\n\n${role}\n`);

		if (msg.contentBlocks?.length) {
			for (const block of msg.contentBlocks ?? []) {
				const md = blockToMarkdown(block);
				if (md) lines.push(md);
			}
		}

		if (msg.content) {
			lines.push(msg.content);
		}

		lines.push('');
	}

	return lines.join('\n');
}

// ─── Browser download helpers ─────────────────────────────────────────────────

/**
 * Triggers a browser download of `content` as a `.md` file.
 */
export function downloadMarkdown(filename: string, content: string): void {
	const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename.endsWith('.md') ? filename : `${filename}.md`;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Triggers a browser download of `data` as a `.json` file.
 */
export function downloadJson(filename: string, data: unknown): void {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename.endsWith('.json') ? filename : `${filename}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

/**
 * Builds the public share URL for a given chat ID.
 */
export function buildShareUrl(chatId: string, origin = ''): string {
	return `${origin}/share/${chatId}`;
}
