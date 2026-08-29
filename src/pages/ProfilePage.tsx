import React, { useState } from 'react';
import {
  IonPage,
  IonContent,
  IonAlert,
  IonModal,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  Mail, IdCard, Building2, Bell, Shield, HelpCircle,
  LogOut, Moon, Sun, Info, ChevronRight, AlertCircle,
  Stethoscope, Car, ShieldAlert, Wrench, ClipboardList, X,
  BellRing, BellOff, Lock, Eye, EyeOff, KeyRound, MessageCircle,
  Phone, Globe, FileText, Star, Code2, CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { supabase } from '../supabaseClient';
import ProfileAvatar from '../components/ProfileAvatar';
import PageHeader from '../components/layout/PageHeader';
import BottomNav from '../components/layout/BottomNav';
import {
  SoftCard, PrimaryButton, StatusBadge, AppToast,
} from '../components/ui';

const ProfilePage: React.FC = () => {
  const [showLogoutAlert, setShowLogoutAlert] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [showEmergencyAlert, setShowEmergencyAlert] = useState(false);
  const [selectedEmergencyType, setSelectedEmergencyType] = useState<'medical' | 'accident' | 'security' | 'mechanical' | 'other'>('other');

  // New modal states
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Notification preferences
  const [notifScanAlerts, setNotifScanAlerts] = useState(true);
  const [notifTripUpdates, setNotifTripUpdates] = useState(true);
  const [notifEmergency, setNotifEmergency] = useState(true);
  const [notifSync, setNotifSync] = useState(false);

  const { profile, signOut, isDark, toggleTheme } = useApp();
  const history = useHistory();

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  function handleLogout() {
    signOut();
    showNotification('Signed out successfully', 'success');
  }

  async function sendEmergencyAlert() {
    if (!profile) return;
    try {
      const position = await (window as any).Capacitor?.Geolocation?.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
      await supabase.from('emergency_alerts').insert({
        conductor_id: profile.id,
        lat: position?.coords.latitude,
        lng: position?.coords.longitude,
        status: 'active',
        type: selectedEmergencyType,
        created_at: new Date().toISOString(),
      });
      showNotification('Emergency alert sent! Admin notified.', 'success');
      setShowEmergencyAlert(false);
      setSelectedEmergencyType('other');
    } catch (error) {
      // Fallback: send alert without location
      await supabase.from('emergency_alerts').insert({
        conductor_id: profile.id,
        status: 'active',
        type: selectedEmergencyType,
        created_at: new Date().toISOString(),
      });
      showNotification('Emergency alert sent! Admin notified.', 'success');
      setShowEmergencyAlert(false);
      setSelectedEmergencyType('other');
    }
  }

  return (
    <IonPage>
      <PageHeader showBack title="Settings" subtitle="Manage your account" />

      <IonContent className="app-page-bg">
        <div className="page-content">
          {/* Profile Hero */}
          <SoftCard variant="hero" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 20 }}>
              <ProfileAvatar name={profile?.full_name || 'Conductor'} size="xl" />
              <div style={{ flex: 1, color: 'white' }}>
                <StatusBadge variant="success" dot style={{ marginBottom: 8, background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                  Active Conductor
                </StatusBadge>
                <h2 style={{ margin: '0 0 4px', fontSize: '1.5rem', fontWeight: 900, color: 'white' }}>
                  {profile?.full_name || 'Conductor'}
                </h2>
                <p style={{ margin: 0, fontSize: '0.9rem', opacity: 0.85, color: 'white' }}>
                  ID: {profile?.id?.slice(-8).toUpperCase()}
                </p>
              </div>
            </div>
          </SoftCard>

          {/* Contact Info */}
          <div className="settings-group">
            <p className="settings-group__title">Profile</p>
            <div className="settings-item glass-card" style={{ cursor: 'default' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <Mail size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Email</span>
                <span className="settings-item__desc">{profile?.email || 'conductor@test.com'}</span>
              </div>
            </div>
            <div className="settings-item glass-card" style={{ cursor: 'default' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                <IdCard size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Employee ID</span>
                <span className="settings-item__desc">EMP-{profile?.id?.slice(-6).toUpperCase() || '001234'}</span>
              </div>
            </div>
            <div className="settings-item glass-card" style={{ cursor: 'default' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-success-subtle)', color: 'var(--color-success)' }}>
                <Building2 size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Department</span>
                <span className="settings-item__desc">Transportation Services</span>
              </div>
            </div>
          </div>

          {/* Settings */}
          <div className="settings-group">
            <p className="settings-group__title">Preferences</p>

            <div className="settings-item glass-card" style={{ cursor: 'pointer' }} onClick={toggleTheme}>
              <div className="settings-item__icon" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}>
                {isDark ? <Sun size={20} /> : <Moon size={20} />}
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Dark Mode</span>
                <span className="settings-item__desc">{isDark ? 'Switch to light theme' : 'Switch to dark theme'}</span>
              </div>
              <button
                type="button"
                className={`settings-toggle ${isDark ? 'settings-toggle--on' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
                aria-label="Toggle dark mode"
              >
                <span className="settings-toggle__thumb" />
              </button>
            </div>

            <button type="button" className="settings-item glass-card" onClick={() => setShowNotificationsModal(true)}>
              <div className="settings-item__icon" style={{ background: 'var(--color-warning-subtle)', color: '#A16207' }}>
                <Bell size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Notifications</span>
                <span className="settings-item__desc">Manage alert preferences</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item glass-card" onClick={() => setShowSecurityModal(true)}>
              <div className="settings-item__icon" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                <Shield size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Security</span>
                <span className="settings-item__desc">Password and authentication</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>
          </div>

          {/* Support & About */}
          <div className="settings-group">
            <p className="settings-group__title">Support</p>

            <button type="button" className="settings-item glass-card" onClick={() => setShowHelpModal(true)}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <HelpCircle size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Help & Support</span>
                <span className="settings-item__desc">Get help and contact support</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item glass-card" onClick={() => setShowAboutModal(true)}>
              <div className="settings-item__icon" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <Info size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">About</span>
                <span className="settings-item__desc">CommutAI Conductor v1.0.0</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>
          </div>

          <button
            type="button"
            className="emergency-btn"
            onClick={() => setShowEmergencyAlert(true)}
          >
            <div style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(239, 68, 68, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <AlertCircle size={22} color="#DC2626" />
            </div>
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, display: 'block', color: '#DC2626' }}>EMERGENCY</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.9, display: 'block', color: 'var(--text-secondary)' }}>Send Alert to Admin</span>
            </div>
          </button>

          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            padding: '12px',
            marginBottom: 16,
          }}>
            <PrimaryButton
              onClick={() => setShowLogoutAlert(true)}
              variant="secondary"
              fullWidth
              icon={<LogOut size={20} />}
              style={{
                background: 'var(--bg-elevated)',
                border: '1.5px solid rgba(239,68,68,0.3)',
                color: '#DC2626',
              }}
            >
              Sign Out
            </PrimaryButton>
          </div>

          <div style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            padding: '12px 16px',
            textAlign: 'center',
            marginBottom: 16,
          }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              OMANFORTSCO · Transportation Services
            </p>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              Made with care for Filipino commuters
            </p>
          </div>
        </div>

        <BottomNav />
      </IonContent>

      <IonAlert
        isOpen={showLogoutAlert}
        onDidDismiss={() => setShowLogoutAlert(false)}
        header="Sign Out"
        message="Are you sure you want to sign out of your account?"
        cssClass="solid-alert"
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'Sign Out', handler: handleLogout },
        ]}
      />

      <IonModal
        isOpen={showEmergencyAlert}
        onDidDismiss={() => setShowEmergencyAlert(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div className="glass-modal">
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                background: 'rgba(239, 68, 68, 0.12)',
                borderRadius: 10,
                padding: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <AlertCircle size={20} color="#DC2626" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                  Select Emergency Type
                </h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  This will send your GPS location to the admin
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEmergencyAlert(false)}
              style={{
                background: 'var(--bg-secondary)',
                border: '2px solid var(--border-medium)',
                borderRadius: 8,
                padding: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={18} color="var(--text-primary)" />
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: 'rgba(255, 255, 255, 0.2)', margin: '16px 0' }} />

          {/* Emergency Type Cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { type: 'medical',    label: 'Medical',    desc: 'Medical emergency on board',      icon: Stethoscope,  color: '#DC2626', bg: 'rgba(220,38,38,0.08)' },
              { type: 'accident',   label: 'Accident',   desc: 'Vehicle or road accident',        icon: Car,          color: '#D97706', bg: 'rgba(217,119,6,0.08)' },
              { type: 'security',   label: 'Security',   desc: 'Threat or suspicious activity',   icon: ShieldAlert,  color: '#7C3AED', bg: 'rgba(124,58,237,0.08)' },
              { type: 'mechanical', label: 'Mechanical', desc: 'Bus breakdown or malfunction',    icon: Wrench,       color: '#2563EB', bg: 'rgba(37,99,235,0.08)' },
              { type: 'other',      label: 'Other',      desc: 'Other emergency situation',       icon: ClipboardList, color: '#059669', bg: 'rgba(5,150,105,0.08)' },
            ].map(({ type, label, desc, icon: Icon, color, bg }) => (
              <button
                key={type}
                type="button"
                className="glass-modal__option"
                onClick={() => {
                  setSelectedEmergencyType(type as any);
                  sendEmergencyAlert();
                }}
                style={{ borderColor: `${color}40` }}
              >
                <div style={{
                  background: `${color}18`,
                  borderRadius: 10,
                  width: 42,
                  height: 42,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={20} color={color} />
                </div>
                <div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                    {label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {desc}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {/* Cancel */}
          <button
            type="button"
            className="glass-modal__option"
            onClick={() => setShowEmergencyAlert(false)}
            style={{ marginTop: 14, justifyContent: 'center', fontWeight: 700 }}
          >
            Cancel
          </button>
        </div>
      </IonModal>

      <AppToast
        isOpen={showToast}
        message={toastMessage}
        color={toastColor}
        onDismiss={() => setShowToast(false)}
      />

      {/* ── Notifications Modal ─────────────────────────────────── */}
      <IonModal
        isOpen={showNotificationsModal}
        onDidDismiss={() => setShowNotificationsModal(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div className="glass-modal">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'rgba(250,204,21,0.15)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bell size={20} color="#A16207" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>Notifications</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Manage your alert preferences</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowNotificationsModal(false)}
              style={{ background: 'var(--bg-secondary)', border: '2px solid var(--border-medium)', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="var(--text-primary)" />
            </button>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.2)', margin: '16px 0' }} />

          {[
            { key: 'scanAlerts', label: 'Scan Alerts', desc: 'Notify when a QR scan succeeds or fails', icon: BellRing, value: notifScanAlerts, set: setNotifScanAlerts },
            { key: 'tripUpdates', label: 'Trip Updates', desc: 'Notify on trip start and end events', icon: BellRing, value: notifTripUpdates, set: setNotifTripUpdates },
            { key: 'emergency', label: 'Emergency Alerts', desc: 'Always receive emergency notifications', icon: AlertCircle, value: notifEmergency, set: setNotifEmergency },
            { key: 'sync', label: 'Sync Notifications', desc: 'Notify when offline scans are synced', icon: BellOff, value: notifSync, set: setNotifSync },
          ].map(({ key, label, desc, icon: Icon, value, set }) => (
            <button key={key} type="button" className="glass-modal__option"
              onClick={() => { set(!value); showNotification(`${label} ${!value ? 'enabled' : 'disabled'}`, 'success'); }}
              style={{ marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: value ? 'rgba(249,115,22,0.15)' : 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={value ? 'var(--color-primary)' : 'var(--text-secondary)'} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{label}</p>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{desc}</p>
              </div>
              <div style={{
                width: 44, height: 26, borderRadius: 13,
                background: value ? 'var(--color-primary)' : 'var(--border-medium)',
                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: value ? 20 : 3,
                  width: 20, height: 20, borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }} />
              </div>
            </button>
          ))}

          <button type="button" className="glass-modal__option"
            onClick={() => setShowNotificationsModal(false)}
            style={{ marginTop: 8, justifyContent: 'center', fontWeight: 700 }}>
            Done
          </button>
        </div>
      </IonModal>

      {/* ── Security Modal ──────────────────────────────────────── */}
      <IonModal
        isOpen={showSecurityModal}
        onDidDismiss={() => setShowSecurityModal(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div className="glass-modal">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'var(--color-primary-subtle)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={20} color="var(--color-primary)" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>Security</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Account protection settings</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowSecurityModal(false)}
              style={{ background: 'var(--bg-secondary)', border: '2px solid var(--border-medium)', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="var(--text-primary)" />
            </button>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.2)', margin: '16px 0' }} />

          {/* Account info */}
          <div style={{ marginBottom: 12, padding: '14px 16px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signed in as</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{profile?.email}</p>
          </div>

          {[
            {
              icon: KeyRound, label: 'Change Password',
              desc: 'Update your account password',
              color: 'var(--color-primary)',
              action: () => {
                setShowSecurityModal(false);
                showNotification('Password reset email sent to ' + profile?.email, 'success');
                supabase.auth.resetPasswordForEmail(profile?.email || '');
              },
            },
            {
              icon: Lock, label: 'Two-Factor Authentication',
              desc: 'Extra layer of account security',
              color: '#7C3AED',
              action: () => showNotification('2FA setup coming in a future update', 'warning'),
            },
            {
              icon: Eye, label: 'Active Sessions',
              desc: 'View and manage login sessions',
              color: 'var(--color-info)',
              action: () => showNotification('Session management coming in a future update', 'warning'),
            },
          ].map(({ icon: Icon, label, desc, color, action }) => (
            <button key={label} type="button" className="glass-modal__option" onClick={action} style={{ marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={color} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{label}</p>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{desc}</p>
              </div>
              <ChevronRight size={16} color="var(--text-tertiary)" />
            </button>
          ))}

          <button type="button" className="glass-modal__option"
            onClick={() => setShowSecurityModal(false)}
            style={{ marginTop: 8, justifyContent: 'center', fontWeight: 700 }}>
            Close
          </button>
        </div>
      </IonModal>

      {/* ── Help & Support Modal ────────────────────────────────── */}
      <IonModal
        isOpen={showHelpModal}
        onDidDismiss={() => setShowHelpModal(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div className="glass-modal">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'var(--color-info-subtle)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <HelpCircle size={20} color="var(--color-info)" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>Help & Support</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>We're here to help</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowHelpModal(false)}
              style={{ background: 'var(--bg-secondary)', border: '2px solid var(--border-medium)', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="var(--text-primary)" />
            </button>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.2)', margin: '16px 0' }} />

          {/* FAQ quick links */}
          <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Common Questions
          </p>
          {[
            { q: 'How do I scan a QR card?', a: 'Tap "QR Scanner" from the home screen, select Onboarding or Alighting, then point the camera at the passenger\'s card.' },
            { q: 'What if the scan fails offline?', a: 'Offline scans are queued automatically and synced as soon as the device reconnects to the internet.' },
            { q: 'How does cash payment work?', a: 'If a card has insufficient balance, you\'ll see a "Pay in Cash" option. Tap it to record a cash payment without deducting card balance.' },
            { q: 'How do I send an emergency alert?', a: 'Scroll down on the Settings page and tap the red EMERGENCY button. Select the emergency type and it will be sent to your admin.' },
          ].map(({ q, a }) => (
            <div key={q} style={{ marginBottom: 10, padding: '12px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
              <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{q}</p>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{a}</p>
            </div>
          ))}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.15)', margin: '14px 0' }} />
          <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Contact Support
          </p>

          {[
            { icon: MessageCircle, label: 'Chat with Support', desc: 'Available Mon–Fri, 8am–5pm', color: '#22C55E', action: () => showNotification('Opening support chat…', 'success') },
            { icon: Phone, label: 'Call Helpdesk', desc: '+63 (82) 123-4567', color: 'var(--color-info)', action: () => showNotification('Helpdesk: +63 (82) 123-4567', 'success') },
            { icon: Globe, label: 'Visit Help Center', desc: 'support.omanfortsco.ph', color: 'var(--color-primary)', action: () => showNotification('Help center URL copied', 'success') },
          ].map(({ icon: Icon, label, desc, color, action }) => (
            <button key={label} type="button" className="glass-modal__option" onClick={action} style={{ marginBottom: 8 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} color={color} />
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{label}</p>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{desc}</p>
              </div>
              <ChevronRight size={16} color="var(--text-tertiary)" />
            </button>
          ))}

          <button type="button" className="glass-modal__option"
            onClick={() => setShowHelpModal(false)}
            style={{ marginTop: 8, justifyContent: 'center', fontWeight: 700 }}>
            Close
          </button>
        </div>
      </IonModal>

      {/* ── About Modal ─────────────────────────────────────────── */}
      <IonModal
        isOpen={showAboutModal}
        onDidDismiss={() => setShowAboutModal(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div className="glass-modal">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Info size={20} color="var(--text-secondary)" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>About</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>CommutAI Conductor App</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowAboutModal(false)}
              style={{ background: 'var(--bg-secondary)', border: '2px solid var(--border-medium)', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="var(--text-primary)" />
            </button>
          </div>
          <div style={{ height: 1, background: 'rgba(255,255,255,0.2)', margin: '16px 0' }} />

          {/* App identity */}
          <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
            <div style={{ width: 72, height: 72, borderRadius: 22, background: 'var(--color-primary-gradient)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Star size={34} color="white" />
            </div>
            <p style={{ margin: '0 0 4px', fontWeight: 900, fontSize: '1.2rem', color: 'var(--text-primary)' }}>CommutAI Conductor</p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-primary)', fontWeight: 600 }}>Version 1.0.0</p>
          </div>

          {[
            { icon: Building2, label: 'Developer', value: 'OMANFORTSCO', color: 'var(--color-primary)' },
            { icon: Globe, label: 'Platform', value: 'Android · iOS · Web', color: 'var(--color-info)' },
            { icon: Code2, label: 'Build', value: 'Ionic · React · Capacitor', color: '#7C3AED' },
            { icon: FileText, label: 'License', value: 'Proprietary · All rights reserved', color: '#059669' },
          ].map(({ icon: Icon, label, value, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '12px 14px', background: 'var(--bg-tertiary)', border: '1px solid var(--glass-border)', borderRadius: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={16} color={color} />
              </div>
              <div>
                <p style={{ margin: '0 0 1px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{value}</p>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 6, padding: '12px 14px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 12, textAlign: 'center' }}>
            <p style={{ margin: '0 0 2px', fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-primary)' }}>Made with care for Filipino commuters 🇵🇭</p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Transportation Services · Cagayan de Oro</p>
          </div>

          <button type="button" className="glass-modal__option"
            onClick={() => setShowAboutModal(false)}
            style={{ marginTop: 14, justifyContent: 'center', fontWeight: 700 }}>
            Close
          </button>
        </div>
      </IonModal>
    </IonPage>
  );
};

export default ProfilePage;
