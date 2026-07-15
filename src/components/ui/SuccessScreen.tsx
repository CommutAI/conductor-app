import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';

interface SuccessScreenProps {
  title: string;
  subtitle?: string;
  showConfetti?: boolean;
}

const SuccessScreen: React.FC<SuccessScreenProps> = ({
  title,
  subtitle,
  showConfetti = true,
}) => (
  <div className="success-screen">
    {showConfetti && (
      <div className="success-screen__confetti" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className="success-screen__confetti-piece" style={{
            left: `${(i * 4.2) % 100}%`,
            animationDelay: `${i * 0.08}s`,
            background: ['#F97316', '#22C55E', '#3B82F6', '#FACC15', '#FB923C'][i % 5],
          }} />
        ))}
      </div>
    )}
    <motion.div
      className="success-screen__check"
      initial={{ scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
    >
      <CheckCircle2 size={56} strokeWidth={2} />
    </motion.div>
    <motion.h2
      className="success-screen__title"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
    >
      {title}
    </motion.h2>
    {subtitle && (
      <motion.p
        className="success-screen__subtitle"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
      >
        {subtitle}
      </motion.p>
    )}
  </div>
);

export default SuccessScreen;
