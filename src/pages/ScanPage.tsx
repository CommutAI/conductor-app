import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useIonViewWillLeave } from '@ionic/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, CheckCircle, CloudOff, RefreshCw,
  MapPin, AlertTriangle, X, CreditCard,
  XCircle, Navigation, ChevronRight, Package, Loader,
  LogIn, LogOut as AlightIcon,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { processScan, ScanResult } from '../services/fareService';
import { StorageService } from '../services/storageService';
import { validateAlightingLocation, getLocationAndDecode } from '../services/geoService';
import { offlineQueueService } from '../services/offlineQueueService';
import { supabase } from '../supabaseClient';
import { Html5Qrcode } from 'html5-qrcode';
import { stripQrShadedRegion } from '../utils/qrScannerUi';
import { Camera } from '@capacitor/camera';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton,
  StatusBadge,
} from '../components/ui';
import AnimatedModal from '../components/ui/AnimatedModal';
import QRCardCanvas from '../components/ui/QRCardCanvas';
import BaggageFeeSelector from '../components/ui/BaggageFeeSelector';
import type { BaggageSelection } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detects card type from QR code prefix
 * rc = regular card, sc = student card, scc = senior citizen card, pc = pwd card
 * trc = temporary regular card, tsc = temporary student card, tscc = temporary senior citizen card, tpc = temporary pwd card
 */
function detectCardTypeFromPrefix(scannedCode: string): { isTicket: boolean; passengerType: string } {
  const code = scannedCode.toLowerCase().trim();

  // Temporary tickets (start with 't')
  if (code.startsWith('trc')) return { isTicket: true, passengerType: 'regular' };
  if (code.startsWith('tsc')) return { isTicket: true, passengerType: 'student' };
  if (code.startsWith('tscc')) return { isTicket: true, passengerType: 'senior_citizen' };
  if (code.startsWith('tpc')) return { isTicket: true, passengerType: 'pwd' };

  // Regular cards (no 't' prefix)
  if (code.startsWith('rc')) return { isTicket: false, passengerType: 'regular' };
  if (code.startsWith('sc')) return { isTicket: false, passengerType: 'student' };
  if (code.startsWith('scc')) return { isTicket: false, passengerType: 'senior_citizen' };
  if (code.startsWith('pc')) return { isTicket: false, passengerType: 'pwd' };

  // Default to regular card if no recognized prefix
  return { isTicket: false, passengerType: 'regular' };
}

/**
 * Normalizes QR code strings by replacing special dash characters with regular hyphens.
 * This handles cases where QR codes contain en dashes (–), em dashes (—), or other dash variants
 * that should be treated as regular hyphens for database lookup.
 */
function normalizeQrCode(scannedUid: string): string {
  return scannedUid
    .replace(/[\u2013\u2014\u2015\u2212\uFF0D]/g, '-') // en dash, em dash, horizontal bar, minus sign, fullwidth hyphen-minus
    .split(':')[0] // Remove colon and any trailing data (e.g., "SC-123:1" -> "SC-123")
    .trim();
}

function getRouteStops(route: string): string[] {
  const separators = ['↔', '←', '→', '-', '–', '—', '>', '<', '|'];
  for (const sep of separators) {
    const stops = route.split(sep).map((s) => s.trim()).filter(Boolean);
    if (stops.length >= 2) return stops;
  }
  return [];
}

