// SPDX-License-Identifier: AGPL-3.0-or-later
export interface RinspaceAgentBillingAmounts {
	providerCostCnyMicros: string;
	goodnessChargedSg: string;
	goodnessRevenueCnyMicros: string;
	profitCnyMicros: string;
}

export interface RinspaceAgentBillingTurn extends RinspaceAgentBillingAmounts {
	iteration: number;
	operationId: string;
	requestId: string;
	receiptSha256: string;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
}

export interface RinspaceAgentBilling extends RinspaceAgentBillingAmounts {
	model: string;
	providerPriceVersion: string;
	currency: 'CNY';
	pendingTurns: number;
	turns: RinspaceAgentBillingTurn[];
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent bill is invalid');
	return value as Record<string, unknown>;
}

function decimal(value: unknown, signed = false): string {
	if (typeof value !== 'string' || value.length > 40 || !(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)) {
		throw new Error('Agent bill amount is invalid');
	}
	return value;
}

function count(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Agent bill count is invalid');
	return value;
}

function label(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new Error('Agent bill identifier is invalid');
	return value;
}

function amounts(value: Record<string, unknown>): RinspaceAgentBillingAmounts {
	const result = {
		providerCostCnyMicros: decimal(value.providerCostCnyMicros),
		goodnessChargedSg: decimal(value.goodnessChargedSg),
		goodnessRevenueCnyMicros: decimal(value.goodnessRevenueCnyMicros),
		profitCnyMicros: decimal(value.profitCnyMicros, true),
	};
	if (BigInt(result.goodnessRevenueCnyMicros) - BigInt(result.providerCostCnyMicros) !== BigInt(result.profitCnyMicros)) {
		throw new Error('Agent bill profit is inconsistent');
	}
	return result;
}

export function validateRinspaceAgentBilling(value: unknown): RinspaceAgentBilling | null {
	// Older services omit billing. Absence is never represented as zero charge.
	if (value === undefined || value === null) return null;
	const bill = record(value);
	if (bill.currency !== 'CNY' || !Array.isArray(bill.turns) || bill.turns.length > 128) throw new Error('Agent bill is invalid');
	const seen = new Set<string>();
	let previousIteration = 0;
	const turns = bill.turns.map((item): RinspaceAgentBillingTurn => {
		const turn = record(item);
		const operationId = label(turn.operationId);
		const iteration = count(turn.iteration);
		if (seen.has(operationId) || iteration <= previousIteration || typeof turn.receiptSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(turn.receiptSha256)) {
			throw new Error('Agent bill receipt is invalid');
		}
		seen.add(operationId);
		previousIteration = iteration;
		const inputTokens = count(turn.inputTokens);
		const cachedInputTokens = count(turn.cachedInputTokens);
		if (cachedInputTokens > inputTokens) throw new Error('Agent bill tokens are invalid');
		return { ...amounts(turn), iteration, operationId, requestId: label(turn.requestId), receiptSha256: turn.receiptSha256,
			inputTokens, cachedInputTokens, outputTokens: count(turn.outputTokens) };
	});
	const total = amounts(bill);
	for (const key of Object.keys(total) as (keyof RinspaceAgentBillingAmounts)[]) {
		if (turns.reduce((sum, turn) => sum + BigInt(turn[key]), 0n) !== BigInt(total[key])) throw new Error('Agent bill total is inconsistent');
	}
	return { ...total, model: label(bill.model), providerPriceVersion: label(bill.providerPriceVersion), currency: 'CNY', pendingTurns: count(bill.pendingTurns), turns };
}

export function formatAgentCny(micros: string): string {
	const value = BigInt(micros);
	const absolute = value < 0n ? -value : value;
	return `${value < 0n ? '-' : ''}¥${absolute / 1000000n}.${(absolute % 1000000n).toString().padStart(6, '0')}`;
}
