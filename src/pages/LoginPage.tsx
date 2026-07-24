import React, { useState } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import { ModernInput, PrimaryButton, AppToast } from '../components/ui';

const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('danger');
  const { signIn } = useAuth();
  const history = useHistory();

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'danger') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      const msg = 'Please enter your email and password.';
      setError(msg);
      showNotification(msg, 'warning');
      return;
    }

    setLoading(true);
    showNotification('Authenticating...', 'warning');

    try {
      const result = await signIn(email.trim(), password);
      setLoading(false);

      if (result.error) {
        const errorMsg = typeof result.error === 'string'
          ? result.error
          : 'Login failed. Please check your credentials.';
        setError(errorMsg);
        showNotification(errorMsg, 'danger');
      } else {
        showNotification('Welcome back!', 'success');
        setTimeout(() => history.replace('/trip-setup'), 400);
      }
    } catch (err) {
      setLoading(false);
      const errorMsg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMsg);
      showNotification(errorMsg, 'danger');
    }
  }

  return (
    <IonPage>
      <IonContent fullscreen className="app-page-bg">
        <div className="login-hero">
          <div className="login-hero__content">
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              style={{ textAlign: 'center', marginBottom: 24, paddingTop: 20 }}
            >
              <Logo size="xl" />
              <h1 style={{
                fontSize: '2.25rem', fontWeight: 800, margin: '16px 0 6px',
                color: '#1F2937', letterSpacing: '-0.03em',
              }}>
                CommutAI
              </h1>
              <p style={{ color: '#6B7280', margin: 0, fontSize: '1rem', fontWeight: 500 }}>
                Conductor Portal
              </p>
            </motion.div>

            <motion.div
              className="login-form-card"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <h2 className="heading-medium" style={{ marginBottom: 6 }}>Welcome Back</h2>
              <p className="text-secondary" style={{ margin: '0 0 28px' }}>Sign in to start your shift</p>

              <form onSubmit={handleLogin}>
                <ModernInput
                  label="Email Address"
                  type="email"
                  icon={Mail}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  error={error && !email ? 'Required' : undefined}
                />
                <ModernInput
                  label="Password"
                  type="password"
                  icon={Lock}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />

                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    style={{
                      background: 'var(--color-danger-subtle)',
                      border: '1.5px solid #FECACA',
                      borderRadius: 14,
                      padding: '12px 16px',
                      marginBottom: 20,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '0.875rem', color: '#B91C1C', fontWeight: 600 }}>
                      {error}
                    </p>
                  </motion.div>
                )}

                <PrimaryButton type="submit" loading={loading} fullWidth>
                  Sign In
                </PrimaryButton>
              </form>

              <p style={{
                textAlign: 'center', marginTop: 28, fontSize: '0.75rem',
                color: 'var(--text-tertiary)', fontWeight: 600, letterSpacing: '0.04em',
              }}>
                OMANFORTSCO · Authorized Personnel Only
              </p>
            </motion.div>
          </div>
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
