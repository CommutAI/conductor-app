import React from 'react';
import { useHistory } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import Logo from '../Logo';
import StatusBadge from '../ui/StatusBadge';

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  backTo?: string;
  onBack?: () => void;
  rightAction?: React.ReactNode;
  statusBadge?: { label: string; variant: 'success' | 'danger' | 'warning' | 'primary' };
  showLogo?: boolean;
  transparent?: boolean;
}

const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  showBack = false,
  backTo,
  onBack,
  rightAction,
  statusBadge,
  showLogo = false,
  transparent = false,
}) => {
  const history = useHistory();

  const handleBack = () => {
    if (onBack) onBack();
    else if (backTo) history.push(backTo);
    else history.goBack();
  };

  return (
    <motion.header
      className={`page-header ${transparent ? 'page-header--transparent' : ''}`}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="page-header__inner">
        <div className="page-header__left">
          {showBack && (
            <button
              type="button"
              className="page-header__back"
              onClick={handleBack}
              aria-label="Go back"
            >
              <ArrowLeft size={22} />
            </button>
          )}
          {showLogo && <Logo size="sm" />}
          {(title || subtitle) && (
            <div className="page-header__text">
              {statusBadge && (
                <StatusBadge variant={statusBadge.variant} dot pulse>
                  {statusBadge.label}
                </StatusBadge>
              )}
              {title && <h1 className="page-header__title">{title}</h1>}
              {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
            </div>
          )}
        </div>
        {rightAction && <div className="page-header__right">{rightAction}</div>}
      </div>
    </motion.header>
  );
};

export default PageHeader;
