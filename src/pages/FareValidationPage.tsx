import React, { useState, useRef } from 'react';
import { IonPage, IonContent, IonInput } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, Wallet, CreditCard, AlertCircle, CheckCircle, ArrowRight,
} from 'lucide-react';
import { useOffline } from '../context/OfflineContext';
import { getQRCardByUID } from '../utils/fareValidationApi';
import type { QRCard, PassengerType } from '../types/fareValidation';
import { Html5Qrcode } from 'html5-qrcode';
import { stripQrShadedRegion } from '../utils/qrScannerUi';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton, AnimatedModal,
  AppToast, StatusBadge,
} from '../components/ui';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPassengerTypeLabel(type: PassengerType): string {
  switch (type) {
    case 'student': return 'Student';
    case 'senior_citizen': return 'Senior Citizen';
    case 'pwd': return 'PWD';
    case 'regular': return 'Regular';
    default: return 'Regular';
  }
}

function getDiscountRate(type: PassengerType): number {
  return type === 'regular' ? 0 : 0.20;
}

// ── Component ─────────────────────────────────────────────────────────────────

const FareValidationPage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [scannedCard, setScannedCard] = useState<QRCard | null>(null);
  const [manualCardId, setManualCardId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

  const { isOnline } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const stripShadedRegionRef = useRef<(() => void) | null>(null);

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

  async function startScan() {
    if (!isOnline) {
      showNotification('Card lookup requires internet connection', 'danger');
      return;
    }

    setScanning(true);
    processingRef.current = false;

    await new Promise(resolve => setTimeout(resolve, 100));

    const readerElement = document.getElementById('qr-reader-fare');
    if (!readerElement) {
      showNotification('Camera element not found. Please try again.', 'danger');
      setScanning(false);
      return;
    }

    try {
      // Clear any existing scanner first
      await cleanupScanner();

      const qrCode = new Html5Qrcode('qr-reader-fare');
      scannerRef.current = qrCode;

      // Omit qrbox — prevents html5-qrcode white corner injection; app overlay handles UI.
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
          await cleanupScanner();
          setScanning(false);
          await handleCardScan(decodedText);
        },
        (errorMessage: string) => {
          // Silently ignore scan errors
        }
      );
      stripShadedRegionRef.current = stripQrShadedRegion('qr-reader-fare');
      showNotification('Camera started — scan passenger QR card', 'success');
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

  async function handleCardScan(cardUID: string) {
    setLoading(true);
    try {
      const card = await getQRCardByUID(cardUID);
      if (!card) {
        showNotification('QR card not found', 'danger');
        return;
      }
      if (card.status !== 'active') {
        showNotification(`Card is ${card.status}`, 'danger');
        return;
      }
      setScannedCard(card);
      setShowCardModal(true);
      showNotification('Card found', 'success');
    } catch (error) {
      console.error('Error scanning card:', error);
      showNotification('Error processing card', 'danger');
    } finally {
      setLoading(false);
      processingRef.current = false;
    }
  }

  async function handleManualCardLookup() {
    if (!manualCardId.trim()) {
      showNotification('Please enter a card ID', 'warning');
      return;
    }
    setLoading(true);
    try {
      const card = await getQRCardByUID(manualCardId.trim());
      if (!card) {
        showNotification('QR card not found', 'danger');
        return;
      }
      if (card.status !== 'active') {
        showNotification(`Card is ${card.status}`, 'danger');
        return;
      }
      setScannedCard(card);
      setShowCardModal(true);
      showNotification('Card found', 'success');
    } catch (error) {
      console.error('Error looking up card:', error);
      showNotification('Error processing card', 'danger');
    } finally {
      setLoading(false);
    }
  }

  function closeCardModal() {
    setShowCardModal(false);
    setScannedCard(null);
    setManualCardId('');
    setShowManualInput(false);
  }

  const discount = scannedCard ? getDiscountRate(scannedCard.passenger_type) : 0;

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => history.push('/live-trip')}
        title="Card Balance Checker"
        subtitle="Look up passenger card info"
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <div className="scanner-page">

          {/* ── Redirect tip ───────────────────────────────────────────── */}
          <SoftCard style={{ marginBottom: 20, background: 'var(--color-primary-subtle)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <CheckCircle size={18} color="var(--color-primary)" style={{ marginTop: 2, flexShrink: 0 }} />
              <div>
                <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-primary)' }}>
                  Fare collection happens during scanning
                </p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Use the QR Scanner to board/alight passengers and collect fares. This page checks card balance and passenger type only.
                </p>
              </div>
            </div>
          </SoftCard>

          {!scanning ? (
            <>
              {/* Hero */}
              <div className="scanner-hero">
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
                      style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <CreditCard size={64} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                    </motion.div>
                  </div>
                  <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                    Card Balance Checker
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                    Scan a QR card to view balance and passenger type
                  </p>
                </div>
              </div>

              <PrimaryButton
                onClick={startScan}
                fullWidth
                icon={<ScanLine size={22} />}
                style={{ marginBottom: 16 }}
                disabled={!isOnline}
              >
                Scan QR Card
              </PrimaryButton>

              <PrimaryButton
                onClick={() => setShowManualInput(!showManualInput)}
                variant="secondary"
                fullWidth
                style={{ marginBottom: 20 }}
              >
                {showManualInput ? 'Cancel Manual Entry' : 'Enter Card ID Manually'}
              </PrimaryButton>

              {showManualInput && (
                <SoftCard style={{ marginBottom: 20 }}>
                  <h4 className="heading-small" style={{ marginBottom: 12 }}>Manual Card Entry</h4>
                  <IonInput
                    value={manualCardId}
                    onIonInput={(e) => setManualCardId(e.detail.value || '')}
                    placeholder="Enter Card UID"
                    style={{ marginBottom: 12 }}
                  />
                  <PrimaryButton
                    onClick={handleManualCardLookup}
                    fullWidth
                    disabled={loading || !manualCardId.trim()}
                  >
                    Look Up Card
                  </PrimaryButton>
                </SoftCard>
              )}
            </>
          ) : (
            <>
              <SoftCard style={{ marginBottom: 16, textAlign: 'center' }}>
                <p className="heading-small" style={{ marginBottom: 4 }}>Camera Active</p>
                <p className="text-secondary" style={{ margin: 0 }}>Position QR code in the camera view</p>
              </SoftCard>

              <div className="scanner-active-card">
                <div className="scanner-viewport">
                  <div id="qr-reader-fare" />
                </div>
              </div>

              <PrimaryButton onClick={stopScan} variant="danger" fullWidth style={{ marginTop: 16 }}>
                Stop Scanner
              </PrimaryButton>
            </>
          )}
        </div>
      </IonContent>

      {/* ── Card Info Modal ─────────────────────────────────────────────── */}
      <AnimatedModal isOpen={showCardModal} onClose={closeCardModal} showClose={true}>
        {scannedCard && (
          <div style={{ padding: '8px 0' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: 'var(--color-primary-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CreditCard size={24} color="var(--color-primary)" />
              </div>
              <div>
                <StatusBadge
                  variant={scannedCard.passenger_type === 'regular' ? 'neutral' : 'primary'}
                  style={{ fontSize: '0.8rem', marginBottom: 4 }}
                >
                  {getPassengerTypeLabel(scannedCard.passenger_type)}
                </StatusBadge>
                {discount > 0 && (
                  <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--color-success)', fontWeight: 700 }}>
                    {(discount * 100).toFixed(0)}% Discount Eligible
                  </p>
                )}
              </div>
            </div>

            {/* Balance */}
            <SoftCard style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wallet size={20} color="var(--text-secondary)" />
                  <span className="heading-small">Card Balance</span>
                </div>
                <span style={{
                  fontSize: '1.6rem', fontWeight: 800,
                  color: scannedCard.balance > 50 ? 'var(--color-success)' : scannedCard.balance > 20 ? '#A16207' : 'var(--color-danger)',
                }}>
                  ₱{scannedCard.balance.toFixed(2)}
                </span>
              </div>
              {scannedCard.balance <= 20 && (
                <div style={{
                  marginTop: 10, padding: '8px 12px', borderRadius: 8,
                  background: scannedCard.balance <= 0 ? 'var(--color-danger-subtle)' : 'var(--color-warning-subtle)',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <AlertCircle size={15} color={scannedCard.balance <= 0 ? 'var(--color-danger)' : '#A16207'} />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, color: scannedCard.balance <= 0 ? 'var(--color-danger)' : '#A16207' }}>
                    {scannedCard.balance <= 0 ? 'No balance — cannot board' : 'Low balance'}
                  </span>
                </div>
              )}
            </SoftCard>

            {/* Destination */}
            {scannedCard.destination && (
              <SoftCard style={{ marginBottom: 14, background: 'var(--color-primary-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <ArrowRight size={18} color="var(--color-primary)" />
                  <span className="heading-small">Registered Destination</span>
                </div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--color-primary)' }}>
                  {scannedCard.destination}
                </p>
              </SoftCard>
            )}

            {/* Passenger type & status */}
            <SoftCard style={{ marginBottom: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TYPE</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>{getPassengerTypeLabel(scannedCard.passenger_type)}</p>
                </div>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>STATUS</p>
                  <StatusBadge variant={scannedCard.status === 'active' ? 'success' : 'danger'}>
                    {scannedCard.status}
                  </StatusBadge>
                </div>
              </div>
            </SoftCard>

            <PrimaryButton onClick={closeCardModal} fullWidth>
              Done
            </PrimaryButton>
          </div>
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

export default FareValidationPage;
