// SPDX-License-Identifier: AGPL-3.0-or-later
import { render, screen } from '@testing-library/react';
import { RinspaceAgentBill } from '@extras/agents/rinspace/RinspaceAgentBill';
import type { RinspaceAgentBilling } from '@extras/agents/rinspace/RinspaceAgentBilling';

const emptyBill: RinspaceAgentBilling = {
	model: 'model', providerPriceVersion: 'price', currency: 'CNY',
	pendingTurns: 0, turns: [], providerCostCnyMicros: '0',
	goodnessChargedSg: '0', goodnessRevenueCnyMicros: '0', profitCnyMicros: '0',
};

it('hides an empty bill and shows pending work without zero charge claims', () => {
	const view = render(<RinspaceAgentBill bill={emptyBill} stale={false} />);
	expect(screen.queryByText(/已结算/)).not.toBeInTheDocument();
	view.rerender(<RinspaceAgentBill bill={{ ...emptyBill, pendingTurns: 1 }} stale={false} />);
	expect(screen.getByText('1 回合正在结算')).toBeInTheDocument();
	expect(screen.queryByText(/已结算 0/)).not.toBeInTheDocument();
});
