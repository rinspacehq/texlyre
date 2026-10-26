// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
	copyFile,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} = require('node:fs/promises');
const path = require('node:path');

const releaseConfig = require('../../config/rinspace/release.json');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function checkedRelative(value) {
	assert.equal(typeof value, 'string');
	assert.ok(value.length > 0 && value.length < 512, 'invalid release path');
	assert.equal(
		value,
		value.replaceAll('\\', '/'),
		'release path uses backslashes',
	);
	assert.ok(!path.posix.isAbsolute(value), 'release path must be relative');
	assert.ok(
		!value.split('/').includes('..'),
		'release path traversal rejected',
	);
	return value;
}

function validateReleaseConfig(config = releaseConfig) {
	assert.equal(config.schema, 'rinspace-texlyre-release/v1');
	assert.match(config.releaseTag, /^v[0-9]+\.[0-9]+\.[0-9]+-rinspace\.[0-9]+$/);
	assert.equal(config.version, config.releaseTag.substring(1));
	assert.equal(config.canonicalRepository, 'rinspacehq/texlyre');
	assert.equal(config.routeBase, '/editor/');
	assert.equal(config.license, 'AGPL-3.0-or-later');
	assert.equal(config.productionAccepted, true);
	assert.equal(config.source.commitBoundAtBuild, true);
	assert.equal(config.source.sourceArchiveRequired, true);
	assert.equal(config.artifact.archiveRoot, 'editor');
	assert.equal(config.artifact.includesDependencyNotices, true);
	assert.equal(config.artifact.includesExternalNotices, true);
	checkedRelative(config.artifact.filename);
	assert.equal(config.releaseNotes.sourcePath, 'docs/rinspace/RELEASE_V19.md');
	checkedRelative(config.releaseNotes.sourcePath);
	assert.equal(
		config.releaseNotes.artifactFilename,
		`MIGRATION_AND_ROLLBACK-${config.releaseTag}.md`,
	);
	checkedRelative(config.releaseNotes.artifactFilename);
	assert.match(
		config.texliveRuntime.runtimeId,
		/^texlive-[0-9]{4}-rinspace\.[0-9]+$/,
	);
	assert.equal(config.texliveRuntime.endpointBasePath, '/editor/texlive/2026');
	assert.equal(
		config.texliveRuntime.sourceReview,
		'config/rinspace/texlive-full-runtime.review.json',
	);
	assert.equal(
		config.texliveRuntime.packFilename,
		`${config.texliveRuntime.runtimeId}.pack`,
	);
	assert.equal(
		config.texliveRuntime.indexFilename,
		`${config.texliveRuntime.runtimeId}.index.json`,
	);
	assert.equal(
		config.texliveRuntime.manifestFilename,
		`${config.texliveRuntime.runtimeId}.manifest.json`,
	);
	assert.equal(config.texliveRuntime.maximumPackBytes, 2 * 1024 * 1024 * 1024);

	const outputs = new Set();
	for (const notice of config.externalNotices) {
		assert.match(notice.id, /^[a-z0-9-]+$/);
		checkedRelative(notice.sourcePath);
		checkedRelative(notice.artifactPath);
		assert.ok(
			!outputs.has(notice.artifactPath),
			'duplicate release notice path',
		);
		outputs.add(notice.artifactPath);
		assert.ok(
			Number.isSafeInteger(notice.size) &&
				notice.size > 0 &&
				notice.size < 1024 * 1024,
		);
		assert.match(notice.sha256, /^[0-9a-f]{64}$/);
		const source = new URL(notice.sourceUrl);
		assert.equal(source.protocol, 'https:');
		assert.equal(source.hostname, 'raw.githubusercontent.com');
		assert.equal(source.username, '');
		assert.equal(source.password, '');
		assert.equal(source.port, '');
		const segments = source.pathname.split('/').filter(Boolean);
		assert.ok(segments.length >= 4, 'notice URL lacks repository and commit');
		assert.match(
			segments[2],
			/^[0-9a-f]{40}$/,
			'notice URL must bind a full commit',
		);
	}
	return config;
}

async function fetchNotice(notice, request = fetch) {
	let response;
	let lastError;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			response = await request(notice.sourceUrl, {
				credentials: 'omit',
				redirect: 'error',
				signal: AbortSignal.timeout(60_000),
			});
			break;
		} catch (error) {
			lastError = error;
			if (attempt < 3)
				await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
		}
	}
	if (!response) throw lastError;
	assert.equal(
		response.status,
		200,
		`notice download failed: ${notice.artifactPath}`,
	);
	const bytes = Buffer.from(await response.arrayBuffer());
	assert.equal(
		bytes.length,
		notice.size,
		`notice size mismatch: ${notice.artifactPath}`,
	);
	assert.equal(
		sha256(bytes),
		notice.sha256,
		`notice digest mismatch: ${notice.artifactPath}`,
	);
	return bytes;
}

