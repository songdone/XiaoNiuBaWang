import type { Game } from './types';

export function gameLanguageLabel(game: Pick<Game, 'language' | 'translationStatus'>) {
  if (['translated', 'zh-cn', 'zh-CN', 'chinese_translation'].includes(game.translationStatus)) return '中文汉化';
  if (game.language.toLowerCase().startsWith('zh')) return '中文卡带';
  if (game.language.toLowerCase().startsWith('en')) return '英文原版';
  if (game.language.toLowerCase().startsWith('ja')) return '日文原版';
  if (game.language === 'und') return '语言未标注';
  if (game.language) return '其他语言';
  return '语言未标注';
}

export function formatSize(size: number | null) {
  if (size === null) return '未知大小';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
export function formatDate(date: string | null) {
  if (!date || Number.isNaN(Date.parse(date))) return '暂无记录';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
}
export function relativeDate(date: string | null) {
  if (!date || Number.isNaN(Date.parse(date))) return '尚未游玩';
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 86_400_000));
  if (days === 0) return '今天游玩';
  if (days === 1) return '昨天游玩';
  if (days < 30) return `${days} 天前游玩`;
  return formatDate(date);
}
