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
} from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, Wallet, AlertTriangle,
  CheckCircle, Bus, Play,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { supabase } from '../supabaseClient';
import { getLocationAndDecode } from '../services/geoService';
import { realtimeService } from '../services/realtimeService';
import ProfileAvatar from '../components/ProfileAvatar';
import BottomNav from '../components/layout/BottomNav';
import PageHeader from '../components/layout/PageHeader';
import OfflineBanner from '../components/OfflineBanner';
import {
  SoftCard, StatusBadge, DashboardCard,
  LoadingSkeleton, TripTimeline,
} from '../components/ui';
import '../styles/modern-transport.css';

// Types

interface DestinationAlert {
  id: string;
  passengerName: string;
  destination: string;
  distance: string;
  status: string;
  message: string;
  color: string;
  timestamp: string;
}

interface TripStats {
  passengerCount: number;
  irregularities: any[];
  capacityPercent: number;
}

// Constants

const GPS_UPDATE_INTERVAL = 30000; // 30 seconds
const DATA_REFRESH_INTERVAL = 30000; // 30 seconds
const PROXIMITY_THRESHOLD_KM = 0.5;
const MAX_DESTINATION_ALERTS = 5;

// Component

const HomePage: React.FC = () => {
  // State
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [tripStats, setTripStats] = useState<TripStats>({
    passengerCount: 0,
    irregularities: [],
    capacityPercent: 0,
  });
  const [loading, setLoading] = useState(true);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'active' | 'inactive' | 'searching'>('searching');
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [destinationAlerts, setDestinationAlerts] = useState<DestinationAlert[]>([]);
  const [notifiedPassengers, setNotifiedPassengers] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Context
  const { profile, currentTrip, currentBus, validatedCount, fareCollected, isRestoringTrip, setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected, loading: authLoading } = useApp();
  const { isOnline, syncInProgress, lastSyncAt } = useNetwork();

  // Refs
  const gpsTrackerRef = useRef<any>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastGpsUpdateRef = useRef<number>(0);
  const proximityCheckRef = useRef<NodeJS.Timeout | null>(null);
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

  const routeStops = useMemo(() => {
    if (!currentBus?.route) return [];
    return currentBus.route.split(/[→\-–>↔]/).map((s) => s.trim()).filter(Boolean);
  }, [currentBus?.route]);

  const timelineStops = useMemo(() => {
    if (routeStops.length >= 2) {
      return routeStops.map((name, i) => ({
        id: String(i),
        name,
        status: (i === 0 ? 'completed' : i === 1 ? 'current' : 'upcoming') as 'completed' | 'current' | 'upcoming',
        eta: i > 1 ? `~${i * 8} min` : undefined,
      }));
    }
    return [{ id: '0', name: currentBus?.route || 'Unknown Route', status: 'current' as const }];
  }, [routeStops, currentBus?.route]);

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
        console.error('[HomePage] Error loading bus info:', error);
        return;
      }

      if (bus) {
        console.log('[HomePage] Bus info loaded:', bus);
        setCurrentBus(bus);
        // Cache for offline use
        localStorage.setItem(`cached_bus_${profile.bus_id}`, JSON.stringify(bus));
      }
    } catch (err) {
      console.error('[HomePage] Error loading bus info:', err);
    }
  }, [profile?.bus_id, setCurrentBus, isOnline]);

  const loadData = useCallback(async () => {
    if (!currentTrip) return;

    // ── OFFLINE: Use cached/local state only ──────────────────────────────
    if (!isOnline) {
      console.log('[HomePage] Offline - using local state for stats');
      // Use local state that's already updated by scan operations
      setTripStats({
        passengerCount: validatedCount,
        irregularities: [],
        capacityPercent: currentBus ? (validatedCount / currentBus.seat_capacity) * 100 : 0,
      });
      return;
    }

    // ── ONLINE: Sync with database ───────────────────────────────────────
    // Check if trip is actually still active in database
    const { data: tripStatus } = await supabase
      .from('trips')
      .select('status, ended_at')
      .eq('id', currentTrip.id)
      .single();

    if (tripStatus && (tripStatus.status === 'completed' || tripStatus.ended_at)) {
      console.log('[HomePage] Trip already ended in database, clearing state');
      setCurrentTrip(null);
      setCurrentBus(null);
      setValidatedCount(0);
      setFareCollected(0);
      return;
    }

    try {
      // Load passenger count - only count passengers who have NOT alighted yet
      const { count: passengerCount } = await supabase
        .from('boarded_passengers')
        .select('id', { count: 'exact', head: true })
        .eq('trip_id', currentTrip.id)
        .is('alighted_at', null);

      // Load total fare collected from transactions
      const { data: transactions } = await supabase
        .from('transactions')
        .select('amount')
        .eq('trip_id', currentTrip.id)
        .eq('type', 'fare_validation');

      const totalFare = transactions?.reduce((sum, tx) => sum + (tx.amount || 0), 0) || 0;

      // Load irregularities
      const { data: irregularities } = await supabase
        .from('fare_irregularities')
        .select('*')
        .eq('trip_id', currentTrip.id)
        .order('detected_at', { ascending: false })
        .limit(10);

      setTripStats({
        passengerCount: Math.max(validatedCount, passengerCount || 0),
        irregularities: irregularities || [],
        capacityPercent: currentBus
          ? (Math.max(validatedCount, passengerCount || 0) / currentBus.seat_capacity) * 100
          : 0,
      });

      setValidatedCount(Math.max(validatedCount, passengerCount || 0));
      setFareCollected(Math.max(fareCollected, totalFare));
    } catch (err) {
      console.error('[HomePage] Error loading data:', err);
    }
  }, [currentTrip, currentBus, setValidatedCount, setCurrentTrip, setCurrentBus, setFareCollected, isOnline, validatedCount, fareCollected]);

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
    if (profile?.id && isOnline) {
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

      realtimeCleanupRef.current = () => {
        console.log('[HomePage] Cleaning up realtime subscriptions');
        tripCleanup();
        passengerCleanup();
      };
      
      networkStateRef.current = true; // Track that we're online with subscriptions
    } else if (!isOnline && networkStateRef.current) {
      // Clean up subscriptions when going offline
      console.log('[HomePage] Going offline, cleaning up realtime subscriptions');
      if (realtimeCleanupRef.current) {
        realtimeCleanupRef.current();
        realtimeCleanupRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      networkStateRef.current = false;
    }

    return () => {
      if (dataInterval) clearInterval(dataInterval);
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (proximityCheckRef.current) clearTimeout(proximityCheckRef.current);
      if (realtimeCleanupRef.current) realtimeCleanupRef.current();
    };
  }, [currentTrip?.id, authLoading, initialLoadDone, loadData, profile?.id, isOnline, setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected, showNotification, history]);

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

  const startTrip = useCallback(async () => {
    console.log('[HomePage] Profile data:', profile);
    console.log('[HomePage] Bus ID check:', profile?.bus_id);
    
    if (!profile?.bus_id) {
      const msg = 'No bus assigned to your account. Please contact administrator.';
      setError(msg);
      showNotification(msg, 'warning');
      return;
    }

    // Check if current time is within allowed hours (4 AM - 10 PM)
    const now = new Date();
    const currentHour = now.getHours();
    const isAllowedTime = currentHour >= 4 && currentHour < 22; // 4 AM to 10 PM (22:00)
    
    if (!isAllowedTime) {
      const msg = 'Trips can only be started between 4:00 AM and 10:00 PM.';
      setError(msg);
      showNotification(msg, 'warning');
      return;
    }

    setError(null);
    setStarting(true);
    showNotification('Starting trip...', 'warning');

    try {
      console.log('[HomePage] Starting trip for conductor:', profile.id, 'bus:', profile.bus_id);

      // ── OFFLINE: create local trip — synced to DB on reconnect ─────────────
      if (!isOnline) {
        const cachedBusRaw = localStorage.getItem(`cached_bus_${profile.bus_id}`);
        if (!cachedBusRaw) {
          const msg = 'Bus info not cached. Connect once while online before starting offline.';
          setError(msg);
          showNotification(msg, 'warning');
          setStarting(false);
          return;
        }

        let bus;
        try {
          bus = JSON.parse(cachedBusRaw);
        } catch {
          const msg = 'Cached bus data is invalid. Connect while online and try again.';
          setError(msg);
          showNotification(msg, 'danger');
          setStarting(false);
          return;
        }

        const localTrip = {
          id: crypto.randomUUID(),
          bus_id: bus.id,
          conductor_id: profile.id,
          started_at: new Date().toISOString(),
          ended_at: null,
          status: 'in_progress' as const,
        };

        console.log('[HomePage] Trip started offline (local):', localTrip.id);
        setCurrentTrip(localTrip);
        setCurrentBus(bus);
        setValidatedCount(0);
        setFareCollected(0);
        setStarting(false);
        showNotification('Trip started offline — will sync when online', 'warning');
        return;
      }

      const { data: bus, error: busErr } = await supabase
        .from('buses')
        .select('*')
        .eq('id', profile.bus_id)
        .eq('status', 'active')
        .single();

      if (busErr || !bus) {
        const msg = busErr?.message || 'Failed to load assigned bus';
        console.error('[HomePage] Bus load error:', busErr);
        setError(msg);
        showNotification(msg, 'danger');
        setStarting(false);
        return;
      }

      // Get current GPS location for starting point
      let startingPoint = bus.route; // Default to route name if GPS fails
      try {
        const locationResult = await getLocationAndDecode();
        if (locationResult.success && locationResult.locationName) {
          startingPoint = locationResult.locationName;
        }
      } catch (err) {
        console.log('[HomePage] GPS location not available, using route as starting point');
      }

      // Guard: check if this conductor already has an active trip in the DB.
      // This prevents a second device from creating a duplicate trip before
      // the realtime INSERT event arrives.
      const { data: existingTrip } = await supabase
        .from('trips')
        .select('id, bus_id, started_at, status')
        .eq('conductor_id', profile.id)
        .eq('status', 'in_progress')
        .maybeSingle();

      if (existingTrip) {
        console.log('[HomePage] Active trip already exists in DB, adopting it:', existingTrip);
        setCurrentTrip(existingTrip as any);
        setCurrentBus(bus);
        setValidatedCount(0);
        setFareCollected(0);
        setStarting(false);
        showNotification('Trip already in progress — synced from another device', 'warning');
        loadData();
        return;
      }

      const { data: trip, error: tripErr } = await supabase
        .from('trips')
        .insert({
          bus_id: bus.id,
          conductor_id: profile.id,
          started_at: new Date().toISOString(),
          status: 'in_progress',
          starting_point: startingPoint,
        })
        .select()
        .single();

      if (tripErr || !trip) {
        const msg = tripErr?.message || 'Failed to create trip';
        console.error('[HomePage] Trip creation error:', tripErr);
        setError(msg);
        showNotification(msg, 'danger');
        setStarting(false);
        return;
      }

      console.log('[HomePage] Trip started successfully:', trip);
      setCurrentTrip(trip);
      setCurrentBus(bus);
      setValidatedCount(0);
      setFareCollected(0);
      setStarting(false);
      showNotification('Trip started successfully!', 'success');
      
      // Start data loading after trip is created
      loadData();
    } catch (err) {
      console.error('[HomePage] Error starting trip:', err);
      const msg = 'An unexpected error occurred';
      setError(msg);
      showNotification(msg, 'danger');
      setStarting(false);
    }
  }, [profile, setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected, showNotification, isOnline, loadData]);

  const endTrip = useCallback(async () => {
    if (!currentTrip) return;

    try {
      // Try to get current GPS location for end_point
      let endPoint: string | undefined;
      try {
        const locationResult = await getLocationAndDecode();
        if (locationResult.success && locationResult.locationName) {
          endPoint = locationResult.locationName;
        }
      } catch (_) { /* GPS optional — don't block trip end */ }

      const { error } = await supabase
        .from('trips')
        .update({
          ended_at: new Date().toISOString(),
          status: 'completed',
          ...(endPoint ? { end_point: endPoint } : {}),
        })
        .eq('id', currentTrip.id);

      if (error) throw error;

      // Navigate FIRST — TripSummaryPage still reads trip state
      // State is cleared by startNewTrip() on that page
      history.push('/trip-summary');
    } catch (err) {
      console.error('[HomePage] Error ending trip:', err);
      showNotification('Failed to end trip', 'danger');
    }
  }, [currentTrip, history, showNotification, setCurrentTrip, setCurrentBus, setValidatedCount, setFareCollected]);

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
        rightAction={<ProfileAvatar name={profile?.full_name || 'User'} size="sm" />}
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
            /* No Active Trip - Show Start Trip Button */
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
                
                <div style={{ padding: '32px 24px', position: 'relative', zIndex: 1 }}>
                  {/* Animated Icon */}
                  <motion.div
                    initial={{ scale: 0, rotate: -180 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ 
                      type: 'spring', 
                      stiffness: 200, 
                      damping: 15, 
                      delay: 0.2 
                    }}
                    style={{
                      background: 'rgba(255, 255, 255, 0.25)',
                      backdropFilter: 'blur(10px)',
                      borderRadius: '50%',
                      width: 72,
                      height: 72,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 20px',
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)'
                    }}
                  >
                    <Play size={32} color="white" />
                  </motion.div>
                  
                  <h2 style={{ 
                    margin: '0 0 8px', 
                    fontSize: '1.75rem', 
                    fontWeight: 800, 
                    color: 'white',
                    textAlign: 'center',
                    letterSpacing: '-0.5px'
                  }}>
                    Ready to Start Your Trip
                  </h2>
                  
                  <p style={{ 
                    margin: '0 0 28px', 
                    fontSize: '1rem', 
                    color: 'rgba(255, 255, 255, 0.9)',
                    textAlign: 'center',
                    lineHeight: 1.5,
                    fontWeight: 400
                  }}>
                    {profile?.bus_id 
                      ? 'Your assigned bus is ready. Start your trip when you are prepared.'
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
                        padding: '16px',
                        marginBottom: 24,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12
                      }}
                    >
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        borderRadius: 10,
                        padding: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Bus size={24} color="white" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ 
                          margin: '0 0 2px', 
                          color: 'rgba(255, 255, 255, 0.7)', 
                          fontSize: '0.75rem', 
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          Assigned Bus
                        </p>
                        <p style={{ 
                          margin: 0, 
                          color: 'white', 
                          fontSize: '1rem', 
                          fontWeight: 700 
                        }}>
                          Bus #{currentBus?.plate_number || 'Loading...'}
                        </p>
                      </div>                    </motion.div>
                  )}
                  
                  <motion.button
                    type="button"
                    onClick={startTrip}
                    disabled={starting || !profile?.bus_id}
                    style={{
                      width: '100%',
                      background: starting || !profile?.bus_id 
                        ? 'rgba(255, 255, 255, 0.3)' 
                        : 'white',
                      border: 'none',
                      borderRadius: 14,
                      padding: '16px 24px',
                      cursor: starting || !profile?.bus_id ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      color: starting || !profile?.bus_id ? 'rgba(255, 255, 255, 0.5)' : '#F97316',
                      fontWeight: 700,
                      fontSize: '1.1rem',
                      boxShadow: starting || !profile?.bus_id 
                        ? 'none' 
                        : '0 8px 24px rgba(0, 0, 0, 0.2)',
                      opacity: starting || !profile?.bus_id ? 0.6 : 1,
                      transition: 'all 0.3s ease'
                    }}
                    whileHover={starting || !profile?.bus_id ? {} : { 
                      scale: 1.02,
                      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)'
                    }}
                    whileTap={starting || !profile?.bus_id ? {} : { scale: 0.98 }}
                  >
                    {starting ? <IonSpinner name="crescent" /> : <Play size={24} />}
                    {starting ? 'Starting Trip...' : 'Start Trip'}
                  </motion.button>
                  
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      style={{ 
                        marginTop: 20, 
                        padding: '14px 16px', 
                        background: 'rgba(239, 68, 68, 0.2)', 
                        backdropFilter: 'blur(10px)',
                        borderRadius: 10, 
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#fca5a5',
                        fontSize: '0.9rem',
                        fontWeight: 500,
                        textAlign: 'center'
                      }}
                    >
                      {error}
                    </motion.div>
                  )}
                </div>
              </SoftCard>
            </motion.div>
          ) : (
            /* Active Trip - Show Trip Progress */
            <>
              {/* Summary Cards */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                style={{ marginBottom: 24 }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                  <DashboardCard
                    icon={ScanLine}
                    label="Passengers"
                    value={tripStats.passengerCount.toString()}
                    trend={undefined}
                    iconColor="#10b981"
                    iconBg="rgba(16, 185, 129, 0.1)"
                  />
                  <DashboardCard
                    icon={Wallet}
                    label="Fare Collected"
                    value={`₱${fareCollected.toFixed(0)}`}
                    trend={undefined}
                    iconColor="#3b82f6"
                    iconBg="rgba(59, 130, 246, 0.1)"
                  />
                  <DashboardCard
                    icon={Bus}
                    label="Capacity"
                    value={`${tripStats.capacityPercent.toFixed(0)}%`}
                    trend={undefined}
                    iconColor="#f59e0b"
                    iconBg="rgba(245, 158, 11, 0.1)"
                  />
                  <DashboardCard
                    icon={AlertTriangle}
                    label="Irregularities"
                    value={tripStats.irregularities.length.toString()}
                    trend={undefined}
                    iconColor={tripStats.irregularities.length > 0 ? '#ef4444' : '#10b981'}
                    iconBg={tripStats.irregularities.length > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)'}
                  />
                </div>
              </motion.div>

              {/* Trip Progress */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                style={{ marginBottom: 24 }}
              >
                <SoftCard variant="hero">
                  <TripTimeline
                    stops={timelineStops}
                    currentStop={routeStops.length >= 2 ? routeStops[0] : undefined}
                    nextStop={routeStops[1]}
                    eta={routeStops[1] ? '~8 min' : undefined}
                    progress={tripStats.capacityPercent}
                    onEndTrip={endTrip}
                  />
                </SoftCard>
              </motion.div>



              {/* Recent Activity */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.4 }}
                style={{ marginBottom: 24 }}
              >
                {loading ? (
                  <LoadingSkeleton variant="list" count={3} />
                ) : (
                  <SoftCard>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                      <h3 style={{ 
                        margin: 0, 
                        fontSize: '1rem', 
                        fontWeight: 700, 
                        color: 'var(--color-text-primary)' 
                      }}>
                        Recent Activity
                      </h3>
                      {tripStats.irregularities.length > 0 && (
                        <StatusBadge variant="warning">{tripStats.irregularities.length} alerts</StatusBadge>
                      )}
                    </div>

                    {tripStats.irregularities.length > 0 ? (
                      tripStats.irregularities.slice(0, 3).map((item) => (
                        <div key={item.id} className="transport-list-item" style={{ 
                          background: 'var(--color-warning-subtle)',
                          marginBottom: 8,
                          padding: '12px 16px'
                        }}>
                          <AlertTriangle size={18} color="#A16207" />
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>
                              {item.type?.replace('_', ' ')}
                            </p>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                              {new Date(item.detected_at).toLocaleTimeString()}
                            </p>
                          </div>
                          <StatusBadge variant={item.resolved ? 'success' : 'danger'}>
                            {item.resolved ? 'Resolved' : 'Pending'}
                          </StatusBadge>
                        </div>
                      ))
                    ) : (
                      <div style={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        padding: '24px 16px',
                        gap: 10
                      }}>
                        <div style={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'rgba(16, 185, 129, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          marginBottom: 4
                        }}>
                          <CheckCircle size={28} color="#10b981" />
                        </div>
                        <p style={{ 
                          margin: 0, 
                          fontWeight: 700, 
                          fontSize: '1rem', 
                          color: 'var(--text-primary)' 
                        }}>
                          All Clear!
                        </p>
                        <p style={{ 
                          margin: 0, 
                          fontSize: '0.85rem', 
                          color: 'var(--text-secondary)',
                          textAlign: 'center'
                        }}>
                          No irregularities detected on this trip
                        </p>
                      </div>
                    )}
                  </SoftCard>
                )}
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
