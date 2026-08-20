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
          <SoftCard variant="gradient" style={{ marginBottom: 24 }} className="glass-card">
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
            <div className="settings-item glass-card" style={{ cursor: 'default', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <Mail size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Email</span>
                <span className="settings-item__desc">{profile?.email || 'conductor@test.com'}</span>
              </div>
            </div>
            <div className="settings-item glass-card" style={{ cursor: 'default', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                <IdCard size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Employee ID</span>
                <span className="settings-item__desc">EMP-{profile?.id?.slice(-6).toUpperCase() || '001234'}</span>
              </div>
            </div>
            <div className="settings-item glass-card" style={{ cursor: 'default', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
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

            <div className="settings-item glass-card" style={{ cursor: 'pointer', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }} onClick={toggleTheme}>
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

            <button type="button" className="settings-item glass-card" style={{ background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }} onClick={() => showNotification('Notifications settings coming soon', 'warning')}>
              <div className="settings-item__icon" style={{ background: 'var(--color-warning-subtle)', color: '#A16207' }}>
                <Bell size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Notifications</span>
                <span className="settings-item__desc">Manage alert preferences</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item glass-card" style={{ background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }} onClick={() => showNotification('Security settings coming soon', 'warning')}>
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

            <button type="button" className="settings-item glass-card" style={{ background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }} onClick={() => showNotification('Help center coming soon', 'warning')}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <HelpCircle size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Help & Support</span>
                <span className="settings-item__desc">Get help and contact support</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item glass-card" style={{ cursor: 'default', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
              <div className="settings-item__icon" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                <Info size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">About</span>
                <span className="settings-item__desc">CommutAI Conductor v1.0.0</span>
              </div>
            </button>
          </div>

          <button
            type="button"
            className="emergency-btn glass-card"
            onClick={() => setShowEmergencyAlert(true)}
            style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(239, 68, 68, 0.3)'
            }}
          >
            <AlertCircle size={20} />
            <div style={{ textAlign: 'left' }}>
              <span style={{ fontSize: '0.95rem', fontWeight: 800, display: 'block' }}>EMERGENCY</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.9, display: 'block' }}>Send Alert to Admin</span>
            </div>
          </button>

          <PrimaryButton
            onClick={() => setShowLogoutAlert(true)}
            variant="secondary"
            fullWidth
            icon={<LogOut size={20} />}
            style={{ marginBottom: 16 }}
          >
            Sign Out
          </PrimaryButton>

          <SoftCard padding="sm" style={{ textAlign: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              OMANFORTSCO · Transportation Services
            </p>
            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
              Made with care for Filipino commuters
            </p>
          </SoftCard>
        </div>

        <BottomNav />
      </IonContent>

      <IonAlert
        isOpen={showLogoutAlert}
        onDidDismiss={() => setShowLogoutAlert(false)}
        header="Sign Out"
        message="Are you sure you want to sign out of your account?"
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
        style={{ '--height': 'auto' }}
      >
        <div style={{ padding: '24px 20px 36px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
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
                onClick={() => {
                  setSelectedEmergencyType(type as any);
                  sendEmergencyAlert();
                }}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  border: `1.5px solid ${color}40`,
                  borderRadius: 14,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                }}
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
            onClick={() => setShowEmergencyAlert(false)}
            style={{
              width: '100%',
              marginTop: 14,
              background: 'var(--bg-secondary)',
              border: '2px solid var(--border-medium)',
              borderRadius: 14,
              padding: '14px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
            }}
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
    </IonPage>
  );
};

export default ProfilePage;
