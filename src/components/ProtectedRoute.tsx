import React from 'react';
import { Redirect } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Logo from './Logo';

interface ProtectedRouteProps {
  component: React.ComponentType<any>;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ component: Component }) => {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="login-hero" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
        >
          <Logo size="lg" />
          <Loader2 size={36} color="white" style={{ animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: 'rgba(255,255,255,0.85)', margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>
            Loading your workspace…
          </p>
        </motion.div>
      </div>
    );
  }

  if (!session || !profile) {
    return <Redirect to="/login" />;
  }

  return <Component />;
};

export default ProtectedRoute;
