import React from 'react';

interface SkeletonProps {
  variant?: 'text' | 'rect' | 'circle' | 'card';
  width?: string;
  height?: string;
  lines?: number;
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ variant = 'text', width, height, lines = 1, className = '' }) => {
  const base = 'animate-pulse bg-forge-panel/60 rounded';

  if (variant === 'card') {
    return (
      <div className={`${base} rounded-lg ${className}`} style={{ width: width || '100%', height: height || '120px' }} />
    );
  }
  if (variant === 'circle') {
    return <div className={`${base} rounded-full ${className}`} style={{ width: width || '40px', height: height || '40px' }} />;
  }
  if (variant === 'rect') {
    return <div className={`${base} ${className}`} style={{ width: width || '100%', height: height || '40px' }} />;
  }
  // text lines
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className={base} style={{ width: i === lines - 1 && lines > 1 ? '60%' : width || '100%', height: '12px' }} />
      ))}
    </div>
  );
};
