import { useState } from 'react';
import { Icon } from './Icon';
import type { Game } from '../types';

export function CartridgeArt({ game, large = false }: { game: Game; large?: boolean }) {
  const [missing, setMissing] = useState(false);
  if (game.coverUrl && !missing) return <div className={`cartridge-art has-cover${large ? ' large' : ''}`}><img src={game.coverUrl} alt={`${game.title} 封面`} loading="lazy" onError={() => setMissing(true)}/></div>;
  return <div className={`cartridge-art${large ? ' large' : ''}`} aria-hidden="true">
    <div className="cartridge-ridges"><i/><i/><i/></div>
    <div className="cartridge-label"><span>{game.system || 'NES'} / {game.source === 'bundled' ? '内置卡带' : '个人卡带'}</span><Icon name={game.keyboard ? 'keyboard' : 'cartridge'} size={large ? 60 : 42}/><b>{game.title}</b><span>{game.format}</span></div>
    <div className="cartridge-notch"/>
  </div>;
}
