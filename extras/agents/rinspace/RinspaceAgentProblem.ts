// SPDX-License-Identifier: AGPL-3.0-or-later

type AgentOperation = 'config' | 'create' | 'recover' | 'turn' | 'abort';

const BODY_LIMIT = 4096;

const messages: Partial<Record<string, string>> = {
	UNAUTHENTICATED: '登录状态已失效，请重新登录。',
	PERMISSION_DENIED: '当前账号没有执行此操作的权限。',
	POLICY_LIMIT: '当前账号已达到琳的使用限制，请稍后再试。',
	DEPENDENCY_UNAVAILABLE: '琳暂时不可用，请稍后再试。',
	IDEMPOTENCY_CONFLICT: '任务状态已变化，请刷新后重试。',
};

async function publicProblemCode(response: Response): Promise<string> {
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > BODY_LIMIT) return '';
	let raw: string;
	try {
		raw = await response.text();
	} catch {
		return '';
	}
	if (new TextEncoder().encode(raw).byteLength > BODY_LIMIT) return '';
	try {
		const value = JSON.parse(raw) as { code?: unknown };
		return typeof value.code === 'string' && /^[A-Z_]{2,64}$/.test(value.code)
			? value.code
			: '';
	} catch {
		return '';
	}
}

export async function rinspaceAgentProblem(
	response: Response,
	operation: AgentOperation,
): Promise<Error> {
	const code = await publicProblemCode(response);
	if (
		operation === 'create' &&
		(code === 'NOT_FOUND' || response.status === 404)
	) {
		return new Error('项目版本已变化，请同步仓库后重试。');
	}
	if (
		operation === 'recover' &&
		(code === 'NOT_FOUND' || response.status === 404)
	) {
		return new Error('上一项任务已失效，请开始新任务。');
	}
	const message = messages[code];
	if (message) return new Error(message);
	const labels: Record<AgentOperation, string> = {
		config: '琳配置加载失败',
		create: '琳任务创建失败',
		recover: '琳任务恢复失败',
		turn: '琳任务执行失败',
		abort: '琳任务停止失败',
	};
	return new Error(`${labels[operation]} (${response.status})`);
}
