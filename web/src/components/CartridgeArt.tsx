import { useState } from 'react';
import { appUrl } from '../api/urls';
import { Icon } from './Icon';
import type { Game } from '../types';

function cartridgeTheme(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index++) hash = ((hash * 31) + id.charCodeAt(index)) >>> 0;
  return hash % 6;
}

export function CartridgeArt({ game, large = false }: { game: Game; large?: boolean }) {
  const [missing, setMissing] = useState(false);
  const src = game.coverUrl || (game.source === 'bundled' ? appUrl(`covers/${encodeURIComponent(game.id)}.png`) : null);
  if (src && !missing) return <div className={`cartridge-art has-cover${large ? ' large' : ''}`}><img src={src} className="pixelated" alt={`${game.title} 封面`} loading="lazy" onError={() => setMissing(true)}/></div>;
  return <div className={`cartridge-art cartridge-theme-${cartridgeTheme(game.id)}${large ? ' large' : ''}`} aria-hidden="true">
    <div className="cartridge-ridges"><i/><i/><i/></div>
    <div className="cartridge-label"><span>{game.system || 'NES'} / {game.source === 'bundled' ? '内置卡带' : '个人卡带'}</span><Icon name={game.keyboard ? 'keyboard' : 'cartridge'} size={large ? 60 : 42}/><b>{game.title}</b><span>{game.format}</span></div>
    <div className="cartridge-notch"/>
  </div>;
}
