import React, { useState, useEffect, useRef, useCallback } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine, CheckCircle, Wallet, CloudOff, RefreshCw,
  MapPin, AlertTriangle, Users, ArrowRight, X, CreditCard,
  XCircle, Navigation, ChevronRight,
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function getRouteStops(route: string): string[] {
  const stops = route.split(/[→\-–>]/).map((s) => s.trim()).filter(Boolean);
  return stops.length >= 2 ? stops : [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ScanState =
  | 'idle'
  | 'scanning'
  | 'processing'
  // onboarding-specific: scan succeeded, now pick destination
  | 'pick_destination'
  // committing the boarding after destination picked
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

  // For alighting: which stop is the bus currently at (conductor selects once)
  const [currentStop, setCurrentStop] = useState<string>('');

  // Post-scan state (onboarding: waiting for destination pick)
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<string>('');

  // Final result info
  const [successMsg, setSuccessMsg] = useState('');
  const [successAmount, setSuccessAmount] = useState(0);
  const [successBalance, setSuccessBalance] = useState<number | null>(null);
  const [failedMsg, setFailedMsg] = useState('');

  const [boardedCount, setBoardedCount] = useState(0);
  const [alightedCount, setAlightedCount] = useState(0);

  const { currentTrip, currentBus, validatedCount, fareCollected, setValidatedCount, setFareCollected } = useTrip();
  const { profile } = useAuth();
  const { isOnline, pendingCount, isSyncing, triggerSync, bumpPending } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(false);
  const stripShadedRegionRef = useRef<(() => void) | null>(null);

  const routeStops = currentBus ? getRouteStops(currentBus.route) : [];

  useEffect(() => {
    if (!currentTrip || !currentBus) history.replace('/trip-setup');
    if (routeStops.length > 0) {
      setCurrentStop(routeStops[routeStops.length - 1]); // default: last stop
    }
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
      
      // Omit qrbox — it makes html5-qrcode inject white corner brackets (#ffffff).
      // The custom green scan-frame overlay handles the viewfinder UI instead.
      const config = {
        fps: 10,
        aspectRatio: 1.0,
      };

      await qrCode.start(
        { facingMode: 'environment' },
        config,
        async (decodedText: string) => {
          console.log('QR code detected:', decodedText);
          if (processingRef.current) return;
          processingRef.current = true;
          // Pause scanner instead of stopping it
          try {
            await qrCode.pause();
          } catch { /* ignore pause errors */ }
          setScanState('processing');
          await handleRawScan(decodedText);
        },
        (errorMessage: string) => {
          // Silently ignore scan errors
        }
      );
      stripShadedRegionRef.current = stripQrShadedRegion('qr-reader');
      console.log('Camera started successfully');
    } catch (err) {
      console.error('QR camera error:', err);
      showNotification(`Camera error: ${err instanceof Error ? err.message : 'Unknown error'}`, 'danger');
      setScanState('idle');
    }
  }, [scanType, currentStop]); // eslint-disable-line react-hooks/exhaustive-deps

  async function stopCamera() {
    await cleanupScanner();
    setScanState('idle');
    setPendingScan(null);
    setSelectedDestination('');
    processingRef.current = false;
  }

  async function retryCamera() {
    setPendingScan(null);
    setSelectedDestination('');
    setFailedMsg('');
    processingRef.current = false;
    // Resume scanner if available, otherwise restart
    if (scannerRef.current) {
      try {
        await scannerRef.current.resume();
        setScanState('scanning');
      } catch (err) {
        console.error('Resume failed, restarting:', err);
        await startCamera();
      }
    } else {
      await startCamera();
    }
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

  /** For onboarding: peek at the card/ticket and show destination picker */
  async function handleOnboardingPreScan(scannedCode: string) {
    try {
      const { supabase } = await import('../supabaseClient');

      // Try QR card first
      const { data: card } = await supabase
        .from('qr_cards')
        .select('id, balance, status, allowed_routes, destination')
        .eq('card_uid', scannedCode)
        .maybeSingle();

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
        setPendingScan({
          code: scannedCode,
          balance: card.balance,
          cardDestination: card.destination,
          fare: DEFAULT_FARE,
        });
        setSelectedDestination(card.destination || routeStops[routeStops.length - 1] || '');
        setScanState('pick_destination');
        return;
      }

      // Try temporary ticket
      const { data: ticket } = await supabase
        .from('temporary_tickets')
        .select('id, ticket_uid, fare_amount, status, destination')
        .eq('ticket_uid', scannedCode)
        .maybeSingle();

      if (ticket) {
        if (ticket.status === 'validated' || ticket.status === 'expired') {
          setFailedMsg(ticket.status === 'expired' ? 'Ticket expired' : 'Ticket already used');
          setScanState('failed');
          return;
        }
        setPendingScan({
          code: scannedCode,
          balance: ticket.fare_amount, // not a balance, reusing field for display
          cardDestination: ticket.destination,
          fare: ticket.fare_amount,
        });
        setSelectedDestination(ticket.destination || routeStops[routeStops.length - 1] || '');
        setScanState('pick_destination');
        return;
      }

      setFailedMsg('QR code not recognised');
      setScanState('failed');
    } catch (err) {
      setFailedMsg('Scan read failed. Try again.');
      setScanState('failed');
    }
  }

  /** After user picks destination in onboarding — commit the boarding */
  async function commitBoarding() {
    if (!pendingScan || !selectedDestination || !currentTrip || !profile) return;
    setScanState('committing');

    try {
      const result = await processScan(
        pendingScan.code,
        currentTrip.id,
        profile.id,
        currentBus?.route,
        'onboarding',
        selectedDestination
      );

      if (result.status === 'qr_pass') {
        setValidatedCount(validatedCount + 1);
        setBoardedCount(c => c + 1);
        setSuccessMsg(`Boarded → ${selectedDestination}`);
        setSuccessAmount(0);
        setSuccessBalance(result.newBalance);
        setPendingScan(null);
        setScanState('success');
        scheduleNextScan();
      } else if (result.status === 'ticket_validated') {
        setValidatedCount(validatedCount + 1);
        setBoardedCount(c => c + 1);
        setSuccessMsg(`Ticket boarded → ${selectedDestination}`);
        setSuccessAmount(0);
        setSuccessBalance(null);
        setPendingScan(null);
        setScanState('success');
        scheduleNextScan();
      } else if (result.status === 'duplicate_scan') {
        setFailedMsg('Already boarded on this trip');
        setScanState('failed');
      } else if (result.status === 'error') {
        setFailedMsg(result.message);
        setScanState('failed');
      } else {
        setFailedMsg('Could not board passenger');
        setScanState('failed');
      }
    } catch {
      setFailedMsg('Boarding failed. Try again.');
      setScanState('failed');
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
        currentStop  // the conductor's selected current stop = the alighting stop
      );

      if (result.status === 'qr_pass') {
        setValidatedCount(validatedCount + 1);
        setAlightedCount(c => c + 1);
        if (result.fare > 0) setFareCollected(fareCollected + result.fare);
        setSuccessMsg(
          result.destination
            ? `Alighted @ ${result.destination}`
            : 'Alighted successfully'
        );
        setSuccessAmount(result.fare);
        setSuccessBalance(result.newBalance);
        setScanState('success');
        scheduleNextScan();
      } else if (result.status === 'ticket_validated') {
        setValidatedCount(validatedCount + 1);
        setAlightedCount(c => c + 1);
        if (result.fareAmount > 0) setFareCollected(fareCollected + result.fareAmount);
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
        setFailedMsg('Scan could not be processed');
        setScanState('failed');
      }
    } catch {
      setFailedMsg('Scan processing failed. Try again.');
      setScanState('failed');
    }
  }

  function scheduleNextScan() {
    setTimeout(() => {
      setSuccessMsg('');
      setSuccessAmount(0);
      setSuccessBalance(null);
      processingRef.current = false;
      // Resume scanner instead of restarting
      if (scannerRef.current) {
        try {
          scannerRef.current.resume();
          setScanState('scanning');
        } catch (err) {
          console.error('Resume failed, restarting:', err);
          startCamera();
        }
      } else {
        startCamera();
      }
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

                {/* ── ALIGHTING: conductor picks current stop (the bus's location) ── */}
                {scanType === 'alighting' && routeStops.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <MapPin size={15} color="var(--color-warning)" />
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                        Current Stop <span style={{ fontSize: '0.72rem', fontWeight: 500 }}>(where passengers are alighting)</span>
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {routeStops.map((stop) => (
                        <button key={stop} type="button" onClick={() => setCurrentStop(stop)} style={{
                          padding: '8px 16px', borderRadius: 22,
                          border: currentStop === stop ? '2px solid var(--color-warning)' : '1.5px solid var(--color-border)',
                          background: currentStop === stop ? 'var(--color-warning-subtle)' : 'transparent',
                          color: currentStop === stop ? '#A16207' : 'var(--text-secondary)',
                          fontWeight: currentStop === stop ? 700 : 500, fontSize: '0.85rem',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}>{stop}</button>
                      ))}
                    </div>
                    {currentStop && (
                      <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-warning-subtle)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={14} color="#A16207" />
                        <span style={{ fontSize: '0.8rem', color: '#A16207', fontWeight: 600 }}>
                          Scanning will verify destination = <strong>{currentStop}</strong> and deduct fare
                        </span>
                      </div>
                    )}
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
                    {scanType === 'alighting' ? `Alighting @ ${currentStop || '—'}` : 'Onboarding'}
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
                      <span style={{ color: 'rgba(255,255,255,0.85)', fontWeight: 500, fontSize: '0.82rem', textAlign: 'center', maxWidth: 240 }}>{failedMsg}</span>
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
                          </p>
                        </div>
                        {/* Remaining after fare */}
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ margin: '0 0 2px', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>After fare</p>
                          <p style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: pendingScan.balance - pendingScan.fare >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            ₱{(pendingScan.balance - pendingScan.fare).toFixed(2)}
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
                        {routeStops.map((stop) => {
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
                        })}
                      </div>
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
                      Confirm Boarding{selectedDestination ? ` → ${selectedDestination}` : ''}
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
    </IonPage>
  );
};

export default ScanPage;
