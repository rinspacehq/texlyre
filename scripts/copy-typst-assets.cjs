// scripts/copy-typst-assets.cjs
const path = require('node:path');
const { copyVerifiedAssetTree } = require('./rinspace/asset-integrity.cjs');

const compilerSource = path.resolve(
	__dirname,
	'../node_modules/@myriaddreamin/typst-ts-web-compiler/pkg',
);
const compilerDestination = path.resolve(
	__dirname,
	'../public/core/typst-ts-web-compiler/pkg',
);

const rendererSource = path.resolve(
	__dirname,
	'../node_modules/@myriaddreamin/typst-ts-renderer/pkg',
);
const rendererDestination = path.resolve(
	__dirname,
	'../public/core/typst-ts-renderer/pkg',
);

async function copyTypstAssets() {
	try {
		const compiler = await copyVerifiedAssetTree(compilerSource, compilerDestination);
		console.log(`✓ Typst compiler assets ${compiler.status}`);
		const renderer = await copyVerifiedAssetTree(rendererSource, rendererDestination);
		console.log(`✓ Typst renderer assets ${renderer.status}`);
	} catch (err) {
		console.error('❌ Error copying Typst assets:', err);
		throw err;
	}
}

if (require.main === module) {
	copyTypstAssets();
}

module.exports = { copyTypstAssets };
