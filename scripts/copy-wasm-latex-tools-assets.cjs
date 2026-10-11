// scripts/copy-wasm-latex-tools-assets.cjs
const path = require('node:path');
const { copyVerifiedAssetTree } = require('./rinspace/asset-integrity.cjs');

const webperlSource = path.resolve(
	__dirname,
	'../node_modules/wasm-latex-tools/assets/core/webperl',
);
const webperlDestination = path.resolve(__dirname, '../public/core/webperl');

const perlSource = path.resolve(
	__dirname,
	'../node_modules/wasm-latex-tools/assets/core/perl',
);
const perlDestination = path.resolve(__dirname, '../public/core/perl');

async function copyWasmLatexToolsAssets() {
	try {
		const webperl = await copyVerifiedAssetTree(webperlSource, webperlDestination);
		console.log(`✓ WebPerl assets ${webperl.status}`);
		const perl = await copyVerifiedAssetTree(perlSource, perlDestination);
		console.log(`✓ Perl assets ${perl.status}`);
	} catch (err) {
		console.error('❌ Error copying wasm-latex-tools assets:', err);
		throw err;
	}
}

if (require.main === module) {
	copyWasmLatexToolsAssets();
}

module.exports = { copyWasmLatexToolsAssets };
