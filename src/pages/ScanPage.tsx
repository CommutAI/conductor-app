import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, CheckCircle, Wallet, CloudOff, RefreshCw,
  MapPin, AlertTriangle, Users, ArrowRight, X, CreditCard,
  XCircle, Navigation, ChevronRight, Package,
} from 'lucide-react';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { processScan, ScanResult } from '../utils/scanProcessor';
import { OfflineStorage } from '../utils/offlineStorage';
import { Html5Qrcode } from 'html5-qrcode';
import { stripQrShadedRegion } from '../utils/qrScannerUi';
import { Camera } from '@capacitor/camera';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton, DashboardCard,
  AppToast, StatusBadge,
} from '../components/ui';
import BaggageFeeSelector from '../components/ui/BaggageFeeSelector';
import type { BaggageSelection } from '../types/fareValidation';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalizes QR code strings by replacing special dash characters with regular hyphens.
 * This handles cases where QR codes contain en dashes (–), em dashes (—), or other dash variants
 * that should be treated as regular hyphens for database lookup.
 */
function normalizeQrCode(scannedUid: string): string {
  return scannedUid
    .replace(/[\u2013\u2014\u2015\u2212\uFF0D]/g, '-'); // en dash, em dash, horizontal bar, minus sign, fullwidth hyphen-minus
}

