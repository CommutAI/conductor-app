import React, { useState, useRef } from 'react';
import { IonContent, IonPage } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Lock, Bus, AlertCircle } from 'lucide-react';
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { signIn, profile } = useApp();
  const history = useHistory();
  const contentRef = useRef<HTMLIonContentElement>(null);

  // Navigate as soon as profile is set — works for both online and offline login
  React.useEffect(() => {
    if (profile) {
      history.replace('/');
    }
  }, [profile, history]);

  /** Scroll the IonContent so the focused input stays above the virtual keyboard */
  function handleInputFocus() {
    setTimeout(() => {
      contentRef.current?.scrollToBottom(200);
    }, 300);
  }

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'danger') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      const msg = 'Please enter your email and password.';
      setErrorMsg(msg);
      showNotification(msg, 'warning');
      return;
    }

    setLoading(true);

    try {
      const result = await signIn(email.trim(), password);
      setLoading(false);

      if (result.error) {
        const msg = typeof result.error === 'string' ? result.error : 'Login failed. Please check your credentials.';
        setErrorMsg(msg);
        showNotification(msg, 'danger');
      }
      // On success, the useEffect above handles navigation
    } catch (err) {
      setLoading(false);
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      setErrorMsg(msg);
      showNotification(msg, 'danger');
    }
  }

  return (
    <IonPage>
      <IonContent ref={contentRef} fullscreen scrollY className="app-page-bg">

        {/* ── Full-screen centered layout ── */}
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 20px 48px',
        }}>

          {/* ── Brand mark ── */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            style={{ textAlign: 'center', marginBottom: 32 }}
          >
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 80,
              height: 80,
              borderRadius: 24,
              background: 'rgba(255,255,255,0.12)',
              backdropFilter: 'blur(12px)',
              border: '1.5px solid rgba(255,255,255,0.2)',
              marginBottom: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}>
              <Logo size="lg" />
            </div>

            <h1 style={{
              fontSize: '2rem',
              fontWeight: 900,
              margin: '0 0 6px',
              color: '#ffffff',
              letterSpacing: '-0.04em',
              lineHeight: 1,
            }}>
              CommutAI
            </h1>
            <p style={{
              margin: 0,
              fontSize: '0.88rem',
              color: 'rgba(255,255,255,0.75)',
              fontWeight: 500,
            }}>
              Conductor Portal · OMANFORTSCO
            </p>

            {/* Route badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.35 }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 12,
                padding: '5px 14px',
                background: 'rgba(249,115,22,0.18)',
                border: '1px solid rgba(249,115,22,0.35)',
                borderRadius: 20,
              }}
            >
              <Bus size={13} color="#FB923C" />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#FB923C', letterSpacing: 0.3 }}>
                Manolo Fortich ↔ Agora Terminal
              </span>
            </motion.div>
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
              padding: '28px 24px 24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
          >
            <h2 style={{
              margin: '0 0 4px',
              fontSize: '1.25rem',
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
            }}>
              Welcome back
            </h2>
            <p style={{
              margin: '0 0 24px',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              Sign in to start your shift
            </p>

            <form onSubmit={handleLogin} noValidate>
              <ModernInput
                label="Email Address"
                type="email"
                icon={Mail}
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrorMsg(null); }}
                autoComplete="email"
                onFocus={handleInputFocus}
              />
              <ModernInput
                label="Password"
                type="password"
                icon={Lock}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                autoComplete="current-password"
                onFocus={handleInputFocus}
              />

              {/* Inline error message */}
              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    marginBottom: 16,
                    padding: '10px 12px',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 10,
                  }}
                >
                  <AlertCircle size={15} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: '0.82rem', color: '#ef4444', fontWeight: 500, lineHeight: 1.4 }}>
                    {errorMsg}
                  </span>
                </motion.div>
              )}

              <PrimaryButton type="submit" loading={loading} fullWidth style={{ marginTop: 4 }}>
                {loading ? 'Signing in…' : 'Sign In'}
              </PrimaryButton>
            </form>

            {/* Help link */}
            <p style={{
              textAlign: 'center',
              marginTop: 18,
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              fontWeight: 500,
            }}>
              Having trouble?{' '}
              <a
                href="mailto:admin@commutai.test"
                style={{ color: 'var(--color-primary)', fontWeight: 700, textDecoration: 'none' }}
              >
                Contact your administrator
              </a>
            </p>
          </motion.div>

          {/* ── Footer note ── */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            style={{
              marginTop: 28,
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.4)',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textAlign: 'center',
            }}
          >
            AUTHORIZED PERSONNEL ONLY · Conductors only
          </motion.p>
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
