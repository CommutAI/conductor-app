import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  IonPage,
  IonContent,
  IonSpinner,
  IonToast,
  IonFab,
  IonFabButton,
  IonRefresher,
  IonRefresherContent,
  IonAlert,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bus, ScanLine,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { supabase } from '../supabaseClient';
import { StorageService } from '../services/storageService';
import { getLocationAndDecode } from '../services/geoService';
import { realtimeService } from '../services/realtimeService';
import { isLikelyNetworkError } from '../utils/networkUtils';
import ProfileAvatar from '../components/ProfileAvatar';
import BottomNav from '../components/layout/BottomNav';
import PageHeader from '../components/layout/PageHeader';
import OfflineBanner from '../components/OfflineBanner';
import {
  SoftCard, StatusBadge, DashboardCard,
  LoadingSkeleton, AnimatedIllustration,
} from '../components/ui';
import '../styles/modern-transport.css';

// Types

// Constants

const GPS_UPDATE_INTERVAL = 30000; // 30 seconds
const DATA_REFRESH_INTERVAL = 30000; // 30 seconds

// Component

const HomePage: React.FC = () => {
  // State
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'active' | 'inactive' | 'searching'>('searching');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsSpeed, setGpsSpeed] = useState<number>(0);
  const [gpsAccuracy, setGpsAccuracy] = useState<number>(0);
  const [gpsLastUpdate, setGpsLastUpdate] = useState<string>('');
  const [aiPassengerCount, setAiPassengerCount] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Context
  const { profile, currentTrip, currentBus, validatedCount, currentPassengersCount, fareCollected, isRestoringTrip, setCurrentTrip, setCurrentBus, setValidatedCount, setCurrentPassengersCount, setFareCollected, loading: authLoading } = useApp();
  const { isOnline, syncInProgress, lastSyncAt } = useNetwork();

  // Refs
  const gpsTrackerRef = useRef<any>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastGpsUpdateRef = useRef<number>(0);
  const realtimeCleanupRef = useRef<(() => void) | null>(null);
  const networkStateRef = useRef<boolean>(isOnline);
  const prevSyncInProgressRef = useRef(false);
  const history = useHistory();

  // Computed Values
  const isLoading = authLoading || isRestoringTrip || !initialLoadDone;

  const currentDate = useMemo(() => new Date(), []);
  const greeting = useMemo(() => {
    const hour = currentDate.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, [currentDate]);

  // Handlers

  const showNotification = useCallback((message: string, color: 'success' | 'danger' | 'warning') => {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }, []);

  const loadBusInfo = useCallback(async () => {
    if (!profile?.bus_id) return;

    // ── OFFLINE: Try to load from cache first ───────────────────────────────
    if (!isOnline) {
      const cachedBus = localStorage.getItem(`cached_bus_${profile.bus_id}`);
      if (cachedBus) {
        try {
          const bus = JSON.parse(cachedBus);
          console.log('[HomePage] Loaded bus from cache:', bus);
          setCurrentBus(bus);
          return;
        } catch (err) {
          console.error('[HomePage] Error parsing cached bus:', err);
        }
      }
      console.log('[HomePage] Offline - no cached bus available');
      return;
    }

    // ── ONLINE: Fetch from database and cache ───────────────────────────────
    try {
      const { data: bus, error } = await supabase
        .from('buses')
        .select('*')
        .eq('id', profile.bus_id)
        .eq('status', 'active')
        .single();

      if (error) {
        if (isLikelyNetworkError(error)) {
          console.log('[HomePage] Network error loading bus info, trying cache');
          const cachedBus = localStorage.getItem(`cached_bus_${profile.bus_id}`);
          if (cachedBus) {
            try {
              const bus = JSON.parse(cachedBus);
              console.log('[HomePage] Loaded bus from cache due to network error:', bus);
              setCurrentBus(bus);
              return;
            } catch (err) {
              console.error('[HomePage] Error parsing cached bus:', err);
            }
          }
        } else {
          console.error('[HomePage] Error loading bus info:', error);
        }
        return;
      }

      if (bus) {
        console.log('[HomePage] Bus info loaded:', bus);
        setCurrentBus(bus);
        // Cache for offline use
        localStorage.setItem(`cached_bus_${profile.bus_id}`, JSON.stringify(bus));
      }
    } catch (err) {
      if (isLikelyNetworkError(err)) {
        console.log('[HomePage] Network exception loading bus info, trying cache');
        const cachedBus = localStorage.getItem(`cached_bus_${profile.bus_id}`);
        if (cachedBus) {
          try {
            const bus = JSON.parse(cachedBus);
            console.log('[HomePage] Loaded bus from cache due to network exception:', bus);
            setCurrentBus(bus);
            return;
          } catch (parseErr) {
            console.error('[HomePage] Error parsing cached bus:', parseErr);
          }
        }
      } else {
        console.error('[HomePage] Error loading bus info:', err);
      }
    }
  }, [profile?.bus_id, setCurrentBus, isOnline]);

  const loadData = useCallback(async () => {
    if (!currentTrip) return;

    // ── OFFLINE: Use cached/local state only ──────────────────────────────
    if (!isOnline) {
      console.log('[HomePage] Offline - using local state for stats');
      return;
    }

    // ── ONLINE: Sync with database ───────────────────────────────────────
    try {
      // Check if trip is actually still active in database
      const { data: tripStatus, error: tripError } = await supabase
        .from('trips')
        .select('status, ended_at')
        .eq('id', currentTrip.id)
        .single();

      if (tripError && isLikelyNetworkError(tripError)) {
        console.log('[HomePage] Network error checking trip status, using local state');
        return;
      }

      if (tripStatus && (tripStatus.status === 'completed' || tripStatus.ended_at)) {
        console.log('[HomePage] Trip already ended in database, clearing state');
        setCurrentTrip(null);
        setCurrentBus(null);
        setValidatedCount(0);
        setCurrentPassengersCount(0);
        setFareCollected(0);
        return;
      }

      // Load total validated count - count all fare validations for this trip
      const { count: totalValidatedCount, error: validatedError } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', currentTrip.id)
        .eq('type', 'fare_validation');

      // Update validatedCount from database for total validated passengers
      if (!validatedError && totalValidatedCount !== null) {
        setValidatedCount(totalValidatedCount);
      }

      // Load total fare collected from transactions
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select('amount')
        .eq('trip_id', currentTrip.id)
        .eq('type', 'fare_validation');

      if (!txError && transactions) {
        const totalFare = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;
        setFareCollected(totalFare);
      }
    } catch (err) {
      console.error('[HomePage] Error loading data:', err);
      if (isLikelyNetworkError(err)) {
        console.log('[HomePage] Network error, using local state');
      }
    }
  }, [currentTrip, isOnline, currentBus, currentPassengersCount, setValidatedCount, setFareCollected, setCurrentTrip, setCurrentBus]);

  // Effects

  useEffect(() => {
    if (!authLoading && !initialLoadDone) {
      setInitialLoadDone(true);
      setLoading(false);
    }

    let dataInterval: NodeJS.Timeout | undefined;

    if (currentTrip && currentBus) {
      loadData();
      dataInterval = setInterval(loadData, DATA_REFRESH_INTERVAL);
    }

    // Set up real-time subscriptions for cross-device sync.
    // Subscribe regardless of whether a trip is active so that Device 2
    // can pick up a trip that was started on Device 1 (INSERT event).
    // The realtimeService now handles network changes and reconnection automatically.
    if (profile?.id) {
      console.log('[HomePage] Setting up realtime subscriptions');
      
      // Subscribe to trip changes
      const tripCleanup = realtimeService.subscribeToTrips(profile.id, {
        onInsert: async (newTrip) => {
          console.log('[Realtime] New trip started on another device:', newTrip);
          if (!currentTrip) {
            // Load the associated bus so the UI renders correctly
            const { data: bus } = await supabase
              .from('buses')
              .select('*')
              .eq('id', newTrip.bus_id)
              .single();
            setCurrentTrip(newTrip);
            if (bus) setCurrentBus(bus);
            setValidatedCount(0);
            setCurrentPassengersCount(0);
            setFareCollected(0);
            showNotification('Trip started from another device', 'warning');
          }
        },
        onUpdate: (updatedTrip) => {
          console.log('[Realtime] Trip updated:', updatedTrip);
          if (currentTrip && updatedTrip.id === currentTrip.id) {
            // If trip was completed on another device
            if (updatedTrip.status === 'completed' && currentTrip.status !== 'completed') {
              console.log('[Realtime] Trip completed on another device');
              setCurrentTrip(updatedTrip);
              showNotification('Trip completed from another device', 'warning');
              history.push('/trip-summary');
            } else {
              // Update current trip with latest data
              setCurrentTrip(updatedTrip);
            }
          }
        },
        onDelete: (deletedTrip) => {
          if (currentTrip && deletedTrip.id === currentTrip.id) {
            console.log('[Realtime] Trip deleted on another device');
            setCurrentTrip(null);
            setCurrentBus(null);
            setValidatedCount(0);
            setCurrentPassengersCount(0);
            setFareCollected(0);
          }
        },
      });

      // Subscribe to passenger changes for the current trip
      // BUG 7 FIX: subscribeToPassengers now takes tripId (not conductorId)
      // and subscribes to 'boarded_passengers' (not the non-existent 'passengers' table)
      const passengerCleanup = currentTrip
        ? realtimeService.subscribeToPassengers(currentTrip.id, {
            onInsert: (passenger) => {
              console.log('[Realtime] New passenger boarded:', passenger);
              loadData(); // Refresh stats when new passenger is added
            },
            onUpdate: (passenger) => {
              console.log('[Realtime] Passenger updated (alighted?):', passenger);
              loadData(); // Refresh stats when passenger is updated (e.g., alighted)
            },
          })
        : () => {}; // No-op cleanup if there is no active trip yet

      // Subscribe to GPS location updates from driver (read-only for conductor)
      const gpsCleanup = currentBus
        ? realtimeService.subscribeToGpsLocations(currentBus.id, {
            onInsert: (location) => {
              console.log('[Realtime] New GPS location:', location);
              setCurrentLocation({ lat: location.lat, lng: location.lng });
              setGpsSpeed(location.speed || 0);
              setGpsAccuracy(location.accuracy || 0);
              setGpsLastUpdate(location.created_at || '');
              setGpsStatus('active');
            },
            onUpdate: (location) => {
              console.log('[Realtime] GPS location updated:', location);
              setCurrentLocation({ lat: location.lat, lng: location.lng });
              setGpsSpeed(location.speed || 0);
              setGpsAccuracy(location.accuracy || 0);
              setGpsLastUpdate(location.created_at || '');
              setGpsStatus('active');
            },
          })
        : () => {};

      // Subscribe to AI passenger count updates from camera (read-only for conductor)
      const aiCountCleanup = currentBus
        ? realtimeService.subscribeToAiPassengerCounts(currentBus.id, {
            onInsert: (count) => {
              console.log('[Realtime] New AI passenger count:', count);
              setAiPassengerCount(count.count || 0);
            },
            onUpdate: (count) => {
              console.log('[Realtime] AI passenger count updated:', count);
              setAiPassengerCount(count.count || 0);
            },
          })
        : () => {};

      realtimeCleanupRef.current = () => {
        console.log('[HomePage] Cleaning up realtime subscriptions');
        tripCleanup();
        passengerCleanup();
        gpsCleanup();
        aiCountCleanup();
      };
      
      networkStateRef.current = true; // Track that we have subscriptions set up
    }

    return () => {
      if (dataInterval) clearInterval(dataInterval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (realtimeCleanupRef.current) realtimeCleanupRef.current();
    };
  }, [currentTrip?.id, currentBus?.id, authLoading, initialLoadDone, loadData, profile?.id, setCurrentTrip, setCurrentBus, setValidatedCount, setCurrentPassengersCount, setFareCollected, showNotification, history]);

  // Refresh data when component mounts (handles navigation back from scan page)
  useEffect(() => {
    if (currentTrip && currentBus && !isLoading) {
      loadData();
    }
  }, [isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load bus info when profile is available (works offline too)
  useEffect(() => {
    if (profile?.bus_id && !currentBus) {
      loadBusInfo();
    }
  }, [profile?.bus_id, currentBus, loadBusInfo]);

  // Refresh bus info when network status changes (debounced to avoid frequent calls)
  useEffect(() => {
    if (profile?.bus_id) {
      const timeoutId = setTimeout(() => {
        loadBusInfo();
      }, 1000); // 1 second debounce for smoother transitions
      return () => clearTimeout(timeoutId);
    }
  }, [isOnline, profile?.bus_id, loadBusInfo]);

  // Refresh data when network status changes (debounced to avoid frequent calls)
  useEffect(() => {
    if (currentTrip && currentBus) {
      const timeoutId = setTimeout(() => {
        loadData();
      }, 1000); // 1 second debounce for smoother transitions
      return () => clearTimeout(timeoutId);
    }
  }, [isOnline, currentTrip?.id, currentBus?.id, loadData]);

  // Refresh stats after offline queue sync completes (avoids stale counts on reconnect)
  useEffect(() => {
    const wasSyncing = prevSyncInProgressRef.current;
    prevSyncInProgressRef.current = syncInProgress;

    if (wasSyncing && !syncInProgress && isOnline && currentTrip && currentBus) {
      loadData();
    }
  }, [syncInProgress, isOnline, currentTrip, currentBus, loadData]);

  // Also refresh when sync finishes (lastSyncAt updates even if syncInProgress flickers)
  useEffect(() => {
    if (lastSyncAt && currentTrip && currentBus && isOnline) {
      loadData();
    }
  }, [lastSyncAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-complete trip if outside allowed hours (4 AM - 10 PM)
  useEffect(() => {
    if (!currentTrip || currentTrip.status !== 'in_progress') {
      return;
    }

    const checkTimeAndCompleteTrip = async () => {
      const now = new Date();
      const currentHour = now.getHours();
      const isAllowedTime = currentHour >= 4 && currentHour < 22; // 4 AM to 10 PM (22:00)
      
      if (!isAllowedTime) {
        console.log('[HomePage] Auto-completing trip due to time restrictions');
        try {
          const { error } = await supabase
            .from('trips')
            .update({
              ended_at: new Date().toISOString(),
              status: 'completed'
            })
            .eq('id', currentTrip.id);

          if (error) throw error;

          showNotification('Trip automatically completed (outside operating hours)', 'warning');
          history.push('/trip-summary');
        } catch (err) {
          console.error('[HomePage] Error auto-completing trip:', err);
          showNotification('Failed to auto-complete trip', 'danger');
        }
      }
    };

    // Check immediately
    checkTimeAndCompleteTrip();

    // Check every minute
    const timeCheckInterval = setInterval(checkTimeAndCompleteTrip, 60000);

    return () => {
      clearInterval(timeCheckInterval);
    };
  }, [currentTrip, history, showNotification]);

  const handleRefresh = useCallback(async (event: CustomEvent) => {
    if (!currentTrip) {
      event.detail.complete();
      return;
    }

    setIsRefreshing(true);
    try {
      await loadData();
      showNotification('Data refreshed', 'success');
    } catch (err) {
      showNotification('Failed to refresh data', 'danger');
    } finally {
      setIsRefreshing(false);
      event.detail.complete();
    }
  }, [currentTrip, showNotification, loadData]);

  // Note: Trip start/end is driver-only functionality
  // Conductor waits for driver to start the trip before scanning passengers

  // Render

  if (isLoading) {
    return (
      <IonPage>
        <PageHeader showLogo={true} />
        <IonContent className="app-page-bg">
          <div className="page-content">
            <LoadingSkeleton variant="card" count={3} />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  const hasActiveTrip = currentTrip && currentBus;

  return (
    <IonPage>
      <PageHeader
        showLogo={true}
        statusBadge={{
          label: hasActiveTrip ? (isOnline ? 'Trip Active' : 'Offline Mode') : 'Ready',
          variant: hasActiveTrip ? (isOnline ? 'success' : 'danger') : 'primary',
        }}
        rightAction={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* GPS Status in Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 20,
              background: gpsStatus === 'active' ? 'rgba(16, 185, 129, 0.15)' : gpsStatus === 'inactive' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              border: `1px solid ${gpsStatus === 'active' ? 'rgba(16, 185, 129, 0.3)' : gpsStatus === 'inactive' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
            }}>
              <div style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: gpsStatus === 'active' ? '#10b981' : gpsStatus === 'inactive' ? '#ef4444' : '#f59e0b',
                boxShadow: gpsStatus === 'active' ? '0 0 6px #10b981' : 'none',
                animation: gpsStatus === 'searching' ? 'pulse 1.5s infinite' : 'none',
              }} />
              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: gpsStatus === 'active' ? '#10b981' : gpsStatus === 'inactive' ? '#ef4444' : '#f59e0b' }}>
                {gpsStatus === 'active' ? 'GPS' : gpsStatus === 'inactive' ? 'No GPS' : 'GPS...'}
              </span>
            </div>
            <ProfileAvatar name={profile?.full_name || 'User'} size="sm" />
          </div>
        }
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <div className="page-content">
          {/* Greeting Section */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            style={{ marginBottom: 20 }}
          >
            <h1 style={{
              margin: 0,
              fontSize: '1.75rem',
              fontWeight: 800,
              color: '#ffffff',
              marginBottom: 4,
              letterSpacing: '-0.5px'
            }}>
              {greeting}, {profile?.full_name?.split(' ')[0] || 'Conductor'}
            </h1>
            <p style={{
              margin: 0,
              fontSize: '0.95rem',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 500
            }}>
              {hasActiveTrip ? 'Your trip is in progress' : 'Ready to start your shift'}
            </p>
          </motion.div>

          {!hasActiveTrip ? (
            /* No Active Trip - Show Waiting for Driver Message */
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <SoftCard variant="hero" padding="none" style={{ overflow: 'hidden' }}>
                {/* Decorative Elements */}
                <div style={{
                  position: 'absolute',
                  top: -50,
                  right: -50,
                  width: 200,
                  height: 200,
                  background: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: '50%',
                  filter: 'blur(40px)'
                }} />
                <div style={{
                  position: 'absolute',
                  bottom: -30,
                  left: -30,
                  width: 150,
                  height: 150,
                  background: 'rgba(255, 255, 255, 0.08)',
                  borderRadius: '50%',
                  filter: 'blur(30px)'
                }} />

                <div style={{ padding: '16px 12px', position: 'relative', zIndex: 1 }}>
                  {/* Animated Illustration */}
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                    <AnimatedIllustration type="waiting" size={60} />
                  </div>

                  <h2 style={{
                    margin: '0 0 4px',
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    color: 'white',
                    textAlign: 'center',
                    letterSpacing: '-0.5px'
                  }}>
                    Waiting for Driver
                  </h2>

                  <p style={{
                    margin: '0 0 16px',
                    fontSize: '0.85rem',
                    color: 'rgba(255, 255, 255, 0.9)',
                    textAlign: 'center',
                    lineHeight: 1.4,
                    fontWeight: 400
                  }}>
                    {profile?.bus_id
                      ? 'The driver will start the trip. You can begin scanning passengers once the trip is active.'
                      : 'No bus assigned. Please contact your administrator.'}
                  </p>

                  {/* Bus Info Card */}
                  {profile?.bus_id && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="glass-chip"
                      style={{
                        padding: '10px',
                        marginBottom: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                      }}
                    >
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: 6,
                        padding: 6,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Bus size={16} color="white" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{
                          margin: '0 0 1px',
                          color: 'rgba(255, 255, 255, 0.7)',
                          fontSize: '0.65rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Assigned Bus
                        </p>
                        <p style={{
                          margin: 0,
                          color: 'white',
                          fontSize: '0.85rem',
                          fontWeight: 700
                        }}>
                          Bus #{currentBus?.plate_number || 'Loading...'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </SoftCard>
            </motion.div>
          ) : (
            /* Active Trip - Show Simplified Stats */
            <>
              {/* Combined Stats Card - Professional Design */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                style={{ marginBottom: 16 }}
              >
                <SoftCard
                  style={{
                    padding: '20px',
                    background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
                    border: '1px solid rgba(0, 0, 0, 0.06)'
                  }}
                >
                  {/* Card Header */}
                  <div style={{ marginBottom: 20 }}>
                    <h3 style={{
                      margin: 0,
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '1px',
                      marginBottom: 4
                    }}>
                      Trip Overview
                    </h3>
                    <p style={{
                      margin: 0,
                      fontSize: '0.75rem',
                      color: 'var(--text-tertiary)',
                      fontWeight: 500
                    }}>
                      Real-time passenger and fare metrics
                    </p>
                  </div>

                  {/* Unified Stats Card */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    style={{
                      padding: '24px',
                      borderRadius: 16,
                      background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
                      marginBottom: 24
                    }}
                  >
                    {/* Content Layout */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 24, alignItems: 'center' }}>
                      {/* Left Side - Circular Passenger Count */}
                      <div style={{ position: 'relative' }}>
                        <svg width="120" height="120" viewBox="0 0 120 120">
                          {/* Background circle */}
                          <circle
                            cx="60"
                            cy="60"
                            r="50"
                            fill="none"
                            stroke="rgba(16, 185, 129, 0.1)"
                            strokeWidth="8"
                          />
                          {/* Progress circle */}
                          <motion.circle
                            cx="60"
                            cy="60"
                            r="50"
                            fill="none"
                            stroke="url(#circleGradient)"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${2 * Math.PI * 50}`}
                            strokeDashoffset={`${2 * Math.PI * 50 * (1 - Math.min((validatedCount / (currentBus?.seat_capacity || 50)) || 0, 1))}`}
                            initial={{ strokeDashoffset: 2 * Math.PI * 50 }}
                            animate={{ strokeDashoffset: 2 * Math.PI * 50 * (1 - Math.min((validatedCount / (currentBus?.seat_capacity || 50)) || 0, 1)) }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            transform="rotate(-90 60 60)"
                          />
                          {/* Gradient definition */}
                          <defs>
                            <linearGradient id="circleGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                              <stop offset="0%" stopColor="#10b981" />
                              <stop offset="100%" stopColor="#059669" />
                            </linearGradient>
                          </defs>
                        </svg>
                        {/* Center content - only count */}
                        <div style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          <p style={{ margin: 0, fontSize: '0.6rem', fontWeight: 600, color: '#10b981', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Passengers
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '1.5rem', fontWeight: 800, color: '#059669', lineHeight: 1 }}>
                            {validatedCount}
                          </p>
                        </div>
                      </div>

                      {/* Right Side - Capacity Ratio and Revenue */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Capacity Ratio */}
                        <div style={{
                          padding: '16px 20px',
                          borderRadius: 12,
                          background: 'rgba(16, 185, 129, 0.05)',
                          border: '1px solid rgba(16, 185, 129, 0.1)',
                          textAlign: 'center'
                        }}>
                          <p style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: '#059669', lineHeight: 1 }}>
                            {validatedCount} / {currentBus?.seat_capacity || '—'}
                          </p>
                        </div>

                        {/* Revenue Section */}
                        <div style={{
                          padding: '16px 20px',
                          borderRadius: 12,
                          background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(59, 130, 246, 0.02) 100%)',
                          border: '1px solid rgba(59, 130, 246, 0.15)',
                          textAlign: 'center'
                        }}>
                          <p style={{ margin: 0, fontSize: '1.8rem', fontWeight: 800, color: '#2563eb', lineHeight: 1 }}>
                            ₱{fareCollected.toFixed(0)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                </SoftCard>
              </motion.div>

              {/* Home Page Image - Enhanced */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                style={{ marginBottom: 16 }}
              >
                <div style={{
                  position: 'relative',
                  borderRadius: 16,
                  overflow: 'hidden',
                  boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.08)'
                }}>
                  <img
                    src="/assets/home-page image.jpg"
                    alt="CommutAI Card Scanning"
                    style={{
                      width: '100%',
                      height: 'auto',
                      display: 'block',
                      objectFit: 'cover'
                    }}
                  />
                  {/* Gradient overlay */}
                  <div style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.1) 100%)',
                    pointerEvents: 'none'
                  }} />
                </div>
              </motion.div>
            </>
          )}
        </div>
      </IonContent>

      {hasActiveTrip && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton className="fab-scan" onClick={() => history.push('/scan')}>
            <ScanLine size={28} color="white" />
          </IonFabButton>
        </IonFab>
      )}

      <BottomNav />

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

export default HomePage;
