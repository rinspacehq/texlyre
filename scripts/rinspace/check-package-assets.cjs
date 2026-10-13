// SPDX-License-Identifier: AGPL-3.0-or-later
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { hashFile, inventory, inventoryDigest } = require('./asset-integrity.cjs');

const root = path.resolve(__dirname, '../..');
const groups = [
	['pdf-cmaps', '../copy-pdf-cmaps.cjs', 'copyCmaps', 'assets/cmaps', ['pdfjs-dist']],
	['math-fonts', '../copy-mathlive-fonts.cjs', 'copyKTeXFonts', 'assets/math-fonts', ['mathlive']],
	['detypify', '../copy-detypify-assets.cjs', 'copyDetypifyAssets', 'core/detypify', ['detypify-service', 'onnxruntime-web']],
	['typst', '../copy-typst-assets.cjs', 'copyTypstAssets', null, ['@myriaddreamin/typst-ts-web-compiler', '@myriaddreamin/typst-ts-renderer']],
	['oniguruma', '../copy-oniguruma-wasm.cjs', 'copyOnigurumaWasm', 'core/oniguruma', ['vscode-oniguruma']],
	['latex-tools', '../copy-wasm-latex-tools-assets.cjs', 'copyWasmLatexToolsAssets', null, ['wasm-latex-tools']],
];

async function main() {
	// A cold installation and an independent warm verification exercise the
	// actual package inputs, not just a synthetic filesystem fixture.
	for (const [, module, method] of groups) await require(module)[method]();
	for (const [, module, method] of groups) await require(module)[method]();
	const assets = [];
	for (const [id, , , directory, packages] of groups) {
		const directories = directory ? [directory] : id === 'typst'
			? ['core/typst-ts-web-compiler/pkg', 'core/typst-ts-renderer/pkg']
			: ['core/webperl', 'core/perl'];
		const sources = [];
		for (const packageName of packages) {
			const pkg = JSON.parse(await readFile(path.join(root, 'node_modules', packageName, 'package.json'), 'utf8'));
			sources.push({ importName: packageName, packageName: pkg.name, version: pkg.version,
				declaredPackageLicense: pkg.license ?? null });
		}
		for (const assetDirectory of directories) {
			const files = await inventory(path.join(root, 'public', assetDirectory));
			assets.push({ id, directory: assetDirectory, sources, files, inventorySha256: inventoryDigest(files) });
		}
	}
	const manifest = {
		schema: 'texlyre-package-assets/v1',
		lockfileSha256: await hashFile(path.join(root, 'pnpm-lock.yaml')),
		stage: 'source-development',
		productionAccepted: false,
		licenseAudit: 'Package declarations are recorded, not a complete embedded font/WASM/asset notice audit.',
		assets,
	};
	await writeFile(path.join(root, 'public/rinspace-package-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(JSON.stringify({ packageAssetGroups: assets.length, files: assets.reduce((total, group) => total + group.files.length, 0),
		bytes: assets.reduce((total, group) => total + group.files.reduce((sum, file) => sum + file.size, 0), 0),
		lockfileSha256: manifest.lockfileSha256, productionAccepted: false }));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
