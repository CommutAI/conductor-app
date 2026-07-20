import React, { useState, useEffect, useRef } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, CheckCircle, Wallet, Flashlight, SwitchCamera,
  CloudOff, RefreshCw,
} from 'lucide-react';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import { processScan, ScanResult } from '../utils/scanProcessor';
import { OfflineStorage } from '../utils/offlineStorage';
import { Html5QrcodeScanner, Html5QrcodeScannerState } from 'html5-qrcode';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton, DashboardCard, AnimatedModal,
  PassengerDetailsCard, AppToast, StatusBadge,
} from '../components/ui';

function interpretResult(result: ScanResult): { success: boolean; warning: boolean; message: string; amount: number } {
  switch (result.status) {
    case 'qr_pass':
      return { success: true, warning: false, message: `${result.ownerName} — balance ₱${result.newBalance.toFixed(2)}`, amount: result.fare };
    case 'qr_fail_balance':
      return { success: false, warning: false, message: `Insufficient balance (₱${result.balance.toFixed(2)}) — need ₱${result.fare}`, amount: 0 };
    case 'qr_inactive':
      return { success: false, warning: true, message: `Card inactive (${result.ownerName})`, amount: 0 };
    case 'qr_wrong_trip':
      return { success: false, warning: true, message: `Wrong route for ${result.ownerName}. Allowed: ${result.expectedRoute}`, amount: 0 };
    case 'qr_fake':
      return { success: false, warning: false, message: `Fake QR: ${result.reason}`, amount: 0 };
    case 'ticket_validated':
      return { success: true, warning: false, message: 'Ticket validated', amount: result.fareAmount };
    case 'ticket_already_used':
      return { success: false, warning: false, message: 'Ticket already used', amount: 0 };
    case 'ticket_expired':
      return { success: false, warning: true, message: 'Ticket expired', amount: 0 };
    case 'ticket_wrong_trip':
      return { success: false, warning: true, message: `Wrong route for ticket. Allowed: ${result.expectedRoute}`, amount: 0 };
    case 'duplicate_scan':
      return { success: false, warning: true, message: 'Duplicate scan — already recorded this trip', amount: 0 };
    case 'not_found':
      return { success: false, warning: false, message: 'QR code not recognised', amount: 0 };
    case 'error':
      return { success: false, warning: false, message: result.message, amount: 0 };
    default:
      return { success: false, warning: false, message: 'Unknown result', amount: 0 };
  }
}

