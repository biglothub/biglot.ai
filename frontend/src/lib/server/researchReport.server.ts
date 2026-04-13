import type { ResearchReportBlock, ResearchSection } from '$lib/types/contentBlock';

export function parseResearchSections(text: string): ResearchSection[] {
	const lines = text.split('\n');
	const sections: ResearchSection[] = [];
	let currentTitle = '';
	let currentLines: string[] = [];

	for (const line of lines) {
		const headerMatch = line.match(/^##\s+(.+)/);
		if (headerMatch) {
			if (currentTitle && currentLines.length > 0) {
				sections.push({
					id: `section_${sections.length + 1}`,
					title: currentTitle,
					content: currentLines.join('\n').trim()
				});
			}
			currentTitle = headerMatch[1].trim();
			currentLines = [];
			continue;
		}

		currentLines.push(line);
	}

	if (currentTitle && currentLines.length > 0) {
		sections.push({
			id: `section_${sections.length + 1}`,
			title: currentTitle,
			content: currentLines.join('\n').trim()
		});
	}

	if (sections.length === 0 && text.trim().length > 0) {
		sections.push({
			id: 'section_1',
			title: 'Research Findings',
			content: text.trim()
		});
	}

	return sections;
}

export function buildResearchReportBlock(input: {
	query: string;
	text: string;
	toolCallCount?: number;
	startedAt: number;
	now?: number;
}): ResearchReportBlock {
	const updatedAt = input.now ?? Date.now();

	return {
		type: 'research_report',
		reportId: `research_${updatedAt}`,
		title: `Research: ${input.query.slice(0, 60)}`,
		query: input.query,
		sections: parseResearchSections(input.text),
		status: 'complete',
		toolCallCount: input.toolCallCount ?? 0,
		totalDurationMs: Math.max(0, updatedAt - input.startedAt),
		createdAt: input.startedAt,
		updatedAt
	};
}
