import React from 'react';
import { motion, MotionProps } from 'framer-motion';

interface SoftCardProps {
  children: React.ReactNode;
  variant?: 'default' | 'gradient' | 'glass';
  padding?: 'sm' | 'md' | 'lg' | 'none';
  className?: string;
  style?: React.CSSProperties;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  initial?: MotionProps['initial'];
  animate?: MotionProps['animate'];
  transition?: MotionProps['transition'];
}

const paddingMap = { none: '0', sm: '16px', md: '20px', lg: '24px' };

const SoftCard: React.FC<SoftCardProps> = ({
  children,
  variant = 'default',
  padding = 'md',
  className = '',
  style,
  onClick,
  initial = { opacity: 0, y: 12 },
  animate = { opacity: 1, y: 0 },
  transition = { duration: 0.35, ease: [0.4, 0, 0.2, 1] },
}) => {
  const variantClass =
    variant === 'gradient' ? 'soft-card--gradient' :
    variant === 'glass' ? 'soft-card--glass' : '';

  return (
    <motion.div
      className={`soft-card ${variantClass} ${className}`}
      style={{ padding: paddingMap[padding], ...style }}
      onClick={onClick}
      initial={initial}
      animate={animate}
      transition={transition}
    >
      {children}
    </motion.div>
  );
};

export default SoftCard;
