import React, { useState, useEffect, useRef } from 'react';
import { IonPage, IonContent, IonInput } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, MapPin, Wallet, User, Ticket, ArrowRight,
  Clock, Ruler, History, CheckCircle, AlertCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useOffline } from '../context/OfflineContext';
import {
  getQRCardByUID,
  getPassengerDestination,
  getCardValidations
} from '../utils/fareValidationApi';
import type {
  QRCard,
  PassengerDestinationResponse,
  FareValidation,
  PassengerType
} from '../types/fareValidation';
import { Html5QrcodeScanner, Html5QrcodeScannerState } from 'html5-qrcode';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton, DashboardCard, AnimatedModal,
  AppToast, StatusBadge
} from '../components/ui';

const PassengerDestinationPage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [scannedCard, setScannedCard] = useState<QRCard | null>(null);
  const [destinationInfo, setDestinationInfo] = useState<PassengerDestinationResponse | null>(null);
  const [validationHistory, setValidationHistory] = useState<FareValidation[]>([]);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualCardId, setManualCardId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

  const { isOnline } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const processingRef = useRef(false);

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
    try {
      const scanner = new Html5QrcodeScanner(
        'qr-reader-dest',
        {
          fps: 10,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
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
          await handleCardScan(decodedText);
        },
        () => {}
      );
      showNotification('Camera started — scan your QR card', 'success');
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
        setLoading(false);
        return;
      }

      if (card.status !== 'active') {
        showNotification(`Card is ${card.status}`, 'danger');
        setLoading(false);
        return;
      }

      setScannedCard(card);
      await loadDestinationInfo(card.id);
      showNotification('Card scanned successfully', 'success');
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
        setLoading(false);
        return;
      }

      if (card.status !== 'active') {
        showNotification(`Card is ${card.status}`, 'danger');
        setLoading(false);
        return;
      }

      setScannedCard(card);
      await loadDestinationInfo(card.id);
      showNotification('Card found successfully', 'success');
    } catch (error) {
      console.error('Error looking up card:', error);
      showNotification('Error processing card', 'danger');
    } finally {
      setLoading(false);
    }
  }

  async function loadDestinationInfo(cardId: string) {
    try {
      const destInfo = await getPassengerDestination(cardId);
      setDestinationInfo(destInfo);

      // Load validation history
      const history = await getCardValidations(cardId, 10);
      setValidationHistory(history);
    } catch (error) {
      console.error('Error loading destination info:', error);
      showNotification('Error loading destination information', 'danger');
    }
  }

  function resetView() {
    setScannedCard(null);
    setDestinationInfo(null);
    setValidationHistory([]);
    setManualCardId('');
    setShowManualInput(false);
  }

  function getPassengerTypeLabel(type: PassengerType): string {
    switch (type) {
      case 'student': return 'Student';
      case 'senior_citizen': return 'Senior Citizen';
      case 'pwd': return 'PWD';
      case 'regular': return 'Regular';
      default: return 'Regular';
    }
  }

  function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => {
          stopScan();
          history.push('/live-trip');
        }}
        title="My Destination"
        subtitle="View your registered destination"
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <div className="scanner-page">
          {!scannedCard ? (
            <>
              {/* Scanner Hero */}
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
                      style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <MapPin size={64} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                    </motion.div>
                  </div>
                  <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                    View Your Destination
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                    Scan your QR card to see your destination and fare
                  </p>
                </div>
              </div>

              <PrimaryButton
                onClick={startScan}
                fullWidth
                icon={<ScanLine size={22} />}
                style={{ marginBottom: 16 }}
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

              <SoftCard style={{ background: 'var(--color-primary-subtle)' }}>
                <h4 className="heading-small" style={{ marginBottom: 12 }}>How It Works</h4>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.8 }}>
                  <li>Scan your QR card using the camera</li>
                  <li>View your registered destination</li>
                  <li>Check your current card balance</li>
                  <li>See your fare with applicable discounts</li>
                  <li>View recent transaction history</li>
                </ul>
              </SoftCard>
            </>
          ) : (
            <>
              {/* Destination Information */}
              {destinationInfo && (
                <>
                  <SoftCard style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                      <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: 'var(--color-primary-subtle)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                      }}>
                        <User size={28} color="var(--color-primary)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <h3 className="heading-small" style={{ fontSize: '1.2rem', margin: '0 0 4px' }}>
                          {destinationInfo.passengerName}
                        </h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <StatusBadge
                            variant={destinationInfo.passengerType === 'regular' ? 'neutral' : 'primary'}
                          >
                            {getPassengerTypeLabel(destinationInfo.passengerType)}
                          </StatusBadge>
                          {destinationInfo.passengerType !== 'regular' && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 600 }}>
                              20% Discount Applied
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <DashboardCard
                          label="Balance"
                          value={`₱${destinationInfo.balance.toFixed(2)}`}
                          icon={Wallet}
                          iconBg="var(--color-success-subtle)"
                          iconColor="var(--color-success)"
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <DashboardCard
                          label="Fare"
                          value={`₱${destinationInfo.fare.toFixed(2)}`}
                          icon={Ticket}
                          iconBg="var(--color-primary-subtle)"
                          iconColor="var(--color-primary)"
                        />
                      </div>
                    </div>
                  </SoftCard>

                  <SoftCard style={{ marginBottom: 20, background: 'var(--color-primary-subtle)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <MapPin size={20} color="var(--color-primary)" />
                      <span className="heading-small">Route Information</span>
                    </div>

                    {destinationInfo.route ? (
                      <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <div>
                            <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>From</p>
                            <p style={{ margin: 0, fontWeight: 600 }}>{destinationInfo.route.terminal}</p>
                          </div>
                          <ArrowRight size={20} color="var(--text-secondary)" />
                          <div style={{ textAlign: 'right' }}>
                            <p style={{ margin: '0 0 4px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>To</p>
                            <p style={{ margin: 0, fontWeight: 600 }}>{destinationInfo.route.destination}</p>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: 16, paddingTop: 12, borderTop: '1px solid rgba(0,0,0,0.1)' }}>
                          {destinationInfo.route.distance_km && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Ruler size={16} color="var(--text-secondary)" />
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                {destinationInfo.route.distance_km} km
                              </span>
                            </div>
                          )}
                          {destinationInfo.route.estimated_time_minutes && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <Clock size={16} color="var(--text-secondary)" />
                              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                {destinationInfo.route.estimated_time_minutes} min
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <AlertCircle size={32} color="var(--color-warning)" style={{ marginBottom: 8 }} />
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                          No route information available
                        </p>
                      </div>
                    )}
                  </SoftCard>

                  {/* Transaction History */}
                  {validationHistory.length > 0 && (
                    <SoftCard style={{ marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <History size={20} color="var(--text-secondary)" />
                          <span className="heading-small">Recent Transactions</span>
                        </div>
                        <StatusBadge variant="info">{validationHistory.length}</StatusBadge>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {validationHistory.slice(0, 5).map((validation) => (
                          <div
                            key={validation.id}
                            style={{
                              padding: 12, borderRadius: 8,
                              background: 'var(--color-neutral-subtle)',
                              display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}
                          >
                            <div>
                              <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: '0.9rem' }}>
                                ₱{validation.final_fare.toFixed(2)}
                              </p>
                              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {formatDate(validation.validated_at)}
                              </p>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                                <CheckCircle size={14} color="var(--color-success)" />
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-success)', fontWeight: 600 }}>
                                  Paid
                                </span>
                              </div>
                              {validation.discount > 0 && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                  -₱{validation.discount.toFixed(2)} discount
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </SoftCard>
                  )}

                  <PrimaryButton
                    onClick={resetView}
                    variant="secondary"
                    fullWidth
                  >
                    Scan Different Card
                  </PrimaryButton>
                </>
              )}
            </>
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

export default PassengerDestinationPage;
