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
import { smsService } from '../services/smsService';
import { geocodingService } from '../services/geocodingService';
import { gpsService } from '../services/gpsService';
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
  const [showTermsModal, setShowTermsModal] = useState(false);

  // Notification preferences
  const [notifScanAlerts, setNotifScanAlerts] = useState(true);
  const [notifTripUpdates, setNotifTripUpdates] = useState(true);
  const [notifEmergency, setNotifEmergency] = useState(true);
  const [notifSync, setNotifSync] = useState(false);

  const { profile, signOut, isDark, toggleTheme, currentTrip, currentBus } = useApp();
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
    
    // Check if there's an active trip
    if (!currentTrip?.id) {
      showNotification('Please start a trip before sending emergency alerts.', 'warning');
      return;
    }
    
    let gpsPosition = null;
    let locationName = undefined;
    let driverName = 'Unknown';

    try {
      // Step 1: Get GPS position using GPS service (tries Pi GPS first, then mobile)
      gpsPosition = await gpsService.getCurrentPosition();
      
      if (!gpsPosition) {
        showNotification('Unable to get GPS location. Sending alert with coordinates disabled.', 'warning');
      } else {
        console.log(`[Emergency Alert] GPS Position: ${gpsPosition.lat}, ${gpsPosition.lng} from ${gpsPosition.source}`);
      }
      
      // Step 2: Fetch driver information in parallel with geocoding
      const driverPromise = fetchDriverInfo();
      const geocodingPromise = gpsPosition 
        ? geocodingService.getLocationName(gpsPosition.lat, gpsPosition.lng)
        : Promise.resolve(undefined);

      const [driverData, geoResult] = await Promise.all([driverPromise, geocodingPromise]);
      
      if (driverData) driverName = driverData;
      if (geoResult) locationName = geoResult;

      // Step 3: Insert emergency alert to database with retry logic
      const alertData = await insertEmergencyAlertWithRetry(gpsPosition, locationName);
      
      // Step 4: Queue SMS with comprehensive information
      if (profile.emergency_phone) {
        const location = gpsPosition ? {
          lat: gpsPosition.lat,
          lng: gpsPosition.lng
        } : undefined;

        await smsService.queueEmergencySMS(
          profile.emergency_phone,
          {
            emergencyType: selectedEmergencyType,
            location,
            locationName,
            tripId: currentTrip.id,
            busInfo: currentBus ? {
              plateNumber: currentBus.plate_number,
              route: currentBus.route
            } : undefined,
            driverName,
            conductorName: profile.full_name
          }
        );
      }

      const sourceText = gpsPosition?.source === 'pi_gps' ? 'Raspberry Pi GPS' : 'Mobile GPS';
      showNotification(`Emergency alert sent! Location from ${sourceText}. Admin notified via SMS.`, 'success');
      setShowEmergencyAlert(false);
      setSelectedEmergencyType('other');
      
    } catch (error) {
      console.error('Error sending emergency alert:', error);
      
      // Final fallback: send alert with minimal information
      try {
        await sendMinimalEmergencyAlert(driverName);
        showNotification('Emergency alert sent with basic information.', 'success');
        setShowEmergencyAlert(false);
        setSelectedEmergencyType('other');
      } catch (fallbackError) {
        console.error('Error in fallback emergency alert:', fallbackError);
        showNotification('Failed to send emergency alert. Please try again or call emergency services directly.', 'danger');
      }
    }
  }

  // Helper function: Fetch driver information
  async function fetchDriverInfo(): Promise<string | null> {
    if (!currentBus?.assigned_driver_id) return null;
    
    try {
      const { data: driver } = await supabase
        .from('staff_users')
        .select('full_name')
        .eq('id', currentBus.assigned_driver_id)
        .maybeSingle();
      return driver?.full_name || null;
    } catch (error) {
      console.error('Error fetching driver info:', error);
      return null;
    }
  }

  // Helper function: Insert emergency alert with retry logic
  async function insertEmergencyAlertWithRetry(gpsPosition: any, locationName: string | undefined, maxRetries = 2): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { data: alert, error: insertError } = await supabase.from('emergency_alerts').insert({
          conductor_id: profile.id,
          trip_id: currentTrip.id,
          lat: gpsPosition?.lat,
          lng: gpsPosition?.lng,
          location_name: locationName,
          location_source: gpsPosition?.source || 'unknown',
          location_accuracy: gpsPosition?.accuracy,
          status: 'active',
          type: selectedEmergencyType,
          created_at: new Date().toISOString(),
        }).select().single();

        if (insertError) throw insertError;
        return alert;
      } catch (error) {
        console.warn(`Database insert attempt ${attempt} failed:`, error);
        if (attempt === maxRetries) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
    throw new Error('Failed to insert emergency alert');
  }

  // Helper function: Send minimal emergency alert as final fallback
  async function sendMinimalEmergencyAlert(driverName: string): Promise<void> {
    const { data: alert, error: dbError } = await supabase.from('emergency_alerts').insert({
      conductor_id: profile.id,
      trip_id: currentTrip.id,
      status: 'active',
      type: selectedEmergencyType,
      location_source: 'fallback',
      created_at: new Date().toISOString(),
    }).select().single();

    if (dbError) throw dbError;

    if (profile.emergency_phone) {
      await smsService.queueEmergencySMS(
        profile.emergency_phone,
        {
          emergencyType: selectedEmergencyType,
          location: undefined,
          tripId: currentTrip.id,
          busInfo: currentBus ? {
            plateNumber: currentBus.plate_number,
            route: currentBus.route
          } : undefined,
          driverName,
          conductorName: profile.full_name
        }
      );
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
        <div style={{ 
          background: 'white', 
          borderRadius: 16, 
          padding: '20px 16px',
          minHeight: '100%'
        }}>
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
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>
                  Select Emergency Type
                </h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>
                  This will send your GPS location to the admin
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowEmergencyAlert(false)}
              style={{
                background: '#f5f5f5',
                border: '2px solid #e0e0e0',
                borderRadius: 8,
                padding: 6,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={18} color="#1a1a1a" />
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

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
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 12,
                  padding: '14px 16px',
                  background: '#f9f9f9',
                  border: `1px solid ${color}40`,
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'background 0.2s, border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f0f0f0';
                  e.currentTarget.style.borderColor = color;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f9f9f9';
                  e.currentTarget.style.borderColor = `${color}40`;
                }}
              >
                <div style={{
                  background: `${color}18`,
                  borderRadius: 12,
                  width: 44,
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon size={20} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem', color: '#1a1a1a' }}>
                    {label}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: 1.3 }}>
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
              justifyContent: 'center', 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '16px',
              background: '#f9f9f9',
              border: '1px solid #e8e8e8',
              borderRadius: 12,
              cursor: 'pointer',
              color: '#1a1a1a',
              fontSize: '0.95rem',
              transition: 'background 0.2s, border-color 0.2s',
              boxSizing: 'border-box',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0f0f0';
              e.currentTarget.style.borderColor = '#d0d0d0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f9f9f9';
              e.currentTarget.style.borderColor = '#e8e8e8';
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

      {/* ── Notifications Modal ─────────────────────────────────── */}
      <IonModal
        isOpen={showNotificationsModal}
        onDidDismiss={() => setShowNotificationsModal(false)}
        breakpoints={[0, 1]}
        initialBreakpoint={1}
        style={{ '--height': 'auto', '--background': 'var(--bg-secondary)' }}
      >
        <div style={{ 
          background: 'white', 
          borderRadius: 16, 
          padding: '20px 16px',
          minHeight: '100%'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'rgba(250,204,21,0.15)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bell size={20} color="#A16207" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>Notifications</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>Manage your alert preferences</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowNotificationsModal(false)}
              style={{ background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="#1a1a1a" />
            </button>
          </div>
          <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

          {[
            { key: 'scanAlerts', label: 'Scan Alerts', desc: 'Notify when a QR scan succeeds or fails', icon: BellRing, value: notifScanAlerts, set: setNotifScanAlerts },
            { key: 'tripUpdates', label: 'Trip Updates', desc: 'Notify on trip start and end events', icon: BellRing, value: notifTripUpdates, set: setNotifTripUpdates },
            { key: 'emergency', label: 'Emergency Alerts', desc: 'Always receive emergency notifications', icon: AlertCircle, value: notifEmergency, set: setNotifEmergency },
            { key: 'sync', label: 'Sync Notifications', desc: 'Notify when offline scans are synced', icon: BellOff, value: notifSync, set: setNotifSync },
          ].map(({ key, label, desc, icon: Icon, value, set }) => (
            <button key={key} type="button"
              onClick={() => { set(!value); showNotification(`${label} ${!value ? 'enabled' : 'disabled'}`, 'success'); }}
              style={{ 
                width: '100%',
                marginBottom: 10,
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                padding: '14px 16px',
                background: '#f9f9f9',
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f0f0f0';
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f9f9f9';
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: value ? 'rgba(249,115,22,0.15)' : '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} color={value ? '#f97316' : '#666'} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem', color: '#1a1a1a' }}>{label}</p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: 1.3 }}>{desc}</p>
              </div>
              <div style={{
                width: 48, height: 28, borderRadius: 14,
                background: value ? '#f97316' : '#d0d0d0',
                position: 'relative', flexShrink: 0, transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: value ? 22 : 3,
                  width: 22, height: 22, borderRadius: '50%',
                  background: 'white', transition: 'left 0.2s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                }} />
              </div>
            </button>
          ))}

          <button type="button"
            onClick={() => setShowNotificationsModal(false)}
            style={{ 
              width: '100%',
              marginTop: 8, 
              justifyContent: 'center', 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '16px',
              background: '#f9f9f9',
              border: '1px solid #e8e8e8',
              borderRadius: 12,
              cursor: 'pointer',
              color: '#1a1a1a',
              fontSize: '0.95rem',
              transition: 'background 0.2s, border-color 0.2s',
              boxSizing: 'border-box',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0f0f0';
              e.currentTarget.style.borderColor = '#d0d0d0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f9f9f9';
              e.currentTarget.style.borderColor = '#e8e8e8';
            }}
          >
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
        <div style={{ 
          background: 'white', 
          borderRadius: 16, 
          padding: '20px 16px',
          minHeight: '100%'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: 'rgba(59,130,246,0.15)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Shield size={20} color="#3b82f6" />
              </div>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>Security</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>Account protection settings</p>
              </div>
            </div>
            <button type="button" onClick={() => setShowSecurityModal(false)}
              style={{ background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <X size={18} color="#1a1a1a" />
            </button>
          </div>
          <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

          {/* Account info */}
          <div style={{ marginBottom: 12, padding: '14px 16px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 12 }}>
            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Signed in as</p>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: '#1a1a1a' }}>{profile?.email}</p>
          </div>

          {[
            {
              icon: KeyRound, label: 'Change Password',
              desc: 'Update your account password',
              color: '#3b82f6',
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
              color: '#0ea5e9',
              action: () => showNotification('Session management coming in a future update', 'warning'),
            },
          ].map(({ icon: Icon, label, desc, color, action }) => (
            <button key={label} type="button"
              onClick={action}
              style={{ 
                width: '100%',
                marginBottom: 10,
                display: 'flex', 
                alignItems: 'center', 
                gap: 12,
                padding: '14px 16px',
                background: '#f9f9f9',
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f0f0f0';
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f9f9f9';
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} color={color} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem', color: '#1a1a1a' }}>{label}</p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: 1.3 }}>{desc}</p>
              </div>
              <ChevronRight size={18} color="#999" />
            </button>
          ))}

          <button type="button"
            onClick={() => setShowSecurityModal(false)}
            style={{ 
              width: '100%',
              marginTop: 8, 
              justifyContent: 'center', 
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '16px',
              background: '#f9f9f9',
              border: '1px solid #e8e8e8',
              borderRadius: 12,
              cursor: 'pointer',
              color: '#1a1a1a',
              fontSize: '0.95rem',
              transition: 'background 0.2s, border-color 0.2s',
              boxSizing: 'border-box',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f0f0f0';
              e.currentTarget.style.borderColor = '#d0d0d0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f9f9f9';
              e.currentTarget.style.borderColor = '#e8e8e8';
            }}
          >
            Close
          </button>
        </div>
      </IonModal>

      {/* ── Help & Support Modal ────────────────────────────────── */}
      <IonModal
        isOpen={showHelpModal}
        onDidDismiss={() => setShowHelpModal(false)}
        breakpoints={[0, 0.9]}
        initialBreakpoint={0.9}
        style={{ '--background': 'white' }}
      >
        <IonContent scrollY={true} style={{ '--background': 'white', '--overflow': 'auto' }}>
          <div style={{ padding: '20px 16px', paddingBottom: '100px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'rgba(14,165,233,0.15)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <HelpCircle size={20} color="#0ea5e9" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>Help & Support</h2>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>We're here to help</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowHelpModal(false)}
                style={{ background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color="#1a1a1a" />
              </button>
            </div>
            <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

            {/* FAQ quick links */}
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Common Questions
            </p>
            {[
              { q: 'How do I scan a QR card?', a: 'Tap "QR Scanner" from the home screen, select Onboarding or Alighting, then point the camera at the passenger\'s card. Make sure the QR code is clearly visible and well-lit.' },
              { q: 'What if the scan fails offline?', a: 'Offline scans are queued automatically and synced as soon as the device reconnects to the internet. You can continue scanning normally - the app will handle the sync automatically.' },
              { q: 'How does cash payment work?', a: 'If a card has insufficient balance, you\'ll see a "Pay in Cash" option. Tap it to record a cash payment without deducting card balance. The passenger pays you directly.' },
              { q: 'How do I send an emergency alert?', a: 'Scroll down on the Settings page and tap the red EMERGENCY button. Select the emergency type (Medical, Accident, Security, Mechanical, or Other) and it will be sent to your admin with GPS location.' },
              { q: 'What are the different card types?', a: 'Regular cards have standard fares. Student, Senior Citizen, and PWD cards get automatic discounts. Temporary tickets are single-use and don\'t require balance checks.' },
              { q: 'How do I handle baggage fees?', a: 'After scanning a card, you can select baggage size and weight. The system automatically calculates the fee based on the baggage fee matrix. Small (10kg), Medium (20kg), Large (30kg), and Oversized (31kg+) have different rates.' },
              { q: 'What happens when a trip ends?', a: 'Go to the home screen and tap "End Trip". This will stop fare collection, GPS tracking, and prepare the trip data for syncing. All passenger data is saved to the database.' },
              { q: 'How do I check my trip statistics?', a: 'On the home screen, you can see real-time statistics: total passengers, fare collected, current route, and active trip duration. This updates automatically as you scan passengers.' },
              { q: 'Can I change a passenger\'s destination?', a: 'Currently, destinations are set during onboarding and cannot be changed. Make sure to select the correct destination when first scanning the passenger\'s card.' },
              { q: 'What if a passenger has no balance?', a: 'The app will show an "Insufficient Balance" message. You can offer the cash payment option, ask them to top up their card at a station, or use a temporary ticket if available.' },
              { q: 'How does GPS alighting work?', a: 'When in Alighting mode, the app uses GPS to verify the passenger is at their designated stop. OpenStreetMap data helps confirm the location for accurate fare processing.' },
              { q: 'What if the camera doesn\'t work?', a: 'Make sure camera permissions are granted. If the camera is frozen, try closing and reopening the scanner. In extreme cases, restart the app or device.' },
            ].map(({ q, a }) => (
              <div key={q} style={{ marginBottom: 10, padding: '14px 16px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 12 }}>
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.88rem', color: '#1a1a1a' }}>{q}</p>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', lineHeight: 1.5 }}>{a}</p>
              </div>
            ))}

            <div style={{ height: 1, background: '#e0e0e0', margin: '14px 0' }} />
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              App Information
            </p>

            {[
              { icon: Globe, label: 'Visit Help Center', desc: 'support.omanfortsco.ph', color: '#3b82f6', action: () => showNotification('Help center URL copied', 'success') },
            ].map(({ icon: Icon, label, desc, color, action }) => (
              <button key={label} type="button"
                onClick={action}
                style={{ 
                  width: '100%',
                  marginBottom: 10,
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 12,
                  padding: '14px 16px',
                  background: '#f9f9f9',
                  border: '1px solid #e8e8e8',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'background 0.2s, border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f0f0f0';
                  e.currentTarget.style.borderColor = '#d0d0d0';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f9f9f9';
                  e.currentTarget.style.borderColor = '#e8e8e8';
                }}
              >
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={20} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem', color: '#1a1a1a' }}>{label}</p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#666', lineHeight: 1.3 }}>{desc}</p>
                </div>
                <ChevronRight size={18} color="#999" />
              </button>
            ))}

            <button type="button"
              onClick={() => setShowHelpModal(false)}
              style={{ 
                width: '100%',
                marginTop: 8, 
                justifyContent: 'center', 
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px',
                background: '#f9f9f9',
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                cursor: 'pointer',
                color: '#1a1a1a',
                fontSize: '0.95rem',
                transition: 'background 0.2s, border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f0f0f0';
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f9f9f9';
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              Close
            </button>
          </div>
        </IonContent>
      </IonModal>

      {/* ── About Modal ─────────────────────────────────────────── */}
      <IonModal
        isOpen={showAboutModal}
        onDidDismiss={() => setShowAboutModal(false)}
        breakpoints={[0, 0.95]}
        initialBreakpoint={0.95}
        style={{ '--background': 'white' }}
      >
        <IonContent scrollY={true} style={{ '--background': 'white', '--overflow': 'auto' }}>
          <div style={{ padding: '20px 16px', paddingBottom: '100px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: '#f5f5f5', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Info size={20} color="#666" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>About</h2>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>CommutAI Conductor App</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAboutModal(false)}
                style={{ background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color="#1a1a1a" />
              </button>
            </div>
            <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

            {/* App identity */}
            <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
              <div style={{ width: 72, height: 72, borderRadius: 22, background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                <Star size={34} color="white" />
              </div>
              <p style={{ margin: '0 0 4px', fontWeight: 900, fontSize: '1.2rem', color: '#1a1a1a' }}>CommutAI Conductor</p>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#3b82f6', fontWeight: 600 }}>Version 1.0.0</p>
            </div>

            {/* App Information */}
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              App Information
            </p>
            {[
              { icon: Building2, label: 'Developer', value: 'OMANFORTSCO', color: '#3b82f6' },
              { icon: Globe, label: 'Platform', value: 'Android · iOS · Web', color: '#0ea5e9' },
              { icon: Code2, label: 'Build', value: 'Ionic · React · Capacitor', color: '#7C3AED' },
              { icon: FileText, label: 'License', value: 'Proprietary · All rights reserved', color: '#059669' },
            ].map(({ icon: Icon, label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, padding: '14px 16px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={color} />
                </div>
                <div>
                  <p style={{ margin: '0 0 1px', fontSize: '0.7rem', fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: '#1a1a1a' }}>{value}</p>
                </div>
              </div>
            ))}

            {/* Data Privacy Section */}
            <div style={{ height: 1, background: '#e0e0e0', margin: '14px 0' }} />
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Data Privacy & Security
            </p>
            
            <div style={{ padding: '16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Shield size={18} color="#3b82f6" />
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: '#1a1a1a' }}>Your Privacy Matters</p>
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', lineHeight: 1.5 }}>
                We are committed to protecting your personal data and ensuring your privacy while using our conductor app.
              </p>
            </div>

            {[
              { 
                icon: Lock, 
                label: 'Data Collection', 
                desc: 'We collect only essential data for fare processing: passenger card information, trip details, and GPS coordinates for safety and operational purposes.',
                color: '#059669' 
              },
              { 
                icon: Eye, 
                label: 'Data Usage', 
                desc: 'Your data is used solely for fare calculation, trip management, emergency alerts, and operational analytics. We never sell your personal information to third parties.',
                color: '#7C3AED' 
              },
              { 
                icon: ShieldAlert, 
                label: 'Data Security', 
                desc: 'All data is encrypted in transit and at rest. We use industry-standard security measures to protect your information from unauthorized access.',
                color: '#dc2626' 
              },
              { 
                icon: KeyRound, 
                label: 'Data Retention', 
                desc: 'Passenger data is retained for operational and regulatory compliance purposes. Historical trip data is securely stored and can be deleted upon request.',
                color: '#ea580c' 
              },
              { 
                icon: Bell, 
                label: 'Your Rights', 
                desc: 'You have the right to access, correct, or delete your personal data. Contact our support team for any privacy-related concerns.',
                color: '#0ea5e9' 
              },
            ].map(({ icon: Icon, label, desc, color }) => (
              <div key={label} style={{ marginBottom: 10, padding: '14px 16px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color={color} />
                  </div>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '0.88rem', color: '#1a1a1a' }}>{label}</p>
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', lineHeight: 1.5, paddingLeft: 42 }}>{desc}</p>
              </div>
            ))}

            {/* Contact & Legal */}
            <div style={{ height: 1, background: '#e0e0e0', margin: '14px 0' }} />
            <p style={{ margin: '0 0 10px', fontSize: '0.72rem', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Contact & Legal
            </p>

            {[
              { icon: Phone, label: 'Support Hotline', desc: '0910 8945427', color: '#059669' },
              { icon: Mail, label: 'Email Support', desc: 'admin@commutai.test', color: '#3b82f6' },
              { icon: Globe, label: 'Website', desc: 'www.omanfortsco.ph', color: '#0ea5e9' },
              { icon: MessageCircle, label: 'Terms of Service', desc: 'View full terms and conditions', color: '#7C3AED' },
            ].map(({ icon: Icon, label, desc, color }) => (
              <button key={label} type="button"
                onClick={() => label === 'Terms of Service' ? setShowTermsModal(true) : showNotification(`${label}: ${desc}`, 'success')}
                style={{ 
                  width: '100%',
                  marginBottom: 10,
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 12,
                  padding: '14px 16px',
                  background: '#f9f9f9',
                  border: '1px solid #e8e8e8',
                  borderRadius: 12,
                  cursor: 'pointer',
                  transition: 'background 0.2s, border-color 0.2s',
                  boxSizing: 'border-box',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f0f0f0';
                  e.currentTarget.style.borderColor = '#d0d0d0';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#f9f9f9';
                  e.currentTarget.style.borderColor = '#e8e8e8';
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} color={color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.88rem', color: '#1a1a1a' }}>{label}</p>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#666', lineHeight: 1.3 }}>{desc}</p>
                </div>
                <ChevronRight size={18} color="#999" />
              </button>
            ))}

            <div style={{ marginTop: 6, padding: '14px 16px', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 12, textAlign: 'center' }}>
              <p style={{ margin: '0 0 2px', fontSize: '0.8rem', fontWeight: 700, color: '#f97316' }}>Made with care for Filipino commuters 🇵🇭</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#666' }}>Transportation Services · Cagayan de Oro</p>
            </div>

            <button type="button"
              onClick={() => setShowAboutModal(false)}
              style={{ 
                width: '100%',
                marginTop: 14, 
                justifyContent: 'center', 
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px',
                background: '#f9f9f9',
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                cursor: 'pointer',
                color: '#1a1a1a',
                fontSize: '0.95rem',
                transition: 'background 0.2s, border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f0f0f0';
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f9f9f9';
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              Close
            </button>
          </div>
        </IonContent>
      </IonModal>

      {/* ── Terms of Service Modal ─────────────────────────────────── */}
      <IonModal
        isOpen={showTermsModal}
        onDidDismiss={() => setShowTermsModal(false)}
        breakpoints={[0, 0.95]}
        initialBreakpoint={0.95}
        style={{ '--background': 'white' }}
      >
        <IonContent scrollY={true} style={{ '--background': 'white', '--overflow': 'auto' }}>
          <div style={{ padding: '20px 16px', paddingBottom: '100px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: 'rgba(124,58,237,0.15)', borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageCircle size={20} color="#7C3AED" />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#1a1a1a' }}>Terms of Service</h2>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>CommutAI Conductor App</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowTermsModal(false)}
                style={{ background: '#f5f5f5', border: '2px solid #e0e0e0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={18} color="#1a1a1a" />
              </button>
            </div>
            <div style={{ height: 1, background: '#e0e0e0', margin: '16px 0' }} />

            {/* Last Updated */}
            <div style={{ padding: '12px 16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>
                <strong>Last Updated:</strong> January 2025
              </p>
            </div>

            {/* Agreement Section */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>1. Agreement to Terms</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                By downloading, accessing, or using the CommutAI Conductor App, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the app.
              </p>
            </div>

            {/* License Section */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>2. License Grant</h3>
              <p style={{ margin: '0 0 6px', fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                OMANFORTSCO grants you a limited, non-exclusive, non-transferable license to use the CommutAI Conductor App for your authorized duties as a bus conductor.
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                <li>Use is restricted to authorized personnel only</li>
                <li>Commercial use without permission is prohibited</li>
                <li>Reverse engineering or modification is not allowed</li>
              </ul>
            </div>

            {/* User Responsibilities */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>3. User Responsibilities</h3>
              <p style={{ margin: '0 0 6px', fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                As a conductor using this app, you agree to:
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                <li>Accurately scan passenger QR cards and record fares</li>
                <li>Handle passenger data with confidentiality and care</li>
                <li>Report any app issues or security concerns immediately</li>
                <li>Use the app only for official bus operations</li>
                <li>Maintain the security of your login credentials</li>
              </ul>
            </div>

            {/* Data Collection */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>4. Data Collection & Privacy</h3>
              <p style={{ margin: '0 0 6px', fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                The app collects necessary data for operational purposes:
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                <li>Passenger card information and fare transactions</li>
                <li>GPS location data for safety and route tracking</li>
                <li>Trip statistics and operational metrics</li>
                <li>Device information for app functionality</li>
              </ul>
              <p style={{ margin: '8px 0 0', fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                All data collection complies with the Data Privacy Act of 2012 (Republic Act No. 10173).
              </p>
            </div>

            {/* Prohibited Activities */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>5. Prohibited Activities</h3>
              <p style={{ margin: '0 0 6px', fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                You may not:
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                <li>Use the app for fraudulent activities or fare manipulation</li>
                <li>Share your login credentials with unauthorized persons</li>
                <li>Attempt to bypass security measures or access restrictions</li>
                <li>Modify or tamper with passenger data or fare records</li>
                <li>Use the app for personal business unrelated to bus operations</li>
              </ul>
            </div>

            {/* Disclaimer */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>6. Disclaimer of Warranties</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                The app is provided "as is" without warranties of any kind. OMANFORTSCO does not guarantee uninterrupted service or error-free operation. We are not liable for any damages arising from app use or inability to use the app.
              </p>
            </div>

            {/* Limitation of Liability */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>7. Limitation of Liability</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                OMANFORTSCO shall not be liable for any indirect, incidental, special, or consequential damages resulting from the use or inability to use the app, including but not limited to lost profits or data loss.
              </p>
            </div>

            {/* Termination */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>8. Termination</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                OMANFORTSCO reserves the right to suspend or terminate your access to the app at any time, with or without cause, without prior notice.
              </p>
            </div>

            {/* Modifications */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>9. Modifications to Terms</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                We may modify these terms at any time. Continued use of the app after modifications constitutes acceptance of the updated terms.
              </p>
            </div>

            {/* Governing Law */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>10. Governing Law</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                These terms are governed by the laws of the Republic of the Philippines. Any disputes shall be resolved in the courts of Cagayan de Oro City.
              </p>
            </div>

            {/* Contact */}
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem', fontWeight: 700, color: '#1a1a1a' }}>11. Contact Information</h3>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', lineHeight: 1.6 }}>
                For questions about these Terms of Service, please contact:
              </p>
              <div style={{ marginTop: 8, padding: '12px 16px', background: '#f9f9f9', border: '1px solid #e8e8e8', borderRadius: 12 }}>
                <p style={{ margin: '0 0 4px', fontSize: '0.82rem', color: '#666' }}>
                  <strong>Email:</strong> admin@commutai.test
                </p>
                <p style={{ margin: 0, fontSize: '0.82rem', color: '#666' }}>
                  <strong>Phone:</strong> 0910 8945427
                </p>
              </div>
            </div>

            {/* Agreement Checkbox */}
            <div style={{ padding: '16px', background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 12, marginBottom: 16 }}>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#666', fontStyle: 'italic' }}>
                By using the CommutAI Conductor App, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
              </p>
            </div>

            <button type="button"
              onClick={() => setShowTermsModal(false)}
              style={{ 
                width: '100%',
                marginTop: 8, 
                justifyContent: 'center', 
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '16px',
                background: '#f9f9f9',
                border: '1px solid #e8e8e8',
                borderRadius: 12,
                cursor: 'pointer',
                color: '#1a1a1a',
                fontSize: '0.95rem',
                transition: 'background 0.2s, border-color 0.2s',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f0f0f0';
                e.currentTarget.style.borderColor = '#d0d0d0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#f9f9f9';
                e.currentTarget.style.borderColor = '#e8e8e8';
              }}
            >
              I Understand & Accept
            </button>
          </div>
        </IonContent>
      </IonModal>
    </IonPage>
  );
};

export default ProfilePage;
