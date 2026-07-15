import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, Inbox, AlertCircle, CheckCircle2 } from 'lucide-react';
import PrimaryButton from './PrimaryButton';

type EmptyVariant = 'default' | 'error' | 'success';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  variant?: EmptyVariant;
  actionLabel?: string;
  onAction?: () => void;
}

const variantIcons: Record<EmptyVariant, LucideIcon> = {
  default: Inbox,
  error: AlertCircle,
  success: CheckCircle2,
};

const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  variant = 'default',
  actionLabel,
  onAction,
}) => {
  const Icon = icon || variantIcons[variant];

  return (
    <motion.div
      className={`empty-state empty-state--${variant}`}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="empty-state__illustration">
        <div className="empty-state__icon-ring">
          <Icon size={40} strokeWidth={1.75} />
        </div>
        <div className="empty-state__dots" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>
      <h3 className="empty-state__title">{title}</h3>
      {description && <p className="empty-state__description">{description}</p>}
      {actionLabel && onAction && (
        <PrimaryButton onClick={onAction} variant="secondary" style={{ marginTop: 20 }}>
          {actionLabel}
        </PrimaryButton>
      )}
    </motion.div>
  );
};

export default EmptyState;
