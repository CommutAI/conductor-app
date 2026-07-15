import React, { useState, useEffect } from 'react';
import { IonPage, IonContent } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CheckCircle, Wallet, Clock, AlertTriangle, Bus, User,
  Download, Share2, Home,
} from 'lucide-react';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import PageHeader from '../components/layout/PageHeader';
import BottomNav from '../components/layout/BottomNav';
import {
  SoftCard, PrimaryButton, DashboardCard, LoadingSkeleton,
  AppToast,
} from '../components/ui';

const CONFETTI_COLORS = ['#F97316', '#22C55E', '#3B82F6', '#FACC15', '#FB923C'];

const Confetti: React.FC = () => (
  <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
    {Array.from({ length: 24 }).map((_, i) => (
      <motion.div
        key={i}
        className="confetti-piece"
        style={{
          left: `${Math.random() * 100}%`,
          top: -10,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          width: 8 + Math.random() * 6,
          height: 8 + Math.random() * 6,
          animationDelay: `${Math.random() * 0.5}s`,
        }}
        initial={{ y: -20, opacity: 1 }}
        animate={{ y: 400, opacity: 0, rotate: 720 }}
        transition={{ duration: 2 + Math.random(), delay: Math.random() * 0.3 }}
      />
    ))}
  </div>
);

const TripSummaryPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [irregularities, setIrregularities] = useState<any[]>([]);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastColor, setToastColor] = useState<'success' | 'danger' | 'warning'>('success');

  const { currentTrip, currentBus, validatedCount, fareCollected, clearTrip } = useTrip();
  const { profile } = useAuth();
  const history = useHistory();

  useEffect(() => {
    if (!currentTrip || !currentBus) {
      history.replace('/trip-setup');
      return;
    }
    loadSummaryData();
  }, [currentTrip]);

  function showNotification(message: string, color: 'success' | 'danger' | 'warning') {
    setToastMessage(message);
    setToastColor(color);
    setShowToast(true);
  }

  async function loadSummaryData() {
    if (!currentTrip) return;
    try {
      const { data: irregData } = await supabase
        .from('fare_irregularities')
        .select('*')
        .eq('trip_id', currentTrip.id)
        .order('detected_at', { ascending: false });
      setIrregularities(irregData || []);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  function startNewTrip() {
    clearTrip();
    showNotification('Ready for new trip', 'success');
    history.replace('/trip-setup');
  }

  function exportSummary() { showNotification('Summary exported', 'success'); }
  function shareSummary() { showNotification('Summary shared', 'success'); }

  if (!currentTrip || !currentBus) return null;

  const tripDuration = currentTrip.ended_at
    ? Math.floor((new Date(currentTrip.ended_at).getTime() - new Date(currentTrip.started_at).getTime()) / (1000 * 60))
    : 0;
  const completionRate = currentBus.seat_capacity > 0 ? (validatedCount / currentBus.seat_capacity) * 100 : 0;

  return (
    <IonPage>
      <PageHeader title="Trip Summary" subtitle="Completed successfully" />

      <IonContent className="app-page-bg">
        {loading ? (
          <div className="page-content">
            <LoadingSkeleton variant="card" count={3} />
          </div>
        ) : (
          <div className="page-content">
            {/* Success Hero */}
            <div className="success-screen" style={{ marginBottom: 24, position: 'relative' }}>
              <Confetti />
              <motion.div
                className="success-screen__check"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.2 }}
              >
                <CheckCircle size={52} />
              </motion.div>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                style={{ margin: '0 0 8px', fontSize: '1.5rem', fontWeight: 800, color: 'white' }}
              >
                Trip Completed!
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                style={{ margin: 0, color: 'rgba(255,255,255,0.9)', fontWeight: 500 }}
              >
                {currentBus.plate_number} · {tripDuration}m duration
              </motion.p>
            </div>

            <div className="dashboard-grid" style={{ marginBottom: 24 }}>
              <DashboardCard label="Validated" value={validatedCount} icon={CheckCircle} iconBg="var(--color-success-subtle)" iconColor="var(--color-success)" delay={0.1} />
              <DashboardCard label="Revenue" value={`₱${fareCollected.toFixed(0)}`} icon={Wallet} iconBg="var(--color-primary-subtle)" iconColor="var(--color-primary)" delay={0.15} />
              <DashboardCard label="Duration" value={`${Math.floor(tripDuration / 60)}h ${tripDuration % 60}m`} icon={Clock} iconBg="var(--color-info-subtle)" iconColor="var(--color-info)" delay={0.2} />
              <DashboardCard label="Issues" value={irregularities.length} icon={AlertTriangle} iconBg={irregularities.length > 0 ? 'var(--color-warning-subtle)' : 'var(--bg-tertiary)'} iconColor={irregularities.length > 0 ? '#A16207' : 'var(--text-secondary)'} delay={0.25} />
            </div>

            <SoftCard style={{ marginBottom: 16 }}>
              <h3 className="heading-medium" style={{ marginBottom: 16 }}>Trip Details</h3>
              <div className="transport-list-item">
                <Bus size={20} color="var(--color-primary)" />
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{currentBus.plate_number}</p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{currentBus.route}</p>
                </div>
              </div>
              <div className="transport-list-item">
                <User size={20} color="var(--color-success)" />
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 700 }}>{profile?.full_name}</p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Conductor</p>
                </div>
              </div>
              <div style={{ background: 'var(--bg-tertiary)', borderRadius: 14, padding: 16, marginTop: 8 }}>
                {[
                  ['Started', new Date(currentTrip.started_at).toLocaleString()],
                  ['Completed', currentTrip.ended_at ? new Date(currentTrip.ended_at).toLocaleString() : 'N/A'],
                  ['Efficiency', `${completionRate.toFixed(1)}%`],
                ].map(([label, value]) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="text-secondary" style={{ fontWeight: 600, fontSize: '0.85rem' }}>{label}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{value}</span>
                  </div>
                ))}
              </div>
            </SoftCard>

            <SoftCard style={{ marginBottom: 24, background: 'var(--color-primary-subtle)', border: '1px solid rgba(249,115,22,0.2)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: '2rem' }}>
                  {irregularities.length === 0 ? '⭐' : completionRate > 80 ? '🌟' : '✓'}
                </span>
                <div>
                  <p style={{ margin: '0 0 2px', fontWeight: 800, color: 'var(--color-primary)' }}>
                    {irregularities.length === 0 ? 'Perfect Trip!' : completionRate > 80 ? 'Great Performance!' : 'Good Job!'}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {irregularities.length === 0 ? 'No irregularities detected' : `${validatedCount} tickets processed`}
                  </p>
                </div>
              </div>
              <div className="progress-bar">
                <motion.div
                  className="progress-fill"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(completionRate, 100)}%` }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                />
              </div>
            </SoftCard>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <SoftCard padding="sm" style={{ cursor: 'pointer', textAlign: 'center' }} onClick={exportSummary}>
                <Download size={24} color="var(--text-secondary)" style={{ margin: '0 auto 8px' }} />
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem' }}>Export</p>
              </SoftCard>
              <SoftCard padding="sm" style={{ cursor: 'pointer', textAlign: 'center' }} onClick={shareSummary}>
                <Share2 size={24} color="var(--text-secondary)" style={{ margin: '0 auto 8px' }} />
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem' }}>Share</p>
              </SoftCard>
            </div>

            <PrimaryButton onClick={startNewTrip} fullWidth icon={<Home size={22} />}>
              Start New Trip
            </PrimaryButton>

            <SoftCard padding="sm" style={{ marginTop: 24, textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Thank you for your service!
              </p>
            </SoftCard>
          </div>
        )}

        <BottomNav />
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

export default TripSummaryPage;
