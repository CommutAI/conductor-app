import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useIonViewWillLeave } from '@ionic/react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, CheckCircle, CloudOff, RefreshCw,
  MapPin, AlertTriangle, X, CreditCard,
  XCircle, Navigation, ChevronRight, Package, Loader,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { processScan, ScanResult } from '../services/fareService';
import { StorageService } from '../services/storageService';
import { validateAlightingLocation, getLocationAndDecode } from '../services/geoService';
import { Html5Qrcode } from 'html5-qrcode';
import { stripQrShadedRegion } from '../utils/qrScannerUi';
import { Camera } from '@capacitor/camera';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import InteractiveBackground from '../components/layout/InteractiveBackground';
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
  console.log('shouldShowCamera:', scanState, 'result:', scanState === 'idle' || scanState === 'scanning');
  return scanState === 'idle' || scanState === 'scanning';
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanState =
  | 'idle'
  | 'scanning'
  | 'detected'
  | 'processing'
  | 'confirm_alighting'
  | 'pick_destination'
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
    if (!isRestoringTrip && (!currentTrip || !currentBus)) history.replace('/');
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
    setScanState('scanning');
    showNotification('Camera ready for scanning', 'success');
  }

  // ── Core scan handler ─────────────────────────────────────────────────────

  /**
   * Called immediately after a QR code is decoded.
   * - For ONBOARDING: only reads card info (no DB write yet), then shows destination picker.
   * - For ALIGHTING: processes fully (deducts fare, verifies destination).
   */
  async function handleRawScan(scannedCode: string) {
    if (!currentTrip || !profile) return;

    if (!isOnline) {
      StorageService.addOfflineScan(scannedCode, currentTrip.id, profile.id, currentBus?.route);
      bumpPending();
      showNotification('Offline — scan queued for sync', 'warning');
      processingRef.current = false;
      setScanState('idle');
      return;
    }

    if (scanType === 'onboarding') {
      // ── ONBOARDING: just read card balance, don't write yet ──────────────
      await handleOnboardingPreScan(scannedCode);
    } else {
      // ── ALIGHTING: full process with currentStop as destination ──────────
      await handleAlightingScan(scannedCode);
    }
  }

  /** For onboarding: auto-confirm boarding with card destination or default */
  async function handleOnboardingPreScan(scannedCode: string) {
    try {
      console.log('Processing scanned code:', scannedCode);
      setDebugScannedCode(scannedCode);
      const { supabase } = await import('../supabaseClient');

      // Detect card type from QR code prefix
      const detectedType = detectCardTypeFromPrefix(scannedCode);
      console.log('Detected card type from prefix:', detectedType);

      // Normalize the scanned UID to handle special dash characters
      const normalizedCode = normalizeQrCode(scannedCode);
      console.log('Normalized code:', normalizedCode);

      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Auth session:', session ? 'Active' : 'None');

      if (!session) {
        setFailedMsg('Not authenticated. Please login again.');
        setScanState('failed');
        showNotification('Not authenticated', 'danger');
        return;
      }

      if (!currentTrip) {
        setFailedMsg('No active trip found');
        setScanState('failed');
        showNotification('No active trip', 'danger');
        return;
      }

      // Try temporary ticket first if prefix indicates it's a ticket
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
            showNotification(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used', 'danger');
            return;
          }

          // Check if already boarded on this trip (prevent duplicate onboarding scans)
          console.log('Checking for duplicate boarding for ticket:', ticket.id, 'on trip:', currentTrip.id);
          const { data: boardedTicket, error: ticketBoardCheckError } = await supabase
            .from('boarded_passengers')
            .select('id, alighted_at')
            .eq('trip_id', currentTrip.id)
            .eq('temp_ticket_id', ticket.id)
            .maybeSingle();

          console.log('Boarded ticket check result:', boardedTicket);
          console.log('Boarded ticket check error:', ticketBoardCheckError);

          if (boardedTicket && !boardedTicket.alighted_at) {
            console.log('Duplicate scan detected - ticket already boarded');
            setFailedMsg('Already boarded on this trip');
            setScanState('failed');
            showNotification('Already boarded on this trip', 'warning');
            return;
          }

          // Use prefix detection as primary source for tickets since database may not have passenger_type
          const passengerType = detectedType.passengerType;
          console.log('Ticket type determination', { prefixType: detectedType.passengerType, dbType: ticket.passenger_type, finalType: passengerType });

          setPendingScan({
            code: scannedCode,
            balance: ticket.fare_amount,
            cardDestination: ticket.destination,
            fare: ticket.fare_amount,
            passengerType: passengerType,
            cardUid: (ticket.ticket_uid || scannedCode).toUpperCase(),
            isTicket: true,
          });
          // Don't auto-select destination - require manual selection
          setSelectedDestination('');
          setScanState('pick_destination');
          showNotification('Ticket detected - select destination', 'success');
          return;
        }
      }

      // Try QR card
      const { data: card, error: cardError } = await supabase
        .from('qr_cards')
        .select('id, balance, status, allowed_routes, destination, card_type, card_uid, owner_name')
        .eq('card_uid', normalizedCode)
        .maybeSingle();

      console.log('Card lookup result:', card);
      console.log('Card lookup error:', cardError);

      if (cardError) {
        console.error('Database query error:', cardError);
        console.error('Error details:', JSON.stringify(cardError));
        setFailedMsg(`Database error: ${cardError.message}`);
        setScanState('failed');
        showNotification('Database error', 'danger');
        return;
      }

      if (card) {
        if (card.status !== 'active') {
          setFailedMsg('Card is inactive');
          setScanState('failed');
          showNotification('Card is inactive', 'danger');
          return;
        }
        if (card.balance < DEFAULT_FARE) {
          setFailedMsg(`Insufficient balance ₱${card.balance.toFixed(2)} — need ₱${DEFAULT_FARE}`);
          setScanState('failed');
          showNotification('Insufficient balance', 'danger');
          return;
        }

        // Check if already boarded on this trip (prevent duplicate onboarding scans)
        console.log('Checking for duplicate boarding for card:', card.id, 'on trip:', currentTrip.id);
        const { data: boardedPassenger, error: boardCheckError } = await supabase
          .from('boarded_passengers')
          .select('id, alighted_at')
          .eq('trip_id', currentTrip.id)
          .eq('card_id', card.id)
          .maybeSingle();

        console.log('Boarded passenger check result:', boardedPassenger);
        console.log('Boarded passenger check error:', boardCheckError);

        if (boardedPassenger && !boardedPassenger.alighted_at) {
          console.log('Duplicate scan detected - card already boarded');
          setFailedMsg('Already boarded on this trip');
          setScanState('failed');
          showNotification('Already boarded on this trip', 'warning');
          return;
        }

        // Use prefix detection as primary source for QR cards since database may have incorrect values
        const passengerType = detectedType.passengerType;
        console.log('Card type determination', { prefixType: detectedType.passengerType, dbType: card.card_type, finalType: passengerType });

        setPendingScan({
          code: scannedCode,
          balance: card.balance,
          cardDestination: card.destination,
          fare: DEFAULT_FARE,
          passengerType: passengerType,
          cardUid: (card.card_uid || scannedCode).toUpperCase(),
          isTicket: false, // QR cards are never tickets
        });
        // Don't auto-select destination - require manual selection
        setSelectedDestination('');
        console.log('Setting scan state to pick_destination');
        setScanState('pick_destination');
        showNotification('Card detected - select destination', 'success');
        return;
      }

      console.log('No matching card or ticket found for:', scannedCode);
      setFailedMsg(`QR code not recognised`);
      setScanState('failed');
      showNotification('QR code not recognised', 'danger');
    } catch (err) {
      console.error('Scan processing error:', err);
      setFailedMsg(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
      showNotification('Scan processing error', 'danger');
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
    await commitBoardingWithDestination(pendingScan.code, selectedDestination);
  }

  /** Commit boarding with a specific destination (used for both manual and auto-confirm) */
  async function commitBoardingWithDestination(code: string, destination: string) {
    if (!currentTrip || !profile) {
      console.error('Missing currentTrip or profile in commitBoardingWithDestination');
      setFailedMsg('Missing trip or profile data');
      setScanState('failed');
      return;
    }
    setScanState('committing');

    try {
      console.log('Committing boarding with code:', code, 'destination:', destination);
      console.log('Current trip ID:', currentTrip.id);
      console.log('Profile ID:', profile.id);
      console.log('Bus route:', currentBus?.route);
      const result = await processScan(
        code,
        currentTrip.id,
        profile.id,
        currentBus?.route,
        'onboarding',
        destination,
        baggageSelection?.fee || 0
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
          showNotification('Boarding successful', 'success');
          // Auto-restart scanner after successful onboarding
          setTimeout(() => {
            processingRef.current = false;
            lastScanTimeRef.current = 0;
            lastScanCodeRef.current = '';
            setScanState('scanning');
            // Restart camera if needed
            startCamera();
          }, 2000);
          break;
        case 'ticket_validated':
          setValidatedCount(validatedCount + 1);
          setBoardedCount(c => c + 1);
          setPendingScan(null);
          setBaggageSelection(null);
          setSelectedDestination('');
          setScanState('success');
          showNotification('Ticket boarded successfully', 'success');
          // Auto-restart scanner after successful onboarding
          setTimeout(() => {
            processingRef.current = false;
            lastScanTimeRef.current = 0;
            lastScanCodeRef.current = '';
            setScanState('scanning');
            // Restart camera if needed
            startCamera();
          }, 2000);
          break;
        case 'duplicate_scan':
          setFailedMsg('Already boarded on this trip');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          showNotification('Already boarded on this trip', 'warning');
          break;
        case 'qr_fail_balance':
          const neededFare = result.totalFare || result.fare;
          setFailedMsg(`Insufficient balance ₱${result.balance.toFixed(2)} — need ₱${neededFare.toFixed(2)}`);
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
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
          showNotification(result.message || 'An error occurred', 'danger');
          break;
        case 'not_found':
          setFailedMsg('QR code not recognised');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        default:
          console.error('Unexpected result status:', (result as any).status);
          setFailedMsg('Boarding failed - unexpected error');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          showNotification('Unknown error occurred', 'danger');
          break;
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
      const { supabase } = await import('../supabaseClient');

      // Detect card type from QR code prefix (like onboarding)
      const detectedType = detectCardTypeFromPrefix(scannedCode);
      console.log('Detected card type from prefix:', detectedType);

      // Normalize the scanned UID (like onboarding)
      const normalizedCode = normalizeQrCode(scannedCode);
      console.log('Normalized code:', normalizedCode);

      // Check if user is authenticated (like onboarding)
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Auth session:', session ? 'Active' : 'None');

      if (!session) {
        setFailedMsg('Not authenticated. Please login again.');
        setScanState('failed');
        showNotification('Not authenticated', 'danger');
        return;
      }

      if (!currentTrip) {
        setFailedMsg('No active trip found');
        setScanState('failed');
        showNotification('No active trip', 'danger');
        return;
      }

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
            showNotification(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used', 'danger');
            return;
          }

          // Check if already boarded on this trip (prevent duplicate alighting scans)
          console.log('Checking for duplicate alighting for ticket:', ticket.id, 'on trip:', currentTrip.id);
          const { data: boardedTicket, error: ticketBoardCheckError } = await supabase
            .from('boarded_passengers')
            .select('id, alighted_at')
            .eq('trip_id', currentTrip.id)
            .eq('temp_ticket_id', ticket.id)
            .maybeSingle();

          console.log('Boarded ticket check result:', boardedTicket);
          console.log('Boarded ticket check error:', ticketBoardCheckError);

          if (!boardedTicket) {
            console.log('Ticket not boarded on this trip');
            setFailedMsg('Ticket not boarded on this trip');
            setScanState('failed');
            showNotification('Ticket not boarded on this trip', 'danger');
            return;
          }

          if (boardedTicket.alighted_at) {
            console.log('Duplicate scan detected - ticket already alighted');
            setFailedMsg('Already alighted on this trip');
            setScanState('failed');
            showNotification('Already alighted', 'warning');
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
        .select('id, destination, status, balance')
        .eq('card_uid', normalizedCode)
        .maybeSingle();

      console.log('Card lookup result:', card);

      if (!card) {
        setFailedMsg('QR code not recognised');
        setScanState('failed');
        showNotification('QR code not recognised', 'danger');
        return;
      }

      if (card.status !== 'active') {
        setFailedMsg('Card is inactive');
        setScanState('failed');
        showNotification('Card is inactive', 'danger');
        return;
      }

      // Check if already boarded on this trip (prevent duplicate alighting scans)
      console.log('[Alighting] Checking for boarded passenger - card:', card.id, 'trip:', currentTrip.id);
      const { data: boardedPassenger, error: boardCheckError } = await supabase
        .from('boarded_passengers')
        .select('id, alighted_at, boarded_at')
        .eq('trip_id', currentTrip.id)
        .eq('card_id', card.id)
        .maybeSingle();

      console.log('[Alighting] Boarded passenger check result:', boardedPassenger);
      console.log('[Alighting] Boarded passenger check error:', boardCheckError);

      if (!boardedPassenger) {
        console.log('[Alighting] Card not boarded on this trip - checking all boarded passengers for this trip');
        // Debug: Check all boarded passengers for this trip to see what's there
        const { data: allBoarded } = await supabase
          .from('boarded_passengers')
          .select('*')
          .eq('trip_id', currentTrip.id);
        console.log('[Alighting] All boarded passengers for this trip:', allBoarded);
        
        setFailedMsg('Card not boarded on this trip');
        setScanState('failed');
        showNotification('Card not boarded on this trip', 'danger');
        return;
      }

      if (boardedPassenger.alighted_at) {
        console.log('Duplicate scan detected - card already alighted');
        setFailedMsg('Already alighted on this trip');
        setScanState('failed');
        showNotification('Already alighted', 'warning');
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
      const fare = 12; // Default fare - could be calculated based on route
      setPendingAlighting({
        code: scannedCode,
        cardId: card.id,
        destination: card.destination,
        balance: card.balance,
        fare: fare,
        route: currentBus?.route || '',
      });
      setScanState('confirm_alighting');
    } catch (err) {
      console.error('Alighting error:', err);
      setGpsValidating(false);
      setFailedMsg(`Alighting error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setScanState('failed');
      showNotification('Alighting error', 'danger');
    }
  }

  function handleAlightingResult(result: any) {
    console.log('[handleAlightingResult] Received result:', result);
    
    if (result.status === 'qr_pass') {
      console.log('[handleAlightingResult] Processing qr_pass success');
      setValidatedCount(validatedCount + 1);
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
      showNotification('Alighting successful!', 'success');
      // Auto-restart scanner after successful alighting
      setTimeout(() => {
        setSuccessMsg('');
        setSuccessAmount(0);
        setSuccessBalance(null);
        processingRef.current = false;
        lastScanTimeRef.current = 0;
        lastScanCodeRef.current = '';
        setScanState('scanning');
        // Restart camera if needed
        startCamera();
      }, 2000);
    } else if (result.status === 'ticket_validated') {
      console.log('[handleAlightingResult] Processing ticket_validated success');
      setValidatedCount(validatedCount + 1);
      setAlightedCount(c => c + 1);
      const totalFare = result.totalFare || result.fareAmount;
      if (totalFare > 0) setFareCollected(fareCollected + totalFare);
      setSuccessMsg(result.destination ? `Alighted @ ${result.destination}` : 'Alighted successfully');
      setSuccessAmount(result.fareAmount);
      setSuccessBalance(null);
      setGpsResult(null);
      setPendingAlighting(null);
      setScanState('success');
      showNotification('Ticket alighted successfully!', 'success');
      // Auto-restart scanner after successful alighting
      setTimeout(() => {
        setSuccessMsg('');
        setSuccessAmount(0);
        setSuccessBalance(null);
        processingRef.current = false;
        lastScanTimeRef.current = 0;
        lastScanCodeRef.current = '';
        setScanState('scanning');
        // Restart camera if needed
        startCamera();
      }, 2000);
    } else if (result.status === 'qr_fail_balance') {
      console.log('[handleAlightingResult] Insufficient balance error');
      setFailedMsg(`Insufficient balance ₱${result.balance.toFixed(2)} — need ₱${result.fare}`);
      setScanState('failed');
      showNotification('Insufficient balance', 'danger');
    } else if (result.status === 'error') {
      console.log('[handleAlightingResult] Error:', result.message);
      setFailedMsg(result.message);
      setScanState('failed');
      showNotification(result.message || 'Alighting error', 'danger');
    } else if (result.status === 'duplicate_scan') {
      console.log('[handleAlightingResult] Duplicate scan - this is expected after successful alighting');
      // Don't show error for duplicate scans after successful alighting - just reset to scanning
      setGpsResult(null);
      setPendingAlighting(null);
      processingRef.current = false;
      lastScanTimeRef.current = 0;
      lastScanCodeRef.current = '';
      setScanState('scanning');
      showNotification('Passenger already alighted', 'warning');
    } else if (result.status === 'qr_inactive') {
      console.log('[handleAlightingResult] Card inactive');
      setFailedMsg('Card is inactive');
      setScanState('failed');
      showNotification('Card is inactive', 'danger');
    } else if (result.status === 'not_found') {
      console.log('[handleAlightingResult] Not found');
      setFailedMsg('QR code not recognised');
      setScanState('failed');
      showNotification('QR code not recognised', 'danger');
    } else {
      console.log('[handleAlightingResult] Unknown status:', result.status);
      setFailedMsg('Alighting failed - unexpected error');
      setScanState('failed');
      showNotification('Alighting failed', 'danger');
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
      <InteractiveBackground />
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
                <motion.div
                  style={{ width: 80, height: 80, borderRadius: 24, background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 2.5, repeat: Infinity }}
                >
                  {scanType === 'alighting' ? (
                    <MapPin size={40} color="var(--color-primary)" strokeWidth={1.5} />
                  ) : (
                    <ScanLine size={40} color="var(--color-primary)" strokeWidth={1.5} />
                  )}
                </motion.div>
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
                    Onboarding
                  </button>
                  <button type="button" className={`scanner-type-btn ${scanType === 'alighting' ? 'scanner-type-btn--active' : ''}`} onClick={() => setScanType('alighting')}>
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
                    {/* Visual QR Card — canvas composite of template + QR */}
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.3 }}
                      style={{ marginBottom: 0, minHeight: '200px' }}
                    >
                      {pendingScan && (
                        <>
                          <QRCardCanvas
                            cardUid={pendingScan.cardUid || pendingScan.code}
                            balance={pendingScan.balance}
                            passengerType={pendingScan.passengerType}
                            isTicket={pendingScan.isTicket}
                          />
                        </>
                      )}

                      {/* Fare total strip */}
                      <div style={{
                        background: 'var(--color-primary-subtle)',
                        border: '1.5px solid var(--color-primary)',
                        borderTop: 'none',
                        borderRadius: '0 0 14px 14px',
                        padding: '12px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        marginBottom: 14,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                            Base Fare
                          </span>
                          <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                            ₱{pendingScan.fare.toFixed(2)}
                          </span>
                        </div>
                        {baggageSelection && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>
                              Baggage Fee ({baggageSelection.quantity}x {baggageSelection.category})
                            </span>
                            <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                              ₱{baggageSelection.fee.toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div style={{
                          height: 1,
                          background: 'var(--color-primary)',
                          opacity: 0.3,
                          margin: '4px 0',
                        }}></div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)', fontWeight: 700 }}>
                            Total
                          </span>
                          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                            ₱{(pendingScan.fare + (baggageSelection?.fee || 0)).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </motion.div>

                    {/* Destination picker */}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
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

                      {/* GPS Location Display */}
                      {currentStopName && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          style={{
                            marginTop: 12,
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
                    </SoftCard>

                    {/* Baggage fee selector */}
                    <SoftCard variant="glass" style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        onClick={() => setShowBaggageSelector(true)}
                        className="settings-item glass-card"
                        style={{
                          padding: '14px 16px',
                          marginBottom: 0,
                          border: baggageSelection ? '2px solid var(--color-primary)' : '1px solid var(--glass-border)',
                          background: baggageSelection ? 'var(--color-primary-subtle)' : 'var(--glass-bg)',
                        }}
                      >
                        <div className="settings-item__icon" style={{
                          background: baggageSelection ? 'var(--color-primary)' : 'var(--bg-tertiary)',
                        }}>
                          <Package size={16} color={baggageSelection ? 'white' : 'var(--text-secondary)'} />
                        </div>
                        <div className="settings-item__content">
                          <span className="settings-item__label" style={{ color: baggageSelection ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                            {baggageSelection ? `${baggageSelection.category} (x${baggageSelection.quantity})` : 'Add Baggage Fee'}
                          </span>
                          <span className="settings-item__desc">
                            {baggageSelection ? `₱${baggageSelection.fee.toFixed(2)}` : 'Optional - for passengers with baggage'}
                          </span>
                        </div>
                        <ChevronRight size={16} color={baggageSelection ? 'var(--color-primary)' : 'var(--text-secondary)'} style={{ flexShrink: 0 }} />
                      </button>
                    </SoftCard>

                    {/* Confirm button */}
                    <PrimaryButton
                      onClick={commitBoarding}
                      disabled={!selectedDestination}
                      fullWidth
                      icon={<CheckCircle size={20} />}
                      style={{ marginBottom: 10 }}
                    >
                      Confirm Boarding
                      {baggageSelection && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.9 }}>
                          (Total: ₱{(pendingScan.fare + baggageSelection.fee).toFixed(2)})
                        </span>
                      )}
                    </PrimaryButton>

                    <PrimaryButton
                      onClick={retryCamera}
                      variant="ghost"
                      icon={<RefreshCw size={15} />}
                      style={{ marginBottom: 14 }}
                    >
                      Scan Different Card
                    </PrimaryButton>
                  </motion.div>
                )}

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
                      {/* Trip Summary Card */}
                      <SoftCard variant="accent-warning" style={{ marginBottom: 14 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#A16207', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <MapPin size={20} color="white" />
                          </div>
                          <div>
                            <h4 className="heading-small" style={{ margin: 0, color: '#A16207' }}>Alighting Confirmation</h4>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Review trip details before confirming</p>
                          </div>
                        </div>

                        {/* Route */}
                        <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: 10 }}>
                          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Route</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {pendingAlighting.route}
                          </p>
                        </div>

                        {/* Destination */}
                        <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: 10 }}>
                          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Destination</p>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: '#A16207' }}>
                            {pendingAlighting.destination}
                          </p>
                        </div>

                        {/* Fare */}
                        <div style={{ marginBottom: 12, padding: '12px', background: 'rgba(255, 255, 255, 0.1)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.2)', borderRadius: 10 }}>
                          <p style={{ margin: '0 0 4px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Fare to Deduct</p>
                          <p style={{ margin: 0, fontWeight: 800, fontSize: '1.2rem', color: 'var(--color-primary)' }}>
                            ₱{pendingAlighting.fare.toFixed(2)}
                          </p>
                        </div>


                        {/* GPS Location Status */}
                        {gpsResult && (
                          <div style={{
                            padding: '12px 14px',
                            borderRadius: 10,
                            background: gpsResult.status === 'confirmed'
                              ? 'rgba(34,197,94,0.1)'
                              : gpsResult.status === 'mismatch'
                              ? 'rgba(239,68,68,0.1)'
                              : 'rgba(250,204,21,0.1)',
                            border: `1px solid ${
                              gpsResult.status === 'confirmed'
                                ? 'rgba(34,197,94,0.3)'
                                : gpsResult.status === 'mismatch'
                                ? 'rgba(239,68,68,0.3)'
                                : 'rgba(250,204,21,0.3)'
                            }`,
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

                        {/* Confirm Button */}
                        <PrimaryButton
                          onClick={confirmAlighting}
                          variant="primary"
                          fullWidth
                          icon={<CheckCircle size={20} />}
                          style={{
                            marginBottom: 10,
                            background: 'linear-gradient(135deg, #A16207, #FACC15)',
                            borderColor: '#A16207',
                          }}
                        >
                          Confirm Alighting
                        </PrimaryButton>

                        {/* Cancel Button */}
                        <PrimaryButton
                          onClick={() => {
                            setPendingAlighting(null);
                            setGpsResult(null);
                            setScanState('scanning');
                          }}
                          variant="ghost"
                          icon={<X size={15} />}
                          style={{ marginBottom: 14 }}
                        >
                          Cancel
                        </PrimaryButton>
                      </SoftCard>
                    </motion.div>
                  )}
                </AnimatePresence>
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
    </IonPage>
  );
};

export default ScanPage;
