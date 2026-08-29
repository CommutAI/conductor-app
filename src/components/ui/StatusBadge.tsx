import React from 'react';

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'primary';

interface StatusBadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const StatusBadge: React.FC<StatusBadgeProps> = ({
  children,
  variant = 'neutral',
  dot = false,
  pulse = false,
  className = '',
  style,
}) => (
  <span
    className={`status-badge-ui status-badge-ui--${variant} ${className}`}
    style={style}
  >
    {dot && (
      <span className={`status-badge-ui__dot ${pulse ? 'status-badge-ui__dot--pulse' : ''}`} />
    )}
    {children}
  </span>
);

export default StatusBadge;
