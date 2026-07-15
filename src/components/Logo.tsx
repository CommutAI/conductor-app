import React from 'react';
import logoOnly from '../logo-only.png';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const Logo: React.FC<LogoProps> = ({ size = 'md', className = '' }) => {
  const sizes = {
    sm: { width: '32px', height: '32px' },
    md: { width: '44px', height: '44px' },
    lg: { width: '80px', height: '80px' },
    xl: { width: '120px', height: '120px' },
  };

  const currentSize = sizes[size];

  return (
    <img
      src={logoOnly}
      alt="CommutAI"
      className={className}
      style={{
        width: currentSize.width,
        height: currentSize.height,
        objectFit: 'contain',
      }}
    />
  );
};

export default Logo;
