import React, { useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import Logo from '../components/Logo';
import { ModernInput, PrimaryButton, AppToast } from '../components/ui';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('danger');
  const { signIn, profile } = useApp();
  const history = useHistory();

  // Navigate as soon as profile is set — works for both online and offline login
  React.useEffect(() => {
    if (profile) {
      history.replace('/');
    }
  }, [profile, history]);

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'danger') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!email.trim() || !password.trim()) {
      showNotification('Please enter your email and password.', 'warning');
      return;
    }

    setLoading(true);

    try {
      const result = await signIn(email.trim(), password);
      setLoading(false);

      if (result.error) {
        showNotification(
          typeof result.error === 'string' ? result.error : 'Login failed. Please check your credentials.',
          'danger',
        );
      }
      // On success, the useEffect above handles navigation
    } catch (err) {
      setLoading(false);
      showNotification(err instanceof Error ? err.message : 'An unexpected error occurred', 'danger');
    }
  }

  return (
    <IonPage>
      <IonContent fullscreen className="app-page-bg">

        {/* ── Full-screen centered layout ── */}
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 20px',
        }}>

          {/* ── Brand mark ── */}
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            style={{ textAlign: 'center', marginBottom: 32 }}
          >
            <Logo size="xl" />
            <h1 style={{
              fontSize: '2rem',
              fontWeight: 900,
              margin: '14px 0 4px',
              color: '#ffffff',
              letterSpacing: '-0.04em',
              lineHeight: 1,
            }}>
              CommutAI
            </h1>
            <p style={{
              margin: 0,
              fontSize: '0.9rem',
              color: 'rgba(255,255,255,0.75)',
              fontWeight: 500,
            }}>
              Conductor Portal
            </p>
          </motion.div>

          {/* ── Login card ── */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.1 }}
            style={{
              width: '100%',
              maxWidth: 400,
              background: 'var(--bg-elevated)',
              borderRadius: 24,
              padding: '28px 24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <h2 style={{
              margin: '0 0 4px',
              fontSize: '1.3rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}>
              Welcome back
            </h2>
            <p style={{
              margin: '0 0 24px',
              fontSize: '0.88rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              Log in to start your shift
            </p>

            <form onSubmit={handleLogin}>
              <ModernInput
                label="Email Address"
                type="email"
                icon={Mail}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <ModernInput
                label="Password"
                type="password"
                icon={Lock}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />

              <PrimaryButton type="submit" loading={loading} fullWidth>
                Log In
              </PrimaryButton>
            </form>

            <p style={{
              textAlign: 'center',
              marginTop: 20,
              fontSize: '0.72rem',
              color: 'var(--text-tertiary)',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}>
              OMANFORTSCO · Authorized Personnel Only
            </p>
          </motion.div>

        </div>

        <AppToast
          isOpen={showToast}
          message={toastMessage}
          color={toastColor}
          onDismiss={() => setShowToast(false)}
        />
      </IonContent>
    </IonPage>
  );
};

export default LoginPage;
