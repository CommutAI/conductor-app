import React, { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner,
  IonIcon,
  IonAlert,
  IonToast,
  IonSelect,
  IonSelectOption,
} from '@ionic/react';
import { 
  busOutline, 
  playCircleOutline, 
  logOutOutline, 
  calendarOutline, 
  timeOutline,
  locationOutline,
  peopleOutline,
} from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import '../styles/modern-transport.css';
import Logo from '../components/Logo';
import ProfileAvatar from '../components/ProfileAvatar';

interface Bus {
  id: string;
  plate_number: string;
  route: string;
  seat_capacity: number;
  status: string;
}

const TripSetupPage: React.FC = () => {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [selectedBusId, setSelectedBusId] = useState<string>('');
  const [loadingBuses, setLoadingBuses] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLogoutAlert, setShowLogoutAlert] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

  const { profile, signOut } = useAuth();
  const { setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected } = useTrip();
  const history = useHistory();

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  useEffect(() => {
    loadBuses();
  }, []);

  async function loadBuses() {
    setLoadingBuses(true);
    const { data, error } = await supabase
      .from('buses')
      .select('id, plate_number, route, seat_capacity, status')
      .eq('status', 'active')
      .order('plate_number');

    if (error) {
      const msg = 'Failed to load buses';
      setError(msg);
      showNotification(msg, 'danger');
    } else {
      setBuses(data || []);
      if (data && data.length > 0) {
        showNotification(`${data.length} bus(es) ready`, 'success');
      }
    }
    setLoadingBuses(false);
  }

  async function startTrip() {
    if (!selectedBusId) {
      const msg = 'Please select a bus first';
      setError(msg);
      showNotification(msg, 'warning');
      return;
    }
    if (!profile) return;

    setError(null);
    setStarting(true);
    showNotification('Starting trip...', 'warning');

    const { data: trip, error: tripErr } = await supabase
      .from('trips')
      .insert({
        bus_id: selectedBusId,
        conductor_id: profile.id,
        started_at: new Date().toISOString(),
        status: 'in_progress',
      })
      .select()
      .single();

    if (tripErr || !trip) {
      const msg = 'Could not start trip';
      setError(msg);
      showNotification(msg, 'danger');
      setStarting(false);
      return;
    }

    const bus = buses.find((b) => b.id === selectedBusId)!;
    setCurrentTrip(trip);
    setCurrentBus(bus);
    setValidatedCount(0);
    setFareCollected(0);
    setStarting(false);

    showNotification('Trip started! 🚀', 'success');
    setTimeout(() => {
      history.push('/scan');
    }, 600);
  }

  const selectedBus = buses.find((b) => b.id === selectedBusId);
  const currentDate = new Date();
  const greeting = currentDate.getHours() < 12 ? 'Good Morning' : currentDate.getHours() < 18 ? 'Good Afternoon' : 'Good Evening';

  return (
    <IonPage>
      <IonContent style={{ '--background': '#F8F9FA' }}>
        {/* Header */}
        <div style={{ 
          padding: '20px 16px 16px',
          background: 'white',
          borderBottom: '1px solid #E5E7EB',
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: '16px',
          }}>
            <Logo size="sm" />
            
            <button
              onClick={() => setShowLogoutAlert(true)}
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: 'none',
                borderRadius: '12px',
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <IonIcon icon={logOutOutline} style={{ fontSize: '18px', color: '#EF4444' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#EF4444' }}>Logout</span>
            </button>
          </div>

          {/* Profile Section */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              onClick={() => history.push('/profile')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <ProfileAvatar 
                name={profile?.full_name || 'Conductor'}
                size="md"
              />
            </button>
            <div style={{ flex: 1 }}>
              <p style={{ 
                margin: '0 0 2px 0', 
                fontSize: '0.75rem', 
                color: '#6B7280',
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {greeting}
              </p>
              <h2 style={{ 
                margin: '0 0 4px 0', 
                fontSize: '1.25rem', 
                fontWeight: '800', 
                color: '#1F2937',
                letterSpacing: '-0.02em',
              }}>
                {profile?.full_name}
              </h2>
              <div className="status-badge active" style={{ fontSize: '0.7rem' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
                CONDUCTOR
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 16px' }}>
          {/* Date & Time Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '12px',
            marginBottom: '20px',
          }}>
            <div className="transport-card animate-slide-up" style={{ 
              padding: '16px',
              animationDelay: '0.1s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div className="icon-container orange" style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                  <IonIcon icon={calendarOutline} style={{ color: 'white' }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: '600' }}>Today</span>
              </div>
              <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#1F2937' }}>
                {currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </div>

            <div className="transport-card animate-slide-up" style={{ 
              padding: '16px',
              animationDelay: '0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div className="icon-container green" style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                  <IonIcon icon={timeOutline} style={{ color: 'white' }} />
                </div>
                <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: '600' }}>Time</span>
              </div>
              <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', color: '#1F2937' }}>
                {currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {/* Bus Selector */}
          <div className="transport-card animate-slide-up" style={{ 
            marginBottom: '16px',
            padding: '20px',
            animationDelay: '0.3s',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div className="icon-container orange" style={{ fontSize: '22px', color: 'white' }}>
                <IonIcon icon={busOutline} />
              </div>
              <div>
                <h3 className="heading-medium">Select Your Bus</h3>
                <p className="text-secondary" style={{ margin: '2px 0 0 0' }}>
                  Choose assigned vehicle
                </p>
              </div>
            </div>

            {loadingBuses ? (
              <div style={{ padding: '32px', textAlign: 'center' }}>
                <IonSpinner name="crescent" color="primary" />
                <p style={{ marginTop: '12px', color: '#6B7280', fontSize: '0.9rem' }}>
                  Loading buses...
                </p>
              </div>
            ) : (
              <div style={{
                background: '#F9FAFB',
                border: '2px solid #E5E7EB',
                borderRadius: '12px',
                overflow: 'hidden',
              }}>
                <select
                  value={selectedBusId}
                  onChange={(e) => {
                    setSelectedBusId(e.target.value);
                    showNotification('Bus selected', 'success');
                  }}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: 'none',
                    background: 'transparent',
                    fontSize: '1rem',
                    fontWeight: '600',
                    color: '#1F2937',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">Select a bus...</option>
                  {buses.map((bus) => (
                    <option key={bus.id} value={bus.id}>
                      🚌 {bus.plate_number} - {bus.route}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Selected Bus Details */}
          {selectedBus && (
            <div className="transport-card animate-scale-in" style={{
              marginBottom: '16px',
              padding: '20px',
              background: 'linear-gradient(135deg, #FFF5EE 0%, #FFE8CC 100%)',
              border: '2px solid #FFD4A3',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div className="status-badge active">
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
                  ACTIVE
                </div>
                <span style={{ fontSize: '2.5rem' }}>🚌</span>
              </div>

              <h3 style={{
                margin: '0 0 12px 0',
                fontSize: '1.75rem',
                fontWeight: '900',
                color: '#FF6B00',
                letterSpacing: '-0.02em',
              }}>
                {selectedBus.plate_number}
              </h3>

              <div className="transport-list-item" style={{ 
                marginBottom: '8px',
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.7)',
                boxShadow: 'none',
              }}>
                <IonIcon icon={locationOutline} style={{ fontSize: '20px', color: '#FF6B00' }} />
                <span style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1F2937' }}>
                  {selectedBus.route}
                </span>
              </div>

              <div className="transport-list-item" style={{ 
                marginBottom: 0,
                padding: '12px',
                background: 'rgba(255, 255, 255, 0.7)',
                boxShadow: 'none',
              }}>
                <IonIcon icon={peopleOutline} style={{ fontSize: '20px', color: '#10B981' }} />
                <span style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1F2937' }}>
                  {selectedBus.seat_capacity} passengers
                </span>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              background: '#FEF2F2',
              border: '2px solid #FCA5A5',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <span style={{ fontSize: '1.2rem' }}>⚠️</span>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#DC2626', fontWeight: '600' }}>
                {error}
              </p>
            </div>
          )}

          {/* Start Trip Button */}
          <button
            onClick={startTrip}
            disabled={!selectedBusId || starting}
            className="action-button-primary animate-slide-up"
            style={{
              width: '100%',
              opacity: (!selectedBusId || starting) ? 0.5 : 1,
              cursor: (!selectedBusId || starting) ? 'not-allowed' : 'pointer',
              animationDelay: '0.4s',
            }}
          >
            {starting ? (
              <>
                <IonSpinner name="crescent" style={{ width: '20px', height: '20px' }} />
                <span>Starting Trip...</span>
              </>
            ) : (
              <>
                <IonIcon icon={playCircleOutline} style={{ fontSize: '24px' }} />
                <span>Start Trip</span>
                <span style={{ fontSize: '1.3rem' }}>→</span>
              </>
            )}
          </button>

          {/* Info Card */}
          <div className="transport-card animate-slide-up" style={{
            marginTop: '20px',
            background: '#F0F9FF',
            border: '1px solid #BAE6FD',
            animationDelay: '0.5s',
          }}>
            <p style={{ 
              margin: '0 0 8px 0', 
              fontSize: '0.875rem', 
              fontWeight: '700', 
              color: '#0369A1',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{ fontSize: '1.1rem' }}>ℹ️</span>
              Before Starting
            </p>
            <ul style={{ margin: 0, paddingLeft: '20px', color: '#075985', fontSize: '0.85rem', lineHeight: '1.6' }}>
              <li>Ensure bus is ready and safe</li>
              <li>Check scanner is working</li>
              <li>Verify route information</li>
            </ul>
          </div>
        </div>
      </IonContent>

      <IonAlert
        isOpen={showLogoutAlert}
        onDidDismiss={() => setShowLogoutAlert(false)}
        header="Sign Out"
        message="Are you sure you want to sign out?"
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'Sign Out', handler: () => signOut() },
        ]}
      />

      <IonToast
        isOpen={showToast}
        onDidDismiss={() => setShowToast(false)}
        message={toastMessage}
        duration={2500}
        color={toastColor}
        position="top"
      />
    </IonPage>
  );
};

export default TripSetupPage;