import React from 'react';
import { Redirect } from 'react-router-dom';
import { IonContent, IonPage } from '@ionic/react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import Logo from './Logo';

interface ProtectedRouteProps {
  component: React.ComponentType<any>;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ component: Component }) => {
  const { profile, loading, isRestoringTrip, currentTrip } = useApp();

  // Initial auth bootstrap only — not background trip revalidation
  if (loading && !profile) {
    return (
      <IonPage>
        <IonContent fullscreen className="app-page-bg">
          <div className="login-hero" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
            >
              <Logo size="lg" />
              <Loader2 size={36} color="var(--color-primary)" style={{ animation: 'spin 0.8s linear infinite' }} />
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>
                Loading your workspace…
              </p>
            </motion.div>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  // Block UI only on cold start when we have no local trip yet but are checking the DB
  if (isRestoringTrip && !currentTrip) {
    return (
      <IonPage>
        <IonContent fullscreen className="app-page-bg">
          <div className="login-hero" style={{ minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
            >
              <Logo size="lg" />
              <Loader2 size={36} color="var(--color-primary)" style={{ animation: 'spin 0.8s linear infinite' }} />
              <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem', fontWeight: 500 }}>
                Resuming your active trip…
              </p>
            </motion.div>
          </div>
        </IonContent>
      </IonPage>
    );
  }

  if (!profile) {
    return <Redirect to="/login" />;
  }

  return <Component />;
};

export default ProtectedRoute;