function getRouteStops(route: string): string[] {
  console.log('getRouteStops input:', route);
  console.log('Route char codes:', route.split('').map(c => `${c}(${c.charCodeAt(0)})`).join(' '));
  
  // Try multiple separator patterns including Unicode variants
  // Unicode: ↔ (2194), ← (2190), → (2192), – (8211), — (8212)
  const separators = ['↔', '←', '→', '↔', '↔', '-', '–', '—', '>', '<', '|', '\u2194', '\u2190', '\u2192', '\u2013', '\u2014'];
  let stops: string[] = [];
  
  for (const sep of separators) {
    stops = route.split(sep).map((s) => s.trim()).filter(Boolean);
    if (stops.length >= 2) {
      console.log('getRouteStops found stops with separator', sep, ':', stops);
      return stops;
    }
  }
  
  console.log('getRouteStops could not parse, returning empty');
  return [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanState =
  | 'idle'
  | 'scanning'
  | 'detected'
  | 'processing'
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
};

// ── Component ─────────────────────────────────────────────────────────────────

const DEFAULT_FARE = 12;

const ScanPage: React.FC = () => {
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [cardId, setCardId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [scanType, setScanType] = useState<'onboarding' | 'alighting'>('onboarding');

  // Post-scan state (onboarding: waiting for destination pick)
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string>('');
  const [baggageSelection, setBaggageSelection] = useState<BaggageSelection | null>(null);
  const [showBaggageSelector, setShowBaggageSelector] = useState(false);


  // Final result info
  const [successMsg, setSuccessMsg] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);
  const [successBalance, setSuccessBalance] = useState<number | null>(null);
  const [failedMsg, setFailedMsg] = useState('');
  const [debugScannedCode, setDebugScannedCode] = useState('');

  const [boardedCount, setBoardedCount] = useState(0);
  const [alightedCount, setAlightedCount] = useState(0);

  const { currentTrip, currentBus, validatedCount, fareCollected, setValidatedCount, setFareCollected, isRestoringTrip } = useTrip();
  const { profile } = useAuth();
  const { isOnline, pendingCount, isSyncing, triggerSync, bumpPending } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const stripShadedRegionRef = useRef<(() => void) | null>(null);
  const cameraReadyRef = useRef(false);
  const lastScanTimeRef = useRef(0);
  const lastScanCodeRef = useRef('');

  const routeStops = currentBus ? getRouteStops(currentBus.route) : [];
  console.log('Current bus route:', currentBus?.route);
  console.log('Route stops:', routeStops);
  
  // Always use default stops for now to ensure dropdown shows
  const displayStops = ['Manolo Fortich Terminal', 'Dicklum', 'San Miguel', 'Lunocan', 'Alae', 'Mambatangan', 'Puerto', 'Agora Terminal'];
  console.log('Display stops:', displayStops);

  useEffect(() => {
    if (!isRestoringTrip && (!currentTrip || !currentBus)) history.replace('/trip-setup');
    return () => { cleanupScanner(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scanner helpers ───────────────────────────────────────────────────────

  function showNotification(message: string, color: 'success' | 'danger' | 'warning') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
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
      console.error('QR reader element not found');
      showNotification('Camera element not found', 'danger');
      setScanState('idle');
      return;
    }

    console.log('Starting camera');

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
          console.log('QR code detected:', decodedText);
          console.log('Full result:', decodedResult);

          // Ignore scans during camera startup (first 2 seconds)
          if (!cameraReadyRef.current) {
            console.log('Ignoring scan - camera not ready');
            return;
          }

          // Validate QR code format - should be alphanumeric with reasonable length
          if (!decodedText || decodedText.length < 5 || decodedText.length > 100) {
            console.log('Invalid QR code format:', decodedText);
            return;
          }

          // Debounce: ignore if same code scanned within 500ms (prevents rapid duplicate detections)
          const now = Date.now();
          if (decodedText === lastScanCodeRef.current && (now - lastScanTimeRef.current) < 500) {
            console.log('Ignoring duplicate scan within debounce window');
            return;
          }

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
          // Log errors for debugging
          if (errorMessage && !errorMessage.includes('No barcode') && !errorMessage.includes('NotFoundException')) {
            console.log('Scan error:', errorMessage);
          }
        }
      );
      stripShadedRegionRef.current = stripQrShadedRegion('qr-reader');
      
      // Mark camera as ready after 2 seconds to prevent false detections
      setTimeout(() => {
        cameraReadyRef.current = true;
        console.log('Camera ready for scanning');
      }, 2000);
      
      console.log('Camera started successfully');
    } catch (err) {
      console.error('QR camera error:', err);
      showNotification(`Camera error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'danger');
      setScanState('idle');
    }
  }, [scanType]); // eslint-disable-line react-hooks/exhaustive-deps

  async function stopCamera() {
    await cleanupScanner();
    setScanState('idle');
    setPendingScan(null);
    setSelectedDestination('');
    processingRef.current = false;
    lastScanTimeRef.current = 0;
    lastScanCodeRef.current = '';
    cameraReadyRef.current = false;
  }

  async function retryCamera() {
    setPendingScan(null);
    setSelectedDestination('');
    setFailedMsg('');
    processingRef.current = false;
    lastScanTimeRef.current = 0;
    lastScanCodeRef.current = '';
    setScanState('scanning');
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
      OfflineStorage.addOfflineScan(scannedCode, currentTrip.id, profile.id, currentBus?.route);
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

      // Normalize the scanned UID to handle special dash characters
      const normalizedCode = normalizeQrCode(scannedCode);
      console.log('Normalized code:', normalizedCode);

      // Check if user is authenticated
      const { data: { session } } = await supabase.auth.getSession();
      console.log('Auth session:', session ? 'Active' : 'None');

      if (!session) {
        setFailedMsg('Not authenticated. Please login again.');
        setScanState('failed');
        return;
      }

      if (!currentTrip) {
        setFailedMsg('No active trip found');
        setScanState('failed');
        return;
      }

      // Try QR card first
      const { data: card, error: cardError } = await supabase
        .from('qr_cards')
        .select('id, balance, status, allowed_routes, destination')
        .eq('card_uid', normalizedCode)
        .maybeSingle();

      console.log('Card lookup result:', card);
      console.log('Card lookup error:', cardError);

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
        if (card.balance < DEFAULT_FARE) {
          setFailedMsg(`Insufficient balance ₱${card.balance.toFixed(2)} — need ₱${DEFAULT_FARE}`);
          setScanState('failed');
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
          return;
        }
        
        setPendingScan({
          code: scannedCode,
          balance: card.balance,
          cardDestination: card.destination,
          fare: DEFAULT_FARE,
        });
        // Don't auto-select destination - require manual selection
        setSelectedDestination('');
        console.log('Setting scan state to pick_destination');
        setScanState('pick_destination');
        return;
      }

      // Try temporary ticket
      const { data: ticket, error: ticketError } = await supabase
        .from('temporary_tickets')
        .select('id, ticket_uid, fare_amount, status, destination')
        .eq('ticket_uid', normalizedCode)
        .maybeSingle();

      console.log('Ticket lookup result:', ticket);
      console.log('Ticket lookup error:', ticketError);

      if (ticketError) {
        console.error('Database query error:', ticketError);
        setFailedMsg(`Database error: ${ticketError.message}`);
        setScanState('failed');
        return;
      }

      if (ticket) {
        if (ticket.status === 'validated' || ticket.status === 'expired') {
          setFailedMsg(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used');
          setScanState('failed');
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
          return;
        }
        
        setPendingScan({
          code: scannedCode,
          balance: ticket.fare_amount,
          cardDestination: ticket.destination,
          fare: ticket.fare_amount,
        });
        // Don't auto-select destination - require manual selection
        setSelectedDestination('');
        setScanState('pick_destination');
        return;
      }

      console.log('No matching card or ticket found for:', scannedCode);
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
        baggageSelection?.fee
      );
      console.log('Process scan result:', result);
      console.log('Result status:', result.status);
      console.log('Result message:', (result as any).message);

      switch (result.status) {
        case 'qr_pass':
          setValidatedCount(validatedCount + 1);
          setBoardedCount(c => c + 1);
          setSuccessMsg(`Boarded → ${destination}${baggageSelection ? ` (w/ baggage ₱${baggageSelection.fee.toFixed(2)})` : ''}`);
          setSuccessAmount(0);
          setSuccessBalance(result.newBalance);
          setPendingScan(null);
          setBaggageSelection(null);
          setSelectedDestination('');
          setScanState('success');
          // Stop camera after successful boarding - don't auto-rescan
          setTimeout(() => {
            stopCamera();
          }, 2000);
          break;
        case 'ticket_validated':
          setValidatedCount(validatedCount + 1);
          setBoardedCount(c => c + 1);
          setSuccessMsg(`Ticket boarded → ${destination}${baggageSelection ? ` (w/ baggage ₱${baggageSelection.fee.toFixed(2)})` : ''}`);
          setSuccessAmount(0);
          setSuccessBalance(null);
          setPendingScan(null);
          setBaggageSelection(null);
          setSelectedDestination('');
          setScanState('success');
          // Stop camera after successful boarding - don't auto-rescan
          setTimeout(() => {
            stopCamera();
          }, 2000);
          break;
        case 'duplicate_scan':
          setFailedMsg('Already boarded on this trip');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
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
        case 'not_found':
          setFailedMsg('QR code not recognised');
          setScanState('failed');
          setBaggageSelection(null);
          setSelectedDestination('');
          break;
        case 'error':
          setFailedMsg(result.message || 'Boarding failed');
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

  /** Full alighting process */
  async function handleAlightingScan(scannedCode: string) {
    try {
      const result = await processScan(
        scannedCode,
        currentTrip!.id,
        profile!.id,
        currentBus?.route,
        'alighting',
        undefined,  // destination will be fetched from boarded_passengers record
        0  // baggage fee - currently not stored during onboarding, so 0 for now
      );

      if (result.status === 'qr_pass') {
        setValidatedCount(validatedCount + 1);
        setAlightedCount(c => c + 1);
        const totalFare = result.totalFare || result.fare;
        if (totalFare > 0) setFareCollected(fareCollected + totalFare);
        setSuccessMsg(
          result.destination
            ? `Alighted @ ${result.destination}`
            : 'Alighted successfully'
        );
        setSuccessAmount(totalFare);
        setSuccessBalance(result.newBalance);
        setScanState('success');
        scheduleNextScan();
      } else if (result.status === 'ticket_validated') {
        setValidatedCount(validatedCount + 1);
        setAlightedCount(c => c + 1);
        const totalFare = result.totalFare || result.fareAmount;
        if (totalFare > 0) setFareCollected(fareCollected + totalFare);
        setSuccessMsg(result.destination ? `Alighted @ ${result.destination}` : 'Alighted successfully');
        setSuccessAmount(result.fareAmount);
        setSuccessBalance(null);
        setScanState('success');
        scheduleNextScan();
      } else if (result.status === 'qr_fail_balance') {
        setFailedMsg(`Insufficient balance ₱${result.balance.toFixed(2)} — need ₱${result.fare}`);
        setScanState('failed');
      } else if (result.status === 'error') {
        setFailedMsg(result.message);
        setScanState('failed');
      } else if (result.status === 'duplicate_scan') {
        setFailedMsg('Already alighted — duplicate scan');
        setScanState('failed');
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
    } catch (err) {
      console.error('Alighting error:', err);
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

  // ── Card ID manual entry ──────────────────────────────────────────────────

  async function submitCardId() {
    const trimmed = cardId.trim();
    if (!trimmed) { showNotification('Please enter a card ID', 'warning'); return; }
    if (isSubmitting) return;
    setIsSubmitting(true);
    await cleanupScanner();
    setScanState('processing');
    await handleRawScan(trimmed);
    setCardId('');
    setIsSubmitting(false);
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
        onBack={() => { stopCamera(); history.push('/live-trip'); }}
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
              <div className={`scanner-hero ${!isOnline ? 'scanner-hero--offline' : ''}`}>
                <div className="scanner-hero__glow" />
                <div className="scanner-hero__content">
                  <motion.div
                    style={{ width: 80, height: 80, borderRadius: 24, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}
                    animate={{ scale: [1, 1.06, 1] }}
                    transition={{ duration: 2.5, repeat: Infinity }}
                  >
                    <ScanLine size={40} color="rgba(255,255,255,0.95)" strokeWidth={1.5} />
                  </motion.div>
                  <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                    {isOnline ? 'QR Scanner' : 'Offline Scanner'}
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                    {isOnline
                      ? (scanType === 'onboarding' ? 'Scan card → pick destination' : 'Scan card → fare auto-deducted')
                      : `Scans sync when online${pendingCount > 0 ? ` (${pendingCount} queued)` : ''}`}
                  </p>
                </div>
              </div>

              {/* Mode selector card */}
              <SoftCard style={{ marginBottom: 20 }}>
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
                          Scan the passenger's QR card → GPS verifies location matches their destination → fare is automatically deducted.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </SoftCard>

              <PrimaryButton onClick={startCamera} fullWidth icon={<ScanLine size={22} />} style={{ marginBottom: 20 }}>
                Start Scanning
              </PrimaryButton>

              {/* Stats */}
              <div className="dashboard-grid" style={{ marginBottom: 20 }}>
                <DashboardCard label="Validated" value={validatedCount} icon={CheckCircle} iconBg="var(--color-success-subtle)" iconColor="var(--color-success)" />
                <DashboardCard label="Collected" value={`₱${fareCollected.toFixed(0)}`} icon={Wallet} iconBg="var(--color-primary-subtle)" iconColor="var(--color-primary)" />
                <DashboardCard label="Boarded" value={boardedCount} icon={Users} iconBg="var(--color-info-subtle)" iconColor="var(--color-info)" />
                <DashboardCard label="Alighted" value={alightedCount} icon={ArrowRight} iconBg="var(--color-warning-subtle)" iconColor="#A16207" />
              </div>

              {/* Pending sync */}
              {pendingCount > 0 && (
                <SoftCard style={{ marginBottom: 20, cursor: isOnline ? 'pointer' : 'default', background: isOnline ? 'var(--color-warning-subtle)' : 'var(--color-danger-subtle)' }} onClick={isOnline ? triggerSync : undefined}>
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
              <div className="scanner-active-card">

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
                <div className="scanner-viewport">

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
                        {scanState === 'committing' ? 'Confirming boarding…' : 'Reading card…'}
                      </span>
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
                      <button type="button" onClick={retryCamera} style={{
                        marginTop: 8, padding: '10px 28px', borderRadius: 24, border: '2px solid white',
                        background: 'transparent', color: 'white', fontWeight: 700, fontSize: '0.9rem',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      }}>
                        <RefreshCw size={16} /> Try Again
                      </button>
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
                    {/* Balance preview card */}
                    <SoftCard style={{ marginBottom: 14, background: 'var(--color-success-subtle)', border: '1.5px solid var(--color-success)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: 14,
                          background: 'var(--color-success)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <CreditCard size={24} color="white" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ margin: '0 0 2px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-success)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Card Scanned</p>
                          <p style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            ₱{pendingScan.balance.toFixed(2)}
                          </p>
                          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            Current balance · Fare ₱{pendingScan.fare.toFixed(2)}
                            {baggageSelection && ` + Baggage ₱${baggageSelection.fee.toFixed(2)}`}
                          </p>
                          {/* Display scanned QR code */}
                          <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-success)', textTransform: 'uppercase' }}>QR:</span>
                            <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-all' }}>{pendingScan.code}</span>
                          </div>
                        </div>
                        {/* Remaining after fare */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ margin: '0 0 2px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>After fare</p>
                          <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: pendingScan.balance - pendingScan.fare - (baggageSelection?.fee || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            ₱{(pendingScan.balance - pendingScan.fare - (baggageSelection?.fee || 0)).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </SoftCard>

                    {/* Destination picker */}
                    <SoftCard style={{ marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--color-primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Navigation size={16} color="var(--color-primary)" />
                        </div>
                        <div>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Select Destination</p>
                          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Where is the passenger going?</p>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {displayStops.length > 0 ? (
                          displayStops.map((stop) => {
                            const isSelected = selectedDestination === stop;
                            return (
                              <button
                                key={stop}
                                type="button"
                                onClick={() => setSelectedDestination(stop)}
                                style={{
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                  padding: '14px 16px', borderRadius: 12,
                                  border: isSelected ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                                  background: isSelected ? 'var(--color-primary-subtle)' : 'var(--bg-tertiary)',
                                  cursor: 'pointer', transition: 'all 0.15s',
                                  textAlign: 'left',
                                  minHeight: '50px',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{
                                    width: 10, height: 10, borderRadius: '50%',
                                    background: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                                    transition: 'background 0.15s',
                                  }} />
                                  <span style={{ fontWeight: isSelected ? 700 : 500, fontSize: '0.92rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                    {stop}
                                  </span>
                                </div>
                                {isSelected && <ChevronRight size={16} color="var(--color-primary)" />}
                              </button>
                            );
                          })
                        ) : (
                          <div style={{ padding: '20px', background: 'var(--bg-tertiary)', borderRadius: 12, textAlign: 'center' }}>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>No destinations available</p>
                          </div>
                        )}
                      </div>
                    </SoftCard>

                    {/* Baggage fee selector */}
                    <SoftCard style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        onClick={() => setShowBaggageSelector(true)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '14px 16px',
                          borderRadius: 12,
                          border: baggageSelection ? '2px solid var(--color-primary)' : '1.5px solid var(--color-border)',
                          background: baggageSelection ? 'var(--color-primary-subtle)' : 'var(--bg-tertiary)',
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 10,
                            background: baggageSelection ? 'var(--color-primary)' : 'var(--color-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            <Package size={16} color={baggageSelection ? 'white' : 'var(--text-secondary)'} />
                          </div>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.92rem', color: baggageSelection ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                              {baggageSelection ? baggageSelection.category : 'Add Baggage Fee'}
                            </p>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {baggageSelection ? `₱${baggageSelection.fee.toFixed(2)}` : 'Optional - for passengers with baggage'}
                            </p>
                          </div>
                        </div>
                        <ChevronRight size={16} color={baggageSelection ? 'var(--color-primary)' : 'var(--text-secondary)'} />
                      </button>
                    </SoftCard>

                    {/* Confirm button */}
                    <button
                      type="button"
                      onClick={commitBoarding}
                      disabled={!selectedDestination}
                      style={{
                        width: '100%',
                        padding: '16px',
                        borderRadius: 14,
                        border: 'none',
                        background: selectedDestination
                          ? 'linear-gradient(135deg, var(--color-primary), var(--color-primary))'
                          : 'var(--color-border)',
                        color: selectedDestination ? 'white' : 'var(--text-secondary)',
                        fontWeight: 800,
                        fontSize: '1.05rem',
                        cursor: selectedDestination ? 'pointer' : 'not-allowed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                        marginBottom: 10,
                        boxShadow: selectedDestination ? '0 6px 20px rgba(var(--color-primary-rgb,59,130,246),0.35)' : 'none',
                        transition: 'all 0.15s',
                      }}
                    >
                      <CheckCircle size={20} />
                      Confirm Boarding
                      {baggageSelection && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, opacity: 0.9 }}>
                          (Total: ₱{(pendingScan.fare + baggageSelection.fee).toFixed(2)})
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={retryCamera}
                      style={{
                        width: '100%', padding: '12px', borderRadius: 12,
                        border: '1.5px solid var(--color-border)', background: 'transparent',
                        color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.9rem',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <RefreshCw size={15} /> Scan Different Card
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Manual Card ID input (visible while scanning or failed) ── */}
              {(scanState === 'scanning' || scanState === 'failed') && (
                <SoftCard style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <CreditCard size={16} color="var(--color-primary)" />
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Or type card ID
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <input
                      ref={cardInputRef}
                      type="text"
                      value={cardId}
                      onChange={e => setCardId(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && submitCardId()}
                      placeholder="Type or paste card ID…"
                      disabled={isSubmitting}
                      style={{
                        flex: 1, padding: '12px 14px', borderRadius: 10,
                        border: '1.5px solid var(--color-border)',
                        background: 'var(--color-surface)',
                        color: 'var(--text-primary)',
                        fontSize: '0.95rem', fontWeight: 500, outline: 'none',
                      }}
                      onFocus={e => (e.target.style.borderColor = 'var(--color-primary)')}
                      onBlur={e => (e.target.style.borderColor = 'var(--color-border)')}
                    />
                    <button
                      type="button"
                      onClick={submitCardId}
                      disabled={isSubmitting || !cardId.trim()}
                      style={{
                        width: '100%', padding: '14px 18px', borderRadius: 12, border: 'none',
                        background: isSubmitting || !cardId.trim() ? 'var(--color-border)' : 'var(--color-primary)',
                        color: isSubmitting || !cardId.trim() ? 'var(--text-secondary)' : 'white',
                        cursor: isSubmitting || !cardId.trim() ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        fontWeight: 700, fontSize: '1rem', transition: 'all 0.15s',
                        boxShadow: isSubmitting || !cardId.trim() ? 'none' : '0 4px 14px rgba(var(--color-primary-rgb,59,130,246),0.3)',
                      }}
                    >
                      {isSubmitting
                        ? <><RefreshCw size={18} className="primary-btn__spinner" /> Processing…</>
                        : <><CreditCard size={18} /> Submit Card ID</>
                      }
                    </button>
                  </div>
                </SoftCard>
              )}

            </motion.div>
          )}

        </div>
      </IonContent>

      <AppToast
        isOpen={showToast}
        message={toastMessage}
        color={toastColor}
        onDismiss={() => setShowToast(false)}
      />

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
