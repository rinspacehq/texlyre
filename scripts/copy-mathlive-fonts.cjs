// scripts/copy-mathlive-fonts.cjs
const path = require('node:path');
const { copyVerifiedAssetTree } = require('./rinspace/asset-integrity.cjs');

const fontsSource = path.resolve(__dirname, '../node_modules/mathlive/fonts');
const fontsDestination = path.resolve(__dirname, '../public/assets/math-fonts');

async function copyKTeXFonts() {
	try {
		const result = await copyVerifiedAssetTree(fontsSource, fontsDestination);
		console.log(`✓ MathLive KTeX fonts ${result.status}`);
	} catch (err) {
		console.error('❌ Error copying MathLive KTeX fonts:', err);
		throw err;
	}
}

if (require.main === module) {
	copyKTeXFonts();
}

module.exports = { copyKTeXFonts };
