import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/react';
import {
  Users, ArrowUp, ArrowDown, CreditCard, Ticket,
  Search, LogOut as AlightIcon, CheckCircle, Navigation,
  Smartphone, Banknote, Clock, MapPin, X, AlertTriangle
} from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useNetwork } from '../context/NetworkContext';
import { supabase } from '../supabaseClient';
import { alightBoardedPassenger } from '../services/fareService';
import { StorageService } from '../services/storageService';
import { offlineQueueService } from '../services/offlineQueueService';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, StatusBadge, LoadingSkeleton, EmptyState, DashboardCard, PrimaryButton
} from '../components/ui';
import AnimatedModal from '../components/ui/AnimatedModal';
import { motion, AnimatePresence } from 'framer-motion';

interface TripPassengerStats {
  totalBoarded: number;
  totalAlighted: number;
  currentOnboard: number;
  qrCardCount: number;
  ticketCount: number;
  fareCollectedTotal: number;
}

interface DestinationGroup {
  destination: string;
  count: number;
  alighted: number;
}

export interface BoardedPassengerItem {
  id: string;
  card_id?: string | null;
  temp_ticket_id?: string | null;
  boarded_at: string;
  alighted_at?: string | null;
  payment_method: string;
  boarding_stop?: string | null;
  destination_stop?: string | null;
  card_uid: string;
  passenger_type: string;
  owner_name?: string | null;
  fare_amount?: number;
}

function passengerTypeLabel(type: string): string {
  switch (type) {
    case 'student': return 'Student';
    case 'senior_citizen': return 'Senior Citizen';
    case 'pwd': return 'PWD';
    default: return 'Regular';
  }
}

