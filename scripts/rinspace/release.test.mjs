// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import releaseModule from './assemble-release.cjs';
import config from '../../config/rinspace/release.json' with { type: 'json' };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('formal release config binds route, source, artifact and complete notice files', () => {
	releaseModule.validateReleaseConfig(config);
	assert.equal(config.routeBase, '/editor/');
	assert.equal(config.productionAccepted, true);
	assert.equal(config.releaseTag, 'v0.13.2-rinspace.24');
	assert.equal(config.releaseNotes.sourcePath, 'docs/rinspace/RELEASE_V24.md');
	assert.equal(
		config.releaseNotes.artifactFilename,
		'MIGRATION_AND_ROLLBACK-v0.13.2-rinspace.24.md',
	);
	assert.equal(config.texliveRuntime.runtimeId, 'texlive-2026-rinspace.1');
	assert.equal(config.texliveRuntime.endpointBasePath, '/editor/texlive/2026');
	assert.ok(config.externalNotices.length >= 30);
	assert.ok(
		config.externalNotices.some((entry) =>
			entry.artifactPath.endsWith('/THIRD_PARTY.md'),
		),
	);
	assert.ok(
		config.externalNotices.some((entry) =>
			entry.artifactPath.includes('/LICENSES/'),
		),
	);
});

test('release work uses the protected runner while public checks use hosted runners', async () => {
	const [releaseWorkflow, testWorkflow] = await Promise.all([
		readFile(
			new URL('../../.github/workflows/release.yml', import.meta.url),
			'utf8',
		),
		readFile(
			new URL('../../.github/workflows/test.yml', import.meta.url),
			'utf8',
		),
	]);
	assert.match(
		releaseWorkflow,
		/runs-on: \[rinspace-release-build, rinspace-public-texlyre-isolated\]/,
	);
	assert.match(
		releaseWorkflow,
		/RINSPACE_ASSET_ARCHIVE_CACHE_DIR: \/repositories\/data\/texlyre-asset-cache/,
	);
	assert.match(releaseWorkflow, /build-texlive-runtime-stream\.cjs/);
	assert.match(releaseWorkflow, /reuse_texlive_runtime:[\s\S]*?default: true/);
	assert.match(releaseWorkflow, /prepare-reviewed-texlive-runtime\.cjs/);
	assert.match(
		releaseWorkflow,
		/prepare-reviewed-texlive-runtime\.cjs --verify-only/,
	);
	assert.match(
		releaseWorkflow,
		/Assemble exact source, notices and static artifacts[\s\S]*?NODE_USE_ENV_PROXY: '1'/,
	);
	assert.match(
		releaseWorkflow,
		/if \[\[ "\$REUSE_TEXLIVE_RUNTIME" == true \]\]; then[\s\S]*?texlive-runtime-reference\.json/,
	);
	assert.match(
		releaseWorkflow,
		/else\s+runtime_dir="\$RUNNER_TEMP\/texlyre-texlive-runtime"/,
	);
	for (const required of [
		'SHA256SUMS',
		'sbom.spdx.json',
		'provenance.intoto.json',
		'releaseNotes.artifactFilename',
		'--notes-file "$output/$release_notes"',
	])
		assert.ok(releaseWorkflow.includes(required), required);
	assert.match(releaseWorkflow, /sha256sum -c SHA256SUMS/);
	assert.match(
		releaseWorkflow,
		/if: \$\{\{ !inputs\.reuse_texlive_runtime \}\}/,
	);
	assert.doesNotMatch(
		releaseWorkflow,
		/--output "\$source_dir\/texmf-dist\.tar\.zst"/,
	);
	const assemblyStep = releaseWorkflow.slice(
		releaseWorkflow.indexOf(
			'Assemble exact source, notices and static artifacts',
		),
		releaseWorkflow.indexOf('Publish immutable public release'),
	);
	const outputDirectoryChange = assemblyStep.indexOf('cd "$output"');
	assert.ok(outputDirectoryChange > 0);
	assert.ok(
		!assemblyStep
			.slice(outputDirectoryChange)
			.includes("require('./config/rinspace/release.json')"),
	);
	assert.match(testWorkflow, /runs-on: ubuntu-latest/);
	assert.doesNotMatch(testWorkflow, /runs-on:.*rinspace-release-build/);
});

