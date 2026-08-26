import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface DashboardCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: string;
  delay?: number;
  onClick?: () => void;
}

const DashboardCard: React.FC<DashboardCardProps> = ({
  label,
  value,
  icon: Icon,
  iconColor = 'var(--color-primary)',
  iconBg = 'rgba(249, 115, 22, 0.15)',
  trend,
  delay = 0,
  onClick,
}) => (
  <motion.div
    className={`dashboard-kpi glass-card ${onClick ? 'dashboard-kpi--clickable' : ''}`}
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay, ease: [0.4, 0, 0.2, 1] }}
    onClick={onClick}
    role={onClick ? 'button' : undefined}
    tabIndex={onClick ? 0 : undefined}
    whileHover={{ scale: 1.02, y: -2 }}
    whileTap={{ scale: 0.98 }}
  >
    <div className="dashboard-kpi__icon" style={{ background: iconBg, color: iconColor, width: '32px', height: '32px' }}>
      <Icon size={16} strokeWidth={2.25} />
    </div>
    <div className="dashboard-kpi__content">
      <p className="dashboard-kpi__value" style={{ fontSize: '1rem' }}>{value}</p>
      <p className="dashboard-kpi__label" style={{ fontSize: '0.75rem' }}>{label}</p>
      {trend && <p className="dashboard-kpi__trend">{trend}</p>}
    </div>
  </motion.div>
);

export default DashboardCard;