async function assembleExternalNotices(
	distRoot,
	config = releaseConfig,
	request = fetch,
) {
	validateReleaseConfig(config);
	const noticeRoot = path.join(distRoot, 'notices');
	await rm(noticeRoot, { recursive: true, force: true });
	const records = [];

	for (const notice of config.externalNotices) {
		const bytes = await fetchNotice(notice, request);
		const relative = checkedRelative(notice.artifactPath);
		const target = path.join(distRoot, relative);
		assert.ok(target.startsWith(`${path.resolve(distRoot)}${path.sep}`));
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
		records.push({
			id: notice.id,
			path: relative,
			sourceUrl: notice.sourceUrl,
			size: bytes.length,
			sha256: notice.sha256,
		});
	}

	const root = path.resolve(__dirname, '../..');
	await mkdir(path.join(noticeRoot, 'texlyre'), { recursive: true });
	for (const [source, target] of [
		['LICENSE', 'LICENSE'],
		['docs/rinspace/SOURCE_AND_LICENSE.md', 'SOURCE_AND_LICENSE.md'],
	]) {
		await copyFile(
			path.join(root, source),
			path.join(noticeRoot, 'texlyre', target),
		);
	}

	const index = {
		schema: 'rinspace-texlyre-external-notices/v1',
		releaseTag: config.releaseTag,
		files: records,
	};
	const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
	await writeFile(path.join(noticeRoot, 'external/index.json'), indexBytes, {
		mode: 0o644,
	});
	return { ...index, sha256: sha256(indexBytes) };
}

async function inventory(root, relative = '') {
	const entries = await readdir(path.join(root, relative), {
		withFileTypes: true,
	});
	const result = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const item = path.posix.join(
			relative.replaceAll(path.sep, '/'),
			entry.name,
		);
		if (item === 'rinspace-release.json') continue;
		if (entry.isDirectory()) {
			result.push(...(await inventory(root, item)));
			continue;
		}
		assert.ok(entry.isFile(), `release tree contains a non-file: ${item}`);
		const bytes = await readFile(path.join(root, item));
		const metadata = await stat(path.join(root, item));
		result.push({
			path: item,
			mode: metadata.mode & 0o111 ? '100755' : '100644',
			size: bytes.length,
			sha256: sha256(bytes),
		});
	}
	return result;
}

function git(root, args) {
	return execFileSync('git', ['-C', root, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			PATH: process.env.PATH,
			GIT_CONFIG_NOSYSTEM: '1',
			GIT_CONFIG_GLOBAL: '/dev/null',
			GIT_TERMINAL_PROMPT: '0',
		},
	}).trim();
}

async function digestFile(filename) {
	const bytes = await readFile(filename);
	return {
		filename: path.basename(filename),
		size: bytes.length,
		sha256: sha256(bytes),
	};
}

function packagePurl(name, version) {
	const locator = name.startsWith('@')
		? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
		: encodeURIComponent(name);
	return `pkg:npm/${locator}@${encodeURIComponent(version)}`;
}

