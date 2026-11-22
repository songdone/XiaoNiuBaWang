import { useState } from 'react';
import { APP_NAME, APP_SHORT_NAME, BRAND_LOGO } from '../types';
import { appUrl } from '../api/urls';

export function Brand({ compact = false }: { compact?: boolean }) {
  const [missing, setMissing] = useState(false);
  return <div className={`brand${compact ? ' brand-compact' : ''}`}>
    {missing ? <strong>{APP_SHORT_NAME}</strong> : <img className="brand-logo" src={appUrl(BRAND_LOGO)} alt={APP_NAME} onError={() => setMissing(true)}/>}
  </div>;
}
