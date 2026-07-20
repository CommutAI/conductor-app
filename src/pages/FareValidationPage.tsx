import React, { useState, useEffect, useRef } from 'react';
import { IonPage, IonContent, IonSelect, IonSelectOption, IonInput } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ScanLine, CheckCircle, Wallet, MapPin, User, Ticket,
  AlertCircle, ArrowRight, X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { useOffline } from '../context/OfflineContext';
import {
  validateFare,
  getQRCardByUID,
  getRoutesByTerminal,
  getPassengerDestination
} from '../utils/fareValidationApi';
import type {
  ValidateFareRequest,
  ValidateFareResponse,
  Route,
  QRCard,
  PassengerType
} from '../types/fareValidation';
import { Html5QrcodeScanner, Html5QrcodeScannerState } from 'html5-qrcode';
import OfflineBanner from '../components/OfflineBanner';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, PrimaryButton, DashboardCard, AnimatedModal,
  AppToast, StatusBadge
} from '../components/ui';

const FareValidationPage: React.FC = () => {
  const [scanning, setScanning] = useState(false);
  const [selectedTerminal, setSelectedTerminal] = useState('Manolo Fortich Terminal');
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [scannedCard, setScannedCard] = useState<QRCard | null>(null);
  const [validationResult, setValidationResult] = useState<ValidateFareResponse | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [showResultModal, setShowResultModal] = useState(false);
  const [manualCardId, setManualCardId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

  const { profile } = useAuth();
  const { currentTrip } = useTrip();
  const { isOnline } = useOffline();
  const history = useHistory();
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    loadRoutes();
    return () => { cleanupScanner(); };
  }, [selectedTerminal]);

  async function loadRoutes() {
    const routesData = await getRoutesByTerminal(selectedTerminal);
    setRoutes(routesData);
    setSelectedRoute(null);
  }

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
    if (!isOnline) {
      showNotification('Fare validation requires internet connection', 'danger');
      return;
    }

    setScanning(true);
    processingRef.current = false;
    
    // Wait for DOM to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const readerElement = document.getElementById('qr-reader-fare');
    if (!readerElement) {
      console.error('QR reader element not found in DOM');
      showNotification('Camera element not found. Please try again.', 'danger');
      setScanning(false);
      return;
    }
    
    try {
      const scanner = new Html5QrcodeScanner(
        'qr-reader-fare',
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
        setLoading(false);
        return;
      }

      if (card.status !== 'active') {
        showNotification(`Card is ${card.status}`, 'danger');
        setLoading(false);
        return;
      }

      setScannedCard(card);
      
      // Get passenger destination info
      const destInfo = await getPassengerDestination(card.id);
      if (destInfo && destInfo.destination && destInfo.destination !== 'Not set') {
        // Find matching route
        const matchingRoute = routes.find(r => r.destination === destInfo.destination);
        if (matchingRoute) {
          setSelectedRoute(matchingRoute);
        }
      }

      setShowValidationModal(true);
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
      setShowValidationModal(true);
      showNotification('Card found successfully', 'success');
    } catch (error) {
      console.error('Error looking up card:', error);
      showNotification('Error processing card', 'danger');
    } finally {
      setLoading(false);
    }
  }

  async function confirmValidation() {
    if (!scannedCard || !selectedRoute || !profile) {
      showNotification('Missing required information', 'danger');
      return;
    }

    setLoading(true);
    try {
      const request: ValidateFareRequest = {
        cardId: scannedCard.id,
        terminal: selectedTerminal,
        conductorId: profile.id
      };

      const result = await validateFare(request);
      setValidationResult(result);
      setShowValidationModal(false);
      setShowResultModal(true);

      if (result.success) {
        showNotification('Fare validated successfully', 'success');
      } else {
        showNotification(result.error || 'Validation failed', 'danger');
      }
    } catch (error) {
      console.error('Error validating fare:', error);
      showNotification('Error validating fare', 'danger');
    } finally {
      setLoading(false);
    }
  }

  function closeValidationModal() {
    setShowValidationModal(false);
    setScannedCard(null);
    setSelectedRoute(null);
    setManualCardId('');
  }

  function closeResultModal() {
    setShowResultModal(false);
    setValidationResult(null);
    setScannedCard(null);
    setSelectedRoute(null);
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

  function getPassengerTypeColor(type: PassengerType): string {
    switch (type) {
      case 'student': return 'var(--color-primary)';
      case 'senior_citizen': return 'var(--color-warning)';
      case 'pwd': return 'var(--color-success)';
      case 'regular': return 'var(--text-secondary)';
      default: return 'var(--text-secondary)';
    }
  }

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => history.push('/live-trip')}
        title="Fare Validation"
        subtitle="Validate passenger fares"
      />
      <OfflineBanner />

      <IonContent className="app-page-bg">
        <div className="scanner-page">
          {/* Terminal Selection */}
          <SoftCard style={{ marginBottom: 20 }}>
            <h4 className="heading-small" style={{ marginBottom: 12 }}>Select Terminal</h4>
            <IonSelect
              value={selectedTerminal}
              onIonChange={(e: CustomEvent<{ value: string }>) => setSelectedTerminal(e.detail.value)}
              interface="popover"
            >
              <IonSelectOption value="Manolo Fortich Terminal">Manolo Fortich Terminal</IonSelectOption>
            </IonSelect>
          </SoftCard>

          {/* Route Selection */}
          {routes.length > 0 && (
            <SoftCard style={{ marginBottom: 20 }}>
              <h4 className="heading-small" style={{ marginBottom: 12 }}>Select Destination</h4>
              <IonSelect
                value={selectedRoute?.id}
                placeholder="Choose destination"
                onIonChange={(e: CustomEvent<{ value: string }>) => {
                  const route = routes.find(r => r.id === e.detail.value);
                  setSelectedRoute(route || null);
                }}
                interface="popover"
              >
                {routes.map(route => (
                  <IonSelectOption key={route.id} value={route.id}>
                    {route.destination} - ₱{route.fare.toFixed(2)}
                  </IonSelectOption>
                ))}
              </IonSelect>
            </SoftCard>
          )}

          {!scanning ? (
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
                      <Ticket size={64} color="rgba(255,255,255,0.9)" strokeWidth={1.5} />
                    </motion.div>
                  </div>
                  <h2 style={{ color: 'white', fontSize: '1.4rem', fontWeight: 800, margin: '0 0 8px', textAlign: 'center' }}>
                    Fare Validation
                  </h2>
                  <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem', margin: 0, textAlign: 'center', fontWeight: 500 }}>
                    Scan passenger QR card to validate fare
                  </p>
                </div>
              </div>

              <PrimaryButton 
                onClick={startScan} 
                fullWidth 
                icon={<ScanLine size={22} />} 
                style={{ marginBottom: 16 }}
                disabled={!selectedRoute}
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
                  <li>Select your current terminal</li>
                  <li>Choose the passenger's destination</li>
                  <li>Scan the passenger's QR card</li>
                  <li>Review fare calculation with discounts</li>
                  <li>Confirm to deduct fare from card balance</li>
                </ul>
              </SoftCard>
            </>
          ) : (
            <>
              <SoftCard style={{ marginBottom: 16, textAlign: 'center' }}>
                <p className="heading-small" style={{ marginBottom: 4 }}>
                  Camera Active
                </p>
                <p className="text-secondary" style={{ margin: 0 }}>
                  Position QR code in the camera view
                </p>
              </SoftCard>

              <div className="scanner-active-view">
                <div id="qr-reader-fare" />
              </div>

              <PrimaryButton onClick={stopScan} variant="danger" fullWidth style={{ marginTop: 16 }}>
                Stop Scanner
              </PrimaryButton>
            </>
          )}
        </div>
      </IonContent>

      {/* Validation Confirmation Modal */}
      <AnimatedModal isOpen={showValidationModal} onClose={closeValidationModal} showClose={true}>
        {scannedCard && selectedRoute && (
          <div style={{ padding: '20px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--color-primary-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <User size={24} color="var(--color-primary)" />
              </div>
              <div>
                <h3 className="heading-small" style={{ margin: '0 0 4px' }}>{scannedCard.owner_name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <StatusBadge 
                    variant={scannedCard.passenger_type === 'regular' ? 'neutral' : 'primary'}
                    style={{ fontSize: '0.75rem' }}
                  >
                    {getPassengerTypeLabel(scannedCard.passenger_type)}
                  </StatusBadge>
                  {scannedCard.passenger_type !== 'regular' && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-success)', fontWeight: 600 }}>
                      20% Discount Applied
                    </span>
                  )}
                </div>
              </div>
            </div>

            <SoftCard style={{ marginBottom: 16, background: 'var(--color-primary-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <MapPin size={18} color="var(--color-primary)" />
                <span className="heading-small">Route Information</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>From</p>
                  <p style={{ margin: 0, fontWeight: 600 }}>{selectedTerminal}</p>
                </div>
                <ArrowRight size={20} color="var(--text-secondary)" />
                <div style={{ textAlign: 'right' }}>
                  <p style={{ margin: '0 0 4px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>To</p>
                  <p style={{ margin: 0, fontWeight: 600 }}>{selectedRoute.destination}</p>
                </div>
              </div>
            </SoftCard>

            <SoftCard style={{ marginBottom: 16 }}>
              <h4 className="heading-small" style={{ marginBottom: 12 }}>Fare Breakdown</h4>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ color: 'var(--text-secondary)' }}>Base Fare</span>
                <span style={{ fontWeight: 600 }}>₱{selectedRoute.fare.toFixed(2)}</span>
              </div>
              {scannedCard.passenger_type !== 'regular' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Discount (20%)</span>
                  <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>-₱{(selectedRoute.fare * 0.20).toFixed(2)}</span>
                </div>
              )}
              <div style={{ 
                display: 'flex', justifyContent: 'space-between', 
                paddingTop: 12, borderTop: '1px solid var(--border-color)',
                fontSize: '1.1rem', fontWeight: 700
              }}>
                <span>Final Fare</span>
                <span style={{ color: 'var(--color-primary)' }}>
                  ₱{(selectedRoute.fare * (scannedCard.passenger_type === 'regular' ? 1 : 0.8)).toFixed(2)}
                </span>
              </div>
            </SoftCard>

            <SoftCard style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wallet size={20} color="var(--text-secondary)" />
                  <span className="heading-small">Card Balance</span>
                </div>
                <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-success)' }}>
                  ₱{scannedCard.balance.toFixed(2)}
                </span>
              </div>
            </SoftCard>

            <PrimaryButton
              onClick={confirmValidation}
              fullWidth
              disabled={loading || scannedCard.balance < (selectedRoute.fare * (scannedCard.passenger_type === 'regular' ? 1 : 0.8))}
            >
              {loading ? 'Processing...' : 'Confirm Fare Deduction'}
            </PrimaryButton>

            {scannedCard.balance < (selectedRoute.fare * (scannedCard.passenger_type === 'regular' ? 1 : 0.8)) && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: 'var(--color-danger-subtle)',
                display: 'flex', alignItems: 'center', gap: 8
              }}>
                <AlertCircle size={18} color="var(--color-danger)" />
                <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)', fontWeight: 600 }}>
                  Insufficient balance
                </span>
              </div>
            )}
          </div>
        )}
      </AnimatedModal>

      {/* Result Modal */}
      <AnimatedModal isOpen={showResultModal} onClose={closeResultModal} showClose={false}>
        {validationResult && (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: validationResult.success ? 'var(--color-success-subtle)' : 'var(--color-danger-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px'
            }}>
              {validationResult.success ? (
                <CheckCircle size={40} color="var(--color-success)" />
              ) : (
                <AlertCircle size={40} color="var(--color-danger)" />
              )}
            </div>

            <h2 className="heading-small" style={{ fontSize: '1.5rem', marginBottom: 8 }}>
              {validationResult.success ? 'Fare Validated!' : 'Validation Failed'}
            </h2>

            {validationResult.success ? (
              <>
                <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
                  {validationResult.passengerName}'s fare has been deducted
                </p>

                <SoftCard style={{ marginBottom: 16, textAlign: 'left' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Passenger</span>
                    <span style={{ fontWeight: 600 }}>{validationResult.passengerName}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Destination</span>
                    <span style={{ fontWeight: 600 }}>{validationResult.destination}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Base Fare</span>
                    <span style={{ fontWeight: 600 }}>₱{validationResult.fare.toFixed(2)}</span>
                  </div>
                  {validationResult.discount > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Discount</span>
                      <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>-₱{validationResult.discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ 
                    display: 'flex', justifyContent: 'space-between', 
                    paddingTop: 12, borderTop: '1px solid var(--border-color)',
                    fontWeight: 700
                  }}>
                    <span>Final Fare</span>
                    <span style={{ color: 'var(--color-primary)' }}>₱{validationResult.finalFare.toFixed(2)}</span>
                  </div>
                </SoftCard>

                <SoftCard style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Wallet size={20} color="var(--text-secondary)" />
                      <span className="heading-small">Balance</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>₱{validationResult.balanceBefore.toFixed(2)} → </span>
                      <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-success)' }}>
                        ₱{validationResult.balanceAfter.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </SoftCard>
              </>
            ) : (
              <p style={{ color: 'var(--color-danger)', marginBottom: 20 }}>
                {validationResult.error}
              </p>
            )}

            <PrimaryButton onClick={closeResultModal} fullWidth>
              {validationResult.success ? 'Validate Another' : 'Try Again'}
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
