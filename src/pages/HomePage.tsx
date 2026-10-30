import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  IonPage,
  IonContent,
  IonToast,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bus,
  ScanLine,
  Users,
  Wallet,
  Gauge,
  Radio,
  Clock,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  History,
  User,
  Calendar,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { supabase } from '../supabaseClient';
import { realtimeService } from '../services/realtimeService';
import { isLikelyNetworkError } from '../utils/networkUtils';
import ProfileAvatar from '../components/ProfileAvatar';
import BottomNav from '../components/layout/BottomNav';
import PageHeader from '../components/layout/PageHeader';
import OfflineBanner from '../components/OfflineBanner';
import {
  SoftCard, StatusBadge, DashboardCard,
  LoadingSkeleton, AnimatedIllustration, PrimaryButton,
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
  const {
    profile, currentTrip, currentBus, validatedCount, currentPassengersCount,
    fareCollected, isRestoringTrip, setCurrentTrip, setCurrentBus,
    setValidatedCount, setCurrentPassengersCount, setFareCollected,
    refreshTrip,
    loading: authLoading,
  } = useApp();
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

  // Live Actual Time Clock
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentDate(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const liveActualTime = useMemo(() => {
    return currentDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [currentDate]);

  const greeting = useMemo(() => {
    const hour = currentDate.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, [currentDate]);

  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(currentDate);
  }, [currentDate]);

  const seatCapacity = currentBus?.seat_capacity || 50;
  const occupancyPercent = Math.min(Math.round((validatedCount / seatCapacity) * 100), 100);
  const remainingSeats = Math.max(0, seatCapacity - validatedCount);

  const occupancyStatus = useMemo(() => {
    if (validatedCount >= seatCapacity) return { label: 'Full Capacity', variant: 'danger' as const };
    if (validatedCount >= seatCapacity * 0.8) return { label: 'Near Full', variant: 'warning' as const };
    return { label: 'Seats Available', variant: 'success' as const };
  }, [validatedCount, seatCapacity]);

  const tripStartTime = useMemo(() => {
    if (!currentTrip?.started_at) return null;
    try {
      return new Date(currentTrip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  }, [currentTrip?.started_at]);

  const tripDuration = useMemo(() => {
    if (!currentTrip?.started_at) return null;
    try {
      const startMs = new Date(currentTrip.started_at).getTime();
      if (isNaN(startMs)) return null;
      const diffMins = Math.max(0, Math.floor((currentDate.getTime() - startMs) / 60000));
      const hours = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      if (hours > 0) return `${hours}h ${mins}m elapsed`;
      return `${mins}m elapsed`;
    } catch {
      return null;
    }
  }, [currentTrip?.started_at, currentDate]);

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
        .eq('trip_id', currentTrip.id);

      // Update validatedCount from database for total validated passengers
      if (!validatedError && totalValidatedCount !== null) {
        setValidatedCount(totalValidatedCount);
      }

      // Load total fare collected from transactions
      const { data: transactions, error: txError } = await supabase
        .from('transactions')
        .select('amount')
        .eq('trip_id', currentTrip.id);

      if (!txError && transactions) {
        const totalFare = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;
        setFareCollected(totalFare);
      }

      // Load current GPS location from trip
      if (currentTrip.current_lat && currentTrip.current_lng) {
        setCurrentLocation({ lat: currentTrip.current_lat, lng: currentTrip.current_lng });
        setGpsLastUpdate(currentTrip.gps_updated_at || currentTrip.updated_at || '');
        setGpsStatus('active');
      }

      // Load latest AI passenger count from database
      const { data: latestCount } = await supabase
        .from('passenger_counts')
        .select('count, ai_count')
        .eq('trip_id', currentTrip.id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestCount) {
        setAiPassengerCount(latestCount.ai_count || latestCount.count || 0);
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
      // GPS data is stored in the trips table
      const gpsCleanup = currentTrip
        ? realtimeService.subscribeToGpsLocations(currentTrip.id, {
            onInsert: (trip) => {
              console.log('[Realtime] New GPS location from trip:', trip);
              if (trip.current_lat && trip.current_lng) {
                setCurrentLocation({ lat: trip.current_lat, lng: trip.current_lng });
                setGpsLastUpdate(trip.gps_updated_at || trip.updated_at || '');
                setGpsStatus('active');
              }
            },
            onUpdate: (trip) => {
              console.log('[Realtime] GPS location updated from trip:', trip);
              if (trip.current_lat && trip.current_lng) {
                setCurrentLocation({ lat: trip.current_lat, lng: trip.current_lng });
                setGpsLastUpdate(trip.gps_updated_at || trip.updated_at || '');
                setGpsStatus('active');
              }
            },
          })
        : () => {};

      // Subscribe to AI passenger count updates from camera (read-only for conductor)
      // Passenger count data is stored in the passenger_counts table
      const aiCountCleanup = currentTrip
        ? realtimeService.subscribeToAiPassengerCounts(currentTrip.id, {
            onInsert: (count) => {
              console.log('[Realtime] New AI passenger count:', count);
              setAiPassengerCount(count.ai_count || count.count || 0);
            },
            onUpdate: (count) => {
              console.log('[Realtime] AI passenger count updated:', count);
              setAiPassengerCount(count.ai_count || count.count || 0);
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
    setIsRefreshing(true);
    try {
      // If no active trip, try to fetch from database
      if (!currentTrip) {
        console.log('[HomePage] No active trip, refreshing trip from database');
        await refreshTrip();
        showNotification('Trip status refreshed', 'success');
      } else {
        await loadData();
        showNotification('Data refreshed', 'success');
      }
    } catch (err) {
      showNotification('Failed to refresh data', 'danger');
    } finally {
      setIsRefreshing(false);
      event.detail.complete();
    }
  }, [currentTrip, showNotification, loadData, refreshTrip]);

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
            <div
              onClick={() => history.push('/profile')}
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              title="View Profile"
            >
              <ProfileAvatar name={profile?.full_name || 'User'} size="sm" />
            </div>
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
            style={{ marginBottom: 18 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: 'rgba(255, 255, 255, 0.75)',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}>
                <Calendar size={13} />
                {formattedDate}
              </span>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 10,
                background: hasActiveTrip ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.15)',
                color: hasActiveTrip ? '#4ade80' : 'rgba(255, 255, 255, 0.9)',
                border: `1px solid ${hasActiveTrip ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.2)'}`,
              }}>
                {hasActiveTrip ? 'Shift Active' : 'Shift Standby'}
              </span>
            </div>
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
              fontSize: '0.9rem',
              color: 'rgba(255, 255, 255, 0.85)',
              fontWeight: 500
            }}>
              {hasActiveTrip
                ? `In Transit • Bus #${currentBus?.plate_number || ''}`
                : 'Ready for departure • Awaiting driver'}
            </p>
          </motion.div>

          {!hasActiveTrip ? (
            /* No Active Trip - Polished Waiting for Driver View */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Hero Waiting Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
              >
                <SoftCard variant="hero" padding="none" style={{ overflow: 'hidden', position: 'relative' }}>
                  {/* Decorative Ambient Background Elements */}
                  <div style={{
                    position: 'absolute',
                    top: -40,
                    right: -40,
                    width: 180,
                    height: 180,
                    background: 'rgba(255, 255, 255, 0.12)',
                    borderRadius: '50%',
                    filter: 'blur(35px)',
                    pointerEvents: 'none',
                  }} />
                  <div style={{
                    position: 'absolute',
                    bottom: -30,
                    left: -30,
                    width: 140,
                    height: 140,
                    background: 'rgba(255, 255, 255, 0.08)',
                    borderRadius: '50%',
                    filter: 'blur(25px)',
                    pointerEvents: 'none',
                  }} />

                  <div style={{ padding: '24px 20px', position: 'relative', zIndex: 1, textAlign: 'center' }}>
                    {/* Animated Waiting Illustration */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
                      <AnimatedIllustration type="waiting" size={68} />
                    </div>

                    {/* Status Pill */}
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 12px',
                      borderRadius: 20,
                      background: 'rgba(255, 255, 255, 0.2)',
                      marginBottom: 12,
                    }}>
                      <div style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#fde047',
                        boxShadow: '0 0 8px #fde047',
                        animation: 'pulse 1.5s infinite',
                      }} />
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px' }}>
                        AWAITING DEPARTURE
                      </span>
                    </div>

                    <h2 style={{
                      margin: '0 0 6px',
                      fontSize: '1.4rem',
                      fontWeight: 800,
                      color: '#ffffff',
                      letterSpacing: '-0.4px',
                    }}>
                      Waiting for Driver
                    </h2>

                    <p style={{
                      margin: '0 auto 16px',
                      fontSize: '0.88rem',
                      color: 'rgba(255, 255, 255, 0.92)',
                      lineHeight: 1.45,
                      fontWeight: 400,
                      maxWidth: 320,
                    }}>
                      {profile?.bus_id
                        ? 'The driver will start the trip from the terminal console. Scanner and trip metrics will activate automatically.'
                        : 'No bus assigned to your account. Please contact your dispatch administrator.'}
                    </p>

                    {/* Bus Info Glass Chip inside Hero */}
                    {profile?.bus_id && (
                      <div
                        className="glass-chip"
                        style={{
                          padding: '12px 14px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          textAlign: 'left',
                          background: 'rgba(255, 255, 255, 0.18)',
                          backdropFilter: 'blur(12px)',
                          borderRadius: 14,
                        }}
                      >
                        <div style={{
                          background: 'rgba(255, 255, 255, 0.25)',
                          borderRadius: 10,
                          padding: 8,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                        }}>
                          <Bus size={22} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{
                            margin: '0 0 2px',
                            color: 'rgba(255, 255, 255, 0.8)',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.6px',
                          }}>
                            Assigned Bus
                          </p>
                          <p style={{
                            margin: 0,
                            color: '#ffffff',
                            fontSize: '1rem',
                            fontWeight: 800,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            Bus #{currentBus?.plate_number || 'Loading...'}
                          </p>
                        </div>
                        <div style={{
                          padding: '4px 8px',
                          borderRadius: 8,
                          background: 'rgba(255, 255, 255, 0.2)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          color: '#ffffff',
                        }}>
                          {currentBus?.seat_capacity ? `${currentBus.seat_capacity} Seats` : 'Assigned'}
                        </div>
                      </div>
                    )}

                    {/* Manual Refresh Button */}
                    <PrimaryButton
                      onClick={async () => {
                        setIsRefreshing(true);
                        try {
                          await refreshTrip();
                          showNotification('Trip status refreshed', 'success');
                        } catch (err) {
                          showNotification('Failed to refresh trip', 'danger');
                        } finally {
                          setIsRefreshing(false);
                        }
                      }}
                      disabled={isRefreshing}
                      style={{
                        width: '100%',
                        marginTop: 8,
                      }}
                    >
                      {isRefreshing ? 'Refreshing...' : 'Check for Active Trip'}
                    </PrimaryButton>
                  </div>
                </SoftCard>
              </motion.div>

              {/* Conductor Pre-Shift Readiness Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
              >
                <SoftCard padding="md">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                    <ShieldCheck size={18} color="var(--color-primary)" />
                    <h3 style={{
                      margin: 0,
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.8px',
                    }}>
                      Pre-Shift Readiness
                    </h3>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--bg-secondary)',
                    }}>
                      <CheckCircle2 size={16} color="#10b981" />
                      <div style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Ticket Scanner (QR & NFC Barcode)
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>Ready</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--bg-secondary)',
                    }}>
                      <CheckCircle2 size={16} color="#10b981" />
                      <div style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Offline Fare Matrix & Cache
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700 }}>Cached</span>
                    </div>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'var(--bg-secondary)',
                    }}>
                      <CheckCircle2 size={16} color={isOnline ? '#10b981' : '#f59e0b'} />
                      <div style={{ flex: 1, fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Real-time Fleet Dispatch Link
                      </div>
                      <span style={{ fontSize: '0.72rem', color: isOnline ? '#10b981' : '#f59e0b', fontWeight: 700 }}>
                        {isOnline ? 'Connected' : 'Offline Ready'}
                      </span>
                    </div>
                  </div>
                </SoftCard>
              </motion.div>

              {/* Quick Navigation Cards */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <div
                  onClick={() => history.push('/history')}
                  style={{
                    padding: '14px',
                    borderRadius: 14,
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-xs)',
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(249, 115, 22, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-primary)',
                    marginBottom: 8,
                  }}>
                    <History size={16} />
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Trip History
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Past shifts & sales
                  </div>
                </div>

                <div
                  onClick={() => history.push('/profile')}
                  style={{
                    padding: '14px',
                    borderRadius: 14,
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(16px)',
                    border: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-xs)',
                  }}
                >
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'rgba(59, 130, 246, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#3b82f6',
                    marginBottom: 8,
                  }}>
                    <User size={16} />
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Profile & Staff
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
                    Account settings
                  </div>
                </div>
              </motion.div>
            </div>
          ) : (
            /* Active Trip - Full Conductor Dashboard */
            <>
              {/* Live Trip Status Bar */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 16,
                  padding: '12px 16px',
                  borderRadius: 16,
                  background: 'rgba(255, 255, 255, 0.08)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 10px #10b981',
                    animation: 'pulse 1.8s infinite',
                  }} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#ffffff', letterSpacing: '0.5px' }}>
                    TRIP IN PROGRESS
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* Actual Current Time Clock */}
                  <span style={{
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    background: 'rgba(255, 255, 255, 0.16)',
                    padding: '3px 9px',
                    borderRadius: 12,
                    backdropFilter: 'blur(8px)',
                  }}>
                    <Clock size={13} color="#ffffff" />
                    {liveActualTime}
                  </span>

                  {/* Trip Start Reference & Elapsed Duration */}
                  {tripStartTime && (
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: 'rgba(255, 255, 255, 0.85)',
                      background: 'rgba(0, 0, 0, 0.22)',
                      padding: '3px 8px',
                      borderRadius: 10,
                    }}>
                      Started {tripStartTime}{tripDuration ? ` · ${tripDuration}` : ''}
                    </span>
                  )}

                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 12,
                    background: 'rgba(249, 115, 22, 0.25)',
                    color: '#ffedd5',
                    border: '1px solid rgba(249, 115, 22, 0.4)',
                  }}>
                    Bus #{currentBus?.plate_number || '---'}
                  </span>
                </div>
              </motion.div>

              {/* Passenger Occupancy & Capacity Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                style={{ marginBottom: 16 }}
              >
                <SoftCard
                  style={{
                    padding: '20px',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(20px)',
                    border: '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-md)',
                  }}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                    <div>
                      <p style={{
                        margin: 0,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        color: 'var(--text-tertiary)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                      }}>
                        Passenger Occupancy
                      </p>
                      <h3 style={{
                        margin: '2px 0 0',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                      }}>
                        {currentBus?.route || 'Active Route'}
                      </h3>
                    </div>
                    <StatusBadge variant={occupancyStatus.variant} dot={true}>
                      {occupancyStatus.label}
                    </StatusBadge>
                  </div>

                  {/* Gauge and Breakdown Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    {/* Radial Progress Ring */}
                    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                      <svg width="110" height="110" viewBox="0 0 110 110">
                        <circle
                          cx="55"
                          cy="55"
                          r="44"
                          fill="none"
                          stroke="var(--bg-secondary)"
                          strokeWidth="8"
                        />
                        <motion.circle
                          cx="55"
                          cy="55"
                          r="44"
                          fill="none"
                          stroke={occupancyPercent >= 100 ? '#ef4444' : occupancyPercent >= 80 ? '#f59e0b' : '#10b981'}
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 44}`}
                          strokeDashoffset={`${2 * Math.PI * 44 * (1 - Math.min(validatedCount / seatCapacity, 1))}`}
                          initial={{ strokeDashoffset: 2 * Math.PI * 44 }}
                          animate={{ strokeDashoffset: 2 * Math.PI * 44 * (1 - Math.min(validatedCount / seatCapacity, 1)) }}
                          transition={{ duration: 1, ease: 'easeOut' }}
                          transform="rotate(-90 55 55)"
                        />
                      </svg>
                      <div style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <span style={{
                          fontSize: '1.35rem',
                          fontWeight: 900,
                          color: 'var(--text-primary)',
                          lineHeight: 1,
                        }}>
                          {occupancyPercent}%
                        </span>
                        <span style={{
                          fontSize: '0.6rem',
                          fontWeight: 700,
                          color: 'var(--text-tertiary)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginTop: 3,
                        }}>
                          Capacity
                        </span>
                      </div>
                    </div>

                    {/* Labeled Metrics Stack */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Validated Onboard
                          </div>
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                            {validatedCount} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>passengers</span>
                          </div>
                        </div>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: 'rgba(249, 115, 22, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--color-primary)',
                        }}>
                          <Users size={16} />
                        </div>
                      </div>

                      <div style={{
                        padding: '10px 14px',
                        borderRadius: 12,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}>
                        <div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Available Seats
                          </div>
                          <div style={{ fontSize: '1.15rem', fontWeight: 800, color: remainingSeats > 0 ? '#10b981' : '#ef4444' }}>
                            {remainingSeats} <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-tertiary)' }}>/ {seatCapacity}</span>
                          </div>
                        </div>
                        <div style={{
                          width: 32,
                          height: 32,
                          borderRadius: 8,
                          background: remainingSeats > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: remainingSeats > 0 ? '#10b981' : '#ef4444',
                        }}>
                          <Gauge size={16} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* AI Camera Cross-verification Pill */}
                  {aiPassengerCount > 0 && (
                    <div style={{
                      marginTop: 14,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'rgba(59, 130, 246, 0.08)',
                      border: '1px solid rgba(59, 130, 246, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Sparkles size={14} color="#3b82f6" />
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          AI Camera Count:
                        </span>
                        <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#3b82f6' }}>
                          {aiPassengerCount}
                        </span>
                      </div>
                      <span style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        color: aiPassengerCount === validatedCount ? '#10b981' : '#f59e0b',
                      }}>
                        {aiPassengerCount === validatedCount ? 'Count Matched' : `${Math.abs(aiPassengerCount - validatedCount)} discrepancy`}
                      </span>
                    </div>
                  )}
                </SoftCard>
              </motion.div>

              {/* Financial & Validations KPI Row */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 12,
                  marginBottom: 16,
                }}
              >
                <DashboardCard
                  icon={Wallet}
                  label="Fare Collected"
                  value={`₱${fareCollected.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`}
                  trend="Live Trip Total"
                  iconColor="#10b981"
                  iconBg="rgba(16, 185, 129, 0.12)"
                  delay={0.1}
                />
                <DashboardCard
                  icon={ScanLine}
                  label="Tickets Validated"
                  value={validatedCount.toString()}
                  trend="Scanned Entries"
                  iconColor="#3b82f6"
                  iconBg="rgba(59, 130, 246, 0.12)"
                  delay={0.2}
                />
              </motion.div>

              {/* Secondary Action: Passenger Manifest */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                style={{ marginBottom: 16 }}
              >
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => history.push('/passengers')}
                  style={{
                    width: '100%',
                    padding: '13px 18px',
                    borderRadius: 16,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'blur(16px)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    boxShadow: 'var(--shadow-xs)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      background: 'rgba(59, 130, 246, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#3b82f6',
                    }}>
                      <Users size={18} />
                    </div>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Passenger Manifest & Drops
                      </div>
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        Onboard passenger list
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: currentPassengersCount > 0 ? '#10b981' : 'var(--text-secondary)',
                      background: currentPassengersCount > 0 ? 'rgba(16, 185, 129, 0.12)' : 'var(--bg-secondary)',
                      padding: '4px 10px',
                      borderRadius: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}>
                      {currentPassengersCount > 0 && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      )}
                      {currentPassengersCount} Onboard
                    </span>
                    <ChevronRight size={18} color="var(--text-tertiary)" />
                  </div>
                </motion.button>
              </motion.div>

              {/* Live Telemetry & GPS Card */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.45 }}
                style={{ marginBottom: 20 }}
              >
              </motion.div>
            </>
          )}
        </div>
      </IonContent>

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