const ScanPage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [interpreted, setInterpreted] = useState<{ success: boolean; warning: boolean; message: string; amount: number } | null>(null);
  const [rawResult, setRawResult] = useState<ScanResult | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');
  const [torchOn, setTorchOn] = useState(false);

  const { currentTrip, currentBus, validatedCount, fareCollected, setValidatedCount, setFareCollected } = useTrip();
  const { profile } = useAuth();
  const { isOnline, pendingCount, isSyncing, triggerSync, bumpPending } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!currentTrip || !currentBus) history.replace('/trip-setup');
    return () => { cleanupScanner(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function showNotification(message: string, color: 'success' | 'danger' | 'warning') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  async function cleanupScanner() {
    try {
      if (scannerRef.current && scannerRef.current.getState() === Html5QrcodeScannerState.SCANNING) {
        await scannerRef.current.clear();
      }
    } catch { /* ignore */ }
    scannerRef.current = null;
  }

  async function startScan() {
    setScanning(true);
    processingRef.current = false;
    
    // Wait for DOM to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const readerElement = document.getElementById('qr-reader');
    if (!readerElement) {
      console.error('QR reader element not found in DOM');
      showNotification('Camera element not found. Please try again.', 'danger');
      setScanning(false);
      return;
    }
    
    try {
      const scanner = new Html5QrcodeScanner(
        'qr-reader',
        {
          fps: 10,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
          showTorchButtonIfSupported: true,
        },
        false
      );
      scannerRef.current = scanner;
      scanner.render(
        async (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          await cleanupScanner();
          setScanning(false);
          await handleScanResult(decodedText);
        },
        () => {}
      );
      showNotification('Camera started — point at QR code', 'success');
    } catch (err) {
      console.error('Camera error:', err);
      showNotification('Failed to start camera. Check permissions.', 'danger');
      setScanning(false);
    }
  }

  async function stopScan() {
    await cleanupScanner();
    setScanning(false);
  }

  function toggleTorch() {
    const torchBtn = document.querySelector('#qr-reader__dashboard_section_csr button') as HTMLButtonElement;
    if (torchBtn) { torchBtn.click(); setTorchOn(!torchOn); }
  }

  async function handleScanResult(scannedCode: string) {
    if (!currentTrip || !profile) return;

    if (!isOnline) {
      OfflineStorage.addOfflineScan(scannedCode, currentTrip.id, profile.id, currentBus?.route);
      bumpPending();
      showNotification('Offline — scan queued for sync', 'warning');
      processingRef.current = false;
      return;
    }

    showNotification('Processing…', 'warning');

    try {
      const result = await processScan(scannedCode, currentTrip.id, profile.id, currentBus?.route);
      const info = interpretResult(result);
      setRawResult(result);
      setInterpreted(info);
      setShowResult(true);

      if (info.success) {
        setValidatedCount(validatedCount + 1);
        if (info.amount > 0) setFareCollected(fareCollected + info.amount);
        showNotification(info.message, 'success');
      } else {
        showNotification(info.message, info.warning ? 'warning' : 'danger');
      }
    } catch {
      showNotification('Scan processing failed', 'danger');
    }
  }

  function closeResultModal() {
    setShowResult(false);
    setRawResult(null);
    setInterpreted(null);
    processingRef.current = false;
  }

  function getPassengerDetails() {
    if (!rawResult || !interpreted) return null;
    const timestamp = new Date().toLocaleString();

    if (rawResult.status === 'qr_pass') {
      return {
        passengerName: rawResult.ownerName,
        remainingBalance: rawResult.newBalance,
        fareDeducted: rawResult.fare,
        currentTrip: currentBus?.route,
        timestamp,
      };
    }
    if (rawResult.status === 'qr_fail_balance') {
      return {
        passengerName: rawResult.ownerName,
        remainingBalance: rawResult.balance,
        fareDeducted: rawResult.fare,
        currentTrip: currentBus?.route,
        timestamp,
      };
    }
    if ('ownerName' in rawResult && rawResult.ownerName) {
      return { passengerName: rawResult.ownerName, currentTrip: currentBus?.route, timestamp };
    }
    return { currentTrip: currentBus?.route, timestamp };
  }

  const details = getPassengerDetails();

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => { stopScan(); history.push('/live-trip'); }}
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
          {!scanning ? (
            <>
              {/* Scanner Hero */}
              <div className={`scanner-hero ${!isOnline ? 'scanner-hero--offline' : ''}`}>
                <div className="scanner-hero__glow" />
                <div className="scanner-hero__content">
                  <div className="scanner-frame">
                    <div className="scanner-frame__corners">
                      <div className="scanner-frame__corner scanner-frame__corner--tl" />
                      <div className="scanner-frame__corner scanner-frame__corner--tr" />
                      <div className="scanner-frame__corner scanner-frame__corner--bl" />
                      <div className="scanner-frame__corner scanner-frame__corner--br" />
                    </div>
                    <div className="scanner-frame__line" />
                    <motion.div
                      style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <ScanLine size={64} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                    </motion.div>
                  </div>
                  <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                    {isOnline ? 'QR Code Scanner' : 'Offline Scanner'}
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                    {isOnline ? 'Scan passenger QR cards or tickets' : `Scans sync when online${pendingCount > 0 ? ` (${pendingCount} queued)` : ''}`}
                  </p>
                </div>
              </div>

              <PrimaryButton onClick={startScan} fullWidth icon={<ScanLine size={22} />} style={{ marginBottom: 20 }}>
                Start Scanning
              </PrimaryButton>

              <div className="dashboard-grid" style={{ marginBottom: 20 }}>
                <DashboardCard label="Validated" value={validatedCount} icon={CheckCircle} iconBg="var(--color-success-subtle)" iconColor="var(--color-success)" />
                <DashboardCard label="Collected" value={`₱${fareCollected.toFixed(0)}`} icon={Wallet} iconBg="var(--color-primary-subtle)" iconColor="var(--color-primary)" />
              </div>

              {pendingCount > 0 && (
                <SoftCard
                  style={{
                    marginBottom: 20, cursor: isOnline ? 'pointer' : 'default',
                    background: isOnline ? 'var(--color-warning-subtle)' : 'var(--color-danger-subtle)',
                  }}
                  onClick={isOnline ? () => triggerSync() : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <RefreshCw size={20} color={isOnline ? '#A16207' : 'var(--color-danger)'} className={isSyncing ? 'primary-btn__spinner' : ''} />
                      <div>
                        <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: '0.9rem' }}>
                          {pendingCount} scan{pendingCount !== 1 ? 's' : ''} pending sync
                        </p>
                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          {isOnline ? 'Tap to sync now' : 'Will sync when online'}
                        </p>
                      </div>
                    </div>
                    {isSyncing && <StatusBadge variant="primary">Syncing</StatusBadge>}
                  </div>
                </SoftCard>
              )}

              <SoftCard style={{ background: 'var(--color-primary-subtle)' }}>
                <h4 className="heading-small" style={{ marginBottom: 12 }}>How to Scan</h4>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.8 }}>
                  <li>Position QR code within the camera frame</li>
                  <li>Keep camera steady and ensure good lighting</li>
                  <li>Scans are saved locally when offline</li>
                </ul>
              </SoftCard>
            </>
          ) : (
            <>
              <SoftCard style={{ marginBottom: 16, textAlign: 'center' }}>
                <p className="heading-small" style={{ marginBottom: 4 }}>
                  Camera Active {!isOnline && '(Offline)'}
                </p>
                <p className="text-secondary" style={{ margin: 0 }}>
                  {isOnline ? 'Position QR code in the camera view' : 'Scans saved locally for later sync'}
                </p>
              </SoftCard>

              <div className="scanner-active-view">
                <div id="qr-reader" />
              </div>

              <div className="scanner-controls">
                <button type="button" className={`scanner-control-btn ${torchOn ? 'scanner-control-btn--active' : ''}`} onClick={toggleTorch} aria-label="Toggle flashlight">
                  <Flashlight size={22} />
                </button>
                <button type="button" className="scanner-control-btn" onClick={() => { stopScan(); startScan(); }} aria-label="Switch camera">
                  <SwitchCamera size={22} />
                </button>
              </div>

              <PrimaryButton onClick={stopScan} variant="danger" fullWidth style={{ marginTop: 16 }}>
                Stop Scanner
              </PrimaryButton>
            </>
          )}
        </div>
      </IonContent>

      <AnimatedModal isOpen={showResult} onClose={closeResultModal} showClose={false}>
        {interpreted && (
          <>
            <PassengerDetailsCard
              success={interpreted.success}
              warning={interpreted.warning}
              message={interpreted.message}
              passengerName={details?.passengerName}
              remainingBalance={details?.remainingBalance}
              fareDeducted={interpreted.amount > 0 ? interpreted.amount : details?.fareDeducted}
              currentTrip={details?.currentTrip}
              timestamp={details?.timestamp}
            />
            <PrimaryButton onClick={closeResultModal} fullWidth style={{ marginTop: 20 }}>
              Continue Scanning
            </PrimaryButton>
          </>
        )}
      </AnimatedModal>

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