// Helper to determine if camera should be visible
function shouldShowCamera(scanState: ScanState): boolean {
  return scanState === 'idle'
    || scanState === 'scanning'
    || scanState === 'payment_options'
    || scanState === 'detected'
    || scanState === 'processing'
    || scanState === 'committing'
    || scanState === 'success'
    || scanState === 'failed';
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanState =
  | 'idle'
  | 'scanning'
  | 'detected'
  | 'processing'
  | 'confirm_alighting'
  | 'pick_destination'
  | 'payment_options'
  | 'committing'
  | 'success'
  | 'failed';

/** Raw card/ticket data captured right after the QR is decoded (before destination is chosen) */
type PendingScan = {
  code: string;
  balance: number;       // current card balance (before deduction)
  cardDestination?: string; // destination already on the card (if any)
  fare: number;          // estimated fare
  passengerType?: string; // passenger type (regular, student, senior_citizen, pwd)
  cardUid?: string;      // last 8 chars of the card UID for display
  isTicket?: boolean;    // true if this is a temporary ticket
  cardId?: string;       // qr_cards.id — required for offline sync
  tempTicketId?: string; // temporary_tickets.id — required for offline sync
};

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_FARE = 12;

const ScanPage: React.FC = () => {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalColor, setModalColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [scanType, setScanType] = useState<'onboarding' | 'alighting'>('onboarding');

  // Post-scan state (onboarding: waiting for destination pick)
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string>('');
  const [baggageSelection, setBaggageSelection] = useState<BaggageSelection | null>(null);
  const [showBaggageSelector, setShowBaggageSelector] = useState(false);
  const [pendingAlighting, setPendingAlighting] = useState<any | null>(null);
  const [alightingBaggageSelection, setAlightingBaggageSelection] = useState<BaggageSelection | null>(null);
  const [showAlightingBaggageSelector, setShowAlightingBaggageSelector] = useState(false);
  
  // Payment options state (for insufficient balance scenarios)
  const [pendingPayment, setPendingPayment] = useState<{
    code: string;
    balance: number;
    fare: number;
    baggageFee?: number;
    baggageCategory?: string;
    baggageWeight?: number;
    totalFare: number;
    destination?: string;
    passengerType?: string;
    cardId?: string;
  } | null>(null);


  // Final result info
  const [successMsg, setSuccessMsg] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);
  const [successBalance, setSuccessBalance] = useState<number | null>(null);
  const [failedMsg, setFailedMsg] = useState('');
  const [debugScannedCode, setDebugScannedCode] = useState('');

  const [boardedCount, setBoardedCount] = useState(0);
  const [alightedCount, setAlightedCount] = useState(0);
  const [gpsValidating, setGpsValidating] = useState(false);
  const [gpsResult, setGpsResult] = useState<{ status: string; message: string; nearestStop: string } | null>(null);
  const [currentStopName, setCurrentStopName] = useState<string | null>(null); // GPS-detected current location
  const [currentCoordinates, setCurrentCoordinates] = useState<{ lat: number; lng: number } | null>(null); // GPS coordinates

  const { currentTrip, currentBus, validatedCount, fareCollected, setValidatedCount, setFareCollected, isRestoringTrip, profile } = useApp();
  const { isOnline, pendingCount, isSyncing, triggerSync, bumpPending } = useNetwork();
  const history = useHistory();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const stripShadedRegionRef = useRef<(() => void) | null>(null);
  const cameraReadyRef = useRef(false);
  const lastScanTimeRef = useRef(0);
  const lastScanCodeRef = useRef('');
  const offlineQueueCleanupRef = useRef<(() => void) | null>(null);

  const routeStops = currentBus ? getRouteStops(currentBus.route) : [];
  const displayStops = routeStops.length >= 2 ? routeStops : [
    'Agora Terminal',
    'Puerto',
    'Ba-e',
    'Mambatangan',
    'Maitom',
    'Ala-e',
    'Lonocan',
    'San Miguel',
    'Diclum',
    'Manolo Fortich',
  ];

  useEffect(() => {
    if (!isRestoringTrip && (!currentTrip || !currentBus)) {
      history.replace('/');
    }
    return () => { cleanupScanner(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up camera whenever the page is left (back gesture, hardware back, tab switch)
  useIonViewWillLeave(() => {
    cleanupScanner();
  });

  // Auto-detect current GPS location when destination picker opens
  useEffect(() => {
    if (scanState !== 'pick_destination') return;
    let cancelled = false;
    (async () => {
      try {
        console.log('[GPS] Attempting to get current location...');
        const locationResult = await getLocationAndDecode();
        if (cancelled) return;
        console.log('[GPS] Location obtained:', locationResult);
        
        if (locationResult.success && locationResult.locationName) {
          setCurrentStopName(locationResult.locationName);
          if (locationResult.coordinates) {
            setCurrentCoordinates({
              lat: locationResult.coordinates.lat,
              lng: locationResult.coordinates.lng,
            });
          }
          console.log('[GPS] Current location set to:', locationResult.locationName);
        } else {
          console.log('[GPS] Location detection failed:', locationResult.error);
          setCurrentStopName(null);
          setCurrentCoordinates(null);
        }
      } catch (err) {
        console.error('[GPS] Error getting location:', err);
        // GPS unavailable — no current location shown
        setCurrentStopName(null);
        setCurrentCoordinates(null);
      }
    })();
    return () => { cancelled = true; };
  }, [scanState]);

  // Auto-restart scanner after failed state (only for onboarding duplicate scans)
  useEffect(() => {
    if (scanState !== 'failed') return;
    // Only auto-restart for onboarding duplicate scans, not for alighting errors
    if (scanType !== 'onboarding' || !failedMsg.includes('Already boarded')) return;
    const timeout = setTimeout(() => {
      setFailedMsg('');
      processingRef.current = false;
      lastScanTimeRef.current = 0;
      lastScanCodeRef.current = '';
      setScanState('scanning');
    }, 2000);
    return () => clearTimeout(timeout);
  }, [scanState, scanType, failedMsg]);

  // Subscribe to offline queue changes
  useEffect(() => {
    const cleanup = offlineQueueService.subscribe((queue) => {
      const pendingCount = queue.filter(q => q.status === 'pending').length;
      bumpPending(pendingCount);
    });

    offlineQueueCleanupRef.current = cleanup;

    return () => {
      cleanup();
    };
  }, [bumpPending]);

  // BUG 4 FIX: Removed duplicate sync trigger — NetworkContext.triggerSync() already
  // handles flushing StorageService.syncOfflineScans() when coming back online.
  // offlineQueueService is now the single source of truth for the offline queue;
  // NetworkContext coordinates all sync so there are no concurrent Supabase races.

  // ── Scanner helpers ───────────────────────────────────────────────────────

  function showNotification(message: string, color: 'success' | 'danger' | 'warning') {
    setModalMessage(message);
    setModalColor(color);
    setShowModal(true);
  }

  async function cleanupScanner() {
    stripShadedRegionRef.current?.();
    stripShadedRegionRef.current = null;
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        await scannerRef.current.clear();
      }
    } catch { /* ignore */ }
    scannerRef.current = null;
  }

  const startCamera = useCallback(async () => {
    // Guard: no active trip = no scanner
    if (!currentTrip || !currentBus) {
      showNotification('Start a trip before scanning', 'warning');
      setScanState('idle');
      history.replace('/');
      return;
    }

    setScanState('scanning');
    processingRef.current = false;
    cameraReadyRef.current = false;

    await new Promise(resolve => setTimeout(resolve, 100));

    const readerEl = document.getElementById('qr-reader');
    if (!readerEl) {
      showNotification('Camera element not found', 'danger');
      setScanState('idle');
      return;
    }

    try {
      // Clear any existing scanner first
      await cleanupScanner();

      const qrCode = new Html5Qrcode('qr-reader');
      scannerRef.current = qrCode;
      
      // Add qrbox for better detection - define scan area
      const config = {
        fps: 10,
        aspectRatio: 1.0,
        qrbox: { width: 250, height: 250 },
      };

      await qrCode.start(
        { facingMode: 'environment' },
        config,
        async (decodedText: string, decodedResult: any) => {
          if (!cameraReadyRef.current) return;
          if (!decodedText || decodedText.length < 5 || decodedText.length > 100) return;

          const now = Date.now();
          if (decodedText === lastScanCodeRef.current && (now - lastScanTimeRef.current) < 500) return;

          if (processingRef.current) return;
          processingRef.current = true;
          lastScanTimeRef.current = now;
          lastScanCodeRef.current = decodedText;

          // Show detection animation first
          setScanState('detected');
          // Then process after short delay
          setTimeout(async () => {
            setScanState('processing');
            await handleRawScan(decodedText);
          }, 500);
        },
        (errorMessage: string) => {
          // Silently ignore scan errors
        }
      );
      stripShadedRegionRef.current = stripQrShadedRegion('qr-reader');
      
      setTimeout(() => {
        cameraReadyRef.current = true;
      }, 2000);
    } catch (err) {
      showNotification('Failed to start camera', 'danger');
      setScanState('idle');
    }
  }, [scanType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function stopCamera() {
    try {
      await cleanupScanner();
    } catch (err) {
      console.error('[ScanPage] Error stopping camera:', err);
    }
    setScanState('idle');
    setPendingScan(null);
    setSelectedDestination('');
    setCurrentStopName(null);
    setCurrentCoordinates(null);
    processingRef.current = false;
    lastScanTimeRef.current = 0;
    lastScanCodeRef.current = '';
    cameraReadyRef.current = false;
  }

  async function retryCamera() {
    setPendingScan(null);
    setSelectedDestination('');
    setFailedMsg('');
    setCurrentStopName(null);
    setCurrentCoordinates(null);
    processingRef.current = false;
    lastScanTimeRef.current = 0;
    lastScanCodeRef.current = '';
    // BUG 9 FIX: startCamera() must be called to actually reinitialise the camera
    // hardware. Previously this only set scanState which showed scanning UI but
    // left a blank video feed because Html5Qrcode was never restarted.
    await startCamera();
  }

  async function handleCashPayment() {
    if (!pendingPayment || !currentTrip || !profile) return;
    
    try {
      setScanState('processing');
      
      // Process the boarding with cash payment
      const result = await processScan(
        pendingPayment.code,
        currentTrip.id,
        profile.id,
        currentBus?.route,
        'onboarding',
        pendingPayment.destination,
        pendingPayment.baggageFee,
        pendingPayment.baggageCategory,
        pendingPayment.baggageWeight,
        'cash',
      );
      
      if (result.status === 'qr_pass') {
        setValidatedCount(validatedCount + 1);
        setBoardedCount(c => c + 1);
        setPendingPayment(null);
        setPendingScan(null);
        setBaggageSelection(null);
        setSelectedDestination('');
        setSuccessMsg('Boarding successful (cash payment)');
        setSuccessAmount(pendingPayment.totalFare);
        setSuccessBalance(null); // No balance change for cash payment
        setScanState('success');
        setTimeout(async () => {
          setSuccessMsg('');
          setSuccessAmount(0);
          setSuccessBalance(null);
          processingRef.current = false;
          lastScanTimeRef.current = 0;
          lastScanCodeRef.current = '';
          await cleanupScanner();
          setScanState('idle');
        }, 1500);
      } else {
        const errorMsg = (result as any).message || 'Cash payment failed';
        setFailedMsg(errorMsg);
        setScanState('failed');
      }
    } catch (err) {
      console.error('Cash payment error:', err);
      setFailedMsg(`Cash payment error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
    }
  }

  async function handleContinueWithCard() {
    if (!pendingPayment) return;
    
    // Prompt user to top up their card or use a different card
    setPendingPayment(null);
    setFailedMsg('Please top up your card or use a different payment method');
    setScanState('failed');
  }

  // ── Core scan handler ─────────────────────────────────────────────────────

  /**
   * Called immediately after a QR code is decoded.
   * - For ONBOARDING: only reads card info (no DB write yet), then shows destination picker.
   * - For ALIGHTING: processes fully (deducts fare, verifies destination).
   */
  async function handleRawScan(scannedCode: string) {
    if (!currentTrip || !profile) return;

    // Both online and offline go through the same full UX flow.
    // Offline: card lookup uses persistent cache / QR prefix fallback.
    // The DB write is deferred to the queue — but the conductor still sees
    // passenger details and confirms destination before queuing.
    if (scanType === 'onboarding') {
      await handleOnboardingPreScan(scannedCode);
    } else {
      await handleAlightingScan(scannedCode);
    }
  }

  /** For onboarding: auto-confirm boarding with card destination or default */
  async function handleOnboardingPreScan(scannedCode: string) {
    try {
      console.log('Processing scanned code:', scannedCode);
      setDebugScannedCode(scannedCode);

      const detectedType = detectCardTypeFromPrefix(scannedCode);
      const normalizedCode = normalizeQrCode(scannedCode);

      if (!currentTrip) {
        setFailedMsg('No active trip found');
        setScanState('failed');
        return;
      }

      // ── OFFLINE PATH — use persistent cache or prefix-derived defaults ──
      if (!isOnline) {
        const cardUidNorm = detectedType.isTicket ? undefined : normalizedCode.toUpperCase();
        const ticketUidNorm = detectedType.isTicket ? normalizedCode.toUpperCase() : undefined;

        if (offlineQueueService.hasPendingBoarding(currentTrip.id, cardUidNorm, ticketUidNorm)) {
          setFailedMsg('Already boarded — pending offline sync');
          setScanState('failed');
          return;
        }

        if (detectedType.isTicket) {
          const cachedTicket = StorageService.getCachedTicket(normalizedCode);
          if (cachedTicket) {
            if (cachedTicket.status === 'validated' || cachedTicket.status === 'expired') {
              setFailedMsg(cachedTicket.status === 'expired' ? 'Ticket expired' : 'Ticket already used');
              setScanState('failed');
              return;
            }
            setPendingScan({
              code: scannedCode,
              balance: cachedTicket.fare_amount,
              cardDestination: cachedTicket.destination,
              fare: cachedTicket.fare_amount,
              passengerType: cachedTicket.passenger_type || detectedType.passengerType,
              cardUid: cachedTicket.ticket_uid.toUpperCase(),
              isTicket: true,
              tempTicketId: cachedTicket.id,
            });
          } else {
            // No cache — derive from prefix, use default fare
            setPendingScan({
              code: scannedCode,
              balance: DEFAULT_FARE,
              fare: DEFAULT_FARE,
              passengerType: detectedType.passengerType,
              cardUid: normalizedCode.toUpperCase(),
              isTicket: true,
            });
          }
        } else {
          const cachedCard = StorageService.getCachedCard(normalizedCode);
          if (cachedCard) {
            if (cachedCard.status !== 'active') {
              setFailedMsg('Card is inactive');
              setScanState('failed');
              return;
            }
            setPendingScan({
              code: scannedCode,
              balance: cachedCard.balance,
              cardDestination: cachedCard.destination,
              fare: DEFAULT_FARE,
              passengerType: cachedCard.passenger_type || detectedType.passengerType,
              cardUid: cachedCard.card_uid.toUpperCase(),
              isTicket: false,
              cardId: cachedCard.id,
            });
          } else {
            // No cache — derive from prefix only, balance unknown
            setPendingScan({
              code: scannedCode,
              balance: 999, // unknown — skip balance check, commit will queue offline
              fare: DEFAULT_FARE,
              passengerType: detectedType.passengerType,
              cardUid: normalizedCode.toUpperCase(),
              isTicket: false,
            });
          }
        }
        setSelectedDestination('');
        setScanState('pick_destination');
        return;
      }

      // ── ONLINE PATH ──────────────────────────────────────────────────────
      // Try temporary ticket first if prefix indicates it's a ticket
      if (detectedType.isTicket) {
        const { data: ticket, error: ticketError } = await supabase
          .from('temporary_tickets')
          .select('id, ticket_uid, fare_amount, status, destination, passenger_type')
          .eq('ticket_uid', normalizedCode)
          .maybeSingle();

        if (ticket) {
          // Save to persistent cache for offline use
          StorageService.cacheTicket({
            id: ticket.id,
            ticket_uid: ticket.ticket_uid,
            fare_amount: ticket.fare_amount,
            status: ticket.status,
            destination: ticket.destination,
            passenger_type: ticket.passenger_type,
          });

          if (ticket.status === 'validated' || ticket.status === 'expired') {
            setFailedMsg(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used');
            setScanState('failed');
            return;
          }

          const { data: boardedTicket } = await supabase
            .from('boarded_passengers')
            .select('id')
            .eq('trip_id', currentTrip.id)
            .eq('temp_ticket_id', ticket.id)
            .is('alighted_at', null)
            .order('boarded_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (boardedTicket) {
            setFailedMsg('Already boarded on this trip');
            setScanState('failed');
            return;
          }

          setPendingScan({
            code: scannedCode,
            balance: ticket.fare_amount,
            cardDestination: ticket.destination,
            fare: ticket.fare_amount,
            passengerType: detectedType.passengerType,
            cardUid: (ticket.ticket_uid || scannedCode).toUpperCase(),
            isTicket: true,
            tempTicketId: ticket.id,
          });
          setSelectedDestination('');
          setScanState('pick_destination');
          return;
        }
      }

      // Try QR card
      const { data: card, error: cardError } = await supabase
        .from('qr_cards')
        .select('id, balance, status, allowed_routes, destination, passenger_type, card_uid, owner_name')
        .eq('card_uid', normalizedCode)
        .maybeSingle();

      if (cardError) {
        console.error('Database query error:', cardError);
        setFailedMsg(`Database error: ${cardError.message}`);
        setScanState('failed');
        return;
      }

      if (card) {
        if (card.status !== 'active') {
          setFailedMsg('Card is inactive');
          setScanState('failed');
          return;
        }

        // Save to persistent cache for offline use
        StorageService.cacheCard({
          id: card.id,
          card_uid: card.card_uid,
          balance: Number(card.balance),
          status: card.status,
          passenger_type: card.passenger_type,
          destination: card.destination,
          allowed_routes: card.allowed_routes || [],
          owner_name: card.owner_name,
        });

        const { data: boardedPassenger } = await supabase
          .from('boarded_passengers')
          .select('id')
          .eq('trip_id', currentTrip.id)
          .eq('card_id', card.id)
          .is('alighted_at', null)
          .order('boarded_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (boardedPassenger) {
          setFailedMsg('Already boarded on this trip');
          setScanState('failed');
          return;
        }

        const passengerType = detectedType.passengerType;
        console.log('Card type determination', { prefixType: detectedType.passengerType, dbType: card.passenger_type, finalType: passengerType });

        setPendingScan({
          code: scannedCode,
          balance: card.balance,
          cardDestination: card.destination,
          fare: DEFAULT_FARE,
          passengerType: passengerType,
          cardUid: (card.card_uid || scannedCode).toUpperCase(),
          isTicket: false,
          cardId: card.id,
        });
        setSelectedDestination('');
        setScanState('pick_destination');
        return;
      }

      setFailedMsg(`QR code not recognised`);
      setScanState('failed');
    } catch (err) {
      console.error('Scan processing error:', err);
      setFailedMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
    }
  }

  /** After user picks destination in onboarding — commit the boarding */
  async function commitBoarding() {
    console.log('commitBoarding called');
    console.log('pendingScan:', pendingScan);
    console.log('selectedDestination:', selectedDestination);
    console.log('currentTrip:', currentTrip);
    console.log('profile:', profile);
    
    if (!pendingScan || !selectedDestination || !currentTrip || !profile) {
      console.error('Missing required data for boarding:', {
        hasPendingScan: !!pendingScan,
        hasSelectedDestination: !!selectedDestination,
        hasCurrentTrip: !!currentTrip,
        hasProfile: !!profile
      });
      setFailedMsg('Missing required data for boarding');
      setScanState('failed');
      return;
    }

    // If balance is insufficient, go straight to cash payment
    const totalRequired = pendingScan.fare + (baggageSelection?.fee || 0);
    if (!pendingScan.isTicket && pendingScan.balance < totalRequired) {
      await commitBoardingWithDestination(pendingScan.code, selectedDestination, 'cash');
    } else {
      await commitBoardingWithDestination(pendingScan.code, selectedDestination, 'card');
    }
  }

  /** Commit boarding with a specific destination (used for both manual and auto-confirm) */
  async function commitBoardingWithDestination(code: string, destination: string, paymentMethod: 'card' | 'cash' = 'card') {
    if (!currentTrip || !profile) {
      console.error('Missing currentTrip or profile in commitBoardingWithDestination');
      setFailedMsg('Missing trip or profile data');
      setScanState('failed');
      return;
    }
    setScanState('committing');

    try {
      console.log('Committing boarding with code:', code, 'destination:', destination, 'payment:', paymentMethod);
      console.log('Current trip ID:', currentTrip.id);
      console.log('Profile ID:', profile.id);
      console.log('Bus route:', currentBus?.route);
      console.log('Is online:', isOnline);

      // Check if user is authenticated (only when committing to server)
      if (isOnline) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setFailedMsg('Not authenticated. Please login again.');
          setScanState('failed');
          return;
        }
      }

      // If offline, queue the scan with full details instead of processing immediately
      if (!isOnline) {
        console.log('[Offline] Queuing boarding scan with destination:', destination);
        const { isTicket } = detectCardTypeFromPrefix(code);
        const normalized = normalizeQrCode(code);
        const cardUid = isTicket ? undefined : normalized.toUpperCase();
        const ticketUid = isTicket ? normalized.toUpperCase() : undefined;

        if (offlineQueueService.hasPendingBoarding(currentTrip.id, cardUid, ticketUid)) {
          setFailedMsg('Already boarded — pending offline sync');
          setScanState('failed');
          return;
        }

        // Resolve IDs from pending scan or persistent cache
        let cardId = pendingScan?.cardId;
        let tempTicketId = pendingScan?.tempTicketId;
        if (!cardId && !tempTicketId) {
          if (isTicket) {
            tempTicketId = StorageService.getCachedTicket(normalized)?.id;
          } else {
            cardId = StorageService.getCachedCard(normalized)?.id;
          }
        }

        if (!cardId && !tempTicketId) {
          setFailedMsg('Card not cached — scan once while online before going offline');
          setScanState('failed');
          return;
        }

        offlineQueueService.addScan({
          type: 'boarding',
          cardUid,
          ticketUid,
          cardId,
          tempTicketId,
          fare: pendingScan?.fare,
          baggageFee: baggageSelection?.fee,
          paymentMethod,
          destination,
          tripId: currentTrip.id,
        });

        bumpPending(offlineQueueService.getPendingCount());

        setValidatedCount(validatedCount + 1);
        setBoardedCount(c => c + 1);
        setPendingScan(null);
        setBaggageSelection(null);
        setSelectedDestination('');
        setScanState('success');
        setSuccessMsg('Boarded — saved offline, will sync when online');
        const totalFare = (pendingScan?.fare || 0) + (baggageSelection?.fee || 0);
        setSuccessAmount(totalFare);
        setSuccessBalance(null);

        setTimeout(async () => {
          setSuccessMsg('');
          setSuccessAmount(0);
          processingRef.current = false;
          lastScanTimeRef.current = 0;
          lastScanCodeRef.current = '';
          await cleanupScanner();
          setScanState('idle');
        }, 1500);
        return;
      }

      const result = await processScan(
        code,
        currentTrip.id,
        profile.id,
        currentBus?.route,
        'onboarding',
        destination,
        baggageSelection?.fee || 0,
        baggageSelection?.category,
        baggageSelection?.weight,
        paymentMethod,
        currentStopName || undefined,
      );
      console.log('Process scan result:', result);
      console.log('Result status:', result.status);
      console.log('Result message:', (result as any).message);

      switch (result.status) {
        case 'qr_pass':
          setValidatedCount(validatedCount + 1);
          setBoardedCount(c => c + 1);
          setPendingScan(null);
          setBaggageSelection(null);
          setSelectedDestination('');
          setScanState('success');
          setSuccessMsg(paymentMethod === 'cash' ? 'Boarded — cash payment recorded' : 'Boarding successful');
          setSuccessAmount(result.totalFare || 0);
          setSuccessBalance(paymentMethod === 'cash' ? null : result.newBalance);
          // Return to idle (mode selector) after successful onboarding
          setTimeout(async () => {
            setSuccessMsg('');
            setSuccessAmount(0);
            setSuccessBalance(null);
            processingRef.current = false;
            lastScanTimeRef.current = 0;
            lastScanCodeRef.current = '';
            await cleanupScanner();
            setScanState('idle');
          }, 1500);
          break;
        case 'ticket_validated':
          setValidatedCount(validatedCount + 1);
          setBoardedCount(c => c + 1);
          setPendingScan(null);
          setBaggageSelection(null);
          setSelectedDestination('');
          setScanState('success');
          setSuccessMsg('Ticket boarded successfully');
          setSuccessAmount(0);
          setSuccessBalance(null);
          // Return to idle (mode selector) after successful onboarding
          setTimeout(async () => {
            setSuccessMsg('');
            setSuccessAmount(0);
            setSuccessBalance(null);
            processingRef.current = false;
            lastScanTimeRef.current = 0;
            lastScanCodeRef.current = '';
            await cleanupScanner();
            setScanState('idle');
          }, 1500);
          break;
        case 'duplicate_scan':
          setFailedMsg('Already boarded on this trip');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'qr_fail_balance':
          const neededFare = result.totalFare || result.fare;
          // Show payment options instead of failing
          setPendingPayment({
            code: pendingScan?.code || '',
            balance: result.balance,
            fare: result.fare,
            baggageFee: result.baggageFee,
            baggageCategory: baggageSelection?.category,
            baggageWeight: baggageSelection?.weight,
            totalFare: neededFare,
            destination: pendingScan?.cardDestination || selectedDestination,
            passengerType: pendingScan?.passengerType,
            cardId: pendingScan?.code, // This would be the card ID in a real implementation
          });
          setScanState('payment_options');
          break;
        case 'qr_inactive':
          setFailedMsg('Card is inactive');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'qr_wrong_trip':
          setFailedMsg(`Wrong route. Card is for: ${result.expectedRoute}`);
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'qr_fake':
          setFailedMsg(`Invalid QR: ${result.reason}`);
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'ticket_already_used':
          setFailedMsg('Ticket already used');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'ticket_expired':
          setFailedMsg('Ticket expired');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'ticket_wrong_trip':
          setFailedMsg(`Wrong route. Ticket is for: ${result.expectedRoute}`);
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'error':
          setFailedMsg(result.message || 'An error occurred');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'not_found':
          setFailedMsg('QR code not recognised');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        default:
          // BUG 2 FIX: dead code (duplicate setBaggageSelection/setSelectedDestination
          // after break) has been removed. These calls now only appear once, before break.
          console.error('Unexpected result status:', (result as any).status);
          setFailedMsg('Boarding failed - unexpected error');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
      }
    } catch (err) {
      console.error('Boarding error:', err);
      setFailedMsg(`Boarding error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
      setBaggageSelection(null);
      setSelectedDestination('');
    }
  }

  /** Full alighting process with GPS validation */
  async function handleAlightingScan(scannedCode: string) {
    try {
      console.log('Processing alighting scan for code:', scannedCode);

      // Detect card type from QR code prefix (like onboarding)
      const detectedType = detectCardTypeFromPrefix(scannedCode);
      console.log('Detected card type from prefix:', detectedType);

      // Normalize the scanned UID (like onboarding)
      const normalizedCode = normalizeQrCode(scannedCode);
      console.log('Normalized code:', normalizedCode);

      if (!currentTrip) {
        setFailedMsg('No active trip found');
        setScanState('failed');
        return;
      }

      // ── OFFLINE PATH — use persistent cache or prefix-derived defaults ──
      if (!isOnline) {
        console.log('[Alighting] Offline mode - using cache for alighting');
        
        if (detectedType.isTicket) {
          const cachedTicket = StorageService.getCachedTicket(normalizedCode);
          if (cachedTicket) {
            // For offline, we can't verify if ticket was boarded, so we queue it for sync
            setPendingAlighting({
              code: scannedCode,
              destination: cachedTicket.destination,
              fare: cachedTicket.fare_amount,
              passengerType: cachedTicket.passenger_type || detectedType.passengerType,
              tempTicketId: cachedTicket.id,
            });
            setScanState('confirm_alighting');
            return;
          }
        } else {
          const cachedCard = StorageService.getCachedCard(normalizedCode);
          if (cachedCard) {
            if (cachedCard.status !== 'active') {
              setFailedMsg('Card is inactive');
              setScanState('failed');
              return;
            }
            // For offline, we can't verify if card was boarded, so we queue it for sync
            setPendingAlighting({
              code: scannedCode,
              destination: cachedCard.destination,
              fare: DEFAULT_FARE,
              passengerType: cachedCard.passenger_type || detectedType.passengerType,
              cardId: cachedCard.id,
            });
            setScanState('confirm_alighting');
            return;
          }
        }
        
        // No cache - still allow alighting with minimal info
        setPendingAlighting({
          code: scannedCode,
          destination: undefined,
          fare: DEFAULT_FARE,
          passengerType: detectedType.passengerType,
        });
        setScanState('confirm_alighting');
        return;
      }

      // ── ONLINE PATH ──────────────────────────────────────────────────────
      // Step 1 — Check for temporary ticket first if prefix indicates it's a ticket (like onboarding)
      if (detectedType.isTicket) {
        console.log('Prefix indicates temporary ticket, checking temporary_tickets table first');
        const { data: ticket, error: ticketError } = await supabase
          .from('temporary_tickets')
          .select('id, ticket_uid, fare_amount, status, destination, passenger_type')
          .eq('ticket_uid', normalizedCode)
          .maybeSingle();

        console.log('Ticket lookup result:', ticket);
        console.log('Ticket lookup error:', ticketError);

        if (ticket) {
          if (ticket.status === 'validated' || ticket.status === 'expired') {
            setFailedMsg(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used');
            setScanState('failed');
            return;
          }

          // Check if there's an active (unalighted) boarding for this ticket on this trip
          const { data: boardedTicket } = await supabase
            .from('boarded_passengers')
            .select('id, alighted_at')
            .eq('trip_id', currentTrip.id)
            .eq('temp_ticket_id', ticket.id)
            .is('alighted_at', null)
            .order('boarded_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!boardedTicket) {
            setFailedMsg('Ticket not boarded on this trip');
            setScanState('failed');
            return;
          }

          // Process ticket alighting
          const result = await processScan(
            scannedCode,
            currentTrip.id,
            profile!.id,
            currentBus?.route,
            'alighting',
            undefined,
            0,
          );

          handleAlightingResult(result);
          return;
        }
      }

      // Step 2 — Try QR card (like onboarding)
      const { data: card } = await supabase
        .from('qr_cards')
        .select('id, destination, status, balance, passenger_type, card_uid, owner_name')
        .eq('card_uid', normalizedCode)
        .maybeSingle();

      console.log('Card lookup result:', card);

      if (!card) {
        setFailedMsg('QR code not recognised');
        setScanState('failed');
        return;
      }

      if (card.status !== 'active') {
        setFailedMsg('Card is inactive');
        setScanState('failed');
        return;
      }

      // Check if already boarded on this trip (prevent duplicate alighting scans)
      console.log('[Alighting] Checking for boarded passenger - card:', card.id, 'trip:', currentTrip.id);
      
      // Look for the most recent active (unalighted) boarding for this card on this trip
      let boardedPassenger = await supabase
        .from('boarded_passengers')
        .select('id, alighted_at, boarded_at')
        .eq('trip_id', currentTrip.id)
        .eq('card_id', card.id)
        .is('alighted_at', null)
        .order('boarded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // If not found by card_id, try by temp_ticket_id
      if (!boardedPassenger.data) {
        console.log('[Alighting] Not found by card_id, trying temp_ticket_id lookup');
        boardedPassenger = await supabase
          .from('boarded_passengers')
          .select('id, alighted_at, boarded_at')
          .eq('trip_id', currentTrip.id)
          .eq('temp_ticket_id', card.id)
          .is('alighted_at', null)
          .order('boarded_at', { ascending: false })
          .limit(1)
          .maybeSingle();
      }

      const actualBoardedPassenger = boardedPassenger.data;

      // Fetch fare and baggage info from boarding transaction
      const { data: boardingTransaction } = await supabase
        .from('transactions')
        .select('amount, baggage_category, baggage_weight, baggage_fee, channel')
        .eq('card_id', card.id)
        .eq('trip_id', currentTrip.id)
        .eq('type', 'fare_validation')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      console.log('[Alighting] Boarding transaction result:', boardingTransaction);

      console.log('[Alighting] Boarded passenger check result:', actualBoardedPassenger);
      console.log('[Alighting] Boarded passenger check error:', boardedPassenger.error);

      if (!actualBoardedPassenger) {
        setFailedMsg('Card not boarded on this trip');
        setScanState('failed');
        return;
      }

      const storedDestination = card.destination as string | undefined;

      // Step 3 — GPS validation (non-blocking: warn but never hard-block)
      if (storedDestination) {
        setGpsValidating(true);
        try {
          const gps = await validateAlightingLocation(storedDestination);
          setGpsResult({
            status: gps.status,
            message: gps.message,
            nearestStop: gps.nearestStopName,
          });

          // GPS result is displayed in the trip summary card, no modal needed here
        } catch {
          // GPS errors never block the scan
        } finally {
          setGpsValidating(false);
        }
      }

      // Step 4 — Show confirmation with trip summary before processing
      // transaction.amount = totalFare (base + baggage) as stored by fareService
      const txAmount = boardingTransaction?.amount || 12;
      const baggageFee = boardingTransaction?.baggage_fee || 0;
      const baseFare = txAmount - baggageFee;   // strip out baggage to get the true base fare
      const totalFare = txAmount;               // amount IS already the total — no re-addition needed
      
      // Use prefix detection as primary source for QR cards since database may have incorrect values
      const passengerType = detectedType.passengerType;
      console.log('Alighting card type determination', { prefixType: detectedType.passengerType, dbType: card.passenger_type, finalType: passengerType });
      
      setPendingAlighting({
        code: scannedCode,
        cardId: card.id,
        destination: card.destination,
        balance: card.balance,
        fare: baseFare,
        totalFare: totalFare,
        route: currentBus?.route || '',
        cardType: passengerType,
        cardUid: card.card_uid,
        paymentMethod: boardingTransaction?.channel || 'qr_card',
        baggageInfo: boardingTransaction ? {
          category: boardingTransaction.baggage_category,
          weight: boardingTransaction.baggage_weight,
          fee: boardingTransaction.baggage_fee,
        } : null,
      });
      setScanState('confirm_alighting');
    } catch (err) {
      console.error('Alighting error:', err);
      setGpsValidating(false);
      setFailedMsg(`Alighting error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
    }
  }

  function handleAlightingResult(result: any) {
    console.log('[handleAlightingResult] Received result:', result);
    
    if (result.status === 'qr_pass') {
      console.log('[handleAlightingResult] Processing qr_pass success');
      setValidatedCount(validatedCount - 1);
      setAlightedCount(c => c + 1);
      const totalFare = result.totalFare || result.fare;
      if (totalFare > 0) setFareCollected(fareCollected + totalFare);
      setSuccessMsg(
        result.destination
          ? `Alighted @ ${result.destination}`
          : 'Alighted successfully',
      );
      setSuccessAmount(totalFare);
      setSuccessBalance(result.newBalance);
      setGpsResult(null);
      setPendingAlighting(null);
      setScanState('success');
      // Return to idle (mode selector) after successful alighting
      setTimeout(async () => {
        setSuccessMsg('');
        setSuccessAmount(0);
        setSuccessBalance(null);
        processingRef.current = false;
        lastScanTimeRef.current = 0;
        lastScanCodeRef.current = '';
        await cleanupScanner();
        setScanState('idle');
      }, 1500);
    } else if (result.status === 'ticket_validated') {
      console.log('[handleAlightingResult] Processing ticket_validated success');
      setValidatedCount(validatedCount - 1);
      setAlightedCount(c => c + 1);
      const totalFare = result.totalFare || result.fareAmount;
      if (totalFare > 0) setFareCollected(fareCollected + totalFare);
      setSuccessMsg(result.destination ? `Alighted @ ${result.destination}` : 'Alighted successfully');
      setSuccessAmount(result.fareAmount);
      setSuccessBalance(null);
      setGpsResult(null);
      setPendingAlighting(null);
      setScanState('success');
      // Return to idle (mode selector) after successful alighting
      setTimeout(async () => {
        setSuccessMsg('');
        setSuccessAmount(0);
        setSuccessBalance(null);
        processingRef.current = false;
        lastScanTimeRef.current = 0;
        lastScanCodeRef.current = '';
        await cleanupScanner();
        setScanState('idle');
      }, 1500);
    } else if (result.status === 'qr_fail_balance') {
      setFailedMsg(`Insufficient balance ₱${result.balance.toFixed(2)} — need ₱${result.fare}`);
      setScanState('failed');
    } else if (result.status === 'error') {
      setFailedMsg(result.message);
      setScanState('failed');
    } else if (result.status === 'duplicate_scan') {
      // Passenger already alighted — quietly return to scanning
      setGpsResult(null);
      setPendingAlighting(null);
      processingRef.current = false;
      lastScanTimeRef.current = 0;
      lastScanCodeRef.current = '';
      setScanState('scanning');
    } else if (result.status === 'qr_inactive') {
      setFailedMsg('Card is inactive');
      setScanState('failed');
    } else if (result.status === 'not_found') {
      setFailedMsg('QR code not recognised');
      setScanState('failed');
    } else {
      setFailedMsg('Alighting failed - unexpected error');
      setScanState('failed');
    }
  }

  async function confirmAlighting() {
    if (!pendingAlighting || !currentTrip || !profile) {
      setFailedMsg('Missing data for alighting');
      setScanState('failed');
      return;
    }

    setScanState('processing');

    try {
      console.log('[confirmAlighting] Processing alighting with data:', {
        code: pendingAlighting.code,
        tripId: currentTrip.id,
        conductorId: profile.id,
        route: currentBus?.route,
        destination: pendingAlighting.destination,
      });
      console.log('Is online:', isOnline);

      // Check if user is authenticated (only when committing to server)
      if (isOnline) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setFailedMsg('Not authenticated. Please login again.');
          setScanState('failed');
          return;
        }
      }

      // If offline, queue the alighting scan instead of processing immediately
      if (!isOnline) {
        console.log('[Offline] Queuing alighting scan');
        const { isTicket } = detectCardTypeFromPrefix(pendingAlighting.code);
        const normalized = normalizeQrCode(pendingAlighting.code);
        const cardUid = isTicket ? undefined : normalized.toUpperCase();
        const ticketUid = isTicket ? normalized.toUpperCase() : undefined;

        offlineQueueService.addScan({
          type: 'alighting',
          cardUid,
          ticketUid,
          cardId: pendingAlighting.cardId,
          tempTicketId: pendingAlighting.tempTicketId,
          tripId: currentTrip.id,
        });

        bumpPending(offlineQueueService.getPendingCount());

        setValidatedCount(validatedCount - 1);
        setAlightedCount(c => c + 1);
        setGpsResult(null);
        setPendingAlighting(null);
        setScanState('success');
        setSuccessMsg('Alighted — saved offline, will sync when online');
        setSuccessAmount(0);
        setSuccessBalance(null);

        setTimeout(() => {
          setSuccessMsg('');
          setSuccessAmount(0);
          processingRef.current = false;
          lastScanTimeRef.current = 0;
          lastScanCodeRef.current = '';
          setScanState('scanning');
        }, 1500);
        return;
      }

      const result = await processScan(
        pendingAlighting.code,
        currentTrip.id,
        profile.id,
        currentBus?.route,
        'alighting',
        pendingAlighting.destination, // Pass the destination from pendingAlighting
        0,
      );

      console.log('[confirmAlighting] Process scan result:', result);
      handleAlightingResult(result);
    } catch (err) {
      console.error('Alighting error:', err);
      setGpsValidating(false);
      setFailedMsg(`Alighting error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
    }
  }

  function scheduleNextScan() {
    setTimeout(() => {
      setSuccessMsg('');
      setSuccessAmount(0);
      setSuccessBalance(null);
      processingRef.current = false;
      setScanState('scanning');
    }, 2500);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  const isActiveView = scanState !== 'idle';
  const shortEdge = Math.min(window.innerWidth, window.innerHeight);
  const boxSize = Math.min(Math.round(shortEdge * 0.7), 280);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={(e?: React.MouseEvent<HTMLButtonElement>) => {
          console.log('[ScanPage] Back button clicked');
          e?.preventDefault();
          e?.stopPropagation();
          
          // Blur any focused element before navigating to avoid aria-hidden focus conflict
          (document.activeElement as HTMLElement)?.blur();
          
          // Navigate immediately, cleanup in background
          history.replace('/');
          
          // Cleanup camera after navigation (non-blocking)
          cleanupScanner().catch(err => {
            console.error('[ScanPage] Cleanup error after navigation:', err);
          });
        }}
        title="QR Scanner"
        subtitle={`${validatedCount} scanned · ${currentBus?.plate_number}`}
        rightAction={
          !isOnline ? (
            <span style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'var(--color-danger-subtle)', borderRadius: 20,
              padding: '6px 12px', color: 'var(--color-danger)', fontSize: '0.75rem', fontWeight: 700,
            }}>
              <CloudOff size={14} /> Offline
            </span>
          ) : undefined
        }
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <div className="scanner-page">

          {/* ══════════════════════════════════════════════════════════════
              IDLE VIEW
          ══════════════════════════════════════════════════════════════ */}
          {!isActiveView && (
            <>
              {/* Hero */}
              <SoftCard variant="glass" style={{ marginBottom: 20, padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                  <motion.div
                    style={{ width: 80, height: 80, borderRadius: 24, background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                  >
                    {scanType === 'alighting' ? (
                      <MapPin size={40} color="var(--color-primary)" strokeWidth={1.5} />
                    ) : (
                      <ScanLine size={40} color="var(--color-primary)" strokeWidth={1.5} />
                    )}
                  </motion.div>
                </div>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                  {isOnline ? (scanType === 'alighting' ? 'Alighting Scanner' : 'Onboarding Scanner') : 'Offline Scanner'}
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                  {isOnline
                    ? (scanType === 'onboarding' ? 'Scan card → pick destination' : 'Scan card → fare auto-deducted')
                    : `Scans sync when online${pendingCount > 0 ? ` (${pendingCount} queued)` : ''}`}
                </p>
              </SoftCard>

              {/* Mode selector card */}
              <SoftCard variant="glass" style={{ marginBottom: 20 }}>
                <h4 className="heading-small" style={{ marginBottom: 12 }}>Scan Mode</h4>
                <div style={{ display: 'flex', gap: 12, marginBottom: scanType === 'alighting' && routeStops.length > 0 ? 16 : 0 }}>
                  <button type="button" className={`scanner-type-btn ${scanType === 'onboarding' ? 'scanner-type-btn--active' : ''}`} onClick={() => setScanType('onboarding')}>
                    <span className="scanner-type-btn__icon"><LogIn size={18} /></span>
                    Onboarding
                  </button>
                  <button type="button" className={`scanner-type-btn ${scanType === 'alighting' ? 'scanner-type-btn--active' : ''}`} onClick={() => setScanType('alighting')}>
                    <span className="scanner-type-btn__icon"><AlightIcon size={18} /></span>
                    Alighting
                  </button>
                </div>

                {/* ── ONBOARDING description ── */}
                {scanType === 'onboarding' && (
                  <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--color-success-subtle)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <Navigation size={16} color="var(--color-success)" style={{ marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.85rem', color: 'var(--color-success)' }}>How onboarding works</p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Scan the passenger's QR card → select their destination stop → confirm boarding. Balance is checked before confirming.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── ALIGHTING: GPS-based destination verification ── */}
                {scanType === 'alighting' && (
                  <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--color-warning-subtle)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <MapPin size={16} color="var(--color-warning)" style={{ marginTop: 2, flexShrink: 0 }} />
                      <div>
                        <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.85rem', color: '#A16207' }}>How alighting works</p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Scan the passenger's QR card → GPS verifies location via OpenStreetMap → fare is automatically deducted.
                        </p>
                      </div>
                    </div>
                    {gpsResult && (
                      <div style={{
                        marginTop: 10,
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: gpsResult.status === 'confirmed'
                          ? 'rgba(34,197,94,0.15)'
                          : gpsResult.status === 'mismatch'
                          ? 'rgba(239,68,68,0.12)'
                          : 'rgba(0,0,0,0.06)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <MapPin size={13} color={
                          gpsResult.status === 'confirmed' ? '#16a34a' :
                          gpsResult.status === 'mismatch' ? '#dc2626' : '#A16207'
                        } />
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          color: gpsResult.status === 'confirmed' ? '#16a34a' :
                                 gpsResult.status === 'mismatch' ? '#dc2626' : '#92400e',
                        }}>
                          {gpsResult.message}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </SoftCard>

              <PrimaryButton onClick={startCamera} fullWidth icon={<ScanLine size={22} />} style={{ marginBottom: 20 }}>
                Start Scanning
              </PrimaryButton>

              {/* Pending sync */}
              {pendingCount > 0 && (
                <SoftCard
                  variant={isOnline ? 'accent-warning' : 'accent-danger'}
                  style={{ marginBottom: 20, cursor: isOnline ? 'pointer' : 'default' }}
                  onClick={isOnline ? triggerSync : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <RefreshCw size={20} color={isOnline ? '#A16207' : 'var(--color-danger)'} className={isSyncing ? 'primary-btn__spinner' : ''} />
                      <div>
                        <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.9rem' }}>{pendingCount} scan{pendingCount !== 1 ? 's' : ''} pending sync</p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{isOnline ? 'Tap to sync now' : 'Will sync when online'}</p>
                      </div>
                    </div>
                    {isSyncing && <StatusBadge variant="primary">Syncing</StatusBadge>}
                  </div>
                </SoftCard>
              )}
            </>
          )}

          {/* ══════════════════════════════════════════════════════════════
              ACTIVE VIEW
          ══════════════════════════════════════════════════════════════ */}
          {isActiveView && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

              {/* ── Camera / Overlay ─────────────────────────────── */}
              <div className="scanner-active-card" style={{
                display: shouldShowCamera(scanState) ? 'block' : 'none',
              }}>

                {/* Card header bar */}
                <div className="scanner-active-card__header">
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: scanType === 'alighting' ? 'var(--color-warning-subtle)' : 'var(--color-success-subtle)',
                    color: scanType === 'alighting' ? '#A16207' : 'var(--color-success)',
                    borderRadius: 20, padding: '4px 12px', fontSize: '0.78rem', fontWeight: 700,
                  }}>
                    {scanType === 'alighting' ? 'Alighting' : 'Onboarding'}
                    {!isOnline && ' · Offline'}
                  </span>
                  <button type="button" onClick={stopCamera}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: 4, borderRadius: 8 }}
                    aria-label="Cancel"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Viewport */}
                <div className="scanner-viewport" style={{
                  display: shouldShowCamera(scanState) ? 'block' : 'none',
                }}>

                  {/* ── Camera feed (scanning state) ── */}
                  <div
                    id="qr-reader"
                    style={{
                      opacity: scanState === 'scanning' ? 1 : 0,
                      transition: 'opacity 0.3s',
                      pointerEvents: scanState === 'scanning' ? 'auto' : 'none',
                      background: 'transparent',
                    }}
                  />

                  {/* ── Scan-box animation overlay ── */}
                  {scanState === 'scanning' && (
                    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* The scan-box frame */}
                      <div style={{ position: 'relative', width: boxSize, height: boxSize, flexShrink: 0 }}>
                        {/* Corner brackets */}
                        {(['tl','tr','bl','br'] as const).map(pos => (
                          <div key={pos} style={{
                            position: 'absolute',
                            width: Math.round(boxSize * 0.14),
                            height: Math.round(boxSize * 0.14),
                            top: pos.startsWith('t') ? 0 : undefined,
                            bottom: pos.startsWith('b') ? 0 : undefined,
                            left: pos.endsWith('l') ? 0 : undefined,
                            right: pos.endsWith('r') ? 0 : undefined,
                            borderColor: '#22C55E',
                            borderStyle: 'solid',
                            borderWidth: pos === 'tl' ? '3px 0 0 3px' : pos === 'tr' ? '3px 3px 0 0' : pos === 'bl' ? '0 0 3px 3px' : '0 3px 3px 0',
                            borderRadius: pos === 'tl' ? '6px 0 0 0' : pos === 'tr' ? '0 6px 0 0' : pos === 'bl' ? '0 0 0 6px' : '0 0 6px 0',
                          }} />
                        ))}
                        {/* Scan beam */}
                        <motion.div
                          style={{
                            position: 'absolute', left: 0, right: 0, height: 3,
                            background: 'linear-gradient(90deg, transparent, #22C55E, transparent)',
                            boxShadow: '0 0 10px 3px rgba(34,197,94,0.8)',
                            top: 0,
                          }}
                          animate={{ top: ['0px', `${boxSize}px`, '0px'] }}
                          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      </div>
                    </div>
                  )}

                  {/* ── Detected animation ── */}
                  {scanState === 'detected' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      style={{ position: 'absolute', inset: 0, background: 'rgba(34,197,94,0.3)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 220, padding: '20px' }}
                    >
                      <motion.div
                        animate={{ scale: [1, 1.2, 1], opacity: [0.8, 1, 0.8] }}
                        transition={{ duration: 0.5, repeat: 2 }}
                      >
                        <CheckCircle size={64} color="#22C55E" strokeWidth={3} />
                      </motion.div>
                      <span style={{ color: '#22C55E', fontWeight: 800, fontSize: '1.1rem', textShadow: '0 2px 8px rgba(0,0,0,0.3)' }}>
                        QR Code Detected!
                      </span>
                      {/* Display scanned QR code in detected state */}
                      {debugScannedCode && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.9)', borderRadius: 8, maxWidth: '100%', overflow: 'hidden' }}>
                          <span style={{ color: '#22C55E', fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>SCANNED QR:</span>
                          <span style={{ color: '#1a1a1a', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 500, wordBreak: 'break-all' }}>{debugScannedCode}</span>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* ── Processing ── */}
                  {(scanState === 'processing' || scanState === 'committing') && (
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: 220 }}>
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                        <RefreshCw size={38} color="white" />
                      </motion.div>
                      <span style={{ color: 'white', fontWeight: 700, fontSize: '0.95rem' }}>
                        {gpsValidating ? 'Checking GPS location…' : scanState === 'committing' ? 'Confirming boarding…' : 'Reading card…'}
                      </span>
                      {gpsValidating && (
                        <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: '0.78rem' }}>
                          Verifying stop via OpenStreetMap
                        </span>
                      )}
                    </div>
                  )}

                  {/* ── Success ── */}
                  {scanState === 'success' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ position: 'absolute', inset: 0, background: 'rgba(21,128,61,0.93)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 220, padding: '24px 20px' }}
                    >
                      <motion.div animate={{ scale: [0.8, 1.15, 1] }} transition={{ duration: 0.4 }}>
                        <CheckCircle size={56} color="white" />
                      </motion.div>
                      <span style={{ color: 'white', fontWeight: 800, fontSize: '1.15rem', textAlign: 'center' }}>Success!</span>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: '0.88rem', textAlign: 'center' }}>{successMsg}</span>

                      {/* Display scanned QR code */}
                      {debugScannedCode && (
                        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.9)', borderRadius: 8, maxWidth: '100%', overflow: 'hidden' }}>
                          <span style={{ color: '#15803d', fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>SCANNED QR:</span>
                          <span style={{ color: '#1a1a1a', fontSize: '0.8rem', fontFamily: 'monospace', fontWeight: 500, wordBreak: 'break-all' }}>{debugScannedCode}</span>
                        </div>
                      )}

                      {/* Balance display */}
                      {successBalance !== null && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: '10px 24px', marginTop: 4 }}>
                          {successAmount > 0 && (
                            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem', fontWeight: 600 }}>
                              ₱{successAmount.toFixed(2)} deducted
                            </span>
                          )}
                          <span style={{ color: 'white', fontWeight: 800, fontSize: '1.2rem' }}>
                            ₱{successBalance.toFixed(2)} balance
                          </span>
                        </div>
                      )}
                      {successAmount > 0 && successBalance === null && (
                        <span style={{ color: 'white', fontWeight: 800, fontSize: '1.1rem', background: 'rgba(255,255,255,0.15)', borderRadius: 12, padding: '6px 16px' }}>
                          ₱{successAmount.toFixed(2)} deducted
                        </span>
                      )}

                      <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.73rem', marginTop: 2 }}>Resuming in 2.5s…</span>
                    </motion.div>
                  )}

                  {/* ── Failed ── */}
                  {scanState === 'failed' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ position: 'absolute', inset: 0, background: 'rgba(185,28,28,0.93)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 220, padding: '24px 20px' }}
                    >
                      <motion.div animate={{ rotate: [0, -8, 8, -4, 4, 0] }} transition={{ duration: 0.5 }}>
                        <XCircle size={52} color="white" />
                      </motion.div>
                      <span style={{ color: 'white', fontWeight: 800, fontSize: '1.05rem', textAlign: 'center' }}>Scan Failed</span>
                      <span style={{ color: 'rgba(255,255,255,0.9)', fontWeight: 500, fontSize: '0.88rem', textAlign: 'center' }}>{failedMsg}</span>
                      
                      {/* Debug: Show scanned code */}
                      {debugScannedCode && (
                        <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: 8, maxWidth: '100%', overflow: 'hidden' }}>
                          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.7rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Scanned:</span>
                          <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>{debugScannedCode}</span>
                        </div>
                      )}
                      <PrimaryButton
                        onClick={retryCamera}
                        variant="ghost"
                        icon={<RefreshCw size={16} />}
                        style={{
                          marginTop: 8,
                          borderColor: 'white',
                          color: 'white',
                          background: 'transparent',
                        }}
                      >
                        Try Again
                      </PrimaryButton>
                    </motion.div>
                  )}

                  {/* ── Payment Options (Insufficient Balance) ── */}
                  {scanState === 'payment_options' && pendingPayment && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 220, padding: '24px 20px' }}
                    >
                      <div style={{ 
                        width: 56, height: 56, borderRadius: '50%', 
                        background: 'linear-gradient(135deg, #F59E0B, #EF4444)', 
                        display: 'flex', alignItems: 'center', justifyContent: 'center' 
                      }}>
                        <AlertTriangle size={28} color="white" />
                      </div>
                      <span style={{ color: 'white', fontWeight: 800, fontSize: '1.15rem', textAlign: 'center' }}>Insufficient Balance</span>
                      <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500, fontSize: '0.88rem', textAlign: 'center' }}>
                        Card balance: ₱{pendingPayment.balance.toFixed(2)}<br />
                        Required: ₱{pendingPayment.totalFare.toFixed(2)}
                      </span>
                      
                      <div style={{ 
                        width: '100%', 
                        background: 'rgba(255,255,255,0.1)', 
                        borderRadius: 12, 
                        padding: '16px',
                        marginTop: 8
                      }}>
                        <p style={{ 
                          margin: '0 0 12px', 
                          fontSize: '0.85rem', 
                          fontWeight: 600, 
                          color: 'rgba(255,255,255,0.9)',
                          textAlign: 'center'
                        }}>
                          Choose payment method:
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <PrimaryButton
                            onClick={() => handleCashPayment()}
                            variant="primary"
                            icon={<CreditCard size={18} />}
                            style={{
                              background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                              borderColor: '#22C55E',
                              padding: '14px 20px',
                            }}
                          >
                            Pay in Cash
                          </PrimaryButton>
                          <PrimaryButton
                            onClick={() => handleContinueWithCard()}
                            variant="ghost"
                            icon={<RefreshCw size={18} />}
                            style={{
                              borderColor: 'rgba(255,255,255,0.3)',
                              color: 'white',
                              background: 'rgba(255,255,255,0.1)',
                              padding: '14px 20px',
                            }}
                          >
                            Continue with Card
                          </PrimaryButton>
                        </div>
                      </div>
                      
                      <PrimaryButton
                        onClick={() => {
                          setPendingPayment(null);
                          setPendingScan(null);
                          setBaggageSelection(null);
                          setSelectedDestination('');
                          retryCamera();
                        }}
                        variant="ghost"
                        icon={<X size={16} />}
                        style={{
                          marginTop: 8,
                          borderColor: 'rgba(255,255,255,0.2)',
                          color: 'rgba(255,255,255,0.7)',
                          background: 'transparent',
                          fontSize: '0.85rem',
                        }}
                      >
                        Cancel
                      </PrimaryButton>
                    </motion.div>
                  )}
                </div>

                {/* Status bar */}
                {(scanState === 'scanning' || scanState === 'processing' || scanState === 'committing') && (
                  <div style={{ padding: '10px 16px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: scanState === 'scanning' ? '#22C55E' : '#9CA3AF',
                      boxShadow: scanState === 'scanning' ? '0 0 6px #22C55E' : 'none',
                    }} />
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {scanState === 'scanning' ? 'Camera active — point at QR code'
                        : scanState === 'committing' ? 'Confirming boarding…'
                        : 'Reading card…'}
                    </span>
                  </div>
                )}
              </div>

              {/* ══════════════════════════════════════════════════════════
                  DESTINATION PICKER (onboarding, after scan)
              ══════════════════════════════════════════════════════════ */}
              <AnimatePresence>
                {scanState === 'pick_destination' && pendingScan && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.25 }}
                  >
                    {/* Visual QR Card */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      style={{ marginBottom: 16, minHeight: '200px' }}
                    >
                      <QRCardCanvas
                        cardUid={pendingScan.cardUid || pendingScan.code}
                        balance={pendingScan.balance}
                        passengerType={pendingScan.passengerType}
                        isTicket={pendingScan.isTicket}
                      />
                    </motion.div>

                    {/* Destination picker + GPS + Baggage + Fare — all in one card */}
                    <SoftCard variant="glass" style={{ marginBottom: 14 }}>
                      {/* From (current GPS stop) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--color-success-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <MapPin size={16} color="var(--color-success)" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: 0, fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Boarding From</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {currentStopName ?? (
                              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Detecting location…</span>
                            )}
                          </p>
                          {currentCoordinates && (
                            <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                              {currentCoordinates.lat.toFixed(6)}, {currentCoordinates.lng.toFixed(6)}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Divider with route line */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 12 }}>
                        <div style={{ width: 4, height: 32, borderRadius: 2, background: 'linear-gradient(to bottom, var(--color-success), var(--color-primary))' }} />
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>select stop below</span>
                      </div>

                      {/* To — native select dropdown */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Navigation size={16} color="var(--color-primary)" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 6px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Destination</p>
                          <select
                            className="bus-select"
                            value={selectedDestination}
                            onChange={e => setSelectedDestination(e.target.value)}
                          >
                            <option value="">— Choose destination —</option>
                            <option value="Agora Terminal">Agora Terminal</option>
                            <option value="Puerto">Puerto</option>
                            <option value="Ba-e">Ba-e</option>
                            <option value="Mambatangan">Mambatangan</option>
                            <option value="Maitom">Maitom</option>
                            <option value="Ala-e">Ala-e</option>
                            <option value="Lonocan">Lonocan</option>
                            <option value="San Miguel">San Miguel</option>
                            <option value="Diclum">Diclum</option>
                            <option value="Manolo Fortich">Manolo Fortich</option>
                          </select>
                        </div>
                      </div>

                      {/* GPS confirmed badge */}
                      {currentStopName && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          style={{
                            marginBottom: 12,
                            padding: '10px 14px',
                            borderRadius: 10,
                            background: 'rgba(16, 185, 129, 0.1)',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                          }}
                        >
                          <CheckCircle size={18} color="#10b981" />
                          <div style={{ flex: 1 }}>
                            <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#10b981' }}>
                              GPS Location Detected
                            </p>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {currentStopName}
                            </p>
                            {currentCoordinates && (
                              <p style={{ margin: '2px 0 0', fontSize: '0.7rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                                {currentCoordinates.lat.toFixed(6)}, {currentCoordinates.lng.toFixed(6)}
                              </p>
                            )}
                          </div>
                        </motion.div>
                      )}

                      {/* Divider */}
                      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0 12px' }} />

                      {/* Baggage fee selector */}
                      <button
                        type="button"
                        onClick={() => setShowBaggageSelector(true)}
                        className="settings-item glass-card"
                        style={{
                          padding: '12px 14px',
                          marginBottom: 12,
                          border: baggageSelection ? '2px solid var(--color-primary)' : '1px solid var(--glass-border)',
                          background: baggageSelection ? 'var(--color-primary-subtle)' : 'var(--glass-bg)',
                        }}
                      >
                        <div className="settings-item__icon" style={{
                          background: baggageSelection ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                          width: 36, height: 36,
                        }}>
                          <Package size={16} color={baggageSelection ? 'white' : 'var(--text-secondary)'} />
                        </div>
                        <div className="settings-item__content">
                          <span className="settings-item__label" style={{ color: baggageSelection ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                            {baggageSelection ? `${baggageSelection.category} (x${baggageSelection.quantity})` : 'Add Baggage Fee'}
                          </span>
                          <span className="settings-item__desc">
                            {baggageSelection ? `₱${baggageSelection.fee.toFixed(2)}` : 'Optional — for passengers with baggage'}
                          </span>
                        </div>
                        <ChevronRight size={16} color={baggageSelection ? 'var(--color-primary)' : 'var(--text-secondary)'} style={{ flexShrink: 0 }} />
                      </button>

                      {/* Fare breakdown */}
                      <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Base Fare</span>
                          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            ₱{pendingScan.fare.toFixed(2)}
                          </span>
                        </div>
                        {baggageSelection && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                              Baggage ({baggageSelection.quantity}× {baggageSelection.category})
                            </span>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                              ₱{baggageSelection.fee.toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '6px 0' }} />
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.88rem', color: 'var(--color-primary)', fontWeight: 800 }}>Total</span>
                          <span style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--color-primary)' }}>
                            ₱{(pendingScan.fare + (baggageSelection?.fee || 0)).toFixed(2)}
                          </span>
                        </div>

                        {/* Low balance warning */}
                        {!pendingScan.isTicket && pendingScan.balance < (pendingScan.fare + (baggageSelection?.fee || 0)) && (
                          <div style={{
                            marginTop: 10,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'rgba(239, 68, 68, 0.12)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}>
                            <AlertTriangle size={14} color="#EF4444" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#EF4444', display: 'block' }}>
                                Insufficient Balance — ₱{pendingScan.balance.toFixed(2)} available
                              </span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                Tap confirm to pay in cash
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </SoftCard>

                    {/* Button Row - Confirm and Cancel */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                      <PrimaryButton
                        onClick={retryCamera}
                        variant="ghost"
                        icon={<RefreshCw size={15} />}
                        style={{ flex: 1 }}
                      >
                        Cancel
                      </PrimaryButton>
                      <PrimaryButton
                        onClick={commitBoarding}
                        disabled={!selectedDestination}
                        icon={
                          !pendingScan.isTicket && pendingScan.balance < (pendingScan.fare + (baggageSelection?.fee || 0))
                            ? <CreditCard size={20} />
                            : <CheckCircle size={20} />
                        }
                        style={{
                          flex: 1,
                          ...((!pendingScan.isTicket && pendingScan.balance < (pendingScan.fare + (baggageSelection?.fee || 0))) && {
                            background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                          }),
                        }}
                      >
                        {!pendingScan.isTicket && pendingScan.balance < (pendingScan.fare + (baggageSelection?.fee || 0))
                          ? 'Pay in Cash'
                          : 'Confirm Boarding'}
                      </PrimaryButton>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

                {/* ══════════════════════════════════════════════════════════
                    ALIGHTING CONFIRMATION
                ══════════════════════════════════════════════════════════ */}
                <AnimatePresence>
                  {scanState === 'confirm_alighting' && pendingAlighting && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 20 }}
                      transition={{ duration: 0.25 }}
                    >
                      {/* Onboarding Summary (replaces card display) */}
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginBottom: 16 }}
                      >
                        <SoftCard variant="glass" style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <MapPin size={20} color="white" />
                            </div>
                            <div>
                              <h4 className="heading-small" style={{ margin: 0, color: 'var(--color-primary)' }}>Alighting Confirmation</h4>
                              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Review trip details before confirming</p>
                            </div>
                          </div>

                          {/* Card ID */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'var(--bg-tertiary)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid var(--glass-border)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Card ID</p>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                              {pendingAlighting.cardUid || pendingAlighting.code}
                            </p>
                          </div>

                          {/* Route */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'var(--bg-tertiary)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid var(--glass-border)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Route</p>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                              {pendingAlighting.route}
                            </p>
                          </div>

                          {/* Destination */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'var(--bg-tertiary)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid var(--glass-border)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Destination</p>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--color-primary)' }}>
                              {pendingAlighting.destination}
                            </p>
                          </div>

                          {/* Boarded information */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Boarded</p>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: '#10b981' }}>
                              ✓ Passenger boarded on this trip
                            </p>
                          </div>

                          {/* Payment Method */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'var(--bg-tertiary)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid var(--glass-border)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 6px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Payment Method</p>
                            <div style={{ display: 'flex', gap: 8 }}>
                              {/* QR Card option */}
                              <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                padding: '10px 14px',
                                borderRadius: 10,
                                border: `2px solid ${pendingAlighting.paymentMethod === 'qr_card' ? 'var(--color-primary)' : 'var(--glass-border)'}`,
                                background: pendingAlighting.paymentMethod === 'qr_card' ? 'var(--color-primary-subtle)' : 'transparent',
                                opacity: pendingAlighting.paymentMethod === 'qr_card' ? 1 : 0.45,
                              }}>
                                <CreditCard size={16} color={pendingAlighting.paymentMethod === 'qr_card' ? 'var(--color-primary)' : 'var(--text-secondary)'} />
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: pendingAlighting.paymentMethod === 'qr_card' ? 'var(--color-primary)' : 'var(--text-secondary)' }}>
                                  QR Card
                                </span>
                                {pendingAlighting.paymentMethod === 'qr_card' && (
                                  <CheckCircle size={13} color="var(--color-primary)" />
                                )}
                              </div>
                              {/* Cash option */}
                              <div style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                padding: '10px 14px',
                                borderRadius: 10,
                                border: `2px solid ${pendingAlighting.paymentMethod === 'cash' ? '#22C55E' : 'var(--glass-border)'}`,
                                background: pendingAlighting.paymentMethod === 'cash' ? 'rgba(34,197,94,0.1)' : 'transparent',
                                opacity: pendingAlighting.paymentMethod === 'cash' ? 1 : 0.45,
                              }}>
                                <span style={{ fontSize: '1rem' }}>💵</span>
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: pendingAlighting.paymentMethod === 'cash' ? '#16A34A' : 'var(--text-secondary)' }}>
                                  Cash
                                </span>
                                {pendingAlighting.paymentMethod === 'cash' && (
                                  <CheckCircle size={13} color="#16A34A" />
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Total Fare Charged */}
                          <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)', borderRadius: 10 }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Fare Charged</p>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                                Base Fare
                              </span>
                              <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                ₱{pendingAlighting.fare.toFixed(2)}
                              </span>
                            </div>
                            {pendingAlighting.baggageInfo && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                                  Baggage Fee
                                </span>
                                <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                  ₱{pendingAlighting.baggageInfo.fee?.toFixed(2) || '0.00'}
                                </span>
                              </div>
                            )}
                            <div style={{
                              height: 1,
                              background: 'var(--color-primary)',
                              opacity: 0.3,
                              margin: '6px 0',
                            }}></div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 700 }}>
                                Total
                              </span>
                              <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                ₱{pendingAlighting.totalFare?.toFixed(2) || (pendingAlighting.fare + (pendingAlighting.baggageInfo?.fee || 0)).toFixed(2)}
                              </span>
                            </div>
                          </div>

                          {/* GPS Location Status */}
                          {gpsResult && (
                            <div style={{
                              padding: '12px 14px',
                              borderRadius: 10,
                              background: gpsResult.status === 'confirmed'
                                ? 'rgba(34,197,94,0.12)'
                                : gpsResult.status === 'mismatch'
                                ? 'rgba(239,68,68,0.12)'
                                : 'rgba(250,204,21,0.12)',
                              border: `1px solid ${
                                gpsResult.status === 'confirmed'
                                  ? 'rgba(34,197,94,0.3)'
                                  : gpsResult.status === 'mismatch'
                                  ? 'rgba(239,68,68,0.3)'
                                  : 'rgba(250,204,21,0.3)'
                              }`,
                              backdropFilter: 'blur(8px)',
                              WebkitBackdropFilter: 'blur(8px)',
                              marginBottom: 16,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <MapPin size={18} color={
                                  gpsResult.status === 'confirmed' ? '#16a34a' :
                                  gpsResult.status === 'mismatch' ? '#dc2626' : '#A16207'
                                } />
                                <div style={{ flex: 1 }}>
                                  <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 700, color: 
                                    gpsResult.status === 'confirmed' ? '#16a34a' :
                                    gpsResult.status === 'mismatch' ? '#dc2626' : '#A16207',
                                  }}>
                                    {gpsResult.status === 'confirmed' ? 'Location Matched' : 
                                     gpsResult.status === 'mismatch' ? 'Location Mismatch' : 'Location Warning'}
                                  </p>
                                  <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {gpsResult.message}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Button Row - Confirm and Cancel */}
                          <div style={{ display: 'flex', gap: 10 }}>
                            <PrimaryButton
                              onClick={() => {
                                setPendingAlighting(null);
                                setGpsResult(null);
                                setScanState('scanning');
                              }}
                              variant="ghost"
                              icon={<X size={15} />}
                              style={{ flex: 1 }}
                            >
                              Cancel
                            </PrimaryButton>
                            <PrimaryButton
                              onClick={confirmAlighting}
                              variant="primary"
                              icon={<CheckCircle size={20} />}
                              style={{ flex: 1 }}
                            >
                              Confirm Alighting
                            </PrimaryButton>
                          </div>
                        </SoftCard>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

              {/* Manual Card ID input removed - only camera scanning enabled */}

            </motion.div>
          )}

        </div>
      </IonContent>

      <AnimatedModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        variant="center"
        showClose={true}
        title={modalColor === 'success' ? 'Success' : modalColor === 'danger' ? 'Error' : 'Notice'}
      >
        <div style={{ padding: '24px', textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
            background: modalColor === 'success' ? 'rgba(16, 185, 129, 0.1)' :
                      modalColor === 'danger' ? 'rgba(239, 68, 68, 0.1)' :
                      'rgba(245, 158, 11, 0.1)'
          }}>
            {modalColor === 'success' && (
              <CheckCircle size={32} color="#10b981" />
            )}
            {modalColor === 'danger' && (
              <XCircle size={32} color="#ef4444" />
            )}
            {modalColor === 'warning' && (
              <AlertTriangle size={32} color="#f59e0b" />
            )}
          </div>
          <p style={{
            fontSize: '1.1rem',
            fontWeight: 500,
            margin: 0,
            color: 'var(--color-text)',
            lineHeight: 1.5
          }}>
            {modalMessage}
          </p>
          <PrimaryButton
            onClick={() => setShowModal(false)}
            variant="primary"
            style={{ 
              marginTop: 24,
              background: modalColor === 'success' ? '#10b981' :
                        modalColor === 'danger' ? '#ef4444' :
                        '#f59e0b',
            }}
          >
            OK
          </PrimaryButton>
        </div>
      </AnimatedModal>

      <BaggageFeeSelector
        isOpen={showBaggageSelector}
        onSelect={(selection) => {
          setBaggageSelection(selection);
          setShowBaggageSelector(false);
        }}
        onClose={() => setShowBaggageSelector(false)}
      />

      <BaggageFeeSelector
        isOpen={showAlightingBaggageSelector}
        onSelect={(selection) => {
          setAlightingBaggageSelection(selection);
          setShowAlightingBaggageSelector(false);
        }}
        onClose={() => setShowAlightingBaggageSelector(false)}
      />
    </IonPage>
  );
};

export default ScanPage;
