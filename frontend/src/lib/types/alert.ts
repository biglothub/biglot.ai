// Alert types — T-401

export type AlertCondition = 'above' | 'below' | 'crosses';

export type PriceAlert = {
	id: string;
	userId: string;
	symbol: string;
	condition: AlertCondition;
	target: number;
	note: string | null;
	triggered: boolean;
	triggeredAt: string | null;
	active: boolean;
	createdAt: string;
};
