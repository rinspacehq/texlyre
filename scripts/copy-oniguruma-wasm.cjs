// scripts/copy-oniguruma-wasm.cjs
const path = require('node:path');
const { copyVerifiedAssetFiles } = require('./rinspace/asset-integrity.cjs');

const wasmSource = path.resolve(
	__dirname,
	'../node_modules/vscode-oniguruma/release/onig.wasm',
);
const wasmDestination = path.resolve(
	__dirname,
	'../public/core/oniguruma/onig.wasm',
);

async function copyOnigurumaWasm() {
	try {
		const result = await copyVerifiedAssetFiles([
			{ source: wasmSource, path: path.basename(wasmDestination) },
		], path.dirname(wasmDestination));
		console.log(`✓ Oniguruma WASM ${result.status}`);
	} catch (err) {
		console.error('❌ Error copying Oniguruma WASM:', err);
		throw err;
	}
}

if (require.main === module) {
	copyOnigurumaWasm();
}

module.exports = { copyOnigurumaWasm };
