// SPDX-License-Identifier: AGPL-3.0-or-later
const { createHash } = require('node:crypto');
const { lstat, readFile, realpath, readdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

const NOTICE_FILE = /^(?:license|licence|copying|notice|copyright)(?:\.|$)/i;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function packageBase(packageRoot) {
	let current = packageRoot;
	while (current !== path.dirname(current)) {
		if (path.basename(current) === 'node_modules') return current;
		current = path.dirname(current);
	}
	throw new Error(`Cannot locate node_modules parent for ${packageRoot}`);
}

function declaredLicense(pkg) {
	if (typeof pkg.license === 'string') return pkg.license;
	if (Array.isArray(pkg.licenses)) {
		return pkg.licenses.map((entry) => entry?.type).filter(Boolean).join(' OR ') || null;
	}
	return null;
}

function sourceReference(pkg) {
	if (typeof pkg.repository === 'string') return pkg.repository;
	if (pkg.repository && typeof pkg.repository.url === 'string') return pkg.repository.url;
	return pkg.homepage ?? null;
}

async function collectDependencyNotices(root) {
	const rootPackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
	const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'));
	const queue = Object.keys(rootPackage.dependencies ?? {}).map((name) => ({
		name,
		base: path.join(root, 'node_modules'),
		optional: false,
	}));
	const packages = new Map();
	const licenseTexts = new Map();
	const skippedOptionalDependencies = [];

	while (queue.length > 0) {
		const request = queue.shift();
		const packageJsonPath = path.join(request.base, ...request.name.split('/'), 'package.json');
		let resolvedPackageJson;
		try {
			resolvedPackageJson = await realpath(packageJsonPath);
		} catch (error) {
			if (request.optional && error.code === 'ENOENT') {
				skippedOptionalDependencies.push(request.name);
				continue;
			}
			throw new Error(`Installed production dependency is missing: ${request.name}`);
		}

		const packageRoot = path.dirname(resolvedPackageJson);
		const pkgBytes = await readFile(resolvedPackageJson);
		const pkg = JSON.parse(pkgBytes.toString('utf8'));
		const key = `${pkg.name}@${pkg.version}`;
		if (packages.has(key)) continue;

		const textDigests = [];
		for (const filename of (await readdir(packageRoot)).sort()) {
			if (!NOTICE_FILE.test(filename)) continue;
			const noticePath = path.join(packageRoot, filename);
			if (!(await lstat(noticePath)).isFile()) continue;
			const bytes = await readFile(noticePath);
			const digest = sha256(bytes);
			textDigests.push(digest);
			if (!licenseTexts.has(digest)) {
				licenseTexts.set(digest, {
					sha256: digest,
					filename,
					text: bytes.toString('utf8'),
				});
			}
		}

		packages.set(key, {
			name: pkg.name,
			version: pkg.version,
			license: declaredLicense(pkg),
			source: sourceReference(pkg),
			packageJsonSha256: sha256(pkgBytes),
			licenseTextSha256: [...new Set(textDigests)].sort(),
		});

		const base = await packageBase(packageRoot);
		for (const name of Object.keys(pkg.dependencies ?? {})) {
			queue.push({ name, base, optional: false });
		}
		for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
			queue.push({ name, base, optional: true });
		}
	}

	return {
		schema: 'rinspace-production-dependency-notices/v1',
		stage: 'source-development',
		productionAccepted: false,
		application: {
			name: rootPackage.name,
			version: rootPackage.version,
			license: rootPackage.license,
			source: rootPackage.repository?.url ?? null,
		},
		lockfileSha256: sha256(lockfile),
		graph: 'Installed packages reachable through dependencies and optionalDependencies from package.json dependencies; devDependencies are excluded.',
		packages: [...packages.values()].sort((a, b) =>
			`${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`)),
		licenseTexts: [...licenseTexts.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
		skippedOptionalDependencies: [...new Set(skippedOptionalDependencies)].sort(),
	};
}

async function writeDependencyNotices(root) {
	const notices = await collectDependencyNotices(root);
	await writeFile(
		path.join(root, 'public/rinspace-dependency-notices.json'),
		`${JSON.stringify(notices, null, 2)}\n`,
	);
	return notices;
}

module.exports = { collectDependencyNotices, writeDependencyNotices };

if (require.main === module) {
	const root = path.resolve(__dirname, '../..');
	writeDependencyNotices(root)
		.then((notices) => console.log(JSON.stringify({
			packages: notices.packages.length,
			licenseTexts: notices.licenseTexts.length,
			lockfileSha256: notices.lockfileSha256,
			productionAccepted: false,
		})))
		.catch((error) => {
			console.error(error.message);
			process.exitCode = 1;
		});
}
