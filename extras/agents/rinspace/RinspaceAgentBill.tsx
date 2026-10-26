// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatAgentCny, type RinspaceAgentBilling } from './RinspaceAgentBilling';

export function RinspaceAgentBill({ bill, stale }: { bill: RinspaceAgentBilling | null; stale: boolean }) {
	if (!bill) return <p className='rinspace-agent-billing'>实际扣费待确认</p>;
	return <details className='rinspace-agent-billing'>
		<summary>已结算 {bill.goodnessChargedSg} 善功 · {bill.turns.length} 回合{stale ? ' · 更新失败，显示上次确认账单' : ''}</summary>
		<p>{bill.model} · {bill.providerPriceVersion}</p>
		<p>提供商成本 {formatAgentCny(bill.providerCostCnyMicros)} · 善功收入 {formatAgentCny(bill.goodnessRevenueCnyMicros)} · 利润 {formatAgentCny(bill.profitCnyMicros)}</p>
		{bill.pendingTurns > 0 && <p>{bill.pendingTurns} 回合尚未结算，未计入以上金额</p>}
		{bill.turns.map((turn) => <details key={turn.operationId}>
			<summary>第 {turn.iteration} 回合 · {turn.goodnessChargedSg} 善功</summary>
			<p>输入 {turn.inputTokens} · 缓存输入 {turn.cachedInputTokens} · 输出 {turn.outputTokens} token</p>
			<p>成本 {formatAgentCny(turn.providerCostCnyMicros)} · 收入 {formatAgentCny(turn.goodnessRevenueCnyMicros)} · 利润 {formatAgentCny(turn.profitCnyMicros)}</p>
			<p>回执 {turn.requestId}</p><p>SHA-256 {turn.receiptSha256}</p>
		</details>)}
	</details>;
}
