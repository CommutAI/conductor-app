import React from 'react';
import { motion } from 'framer-motion';

interface AnimatedIllustrationProps {
  type: 'waiting' | 'scanning' | 'success' | 'loading';
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

const AnimatedIllustration: React.FC<AnimatedIllustrationProps> = ({
  type,
  size = 120,
  className,
  style,
}) => {
  const renderWaiting = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={className}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <motion.circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(16, 185, 129, 0.2)"
          strokeWidth="8"
          initial={{ scale: 0.8, opacity: 0.5 }}
          animate={{ scale: [0.8, 1, 0.8], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="60"
          fill="none"
          stroke="rgba(16, 185, 129, 0.4)"
          strokeWidth="6"
          initial={{ scale: 0.6, opacity: 0.3 }}
          animate={{ scale: [0.6, 1, 0.6], opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="40"
          fill="rgba(16, 185, 129, 0.6)"
          initial={{ scale: 0.4 }}
          animate={{ scale: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
        />
        <motion.path
          d="M85 100 L95 110 L115 90"
          stroke="white"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, delay: 0.5 }}
        />
      </svg>
    </motion.div>
  );

  const renderScanning = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={className}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <motion.rect
          x="40"
          y="40"
          width="120"
          height="120"
          rx="12"
          fill="none"
          stroke="rgba(59, 130, 246, 0.3)"
          strokeWidth="4"
        />
        <motion.rect
          x="50"
          y="50"
          width="100"
          height="100"
          rx="8"
          fill="none"
          stroke="rgba(59, 130, 246, 0.5)"
          strokeWidth="3"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <motion.line
          x1="50"
          y1="50"
          x2="150"
          y2="50"
          stroke="#3b82f6"
          strokeWidth="4"
          strokeLinecap="round"
          initial={{ scaleX: 0, transformOrigin: 'left' }}
          animate={{ scaleX: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.line
          x1="50"
          y1="150"
          x2="150"
          y2="150"
          stroke="#3b82f6"
          strokeWidth="4"
          strokeLinecap="round"
          initial={{ scaleX: 0, transformOrigin: 'left' }}
          animate={{ scaleX: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.75 }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="20"
          fill="rgba(59, 130, 246, 0.8)"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut", delay: 0.375 }}
        />
      </svg>
    </motion.div>
  );

  const renderSuccess = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={className}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <motion.circle
          cx="100"
          cy="100"
          r="80"
          fill="none"
          stroke="rgba(16, 185, 129, 0.2)"
          strokeWidth="8"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.2, 1] }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="60"
          fill="rgba(16, 185, 129, 0.3)"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1] }}
          transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
        />
        <motion.path
          d="M75 100 L92 117 L125 83"
          stroke="white"
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.5, delay: 0.3, ease: "easeOut" }}
        />
      </svg>
    </motion.div>
  );

  const renderLoading = () => (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5 }}
      className={className}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox="0 0 200 200" width="100%" height="100%">
        <motion.circle
          cx="100"
          cy="100"
          r="70"
          fill="none"
          stroke="rgba(59, 130, 246, 0.2)"
          strokeWidth="8"
          initial={{ rotate: 0 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="50"
          fill="none"
          stroke="rgba(59, 130, 246, 0.4)"
          strokeWidth="6"
          initial={{ rotate: 0 }}
          animate={{ rotate: -360 }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        />
        <motion.circle
          cx="100"
          cy="100"
          r="30"
          fill="rgba(59, 130, 246, 0.6)"
          initial={{ scale: 0.8 }}
          animate={{ scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
        />
      </svg>
    </motion.div>
  );

  switch (type) {
    case 'waiting':
      return renderWaiting();
    case 'scanning':
      return renderScanning();
    case 'success':
      return renderSuccess();
    case 'loading':
      return renderLoading();
    default:
      return renderLoading();
  }
};

export default AnimatedIllustration;
