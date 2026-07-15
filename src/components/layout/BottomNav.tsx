import React from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, ScanLine, Bus, User, History } from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  matchPaths?: string[];
}

const navItems: NavItem[] = [
  { path: '/trip-setup', label: 'Home', icon: <Home size={22} />, matchPaths: ['/trip-setup'] },
  { path: '/live-trip', label: 'Trip', icon: <Bus size={22} />, matchPaths: ['/live-trip', '/scan', '/passengers'] },
  { path: '/scan', label: 'Scan', icon: <ScanLine size={22} />, matchPaths: ['/scan'] },
  { path: '/history', label: 'History', icon: <History size={22} />, matchPaths: ['/history', '/trip-summary'] },
  { path: '/profile', label: 'Profile', icon: <User size={22} />, matchPaths: ['/profile'] },
];

interface BottomNavProps {
  hidden?: boolean;
}

const BottomNav: React.FC<BottomNavProps> = ({ hidden = false }) => {
  const history = useHistory();
  const location = useLocation();

  if (hidden) return null;

  const isActive = (item: NavItem) =>
    item.matchPaths?.some((p) => location.pathname.startsWith(p)) ?? location.pathname === item.path;

  return (
    <nav className="bottom-nav-modern" aria-label="Main navigation">
      <div className="bottom-nav-modern__container">
        {navItems.map((item) => {
          const active = isActive(item);
          return (
            <button
              key={item.path}
              type="button"
              className={`bottom-nav-modern__item ${active ? 'bottom-nav-modern__item--active' : ''}`}
              onClick={() => history.push(item.path)}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <motion.div
                  className="bottom-nav-modern__indicator"
                  layoutId="nav-indicator"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <span className="bottom-nav-modern__icon">{item.icon}</span>
              <span className="bottom-nav-modern__label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
