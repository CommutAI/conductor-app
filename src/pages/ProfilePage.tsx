import React, { useState } from 'react';
import {
  IonPage,
  IonContent,
  IonAlert,
  IonActionSheet,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import {
  Mail, IdCard, Building2, Bell, Shield, HelpCircle,
  LogOut, Moon, Sun, Info, ChevronRight, AlertCircle,
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
          <SoftCard variant="gradient" style={{ marginBottom: 24 }}>
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
            <div className="settings-item" style={{ cursor: 'default' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <Mail size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Email</span>
                <span className="settings-item__desc">{profile?.email || 'conductor@test.com'}</span>
              </div>
            </div>
            <div className="settings-item" style={{ cursor: 'default' }}>
              <div className="settings-item__icon" style={{ background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>
                <IdCard size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Employee ID</span>
                <span className="settings-item__desc">EMP-{profile?.id?.slice(-6).toUpperCase() || '001234'}</span>
              </div>
            </div>
            <div className="settings-item" style={{ cursor: 'default' }}>
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

            <div className="settings-item" style={{ cursor: 'pointer' }} onClick={toggleTheme}>
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

            <button type="button" className="settings-item" onClick={() => showNotification('Notifications settings coming soon', 'warning')}>
              <div className="settings-item__icon" style={{ background: 'var(--color-warning-subtle)', color: '#A16207' }}>
                <Bell size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Notifications</span>
                <span className="settings-item__desc">Manage alert preferences</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item" onClick={() => showNotification('Security settings coming soon', 'warning')}>
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

            <button type="button" className="settings-item" onClick={() => showNotification('Help center coming soon', 'warning')}>
              <div className="settings-item__icon" style={{ background: 'var(--color-info-subtle)', color: 'var(--color-info)' }}>
                <HelpCircle size={20} />
              </div>
              <div className="settings-item__content">
                <span className="settings-item__label">Help & Support</span>
                <span className="settings-item__desc">Get help and contact support</span>
              </div>
              <ChevronRight size={18} className="settings-item__chevron" />
            </button>

            <button type="button" className="settings-item" style={{ cursor: 'default' }}>
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
            className="emergency-btn" 
            onClick={() => setShowEmergencyAlert(true)}
            style={{
              padding: '14px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
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

      <IonActionSheet
        isOpen={showEmergencyAlert}
        onDidDismiss={() => setShowEmergencyAlert(false)}
        header="Select Emergency Type"
        subHeader="This will send your GPS location to the admin"
        buttons={[
          {
            text: '🏥 Medical',
            role: 'destructive',
            handler: () => {
              setSelectedEmergencyType('medical');
              sendEmergencyAlert();
            },
          },
          {
            text: '🚗 Accident',
            role: 'destructive',
            handler: () => {
              setSelectedEmergencyType('accident');
              sendEmergencyAlert();
            },
          },
          {
            text: '🛡️ Security',
            role: 'destructive',
            handler: () => {
              setSelectedEmergencyType('security');
              sendEmergencyAlert();
            },
          },
          {
            text: '🔧 Mechanical',
            role: 'destructive',
            handler: () => {
              setSelectedEmergencyType('mechanical');
              sendEmergencyAlert();
            },
          },
          {
            text: '📋 Other',
            role: 'destructive',
            handler: () => {
              setSelectedEmergencyType('other');
              sendEmergencyAlert();
            },
          },
          {
            text: 'Cancel',
            role: 'cancel',
          },
        ]}
      />

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
