import { useState } from 'react';
import { APP_NAME, APP_SHORT_NAME, BRAND_LOGO } from '../types';
import { appUrl } from '../api/urls';

export function Brand({ compact = false }: { compact?: boolean }) {
  const [fallbackLevel, setFallbackLevel] = useState<0 | 1 | 2>(0);
  return <div className={`brand${compact ? ' brand-compact' : ''}`}>
    {fallbackLevel === 2 ? <strong>{APP_SHORT_NAME}</strong> : fallbackLevel === 1 ? (
      <img className="brand-logo" src={appUrl(BRAND_LOGO)} alt={APP_NAME} width={480} height={176} decoding="async" onError={() => setFallbackLevel(2)}/>
    ) : (
      <picture>
        <source srcSet={appUrl('brand/logo-ui.webp')} type="image/webp"/>
        <img className="brand-logo" src={appUrl('brand/logo-ui.png')} alt={APP_NAME} width={480} height={176} decoding="async" onError={() => setFallbackLevel(1)}/>
      </picture>
    )}
  </div>;
}
