import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

interface PrimaryButtonProps {
  children: React.ReactNode;
  loading?: boolean;
  variant?: 'primary' | 'danger' | 'secondary' | 'ghost';
  icon?: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  style?: React.CSSProperties;
}

const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  children,
  loading = false,
  variant = 'primary',
  icon,
  fullWidth = false,
  disabled,
  type = 'button',
  onClick,
  className = '',
  style,
}) => {
  const isDisabled = Boolean(disabled || loading);
  const variantClass = `primary-btn--${variant}`;

  return (
    <motion.button
      type={type}
      className={`primary-btn ${variantClass} ${fullWidth ? 'primary-btn--full' : ''} ${className}`}
      style={{
        ...style,
        border: style?.border || (variant === 'ghost' ? '2px solid var(--border-medium)' : undefined),
        background: style?.background || undefined,
        color: style?.color || undefined,
        opacity: isDisabled ? 0.55 : style?.opacity || 1,
        cursor: isDisabled ? 'not-allowed' : style?.cursor || 'pointer',
      }}
      disabled={isDisabled}
      onClick={isDisabled ? undefined : onClick}
      whileTap={{ scale: isDisabled ? 1 : 0.97 }}
      whileHover={{ scale: isDisabled ? 1 : 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <span className="primary-btn__ripple" aria-hidden="true" />
      {loading ? (
        <Loader2 className="primary-btn__spinner" size={20} />
      ) : icon ? (
        <span className="primary-btn__icon">{icon}</span>
      ) : null}
      <span>{children}</span>
    </motion.button>
  );
};

export default PrimaryButton;
