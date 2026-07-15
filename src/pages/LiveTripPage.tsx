import React, { useState, useEffect, useRef } from 'react';
import {
  IonPage,
  IonContent,
  IonAlert,
  IonFab,
  IonFabButton,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, StopCircle, Users, Wallet, AlertTriangle,
  CheckCircle, MapPin, List, History, AlertCircle, Wifi, WifiOff,
} from 'lucide-react';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { supabase } from '../supabaseClient';
import ProfileAvatar from '../components/ProfileAvatar';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import BottomNav from '../components/layout/BottomNav';
import {
  SoftCard, PrimaryButton, StatusBadge, DashboardCard,
  LoadingSkeleton, EmptyState, AppToast, TripTimeline,
} from '../components/ui';

const LiveTripPage: React.FC = () => {
  const [passengerCount, setPassengerCount] = useState(0);
  const [aiPassengerCount, setAiPassengerCount] = useState(0);
  const [irregularities, setIrregularities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEndTripAlert, setShowEndTripAlert] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [gpsStatus, setGpsStatus] = useState<'active' | 'inactive' | 'searching'>('searching');
  const [showEmergencyAlert, setShowEmergencyAlert] = useState(false);

  const { currentTrip, currentBus, validatedCount, fareCollected } = useTrip();
  const { profile } = useAuth();
  const { isOnline } = useOffline();
  const history = useHistory();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!currentTrip || !currentBus) {
      history.replace('/trip-setup');
      return;
    }

    loadData();
    subscribeRealtime();
    startGPSTracking();
    const interval = setInterval(loadData, 30000);

    return () => {
      clearInterval(interval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [currentTrip?.id]);

  function showNotification(message: string, color: 'success' | 'danger' | 'warning') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  function startGPSTracking() {
    setGpsStatus('searching');
    if ('geolocation' in navigator) {
      navigator.geolocation.watchPosition(
        (position) => {
          setGpsStatus('active');
          updateGPSLocation(position.coords.latitude, position.coords.longitude);
        },
        () => setGpsStatus('inactive'),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    } else {
      setGpsStatus('inactive');
    }
  }

  async function updateGPSLocation(lat: number, lng: number) {
    if (!currentTrip) return;
    try {
      await supabase.from('trips').update({
        current_lat: lat,
        current_lng: lng,
        gps_updated_at: new Date().toISOString(),
      }).eq('id', currentTrip.id);
    } catch (err) {
      console.error('Error updating GPS location:', err);
    }
  }

  async function sendEmergencyAlert() {
    if (!currentTrip || !profile) return;
    try {
      if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(async (position) => {
          await supabase.from('emergency_alerts').insert({
            trip_id: currentTrip.id,
            conductor_id: profile.id,
            bus_id: currentBus?.id,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            status: 'active',
            created_at: new Date().toISOString(),
          });
          showNotification('Emergency alert sent! Admin notified.', 'success');
          setShowEmergencyAlert(false);
        }, () => {
          showNotification('Could not get GPS location. Emergency alert sent without location.', 'warning');
        });
      } else {
        await supabase.from('emergency_alerts').insert({
          trip_id: currentTrip.id,
          conductor_id: profile.id,
          bus_id: currentBus?.id,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        showNotification('Emergency alert sent! Admin notified.', 'success');
        setShowEmergencyAlert(false);
      }
    } catch {
      showNotification('Failed to send emergency alert', 'danger');
    }
  }

  async function loadData() {
    if (!currentTrip) return;
    try {
      const { data: countData } = await supabase
        .from('passenger_counts')
        .select('count, ai_count')
        .eq('trip_id', currentTrip.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (countData) {
        setPassengerCount(countData.count);
        setAiPassengerCount(countData.ai_count || countData.count);
      }

      const { data: irregData } = await supabase
        .from('fare_irregularities')
        .select('*')
        .eq('trip_id', currentTrip.id)
        .order('detected_at', { ascending: false });

      setIrregularities(irregData || []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function subscribeRealtime() {
    if (!currentTrip) return;
    const channel = supabase
      .channel(`trip-live-${currentTrip.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'passenger_counts',
        filter: `trip_id=eq.${currentTrip.id}`,
      }, (payload) => setPassengerCount((payload.new as any).count))
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'fare_irregularities',
        filter: `trip_id=eq.${currentTrip.id}`,
      }, (payload) => setIrregularities((prev) => [payload.new, ...prev]))
      .subscribe();
    channelRef.current = channel;
  }

  async function endTrip() {
    if (!currentTrip) return;
    try {
      await supabase.from('trips').update({
        ended_at: new Date().toISOString(), status: 'completed',
      }).eq('id', currentTrip.id);
      showNotification('Trip completed!', 'success');
      setTimeout(() => history.push('/trip-summary'), 1000);
    } catch {
      showNotification('Failed to end trip', 'danger');
    }
  }

  if (!currentTrip || !currentBus) return null;

  const tripDuration = Math.floor(
    (Date.now() - new Date(currentTrip.started_at).getTime()) / (1000 * 60)
  );
  const capacityPercent = Math.min((passengerCount / currentBus.seat_capacity) * 100, 100);
  const routeStops = currentBus.route.split(/[→\-–>]/).map((s) => s.trim()).filter(Boolean);
  const timelineStops = routeStops.length >= 2
    ? routeStops.map((name, i) => ({
        id: String(i),
        name,
        status: (i === 0 ? 'completed' : i === 1 ? 'current' : 'upcoming') as 'completed' | 'current' | 'upcoming',
        eta: i > 1 ? `~${i * 8} min` : undefined,
      }))
    : [{ id: '0', name: currentBus.route, status: 'current' as const }];

  return (
    <IonPage>
      <PageHeader
        title={currentBus.plate_number}
        subtitle={currentBus.route}
        statusBadge={{
          label: isOnline ? 'Trip Active' : 'Offline Mode',
          variant: isOnline ? 'success' : 'danger',
        }}
        rightAction={
          <button
            type="button"
            onClick={() => setShowEndTripAlert(true)}
            style={{
              background: 'var(--color-danger-subtle)', border: 'none',
              borderRadius: 14, padding: '8px 14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.85rem',
            }}
          >
            <StopCircle size={18} />
            End
          </button>
        }
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <div className="page-content">
          {/* Hero Card */}
          <SoftCard variant="gradient" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <ProfileAvatar name={profile?.full_name || 'Conductor'} size="md" showBorder={false} />
              <div style={{ flex: 1, color: 'white' }}>
                <p style={{ margin: '0 0 2px', fontSize: '0.7rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase' }}>Conductor</p>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'white' }}>{profile?.full_name}</h3>
              </div>
              <div style={{ textAlign: 'right', color: 'white' }}>
                <p style={{ margin: '0 0 2px', fontSize: '0.7rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase' }}>Duration</p>
                <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>{Math.floor(tripDuration / 60)}h {tripDuration % 60}m</p>
              </div>
            </div>
            <div style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 16, padding: 16 }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.75rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase' }}>Route</p>
              <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'white' }}>{currentBus.route}</p>
            </div>
          </SoftCard>

          {/* KPI Grid */}
          <p className="section-title">Live Metrics</p>
          <div className="dashboard-grid" style={{ marginBottom: 24 }}>
            <DashboardCard label="Validated" value={validatedCount} icon={CheckCircle} iconBg="var(--color-success-subtle)" iconColor="var(--color-success)" delay={0} />
            <DashboardCard label="Fare Collected" value={`₱${fareCollected.toFixed(0)}`} icon={Wallet} iconBg="var(--color-primary-subtle)" iconColor="var(--color-primary)" delay={0.05} />
            <DashboardCard
              label="GPS Signal"
              value={gpsStatus === 'active' ? 'Active' : gpsStatus === 'searching' ? '...' : 'Off'}
              icon={MapPin}
              iconBg={gpsStatus === 'active' ? 'var(--color-success-subtle)' : gpsStatus === 'searching' ? 'var(--color-warning-subtle)' : 'var(--color-danger-subtle)'}
              iconColor={gpsStatus === 'active' ? 'var(--color-success)' : gpsStatus === 'searching' ? '#A16207' : 'var(--color-danger)'}
              delay={0.1}
            />
            <DashboardCard label="AI Count" value={aiPassengerCount} icon={Users} iconBg="var(--color-info-subtle)" iconColor="var(--color-info)" delay={0.15} />
            <DashboardCard
              label="Seats Used"
              value={`${passengerCount}/${currentBus.seat_capacity}`}
              icon={Users}
              iconBg="var(--color-warning-subtle)"
              iconColor="#A16207"
              delay={0.2}
            />
            <DashboardCard
              label="Network"
              value={isOnline ? 'Online' : 'Offline'}
              icon={isOnline ? Wifi : WifiOff}
              iconBg={isOnline ? 'var(--color-success-subtle)' : 'var(--color-danger-subtle)'}
              iconColor={isOnline ? 'var(--color-success)' : 'var(--color-danger)'}
              delay={0.25}
            />
          </div>

          {/* Trip Timeline */}
          <SoftCard style={{ marginBottom: 24 }}>
            <h3 className="heading-medium" style={{ marginBottom: 16 }}>Trip Progress</h3>
            <TripTimeline
              stops={timelineStops}
              currentStop={routeStops[0] || currentBus.route}
              nextStop={routeStops[1]}
              eta={routeStops[1] ? '~8 min' : undefined}
              progress={capacityPercent}
            />
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span className="text-secondary" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Seat Availability</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>{Math.round(capacityPercent)}%</span>
              </div>
              <div className="progress-bar">
                <motion.div
                  className="progress-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${capacityPercent}%` }}
                  transition={{ duration: 0.8 }}
                />
              </div>
              <p className="text-secondary" style={{ margin: '8px 0 0', fontSize: '0.8rem' }}>
                {passengerCount} of {currentBus.seat_capacity} seats occupied
              </p>
            </div>
          </SoftCard>

          {/* Recent Activity */}
          {loading ? (
            <LoadingSkeleton variant="list" count={3} />
          ) : (
            <SoftCard style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h3 className="heading-medium">Recent Activity</h3>
                {irregularities.length > 0 && (
                  <StatusBadge variant="warning">{irregularities.length} alerts</StatusBadge>
                )}
              </div>

              {irregularities.length > 0 ? (
                irregularities.slice(0, 3).map((item) => (
                  <div key={item.id} className="transport-list-item" style={{ background: 'var(--color-warning-subtle)' }}>
                    <AlertTriangle size={20} color="#A16207" />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.9rem' }}>
                        {item.type?.replace('_', ' ')}
                      </p>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {new Date(item.detected_at).toLocaleTimeString()}
                      </p>
                    </div>
                    <StatusBadge variant={item.resolved ? 'success' : 'danger'}>
                      {item.resolved ? 'Resolved' : 'Pending'}
                    </StatusBadge>
                  </div>
                ))
              ) : (
                <EmptyState
                  title="All Clear!"
                  description="No irregularities detected on this trip"
                  variant="success"
                />
              )}
            </SoftCard>
          )}

          {/* Quick Actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
            <SoftCard padding="sm" style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => history.push('/passengers')}>
              <List size={24} color="var(--color-primary)" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>Passengers</p>
            </SoftCard>
            <SoftCard padding="sm" style={{ cursor: 'pointer', textAlign: 'center' }} onClick={() => history.push('/history')}>
              <History size={24} color="var(--color-primary)" style={{ margin: '0 auto 8px' }} />
              <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>History</p>
            </SoftCard>
          </div>

          <button type="button" className="emergency-btn" onClick={() => setShowEmergencyAlert(true)}>
            <AlertCircle size={28} />
            <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>EMERGENCY</span>
            <span style={{ fontSize: '0.85rem', opacity: 0.9 }}>Send GPS & Notify Admin</span>
          </button>
        </div>
      </IonContent>

      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton className="fab-scan" onClick={() => history.push('/scan')}>
          <ScanLine size={28} color="white" />
        </IonFabButton>
      </IonFab>

      <BottomNav />

      <IonAlert
        isOpen={showEndTripAlert}
        onDidDismiss={() => setShowEndTripAlert(false)}
        header="End Trip"
        message="Are you sure you want to end this trip? This action cannot be undone."
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'End Trip', handler: endTrip },
        ]}
      />

      <IonAlert
        isOpen={showEmergencyAlert}
        onDidDismiss={() => setShowEmergencyAlert(false)}
        header="Emergency Alert"
        message="This will send your GPS location to the admin immediately. Are you sure?"
        buttons={[
          { text: 'Cancel', role: 'cancel' },
          { text: 'Send Alert', handler: sendEmergencyAlert },
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

export default LiveTripPage;
