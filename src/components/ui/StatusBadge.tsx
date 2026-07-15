import React from 'react';
import { motion } from 'framer-motion';

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
  <motion.span
    className={`status-badge-ui status-badge-ui--${variant} ${className}`}
    style={style}
    initial={{ opacity: 0, scale: 0.9 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.2 }}
  >
    {dot && (
      <span className={`status-badge-ui__dot ${pulse ? 'status-badge-ui__dot--pulse' : ''}`} />
    )}
    {children}
  </motion.span>
);

export default StatusBadge;