function createSbom({ config, artifact, dependencies, created }) {
	assert.match(created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
	assert.equal(
		dependencies.schema,
		'rinspace-production-dependency-notices/v1',
	);
	assert.ok(
		Array.isArray(dependencies.packages) && dependencies.packages.length > 0,
	);
	const applicationId = 'SPDXRef-Package-texlyre';
	const packages = [
		{
			name: 'texlyre',
			SPDXID: applicationId,
			versionInfo: config.version,
			downloadLocation: `https://github.com/${config.canonicalRepository}/releases/download/${config.releaseTag}/${artifact.filename}`,
			filesAnalyzed: false,
			licenseConcluded: config.license,
			licenseDeclared: config.license,
			checksums: [{ algorithm: 'SHA256', checksumValue: artifact.sha256 }],
			externalRefs: [
				{
					referenceCategory: 'PACKAGE-MANAGER',
					referenceType: 'purl',
					referenceLocator: `pkg:generic/texlyre@${encodeURIComponent(config.version)}`,
				},
			],
		},
	];
	const relationships = [
		{
			spdxElementId: 'SPDXRef-DOCUMENT',
			relationshipType: 'DESCRIBES',
			relatedSpdxElement: applicationId,
		},
	];
	const seen = new Set();
	for (const dependency of [...dependencies.packages].sort((left, right) =>
		`${left.name}@${left.version}`.localeCompare(
			`${right.name}@${right.version}`,
		),
	)) {
		assert.equal(typeof dependency.name, 'string');
		assert.equal(typeof dependency.version, 'string');
		const identity = `${dependency.name}@${dependency.version}`;
		assert.ok(!seen.has(identity), `duplicate dependency in SBOM: ${identity}`);
		seen.add(identity);
		const dependencyId = `SPDXRef-Package-${sha256(Buffer.from(identity)).slice(0, 20)}`;
		packages.push({
			name: dependency.name,
			SPDXID: dependencyId,
			versionInfo: dependency.version,
			downloadLocation: 'NOASSERTION',
			filesAnalyzed: false,
			licenseConcluded: 'NOASSERTION',
			licenseDeclared: 'NOASSERTION',
			externalRefs: [
				{
					referenceCategory: 'PACKAGE-MANAGER',
					referenceType: 'purl',
					referenceLocator: packagePurl(dependency.name, dependency.version),
				},
			],
		});
		relationships.push({
			spdxElementId: applicationId,
			relationshipType: 'DEPENDS_ON',
			relatedSpdxElement: dependencyId,
		});
	}
	return {
		spdxVersion: 'SPDX-2.3',
		dataLicense: 'CC0-1.0',
		SPDXID: 'SPDXRef-DOCUMENT',
		name: `texlyre-${config.version}`,
		documentNamespace: `https://github.com/${config.canonicalRepository}/releases/tag/${config.releaseTag}/sbom`,
		creationInfo: { created, creators: ['Tool: rinspace-texlyre-release/1'] },
		packages,
		relationships,
	};
}

function createProvenance({
	config,
	commit,
	tree,
	artifact,
	source,
	runId,
	runAttempt,
}) {
	assert.match(commit, /^[0-9a-f]{40}$/);
	assert.match(tree, /^[0-9a-f]{40}$/);
	if (runId !== undefined) assert.match(runId, /^[1-9][0-9]*$/);
	if (runAttempt !== undefined) assert.match(runAttempt, /^[1-9][0-9]*$/);
	const invocationId = runId
		? `https://github.com/${config.canonicalRepository}/actions/runs/${runId}/attempts/${runAttempt || '1'}`
		: `urn:local:rinspace-texlyre-release:${commit}`;
	return {
		_type: 'https://in-toto.io/Statement/v1',
		subject: [artifact, source].map((item) => ({
			name: item.filename,
			digest: { sha256: item.sha256 },
		})),
		predicateType: 'https://slsa.dev/provenance/v1',
		predicate: {
			buildDefinition: {
				buildType: `https://github.com/${config.canonicalRepository}/rinspace-texlyre-release/v1`,
				externalParameters: {
					tag: config.releaseTag,
					routeBase: config.routeBase,
				},
				internalParameters: {
					repository: config.canonicalRepository,
					commit,
					tree,
				},
				resolvedDependencies: [
					{
						uri: `git+${config.source.repositoryUrl}@${commit}`,
						digest: { gitCommit: commit, gitTree: tree },
					},
				],
			},
			runDetails: {
				builder: {
					id: runId
						? `https://github.com/${config.canonicalRepository}/actions/runs/${runId}`
						: 'urn:rinspace:builder:local-validation',
				},
				metadata: { invocationId },
			},
		},
	};
}

async function assembleRelease({
	root,
	distRoot,
	outputRoot,
	tag,
	request = fetch,
}) {
	const config = validateReleaseConfig();
	assert.equal(tag, config.releaseTag, 'release tag is not the reviewed tag');
	const commit = git(root, ['rev-parse', 'HEAD']);
	const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
	assert.match(commit, /^[0-9a-f]{40}$/);
	assert.equal(
		git(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
		'main',
		'release must build public main',
	);

	const sourceCandidate = JSON.parse(
		await readFile(path.join(distRoot, 'rinspace-source-candidate.json')),
	);
	assert.equal(sourceCandidate.cleanCommit, true);
	assert.equal(sourceCandidate.correspondingSourceAvailableAtSourceUrl, true);
	assert.equal(sourceCandidate.baseCommit, commit);
	assert.equal(sourceCandidate.baseTree, tree);
	assert.equal(sourceCandidate.changedPaths, 0);

	const externalNotices = await assembleExternalNotices(
		distRoot,
		config,
		request,
	);
	const files = await inventory(distRoot);
	assert.ok(files.length > 100, 'release tree is unexpectedly small');
	const contentInventorySha256 = sha256(
		Buffer.from(`${JSON.stringify(files)}\n`),
	);
	const internalManifest = {
		schema: 'rinspace-texlyre-static-tree/v1',
		releaseTag: tag,
		routeBase: config.routeBase,
		source: { repository: config.canonicalRepository, commit, tree },
		content: {
			files: files.length,
			bytes: files.reduce((sum, file) => sum + file.size, 0),
			inventorySha256: contentInventorySha256,
		},
		externalNotices: {
			files: externalNotices.files.length,
			indexSha256: externalNotices.sha256,
		},
	};
	await writeFile(
		path.join(distRoot, 'rinspace-release.json'),
		`${JSON.stringify(internalManifest, null, 2)}\n`,
		{ mode: 0o644 },
	);

	await rm(outputRoot, { recursive: true, force: true });
	await mkdir(outputRoot, { recursive: true });
	const artifact = path.join(outputRoot, config.artifact.filename);
	execFileSync(
		'tar',
		[
			'--sort=name',
			'--mtime=UTC 1970-01-01',
			'--owner=0',
			'--group=0',
			'--numeric-owner',
			'--transform=s,^\\./,editor/,',
			'--transform=s,^\\.$,editor,',
			'-C',
			distRoot,
			'-czf',
			artifact,
			'.',
		],
		{ stdio: 'inherit' },
	);

	const sourceName = `texlyre-source-${commit}.tar.gz`;
	const sourceArchive = path.join(outputRoot, sourceName);
	execFileSync(
		'git',
		[
			'-C',
			root,
			'archive',
			'--format=tar.gz',
			`--prefix=texlyre-source-${commit}/`,
			'--output',
			sourceArchive,
			commit,
		],
		{ stdio: 'inherit' },
	);
	const artifactRecord = await digestFile(artifact);
	const sourceRecord = await digestFile(sourceArchive);
	await writeFile(
		`${artifact}.sha256`,
		`${artifactRecord.sha256}  ${artifactRecord.filename}\n`,
		{ mode: 0o644 },
	);
	await writeFile(
		`${sourceArchive}.sha256`,
		`${sourceRecord.sha256}  ${sourceRecord.filename}\n`,
		{ mode: 0o644 },
	);

	const dependencyNoticesBytes = await readFile(
		path.join(distRoot, 'rinspace-dependency-notices.json'),
	);
	const releaseManifest = {
		schema: 'rinspace-texlyre-release-artifacts/v1',
		releaseTag: tag,
		version: config.version,
		routeBase: config.routeBase,
		license: config.license,
		source: {
			repository: config.canonicalRepository,
			url: `${config.source.repositoryUrl}/commit/${commit}`,
			commit,
			tree,
			candidateSha256: sourceCandidate.candidateSha256,
			archive: sourceRecord,
		},
		artifact: artifactRecord,
		content: internalManifest.content,
		externalNotices: internalManifest.externalNotices,
		dependencyNoticesSha256: sha256(dependencyNoticesBytes),
	};
	const manifestName = `texlyre-release-${tag}.json`;
	await writeFile(
		path.join(outputRoot, manifestName),
		`${JSON.stringify(releaseManifest, null, 2)}\n`,
		{ mode: 0o644 },
	);

	const created = new Date(
		git(root, ['show', '-s', '--format=%cI', commit]),
	).toISOString();
	const sbom = createSbom({
		config,
		artifact: artifactRecord,
		dependencies: JSON.parse(dependencyNoticesBytes),
		created,
	});
	await writeFile(
		path.join(outputRoot, 'sbom.spdx.json'),
		`${JSON.stringify(sbom, null, 2)}\n`,
		{ mode: 0o644 },
	);
	const provenance = createProvenance({
		config,
		commit,
		tree,
		artifact: artifactRecord,
		source: sourceRecord,
		runId: process.env.GITHUB_RUN_ID,
		runAttempt: process.env.GITHUB_RUN_ATTEMPT,
	});
	await writeFile(
		path.join(outputRoot, 'provenance.intoto.json'),
		`${JSON.stringify(provenance, null, 2)}\n`,
		{ mode: 0o644 },
	);
	await copyFile(
		path.join(root, checkedRelative(config.releaseNotes.sourcePath)),
		path.join(
			outputRoot,
			checkedRelative(config.releaseNotes.artifactFilename),
		),
	);
	return releaseManifest;
}

function argument(name) {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

module.exports = {
	assembleExternalNotices,
	assembleRelease,
	createProvenance,
	createSbom,
	fetchNotice,
	inventory,
	validateReleaseConfig,
};

if (require.main === module) {
	const root = path.resolve(__dirname, '../..');
	const tag = argument('--tag');
	const outputRoot = path.resolve(
		argument('--output') || path.join(root, '.artifacts/texlyre-release'),
	);
	assembleRelease({ root, distRoot: path.join(root, 'dist'), outputRoot, tag })
		.then((manifest) => console.log(JSON.stringify(manifest, null, 2)))
		.catch((error) => {
			console.error(error.stack || error.message);
			process.exitCode = 1;
		});
}
