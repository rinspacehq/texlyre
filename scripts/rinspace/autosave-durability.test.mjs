// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let generation = 0;
async function service() {
	const source = readFileSync(new URL('../../src/services/AutoSaveService.ts', import.meta.url), 'utf8');
	assert(source.includes("from 'lodash/debounce'"));
	assert(source.includes("import { createNamedLogger } from '@/logging';"));
	const code = stripTypeScriptTypes(source, { mode: 'strip' })
		.replace("from 'lodash/debounce'", `from ${JSON.stringify(pathToFileURL(require.resolve('lodash/debounce')).href)}`)
		.replace("import { createNamedLogger } from '@/logging';", 'const createNamedLogger = () => ({ info() {}, error() {}, warn() {} });');
	return (await import(`data:text/javascript;base64,${Buffer.from(code + `\n// test instance ${generation++}`).toString('base64')}`)).autoSaveService;
}
const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('saves the newest captured contents after the idle delay', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	let content = 'first';
	const changed = saver.createAutoSaver('main', () => content, { enabled: true, delay: 1000, onSave: async (id, text) => { saved.push([id, text]); } });
	changed(); t.mock.timers.tick(500); content = 'latest 中文 $x^2$'; changed();
	t.mock.timers.tick(999); await drain(); assert.equal(saved.length, 0);
	t.mock.timers.tick(1); await saver.flushPendingSaves(); assert.deepEqual(saved, [['main', content]]);
});

test('continuous typing receives a bounded checkpoint instead of waiting forever', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	let content = '';
	const changed = saver.createAutoSaver('main', () => content, { enabled: true, delay: 1000, onSave: async (_id, text) => { saved.push(text); } });
	for (let i = 0; i < 80; i++) { content += `中文 English $x_${i}$\n`; changed(); t.mock.timers.tick(100); await drain(); }
	assert(saved.length >= 1, 'Typing continuously for eight seconds must not leave every change only in memory');
	await saver.flushPendingSaves(); assert.equal(saved.at(-1), content);
});

test('disposing a file flushes its captured draft, never the next file view', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	let viewText = 'unsaved main.tex 中文';
	const changed = saver.createAutoSaver('main', () => viewText, { enabled: true, delay: 1000, onSave: async (id, text) => { saved.push([id, text]); } });
	changed(); viewText = 'different README.md view'; saver.clearAutoSaver('main');
	await saver.flushPendingSaves(); assert.deepEqual(saved, [['main', 'unsaved main.tex 中文']]);
});

test('flush waits for a disposed file write that is still in flight', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(); let release;
	const blocked = new Promise(resolve => { release = resolve; });
	const changed = saver.createAutoSaver('main', () => 'pending', { enabled: true, delay: 1000, onSave: async () => blocked });
	changed(); saver.clearAutoSaver('main'); let finished = false;
	const flushing = saver.flushPendingSaves().then(() => { finished = true; });
	await drain(); assert.equal(finished, false, 'Navigation must await the old file write, not just the callback map');
	release(); await flushing; assert.equal(finished, true);
});

test('writes to the same file remain ordered across slow saves', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), started = [], persisted = [];
	let content = 'older', release;
	const blocked = new Promise(resolve => { release = resolve; });
	const changed = saver.createAutoSaver('main', () => content, { enabled: true, delay: 10, onSave: async (_id, text) => { started.push(text); if (text === 'older') await blocked; persisted.push(text); } });
	changed(); t.mock.timers.tick(10); await drain(); content = 'newer'; changed(); t.mock.timers.tick(10); await drain();
	assert.deepEqual(started, ['older'], 'A slow old write must not finish after and overwrite a newer write');
	release(); await saver.flushPendingSaves(); assert.deepEqual(persisted, ['older', 'newer']);
});

test('an intentionally empty draft is saved on disposal', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const changed = saver.createAutoSaver('main', () => '', { enabled: true, delay: 1000, onSave: async (_id, text) => { saved.push(text); } });
	changed(); saver.clearAutoSaver('main'); await saver.flushPendingSaves(); assert.deepEqual(saved, ['']);
});

test('a storage failure rejects flush and reaches the error callback', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), errors = [], failure = new Error('storage quota exceeded');
	const changed = saver.createAutoSaver('main', () => 'retain me', { enabled: true, delay: 1000, onSave: async () => { throw failure; }, onError: error => errors.push(error) });
	changed(); await assert.rejects(saver.flushPendingSaves(), /storage quota exceeded/); assert.deepEqual(errors, [failure]);
});

test('an explicitly disabled auto-saver does not schedule writes', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const changed = saver.createAutoSaver('main', () => 'manual mode', { enabled: false, delay: 10, onSave: async (_id, text) => { saved.push(text); } });
	changed(); t.mock.timers.tick(10000); await saver.flushPendingSaves(); assert.deepEqual(saved, []);
});

