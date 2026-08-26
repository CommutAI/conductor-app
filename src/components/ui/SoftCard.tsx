import React from 'react';
import { motion, MotionProps } from 'framer-motion';

type SoftCardVariant =
  | 'glass'
  | 'gradient'
  | 'hero'
  | 'accent-primary'
  | 'accent-warning'
  | 'accent-danger'
  | 'accent-success'
  | 'accent-info';

interface SoftCardProps {
  children: React.ReactNode;
  variant?: SoftCardVariant;
  padding?: 'sm' | 'md' | 'lg' | 'none';
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  initial?: MotionProps['initial'];
  animate?: MotionProps['animate'];
  transition?: MotionProps['transition'];
}

const paddingMap = { none: '0', sm: '16px', md: '20px', lg: '24px' };

const variantClassMap: Record<SoftCardVariant, string> = {
  glass: '',
  gradient: 'soft-card--gradient',
  hero: 'soft-card--hero',
  'accent-primary': 'soft-card--accent-primary',
  'accent-warning': 'soft-card--accent-warning',
  'accent-danger': 'soft-card--accent-danger',
  'accent-success': 'soft-card--accent-success',
  'accent-info': 'soft-card--accent-info',
};

const SoftCard: React.FC<SoftCardProps> = ({
  children,
  variant = 'glass',
  padding = 'md',
  className = '',
  style,
  onClick,
  initial = { opacity: 0, y: 12 },
  animate = { opacity: 1, y: 0 },
  transition = { duration: 0.35, ease: [0.4, 0, 0.2, 1] },
}) => {
  const clickableClass = onClick ? 'soft-card--clickable' : '';

  return (
    <motion.div
      className={`soft-card glass-card ${variantClassMap[variant]} ${clickableClass} ${className}`.trim()}
      style={{ padding: paddingMap[padding], ...style }}
      onClick={onClick}
      initial={initial}
      animate={animate}
      transition={transition}
      whileHover={onClick ? { scale: 1.01 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
    >
      {children}
    </motion.div>
  );
};

export default SoftCard;
