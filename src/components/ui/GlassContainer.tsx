import React from 'react';
import { motion } from 'framer-motion';

interface GlassContainerProps {
  children: React.ReactNode;
  className?: string;
  padding?: string;
}

const GlassContainer: React.FC<GlassContainerProps> = ({
  children,
  className = '',
  padding = '20px',
}) => (
  <motion.div
    className={`glass-container ${className}`}
    style={{ padding }}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3 }}
  >
    {children}
  </motion.div>
);

export default GlassContainer;
