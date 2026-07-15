import React from 'react';

interface LoadingSkeletonProps {
  variant?: 'text' | 'card' | 'avatar' | 'kpi' | 'list';
  count?: number;
  className?: string;
}

const variants: Record<string, string> = {
  text: 'skeleton skeleton--text',
  card: 'skeleton skeleton--card',
  avatar: 'skeleton skeleton--avatar',
  kpi: 'skeleton skeleton--kpi',
  list: 'skeleton skeleton--list',
};

const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  variant = 'text',
  count = 1,
  className = '',
}) => (
  <div className={`skeleton-group ${className}`} aria-busy="true" aria-label="Loading">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={variants[variant]} />
    ))}
  </div>
);

export default LoadingSkeleton;
