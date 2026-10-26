// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatAgentCny, validateRinspaceAgentBilling } from '@extras/agents/rinspace/RinspaceAgentBilling';

const receipt = () => ({
	iteration: 1, operationId: 'operation-1', requestId: 'receipt-1', receiptSha256: 'a'.repeat(64),
	inputTokens: 7, cachedInputTokens: 2, outputTokens: 3,
	providerCostCnyMicros: '9007199254740993', goodnessChargedSg: '1', goodnessRevenueCnyMicros: '500', profitCnyMicros: '-9007199254740493',
});
const bill = () => ({ ...receipt(), model: 'model-1', providerPriceVersion: 'price-1', currency: 'CNY', pendingTurns: 1, turns: [receipt()] });

test('keeps exact settled money, negative profit, and pending count', () => {
	const result = validateRinspaceAgentBilling(bill());
	expect(result?.providerCostCnyMicros).toBe('9007199254740993');
	expect(result?.pendingTurns).toBe(1);
	expect(formatAgentCny('9007199254740993')).toBe('¥9007199254.740993');
	expect(formatAgentCny('-1')).toBe('-¥0.000001');
});

test('missing billing is unknown rather than free', () => {
	expect(validateRinspaceAgentBilling(undefined)).toBeNull();
});

test.each([
	{ goodnessChargedSg: '2' },
	{ providerCostCnyMicros: Number('9007199254740993') },
	{ profitCnyMicros: '0' },
	{ turns: [receipt(), receipt()] },
	{ turns: [{ ...receipt(), cachedInputTokens: 8 }] },
	{ turns: [{ ...receipt(), receiptSha256: '' }] },
	{ pendingTurns: -1 },
])('rejects inconsistent or malformed authoritative bills: %p', (change) => {
	expect(() => validateRinspaceAgentBilling({ ...bill(), ...change })).toThrow();
});