function formatRelativeTime(dateString: string): string {
  try {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins === 1) return '1 min ago';
    if (diffMins < 60) return `${diffMins} mins ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours === 1) return '1 hr ago';
    return `${diffHours} hrs ago`;
  } catch {
    return '';
  }
}

const PassengerListPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'summary' | 'onboard'>('onboard');
  const [stats, setStats] = useState<TripPassengerStats | null>(null);
  const [destinationGroups, setDestinationGroups] = useState<DestinationGroup[]>([]);
  const [passengersList, setPassengersList] = useState<BoardedPassengerItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  // Manual alighting modal
  const [passengerToAlight, setPassengerToAlight] = useState<BoardedPassengerItem | null>(null);
  const [alightingInProgress, setAlightingInProgress] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const { currentTrip, currentBus, isRestoringTrip, decrementCurrentPassengers } = useApp();
  const { isOnline, bumpPending } = useNetwork();
  const history = useHistory();

  useEffect(() => {
    if (!currentTrip) {
      if (!isRestoringTrip) history.replace('/');
      return;
    }
    loadData();
  }, [currentTrip?.id]);

  async function loadData() {
    if (!currentTrip) return;
    setLoading(true);
    try {
      // Online: Fetch from database with relations
      if (isOnline) {
        const { data, error } = await supabase
          .from('boarded_passengers')
          .select(`
            id, card_id, temp_ticket_id, boarded_at, alighted_at, payment_method, boarding_stop, destination_stop,
            qr_cards(card_uid, passenger_type, destination, owner_name),
            temporary_tickets(ticket_uid, passenger_type, destination, fare_amount)
          `)
          .eq('trip_id', currentTrip.id)
          .order('boarded_at', { ascending: false });

        if (error) {
          console.error('[PassengerListPage] Error loading boarded passengers:', error);
          loadOfflineData();
          return;
        }

        if (data) {
          const items: BoardedPassengerItem[] = data.map((p: any) => {
            const card = p.qr_cards;
            const ticket = p.temporary_tickets;
            const cardUid = card?.card_uid || ticket?.ticket_uid || (p.card_id ? 'QR Card' : 'Ticket');
            const passengerType = card?.passenger_type || ticket?.passenger_type || 'regular';
            const destination = p.destination_stop || card?.destination || ticket?.destination || 'Open Stop';
            const ownerName = card?.owner_name || null;
            const fareAmount = ticket?.fare_amount || 0;

            return {
              id: p.id,
              card_id: p.card_id,
              temp_ticket_id: p.temp_ticket_id,
              boarded_at: p.boarded_at,
              alighted_at: p.alighted_at,
              payment_method: p.payment_method || 'qr_card',
              boarding_stop: p.boarding_stop,
              destination_stop: destination,
              card_uid: cardUid,
              passenger_type: passengerType,
              owner_name: ownerName,
              fare_amount: fareAmount,
            };
          });

          computeStatsAndDestinations(items);
          setPassengersList(items);
        }
      } else {
        loadOfflineData();
      }
    } catch (err) {
      console.error('[PassengerListPage] Exception loading passengers:', err);
      loadOfflineData();
    } finally {
      setLoading(false);
    }
  }

  function loadOfflineData() {
    if (!currentTrip) return;
    const cachedState = StorageService.loadTripState();
    const localPassengers = cachedState?.localPassengers || [];
    const items: BoardedPassengerItem[] = localPassengers.map(lp => ({
      id: lp.id,
      card_id: lp.cardId || null,
      temp_ticket_id: lp.tempTicketId || null,
      boarded_at: lp.boardedAt,
      alighted_at: lp.alightedAt || null,
      payment_method: lp.paymentMethod || 'qr_card',
      boarding_stop: lp.boardingStop,
      destination_stop: lp.destination,
      card_uid: lp.cardUid || lp.ticketUid || 'Offline Passenger',
      passenger_type: lp.passengerType || 'regular',
      owner_name: null,
      fare_amount: lp.fare,
    }));
    computeStatsAndDestinations(items);
    setPassengersList(items);
  }

  function computeStatsAndDestinations(items: BoardedPassengerItem[]) {
    const totalBoarded = items.length;
    const totalAlighted = items.filter(p => !!p.alighted_at).length;
    const currentOnboard = totalBoarded - totalAlighted;
    const qrCardCount = items.filter(p => !!p.card_id || p.payment_method === 'qr_card').length;
    const ticketCount = items.filter(p => !!p.temp_ticket_id || p.payment_method === 'ticket' || p.payment_method === 'cash').length;
    const fareCollectedTotal = items.reduce((sum, p) => sum + (p.fare_amount || 0), 0);

    setStats({
      totalBoarded,
      totalAlighted,
      currentOnboard,
      qrCardCount,
      ticketCount,
      fareCollectedTotal,
    });

    // Group all passengers by destination stop
    const destMap: Record<string, { count: number; alighted: number }> = {};
    for (const p of items) {
      const dest = p.destination_stop || 'Open Stop';
      if (!destMap[dest]) destMap[dest] = { count: 0, alighted: 0 };
      destMap[dest].count += 1;
      if (p.alighted_at) destMap[dest].alighted += 1;
    }

    const groups: DestinationGroup[] = Object.entries(destMap)
      .map(([destination, v]) => ({ destination, count: v.count, alighted: v.alighted }))
      .sort((a, b) => b.count - a.count);

    setDestinationGroups(groups);
  }

  async function handleConfirmManualAlighting() {
    if (!passengerToAlight || !currentTrip) return;
    setAlightingInProgress(true);
    try {
      if (isOnline) {
        const res = await alightBoardedPassenger(
          passengerToAlight.id,
          currentTrip.id,
          passengerToAlight.destination_stop || undefined
        );
        if (!res.success) {
          throw new Error(res.message || 'Failed to record alighting');
        }
      } else {
        // Offline alighting
        StorageService.markLocalAlighted(
          currentTrip.id,
          passengerToAlight.card_id ? passengerToAlight.card_uid : undefined,
          passengerToAlight.temp_ticket_id ? passengerToAlight.card_uid : undefined
        );
        offlineQueueService.addScan({
          type: 'alighting',
          cardUid: passengerToAlight.card_id ? passengerToAlight.card_uid : undefined,
          ticketUid: passengerToAlight.temp_ticket_id ? passengerToAlight.card_uid : undefined,
          cardId: passengerToAlight.card_id || undefined,
          tempTicketId: passengerToAlight.temp_ticket_id || undefined,
          tripId: currentTrip.id,
          destination: passengerToAlight.destination_stop || undefined,
          boardingPoint: passengerToAlight.boarding_stop || undefined,
        });
        bumpPending(offlineQueueService.getPendingCount());
      }

      decrementCurrentPassengers();

      // Update local items state
      setPassengersList(prev => prev.map(item => {
        if (item.id === passengerToAlight.id) {
          return { ...item, alighted_at: new Date().toISOString() };
        }
        return item;
      }));

      // Update stats count
      setStats(prev => prev ? {
        ...prev,
        totalAlighted: prev.totalAlighted + 1,
        currentOnboard: Math.max(0, prev.currentOnboard - 1),
      } : null);

      setToastMessage(`Passenger ${passengerToAlight.card_uid} alighted successfully`);
      setTimeout(() => setToastMessage(null), 3000);
      setPassengerToAlight(null);
    } catch (err: any) {
      console.error('[PassengerListPage] Manual alighting error:', err);
      alert(`Error alighting passenger: ${err?.message || 'Unknown error'}`);
    } finally {
      setAlightingInProgress(false);
    }
  }

  async function handleRefresh(event: CustomEvent) {
    await loadData();
    (event.target as HTMLIonRefresherElement).complete();
  }

  // Filter passengers currently on board
  const onboardPassengers = passengersList.filter(p => !p.alighted_at);
  const filteredOnboard = onboardPassengers.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      p.card_uid.toLowerCase().includes(q) ||
      (p.destination_stop && p.destination_stop.toLowerCase().includes(q)) ||
      (p.boarding_stop && p.boarding_stop.toLowerCase().includes(q)) ||
      p.passenger_type.toLowerCase().includes(q) ||
      p.payment_method.toLowerCase().includes(q)
    );
  });

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => history.push('/')}
        title="Passenger Manifest"
        subtitle={currentBus?.plate_number}
        statusBadge={stats ? { label: `${stats.currentOnboard} on board`, variant: 'primary' } : undefined}
      />

      <IonContent className="app-page-bg">
        <div className="page-content page-content--no-nav">
          <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
            <IonRefresherContent />
          </IonRefresher>

          {/* Success Toast */}
          <AnimatePresence>
            {toastMessage && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                style={{
                  position: 'fixed',
                  top: 70,
                  left: 16,
                  right: 16,
                  zIndex: 9999,
                  background: 'linear-gradient(135deg, #16A34A, #15803D)',
                  color: '#ffffff',
                  padding: '12px 16px',
                  borderRadius: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: '0 8px 24px rgba(22, 163, 74, 0.4)',
                }}
              >
                <CheckCircle size={20} color="#ffffff" />
                <span style={{ fontSize: '0.86rem', fontWeight: 700 }}>{toastMessage}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <LoadingSkeleton variant="list" count={4} />
          ) : !stats ? (
            <EmptyState
              title="No Data"
              description="No passenger data available for this trip"
              icon={Users}
            />
          ) : (
            <>
              {/* ── Main Capacity Card ──────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ marginBottom: 16 }}
              >
                <SoftCard variant="hero" style={{ textAlign: 'center', padding: '22px 18px', marginBottom: 12 }}>
                  <p style={{ margin: '0 0 2px', color: 'rgba(255,255,255,0.8)', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Currently On Board
                  </p>
                  <p style={{ margin: 0, fontSize: '3.2rem', fontWeight: 900, color: 'white', lineHeight: 1.1 }}>
                    {stats.currentOnboard}
                  </p>
                  <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.75)', fontSize: '0.82rem' }}>
                    of {currentBus?.seat_capacity || '?'} seats capacity ({stats.totalBoarded} total boarded)
                  </p>
                </SoftCard>
              </motion.div>

              {/* ── Segmented Navigation Tabs ───────────────────────────── */}
              <div style={{
                display: 'flex',
                background: 'var(--bg-tertiary)',
                borderRadius: 14,
                padding: 4,
                marginBottom: 16,
                border: '1px solid var(--glass-border)',
                boxShadow: 'var(--shadow-xs)',
              }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('onboard')}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: activeTab === 'onboard' ? 'var(--color-primary)' : 'transparent',
                    color: activeTab === 'onboard' ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Users size={16} />
                  Onboard ({stats.currentOnboard})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('summary')}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: activeTab === 'summary' ? 'var(--color-primary)' : 'transparent',
                    color: activeTab === 'summary' ? '#ffffff' : 'var(--text-secondary)',
                    fontWeight: 700,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Navigation size={16} />
                  Stops & Stats
                </button>
              </div>

              {/* ══════════════════════════════════════════════════════════
                  TAB 1: ONBOARD PASSENGERS MANIFEST
              ══════════════════════════════════════════════════════════ */}
              {activeTab === 'onboard' && (
                <div>
                  {/* Search Bar */}
                  <div style={{ position: 'relative', marginBottom: 14 }}>
                    <input
                      type="text"
                      placeholder="Search card UID, destination, passenger..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '11px 14px 11px 38px',
                        borderRadius: 12,
                        border: '1.5px solid var(--glass-border)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        fontSize: '0.86rem',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <Search size={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 4 }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>

                  {filteredOnboard.length === 0 ? (
                    <SoftCard variant="glass" style={{ textAlign: 'center', padding: '32px 18px' }}>
                      <Users size={36} color="var(--text-tertiary)" style={{ marginBottom: 10 }} />
                      <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                        {onboardPassengers.length === 0 ? 'No passengers currently on board' : 'No matching passengers found'}
                      </p>
                      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {onboardPassengers.length === 0 ? 'Board passengers using the QR Scanner.' : 'Try adjusting your search criteria.'}
                      </p>
                    </SoftCard>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {filteredOnboard.map((passenger, index) => {
                        const isStudent = passenger.passenger_type === 'student';
                        const isSenior = passenger.passenger_type === 'senior_citizen';
                        const isPwd = passenger.passenger_type === 'pwd';
                        const isDiscounted = isStudent || isSenior || isPwd;

                        const isGcash = passenger.payment_method === 'gcash';
                        const isCash = passenger.payment_method === 'cash';

                        return (
                          <motion.div
                            key={passenger.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: Math.min(index * 0.03, 0.3) }}
                          >
                            <SoftCard
                              variant="glass"
                              style={{
                                padding: '14px',
                                border: '1px solid var(--glass-border)',
                                position: 'relative',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                                <div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                                      {passenger.card_uid}
                                    </span>
                                    <span style={{
                                      fontSize: '0.66rem',
                                      fontWeight: 700,
                                      padding: '2px 7px',
                                      borderRadius: 6,
                                      background: isDiscounted ? 'rgba(34, 197, 94, 0.14)' : 'var(--bg-tertiary)',
                                      color: isDiscounted ? '#16A34A' : 'var(--text-secondary)',
                                    }}>
                                      {passengerTypeLabel(passenger.passenger_type)}
                                    </span>
                                  </div>
                                  {passenger.owner_name && (
                                    <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                      {passenger.owner_name}
                                    </span>
                                  )}
                                </div>

                                {/* Payment Badge */}
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: isGcash ? 'rgba(0, 125, 254, 0.12)' : isCash ? 'rgba(34, 197, 94, 0.12)' : 'var(--color-primary-subtle)',
                                  color: isGcash ? '#007DFE' : isCash ? '#16A34A' : 'var(--color-primary)',
                                  padding: '3px 8px',
                                  borderRadius: 8,
                                  fontSize: '0.7rem',
                                  fontWeight: 700,
                                }}>
                                  {isGcash ? <Smartphone size={12} /> : isCash ? <Banknote size={12} /> : <CreditCard size={12} />}
                                  <span>{isGcash ? 'GCash' : isCash ? 'Cash' : 'QR Card'}</span>
                                </div>
                              </div>

                              {/* Route Stop Trajectory */}
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 10px',
                                background: 'var(--bg-tertiary)',
                                borderRadius: 10,
                                marginBottom: 10,
                              }}>
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)', fontWeight: 600, display: 'block' }}>FROM</span>
                                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-success)' }}>
                                    {passenger.boarding_stop || 'Trip Origin'}
                                  </span>
                                </div>
                                <Navigation size={14} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                                <div style={{ flex: 1, textAlign: 'right' }}>
                                  <span style={{ fontSize: '0.64rem', color: 'var(--text-tertiary)', fontWeight: 600, display: 'block' }}>DESTINATION</span>
                                  <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                                    {passenger.destination_stop || 'Open Stop'}
                                  </span>
                                </div>
                              </div>

                              {/* Footer with timestamp and Alight Action */}
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>
                                  <Clock size={12} />
                                  <span>{formatRelativeTime(passenger.boarded_at)}</span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => setPassengerToAlight(passenger)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '6px 14px',
                                    borderRadius: 18,
                                    border: '1.5px solid rgba(217, 119, 6, 0.4)',
                                    background: 'rgba(217, 119, 6, 0.1)',
                                    color: '#D97706',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                  }}
                                >
                                  <AlightIcon size={13} />
                                  Alight
                                </button>
                              </div>
                            </SoftCard>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ══════════════════════════════════════════════════════════
                  TAB 2: SUMMARY & DESTINATIONS BREAKDOWN
              ══════════════════════════════════════════════════════════ */}
              {activeTab === 'summary' && (
                <div>
                  {/* Stat Grid */}
                  <div className="dashboard-grid" style={{ marginBottom: 16 }}>
                    <DashboardCard
                      label="Total Boarded"
                      value={stats.totalBoarded}
                      icon={ArrowDown}
                      iconBg="var(--color-success-subtle)"
                      iconColor="var(--color-success)"
                      delay={0}
                    />
                    <DashboardCard
                      label="Alighted"
                      value={stats.totalAlighted}
                      icon={ArrowUp}
                      iconBg="var(--color-warning-subtle)"
                      iconColor="#A16207"
                      delay={0.05}
                    />
                    <DashboardCard
                      label="QR Cards"
                      value={stats.qrCardCount}
                      icon={CreditCard}
                      iconBg="var(--color-info-subtle)"
                      iconColor="var(--color-info)"
                      delay={0.1}
                    />
                    <DashboardCard
                      label="Tickets"
                      value={stats.ticketCount}
                      icon={Ticket}
                      iconBg="var(--color-primary-subtle)"
                      iconColor="var(--color-primary)"
                      delay={0.15}
                    />
                  </div>

                  {/* Destination Breakdown */}
                  {destinationGroups.length > 0 && (
                    <SoftCard variant="glass" style={{ marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                        <h3 className="heading-medium">Stops Breakdown</h3>
                        <StatusBadge variant="info">{destinationGroups.length} destinations</StatusBadge>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {destinationGroups.map((grp, i) => {
                          const onboard = grp.count - grp.alighted;
                          return (
                            <motion.div
                              key={grp.destination}
                              initial={{ opacity: 0, x: -8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: i * 0.04 }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '12px 14px',
                                borderRadius: 12,
                                background: 'var(--color-neutral-subtle)',
                                border: '1px solid var(--border-subtle)',
                              }}
                            >
                              <div>
                                <p style={{ margin: '0 0 3px', fontWeight: 800, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
                                  {grp.destination}
                                </p>
                                <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                  {grp.alighted} alighted · <strong style={{ color: onboard > 0 ? 'var(--color-primary)' : 'inherit' }}>{onboard} onboard</strong>
                                </p>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <span style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--color-primary)' }}>{grp.count}</span>
                                <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>passengers</p>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </SoftCard>
                  )}

                  {destinationGroups.length === 0 && (
                    <SoftCard variant="glass" style={{ textAlign: 'center', padding: 24, marginBottom: 20 }}>
                      <Users size={32} color="var(--text-tertiary)" style={{ marginBottom: 8 }} />
                      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        No destination passenger data recorded yet
                      </p>
                    </SoftCard>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </IonContent>

      {/* ── Manual Alighting Confirmation Modal ──────────────────────── */}
      <AnimatedModal
        isOpen={!!passengerToAlight}
        onClose={() => setPassengerToAlight(null)}
        title="Alight Passenger"
        variant="center"
      >
        {passengerToAlight && (
          <div style={{ padding: '6px 4px' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: 'rgba(217, 119, 6, 0.14)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 10px',
              }}>
                <AlightIcon size={26} color="#D97706" />
              </div>
              <h4 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800 }}>
                Confirm Alighting
              </h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Mark this passenger as alighted from the bus?
              </p>
            </div>

            <div style={{
              background: 'var(--bg-tertiary)',
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid var(--glass-border)',
              marginBottom: 18,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Card / Ticket</span>
                <span style={{ fontSize: '0.82rem', fontFamily: 'monospace', fontWeight: 800, color: 'var(--text-primary)' }}>
                  {passengerToAlight.card_uid}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Passenger Type</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {passengerTypeLabel(passengerToAlight.passenger_type)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Boarding Stop</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-success)' }}>
                  {passengerToAlight.boarding_stop || 'Trip Origin'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Destination Stop</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {passengerToAlight.destination_stop || 'Open Stop'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <PrimaryButton
                onClick={() => setPassengerToAlight(null)}
                variant="ghost"
                style={{ flex: 1 }}
                disabled={alightingInProgress}
              >
                Cancel
              </PrimaryButton>
              <PrimaryButton
                onClick={handleConfirmManualAlighting}
                style={{
                  flex: 1.5,
                  background: 'linear-gradient(135deg, #F59E0B, #D97706)',
                  color: '#ffffff',
                }}
                disabled={alightingInProgress}
                icon={<CheckCircle size={17} />}
              >
                {alightingInProgress ? 'Recording…' : 'Confirm Alight'}
              </PrimaryButton>
            </div>
          </div>
        )}
      </AnimatedModal>
    </IonPage>
  );
};

export default PassengerListPage;
