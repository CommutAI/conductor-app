import React from 'react';

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
}) => {
  const clickableClass = onClick ? 'soft-card--clickable' : '';

  return (
    <div
      className={`soft-card glass-card ${variantClassMap[variant]} ${clickableClass} ${className}`.trim()}
      style={{ padding: paddingMap[padding], ...style }}
      onClick={onClick}
    >
      {children}
    </div>
  );
};

export default SoftCard;
