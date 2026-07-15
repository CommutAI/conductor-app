import React, { useEffect, useState } from 'react';
import {
  IonPage,
  IonContent,
  IonAlert,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bus, Play, LogOut, Calendar, Clock, MapPin, Users,
  Wifi, WifiOff, Navigation, Wallet, User,
} from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { useOffline } from '../context/OfflineContext';
import ProfileAvatar from '../components/ProfileAvatar';
import BottomNav from '../components/layout/BottomNav';
import {
  SoftCard, PrimaryButton, StatusBadge, DashboardCard,
  LoadingSkeleton, AppToast,
} from '../components/ui';

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
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [currentTripStatus, setCurrentTripStatus] = useState<string>('Off Duty');
  const [currentPassengerCount, setCurrentPassengerCount] = useState<number>(0);

  const { profile, signOut } = useAuth();
  const { setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected } = useTrip();
  const { isOnline } = useOffline();
  const history = useHistory();

  function showNotification(message: string, color: 'success' | 'danger' | 'warning' = 'success') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  useEffect(() => {
    loadBuses();
    loadTodayRevenue();
  }, []);

  async function loadTodayRevenue() {
    if (!profile) return;
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data } = await supabase
        .from('transactions')
        .select('amount')
        .gte('created_at', startOfDay.toISOString());
      const total = data?.reduce((sum, t) => sum + (t.amount || 0), 0) ?? 0;
      setTodayRevenue(total);
    } catch {
      setTodayRevenue(0);
    }
  }

  async function loadBuses() {
    setLoadingBuses(true);
    const { data, error: busError } = await supabase
      .from('buses')
      .select('id, plate_number, route, seat_capacity, status')
      .eq('status', 'active')
      .order('plate_number');

    console.log('Buses data:', data);
    console.log('Buses error:', busError);

    if (busError) {
      const msg = 'Failed to load buses';
      setError(msg);
      showNotification(msg, 'danger');
    } else {
      setBuses(data || []);
      if (!data || data.length === 0) {
        showNotification('No active buses found', 'warning');
      }
    }
    setLoadingBuses(false);
  }

  async function loadBusData(busId: string) {
    if (!busId) {
      setCurrentTripStatus('Off Duty');
      setCurrentPassengerCount(0);
      return;
    }

    try {
      const { data: tripData } = await supabase
        .from('trips')
        .select('id, status, started_at')
        .eq('bus_id', busId)
        .eq('status', 'in_progress')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (tripData) {
        setCurrentTripStatus('In Progress');
      } else {
        setCurrentTripStatus('Off Duty');
      }

      const { data: countData } = await supabase
        .from('passenger_counts')
        .select('count')
        .eq('trip_id', tripData?.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      setCurrentPassengerCount(countData?.count || 0);
    } catch {
      setCurrentTripStatus('Off Duty');
      setCurrentPassengerCount(0);
    }
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

    const bus = buses.find((b) => b.id === selectedBusId);
    if (!bus) {
      const msg = 'Selected bus not found';
      setError(msg);
      showNotification(msg, 'danger');
      setStarting(false);
      return;
    }

    setCurrentTrip(trip);
    setCurrentBus(bus);
    setValidatedCount(0);
    setFareCollected(0);
    setStarting(false);

    showNotification('Trip started!', 'success');
    setTimeout(() => history.push('/scan'), 600);
  }

  const selectedBus = buses.find((b) => b.id === selectedBusId);
  const currentDate = new Date();

  return (
    <IonPage>
      <IonContent className="app-page-bg">
        {/* Header */}
        <div style={{
          padding: 'calc(16px + env(safe-area-inset-top, 0px)) 20px 16px',
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <ProfileAvatar name={profile?.full_name || 'Conductor'} size="md" />
              <div>
                <p className="heading-small" style={{ marginBottom: 4 }}>{profile?.full_name}</p>
                <StatusBadge variant="primary" dot pulse>Conductor</StatusBadge>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => history.push('/profile')}
                style={{
                  background: 'var(--color-primary-subtle)', border: 'none',
                  borderRadius: 14, padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)',
                  fontWeight: 600, fontSize: '0.85rem',
                }}
              >
                <User size={18} />
              </button>
              <button
                type="button"
                onClick={() => setShowLogoutAlert(true)}
                style={{
                  background: 'var(--color-danger-subtle)', border: 'none',
                  borderRadius: 14, padding: '10px 14px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)',
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SoftCard padding="sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar size={18} color="var(--color-primary)" />
              <div>
                <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Today</p>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{currentDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </div>
            </SoftCard>
            <SoftCard padding="sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Clock size={18} color="var(--color-success)" />
              <div>
                <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-tertiary)', fontWeight: 700, textTransform: 'uppercase' }}>Time</p>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{currentDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
              </div>
            </SoftCard>
          </div>
        </div>

        <div className="page-content page-content--no-nav" style={{ paddingBottom: 100 }}>
          <p className="section-title">Dashboard Overview</p>

          {/* KPI Grid */}
          <div className="dashboard-grid" style={{ marginBottom: 24 }}>
            <DashboardCard
              label="Current Bus"
              value={selectedBus?.plate_number || '—'}
              icon={Bus}
              iconBg="var(--color-primary-subtle)"
              iconColor="var(--color-primary)"
              delay={0}
            />
            <DashboardCard
              label="Current Route"
              value={selectedBus?.route?.split(' ').slice(0, 2).join(' ') || '—'}
              icon={MapPin}
              iconBg="var(--color-info-subtle)"
              iconColor="var(--color-info)"
              delay={0.05}
            />
            <DashboardCard
              label="Active Trip"
              value={currentTripStatus}
              icon={Navigation}
              iconBg={currentTripStatus === 'In Progress' ? 'var(--color-success-subtle)' : 'var(--bg-tertiary)'}
              iconColor={currentTripStatus === 'In Progress' ? 'var(--color-success)' : 'var(--text-secondary)'}
              delay={0.1}
            />
            <DashboardCard
              label="Passengers"
              value={currentPassengerCount.toString()}
              icon={Users}
              iconBg="var(--color-success-subtle)"
              iconColor="var(--color-success)"
              delay={0.15}
            />
            <DashboardCard
              label="Seat Availability"
              value={selectedBus ? `${selectedBus.seat_capacity}` : '—'}
              icon={Users}
              iconBg="var(--color-warning-subtle)"
              iconColor="#A16207"
              delay={0.2}
            />
            <DashboardCard
              label="GPS Status"
              value="Ready"
              icon={Navigation}
              iconBg="var(--color-success-subtle)"
              iconColor="var(--color-success)"
              delay={0.25}
            />
            <DashboardCard
              label="Internet"
              value={isOnline ? 'Online' : 'Offline'}
              icon={isOnline ? Wifi : WifiOff}
              iconBg={isOnline ? 'var(--color-success-subtle)' : 'var(--color-danger-subtle)'}
              iconColor={isOnline ? 'var(--color-success)' : 'var(--color-danger)'}
              delay={0.3}
            />
            <DashboardCard
              label="Today's Revenue"
              value={`₱${todayRevenue.toFixed(0)}`}
              icon={Wallet}
              iconBg="var(--color-primary-subtle)"
              iconColor="var(--color-primary)"
              delay={0.35}
            />
          </div>

          {/* Bus Selector */}
          <SoftCard style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div className="icon-container orange"><Bus size={22} /></div>
              <div>
                <h3 className="heading-medium">Select Your Bus</h3>
                <p className="text-secondary" style={{ margin: '2px 0 0' }}>Choose assigned vehicle</p>
              </div>
            </div>

            {loadingBuses ? (
              <LoadingSkeleton variant="kpi" count={1} />
            ) : (
              <select
                className="bus-select"
                value={selectedBusId}
                onChange={async (e) => {
                  setSelectedBusId(e.target.value);
                  if (e.target.value) {
                    await loadBusData(e.target.value);
                    showNotification('Bus selected', 'success');
                  } else {
                    setCurrentTripStatus('Off Duty');
                    setCurrentPassengerCount(0);
                  }
                }}
              >
                <option value="">Select a bus...</option>
                {buses.map((bus) => (
                  <option key={bus.id} value={bus.id}>
                    {bus.plate_number} — {bus.route}
                  </option>
                ))}
              </select>
            )}
          </SoftCard>

          {selectedBus && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <SoftCard
                variant="gradient"
                style={{ marginBottom: 16 }}
              >
                <StatusBadge variant="success" dot style={{ marginBottom: 12, background: 'rgba(255,255,255,0.2)', color: 'white' }}>
                  Active Selection
                </StatusBadge>
                <h3 style={{ margin: '0 0 16px', fontSize: '1.75rem', fontWeight: 900, color: 'white' }}>
                  {selectedBus.plate_number}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12 }}>
                    <MapPin size={18} color="white" />
                    <span style={{ color: 'white', fontWeight: 600 }}>{selectedBus.route}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12 }}>
                    <Users size={18} color="white" />
                    <span style={{ color: 'white', fontWeight: 600 }}>{selectedBus.seat_capacity} seats</span>
                  </div>
                </div>
              </SoftCard>
            </motion.div>
          )}

          {error && (
            <SoftCard style={{ marginBottom: 16, background: 'var(--color-danger-subtle)', border: '1.5px solid #FECACA' }}>
              <p style={{ margin: 0, color: '#B91C1C', fontWeight: 600, fontSize: '0.9rem' }}>{error}</p>
            </SoftCard>
          )}

          <PrimaryButton
            onClick={startTrip}
            disabled={!selectedBusId || starting}
            loading={starting}
            fullWidth
            icon={<Play size={22} />}
          >
            Start Trip
          </PrimaryButton>

          <SoftCard style={{ marginTop: 20, background: 'var(--color-primary-subtle)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <p style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--color-primary)', fontSize: '0.9rem' }}>
              Before Starting
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <li>Ensure bus is ready and safe</li>
              <li>Check scanner is working</li>
              <li>Verify route information</li>
            </ul>
          </SoftCard>
        </div>

        <BottomNav />
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

      <AppToast
        isOpen={showToast}
        message={toastMessage}
        color={toastColor}
        onDismiss={() => setShowToast(false)}
      />
    </IonPage>
  );
};

export default TripSetupPage;
