// scripts/copy-detypify-assets.cjs
const path = require('node:path');
const { copyVerifiedAssetFiles } = require('./rinspace/asset-integrity.cjs');

const assets = [
	{
		source: path.resolve(
			__dirname,
			'../node_modules/detypify-service/train/model.onnx',
		),
		destination: path.resolve(__dirname, '../public/core/detypify/model.onnx'),
	},
	{
		source: path.resolve(
			__dirname,
			'../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
		),
		destination: path.resolve(
			__dirname,
			'../public/core/detypify/ort-wasm-simd-threaded.wasm',
		),
	},
];

async function copyDetypifyAssets() {
	try {
		const destDir = path.resolve(__dirname, '../public/core/detypify');

		const result = await copyVerifiedAssetFiles(assets.map((asset) => ({
			source: asset.source, path: path.basename(asset.destination),
		})), destDir);
		console.log(`✓ Detypify assets ${result.status}`);
	} catch (err) {
		console.error('❌ Error copying Detypify assets:', err);
		throw err;
	}
}

if (require.main === module) {
	copyDetypifyAssets();
}

module.exports = { copyDetypifyAssets };
