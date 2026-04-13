import { describe, expect, it } from 'vitest';
import { buildResearchReportBlock, parseResearchSections } from './researchReport.server';

describe('researchReport.server', () => {
	it('parses markdown sections by level-2 headings', () => {
		expect(
			parseResearchSections('## Macro\nFed stays restrictive\n\n## Risk\nLiquidity remains thin')
		).toEqual([
			{
				id: 'section_1',
				title: 'Macro',
				content: 'Fed stays restrictive'
			},
			{
				id: 'section_2',
				title: 'Risk',
				content: 'Liquidity remains thin'
			}
		]);
	});

	it('wraps plain text in a default research section', () => {
		const report = buildResearchReportBlock({
			query: 'gold outlook',
			text: 'Gold remains bid on real-rate weakness.',
			toolCallCount: 0,
			startedAt: 1000,
			now: 2500
		});

		expect(report).toEqual({
			type: 'research_report',
			reportId: 'research_2500',
			title: 'Research: gold outlook',
			query: 'gold outlook',
			sections: [
				{
					id: 'section_1',
					title: 'Research Findings',
					content: 'Gold remains bid on real-rate weakness.'
				}
			],
			status: 'complete',
			toolCallCount: 0,
			totalDurationMs: 1500,
			createdAt: 1000,
			updatedAt: 2500
		});
	});
});
