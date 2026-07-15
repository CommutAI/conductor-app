import React, { useState } from 'react';
import { LucideIcon } from 'lucide-react';

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
  const inputId = id || `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const hasValue = props.value !== undefined && props.value !== '';

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
        />
        <label htmlFor={inputId} className="modern-input__label">
          {label}
        </label>
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
