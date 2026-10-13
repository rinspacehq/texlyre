// SPDX-License-Identifier: AGPL-3.0-or-later
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { lstat, readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function git(root, args) {
	return execFileSync('git', ['-C', root, ...args], {
		encoding: args.includes('-z') ? 'buffer' : 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			PATH: process.env.PATH,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_TERMINAL_PROMPT: '0',
			GIT_NO_LAZY_FETCH: '1',
		},
	});
}

function nulPaths(bytes) {
	return bytes
		.toString('utf8')
		.split('\0')
		.filter(Boolean);
}

async function candidateEntry(root, relativePath) {
	const absolutePath = path.join(root, relativePath);
	try {
		const metadata = await lstat(absolutePath);
		const bytes = await readFile(absolutePath);
		return {
			path: relativePath,
			state: metadata.isSymbolicLink() ? 'symlink' : 'file',
			mode: metadata.mode & 0o111 ? '100755' : '100644',
			size: bytes.length,
			sha256: sha256(bytes),
		};
	} catch (error) {
		if (error.code === 'ENOENT') return { path: relativePath, state: 'deleted' };
		throw error;
	}
}

async function collectSourceCandidate(root) {
	const changed = nulPaths(git(root, ['diff', '--name-only', '--no-renames', '-z', 'HEAD']));
	const untracked = nulPaths(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
	const paths = [...new Set([...changed, ...untracked])].sort();
	const entries = [];
	for (const relativePath of paths) entries.push(await candidateEntry(root, relativePath));

	const baseCommit = git(root, ['rev-parse', 'HEAD']).trim();
	const baseTree = git(root, ['rev-parse', 'HEAD^{tree}']).trim();
	const candidate = { baseCommit, baseTree, entries };
	return {
		schema: 'rinspace-source-candidate/v1',
		repository: 'rinspacehq/texlyre',
		sourceUrl: 'https://github.com/rinspacehq/texlyre',
		stage: 'source-development',
		baseCommit,
		baseTree,
		cleanCommit: entries.length === 0,
		correspondingSourceAvailableAtSourceUrl: entries.length === 0,
		changedPaths: entries.length,
		candidateSha256: sha256(`${JSON.stringify(candidate)}\n`),
		entries,
	};
}

async function writeSourceCandidate(root) {
	const manifest = await collectSourceCandidate(root);
	await writeFile(
		path.join(root, 'public/rinspace-source-candidate.json'),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	return manifest;
}

module.exports = { collectSourceCandidate, writeSourceCandidate };

if (require.main === module) {
	const root = path.resolve(__dirname, '../..');
	writeSourceCandidate(root)
		.then((manifest) => console.log(JSON.stringify({
			baseCommit: manifest.baseCommit,
			changedPaths: manifest.changedPaths,
			candidateSha256: manifest.candidateSha256,
			cleanCommit: manifest.cleanCommit,
		})))
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