test('release metadata binds the static bytes, dependencies, source and workflow invocation', () => {
	const digest = 'a'.repeat(64);
	const artifact = {
		filename: config.artifact.filename,
		size: 123,
		sha256: digest,
	};
	const dependencies = {
		schema: 'rinspace-production-dependency-notices/v1',
		packages: [
			{ name: 'react', version: '19.2.0' },
			{ name: '@rinspacehq/cline-embed', version: '0.1.0-rinspace.3' },
		],
	};
	const sbom = releaseModule.createSbom({
		config,
		artifact,
		dependencies,
		created: '2026-10-26T00:00:00.000Z',
	});
	assert.equal(sbom.spdxVersion, 'SPDX-2.3');
	assert.equal(
		sbom.documentNamespace,
		`https://github.com/rinspacehq/texlyre/releases/tag/${config.releaseTag}/sbom`,
	);
	assert.equal(sbom.packages.length, 3);
	assert.equal(sbom.packages[0].checksums[0].checksumValue, digest);
	assert.ok(
		sbom.packages.some(
			(entry) =>
				entry.externalRefs[0].referenceLocator ===
				'pkg:npm/%40rinspacehq/cline-embed@0.1.0-rinspace.3',
		),
	);
	assert.equal(
		sbom.relationships.filter(
			(entry) => entry.relationshipType === 'DEPENDS_ON',
		).length,
		2,
	);

	const commit = 'b'.repeat(40);
	const tree = 'c'.repeat(40);
	const source = {
		filename: `texlyre-source-${commit}.tar.gz`,
		size: 456,
		sha256: 'd'.repeat(64),
	};
	const provenance = releaseModule.createProvenance({
		config,
		commit,
		tree,
		artifact,
		source,
		runId: '40244844185',
		runAttempt: '1',
	});
	assert.equal(provenance._type, 'https://in-toto.io/Statement/v1');
	assert.equal(provenance.predicateType, 'https://slsa.dev/provenance/v1');
	assert.deepEqual(
		provenance.subject.map((entry) => entry.name),
		[artifact.filename, source.filename],
	);
	assert.equal(
		provenance.predicate.buildDefinition.internalParameters.commit,
		commit,
	);
	assert.equal(
		provenance.predicate.runDetails.metadata.invocationId,
		'https://github.com/rinspacehq/texlyre/actions/runs/40244844185/attempts/1',
	);
});

test('notice assembly rejects bytes that differ from the reviewed digest', async () => {
	const bytes = Buffer.from('reviewed notice\n');
	const target = await mkdtemp(path.join(tmpdir(), 'texlyre-release-notices-'));
	const fixture = {
		...config,
		externalNotices: [
			{
				id: 'fixture',
				sourcePath: 'LICENSE',
				sourceUrl:
					'https://raw.githubusercontent.com/example/project/0123456789012345678901234567890123456789/LICENSE',
				size: bytes.length,
				sha256: sha256(bytes),
				artifactPath: 'notices/external/fixture/LICENSE',
			},
		],
	};
	const response = (body) => async () => new Response(body, { status: 200 });

	try {
		await releaseModule.assembleExternalNotices(
			target,
			fixture,
			response(bytes),
		);
		assert.deepEqual(
			await readFile(
				path.join(target, fixture.externalNotices[0].artifactPath),
			),
			bytes,
		);
		await assert.rejects(
			releaseModule.assembleExternalNotices(
				target,
				fixture,
				response(Buffer.from('tampered notice\n')),
			),
			/(size|digest) mismatch/,
		);
	} finally {
		await rm(target, { recursive: true, force: true });
	}
});
