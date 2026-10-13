// scripts/copy-pdf-cmaps.cjs
const path = require('node:path');
const { copyVerifiedAssetTree } = require('./rinspace/asset-integrity.cjs');

const cmapsSource = path.resolve(__dirname, '../node_modules/pdfjs-dist/cmaps');
const cmapsDestination = path.resolve(__dirname, '../public/assets/cmaps');

async function copyCmaps() {
	try {
		const result = await copyVerifiedAssetTree(cmapsSource, cmapsDestination);
		console.log(`✓ PDF.js cMaps ${result.status}`);
	} catch (err) {
		console.error('❌ Error copying PDF.js cMaps:', err);
		throw err;
	}
}

if (require.main === module) {
	copyCmaps();
}

module.exports = { copyCmaps };
