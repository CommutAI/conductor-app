import React from 'react';

interface ProfileAvatarProps {
  name: string;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showBorder?: boolean;
  className?: string;
}

const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ 
  name, 
  photoUrl, 
  size = 'md', 
  showBorder = true,
  className = '' 
}) => {
  const sizes = {
    sm: { container: '40px', fontSize: '1rem', border: '2px' },
    md: { container: '56px', fontSize: '1.25rem', border: '3px' },
    lg: { container: '72px', fontSize: '1.75rem', border: '3px' },
    xl: { container: '96px', fontSize: '2.25rem', border: '4px' },
  };

  const currentSize = sizes[size];

  // Generate initials from name
  const getInitials = (fullName: string) => {
    return fullName
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Generate consistent color from name
  const getColorFromName = (fullName: string) => {
  const colors = [
    'linear-gradient(135deg, #F97316 0%, #FB923C 100%)',
    'linear-gradient(135deg, #22C55E 0%, #4ADE80 100%)',
    'linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%)',
    'linear-gradient(135deg, #8B5CF6 0%, #A78BFA 100%)',
    'linear-gradient(135deg, #EC4899 0%, #F472B6 100%)',
  ];
    const index = fullName.charCodeAt(0) % colors.length;
    return colors[index];
  };

  return (
    <div
      className={className}
      style={{
        width: currentSize.container,
        height: currentSize.container,
        borderRadius: size === 'sm' ? '12px' : '20px',
        background: photoUrl ? '#E5E7EB' : getColorFromName(name),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: currentSize.fontSize,
        fontWeight: '800',
        color: '#FFFFFF',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
        border: showBorder ? `${currentSize.border} solid rgba(255,255,255,0.3)` : 'none',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onError={(e) => {
            // Fallback to initials if image fails
            const target = e.target as HTMLImageElement;
            target.style.display = 'none';
            const container = target.parentElement;
            if (container) {
              container.style.background = getColorFromName(name);
              container.innerHTML = getInitials(name);
            }
          }}
        />
      ) : (
        <span style={{ 
          textShadow: '0 2px 4px rgba(0,0,0,0.1)',
          letterSpacing: '-0.02em'
        }}>
          {getInitials(name)}
        </span>
      )}
    </div>
  );
};

export default ProfileAvatar;
