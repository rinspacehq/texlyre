// src/components/common/SplashScreen.tsx
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';

interface SplashScreenProps {
	isVisible: boolean;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ isVisible }) => {
	const rinspaceLogo = `${__BASE_PATH__}/assets/brand/rinspace-mark-128.png`;
	const [themeLoaded, setThemeLoaded] = useState(false);

	useEffect(() => {
		const timer = setTimeout(() => {
			setThemeLoaded(true);
		}, 100);

		return () => clearTimeout(timer);
	}, []);

	if (!isVisible) return null;

	return (
		<div className={`splash-screen ${themeLoaded ? 'theme-loaded' : ''}`}>
			<div className='splash-content'>
				<div className='splash-logo'>
					<img src={rinspaceLogo} alt={t('Rinspace logo')} />
				</div>
				<h1 className='splash-title'>{t('TeXlyre')}</h1>
				<div className='splash-loading'>
					<div className='loading-spinner' />
					<p>{t('Loading TeXlyre...')}</p>
				</div>
			</div>
		</div>
	);
};

export default SplashScreen;
