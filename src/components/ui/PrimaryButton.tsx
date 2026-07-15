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
  const variantClass = `primary-btn--${variant}`;

  return (
    <motion.button
      type={type}
      className={`primary-btn ${variantClass} ${fullWidth ? 'primary-btn--full' : ''} ${className}`}
      style={style}
      disabled={disabled || loading}
      onClick={onClick}
      whileTap={{ scale: disabled || loading ? 1 : 0.97 }}
      whileHover={{ scale: disabled || loading ? 1 : 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <span className="primary-btn__ripple" aria-hidden="true" />
      {loading ? (
        <Loader2 className="primary-btn__spinner" size={22} />
      ) : icon ? (
        <span className="primary-btn__icon">{icon}</span>
      ) : null}
      <span>{children}</span>
    </motion.button>
  );
};

export default PrimaryButton;
