import React, { useState } from 'react';
import { LucideIcon, Eye, EyeOff } from 'lucide-react';

interface ModernInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon?: LucideIcon;
  error?: string;
}

const ModernInput: React.FC<ModernInputProps> = ({
  label,
  icon: Icon,
  error,
  id,
  className = '',
  ...props
}) => {
  const [focused, setFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputId = id || `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const hasValue = props.value !== undefined && props.value !== '';
  const isPassword = props.type === 'password';
  const resolvedType = isPassword && showPassword ? 'text' : props.type;

  return (
    <div className={`modern-input ${error ? 'modern-input--error' : ''} ${className}`}>
      <div className={`modern-input__wrapper ${focused || hasValue ? 'modern-input__wrapper--active' : ''}`}>
        {Icon && (
          <span className="modern-input__icon" aria-hidden="true">
            <Icon size={20} strokeWidth={2} />
          </span>
        )}
        <input
          id={inputId}
          className="modern-input__field"
          placeholder=" "
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
          type={resolvedType}
        />
        <label htmlFor={inputId} className="modern-input__label">
          {label}
        </label>
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            style={{
              position: 'absolute',
              right: 14,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
          >
            {showPassword
              ? <EyeOff size={18} strokeWidth={2} />
              : <Eye size={18} strokeWidth={2} />}
          </button>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="modern-input__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default ModernInput;
