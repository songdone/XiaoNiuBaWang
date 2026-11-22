import { Icon, type IconName } from './Icon';

export function EmptyState({ icon = 'cartridge', title, description, action, onAction }: {
  icon?: IconName;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
}) {
  return <div className="empty-state">
    <div className="empty-symbol"><Icon name={icon} size={40}/></div>
    <h2>{title}</h2><p>{description}</p>
    {action && onAction && <button className="button primary" onClick={onAction}><Icon name={icon === 'warning' ? 'refresh' : 'plus'}/>{action}</button>}
  </div>;
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="notice error" role="alert"><Icon name="warning"/><span>{message}</span>{onRetry && <button className="text-button" onClick={onRetry}>重试</button>}</div>;
}

export function Loading({ label = '正在读取…' }: { label?: string }) {
  return <div className="loading-state" role="status"><span className="spinner"/>{label}</div>;
}