test('manual save supersedes an older debounce without replaying stale text', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const persist = async (_id, text) => { saved.push(text); };
	const changed = saver.createAutoSaver('main', () => 'older', { enabled: true, delay: 1000, onSave: persist });
	changed(); await saver.saveNow('main', 'newer manual 中文', persist);
	t.mock.timers.tick(10000); await saver.flushPendingSaves(); assert.deepEqual(saved, ['newer manual 中文']);
});

test('manual save waits behind an already running auto-save', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), started = [], persisted = []; let release;
	const blocked = new Promise(resolve => { release = resolve; });
	const persist = async (_id, text) => { started.push(text); if (text === 'older') await blocked; persisted.push(text); };
	const changed = saver.createAutoSaver('main', () => 'older', { enabled: true, delay: 10, onSave: persist });
	changed(); t.mock.timers.tick(10); await drain(); const manual = saver.saveNow('main', 'latest manual', persist);
	await drain(); assert.deepEqual(started, ['older']); release(); await manual;
	assert.deepEqual(persisted, ['older', 'latest manual']);
});

test('failed disposed drafts can be retried without re-reading a destroyed view', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = []; let failed = true;
	const changed = saver.createAutoSaver('main', () => 'retained 中文', { enabled: true, delay: 1000, onSave: async (_id, text) => { if (failed) throw new Error('quota'); saved.push(text); }, onError: () => {} });
	changed(); saver.clearAutoSaver('main'); await assert.rejects(saver.flushPendingSaves(), /quota/);
	failed = false; await saver.flushPendingSaves(); assert.deepEqual(saved, ['retained 中文']);
});

test('a disposed trigger cannot later overwrite a replacement editor', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const persist = async (_id, text) => { saved.push(text); };
	const oldTrigger = saver.createAutoSaver('main', () => 'stale old view', { enabled: true, delay: 1000, onSave: persist });
	saver.clearAutoSaver('main'); await saver.saveNow('main', 'new editor contents', persist);
	oldTrigger(); t.mock.timers.tick(2000); await saver.flushPendingSaves(); assert.deepEqual(saved, ['new editor contents']);
});

test('a replacement auto-saver preserves the final old snapshot before the new one', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const persist = async (_id, text) => { saved.push(text); };
	const old = saver.createAutoSaver('main', () => 'old view final draft', { enabled: true, delay: 1000, onSave: persist });
	old();
	const next = saver.createAutoSaver('main', () => 'new view current draft', { enabled: true, delay: 1000, onSave: persist });
	next(); await saver.flushPendingSaves();
	assert.deepEqual(saved, ['old view final draft', 'new view current draft']);
});

test('a newer pending draft supersedes a failed older snapshot during retry', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = []; let content = 'older', unavailable = true;
	const changed = saver.createAutoSaver('main', () => content, { enabled: true, delay: 1000, onSave: async (_id, text) => { if (unavailable) throw new Error('quota'); saved.push(text); }, onError: () => {} });
	changed(); await assert.rejects(saver.flushPendingSaves(), /quota/);
	unavailable = false; content = 'newer recovered 中文 $x^2$'; changed();
	await saver.flushPendingSaves(); assert.deepEqual(saved, [content]);
});

test('manual saving remains available when automatic saving is disabled', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = [];
	const persist = async (_id, text) => { saved.push(text); };
	const changed = saver.createAutoSaver('main', () => 'disabled automatic text', { enabled: false, delay: 1000, onSave: persist });
	changed(); await saver.saveNow('main', 'explicit manual text', persist);
	t.mock.timers.tick(10000); await saver.flushPendingSaves(); assert.deepEqual(saved, ['explicit manual text']);
});

test('independent file saves cannot cancel each other and flush awaits both', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
	const saver = await service(), saved = []; let release;
	const blocked = new Promise(resolve => { release = resolve; });
	const main = saver.createAutoSaver('main', () => 'main 中文 $x^2$', { enabled: true, delay: 1000, onSave: async (id, text) => { await blocked; saved.push([id, text]); } });
	const intro = saver.createAutoSaver('intro', () => 'intro English \\[x+y\\]', { enabled: true, delay: 1000, onSave: async (id, text) => { saved.push([id, text]); } });
	main(); intro(); saver.clearAutoSaver('main'); saver.clearAutoSaver('intro');
	let finished = false;
	const flushing = saver.flushPendingSaves().then(() => { finished = true; });
	await drain(); assert.equal(finished, false); assert.deepEqual(saved, [['intro', 'intro English \\[x+y\\]']]);
	release(); await flushing; assert.equal(finished, true);
	assert.deepEqual(saved, [['intro', 'intro English \\[x+y\\]'], ['main', 'main 中文 $x^2$']]);
});
