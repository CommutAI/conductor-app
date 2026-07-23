import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
} from '@ionic/react';
import { Users, ArrowUp, ArrowDown, CreditCard, Ticket } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useTrip } from '../context/TripContext';
import { supabase } from '../supabaseClient';
import PageHeader from '../components/layout/PageHeader';
import {
  SoftCard, StatusBadge, LoadingSkeleton, EmptyState, DashboardCard,
} from '../components/ui';
import { motion } from 'framer-motion';

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

const PassengerListPage: React.FC = () => {
  const [stats, setStats] = useState<TripPassengerStats | null>(null);
  const [destinationGroups, setDestinationGroups] = useState<DestinationGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const { currentTrip, currentBus } = useTrip();
  const history = useHistory();

  useEffect(() => {
    if (!currentTrip) {
      history.replace('/trip-setup');
      return;
    }
    loadStats();
  }, [currentTrip?.id]);

  async function loadStats() {
    if (!currentTrip) return;
    setLoading(true);
    try {
      // Load boarded_passengers records for this trip
      const { data } = await supabase
        .from('boarded_passengers')
        .select(`
          id, card_id, temp_ticket_id, alighted_at,
          qr_cards(destination),
          temporary_tickets(fare_amount)
        `)
        .eq('trip_id', currentTrip.id);

      if (!data) return;

      const totalBoarded = data.length;
      const totalAlighted = data.filter(p => p.alighted_at).length;
      const currentOnboard = totalBoarded - totalAlighted;
      const qrCardCount = data.filter(p => p.card_id).length;
      const ticketCount = data.filter(p => p.temp_ticket_id).length;
      const fareCollectedTotal = data.reduce((sum, p) => {
        const ticketFare = (p.temporary_tickets as any)?.fare_amount || 0;
        return sum + ticketFare;
      }, 0);

      setStats({
        totalBoarded,
        totalAlighted,
        currentOnboard,
        qrCardCount,
        ticketCount,
        fareCollectedTotal,
      });

      // Group by destination (from QR cards only)
      const destMap: Record<string, { count: number; alighted: number }> = {};
      for (const p of data) {
        const dest = (p.qr_cards as any)?.destination;
        if (!dest) continue;
        if (!destMap[dest]) destMap[dest] = { count: 0, alighted: 0 };
        destMap[dest].count += 1;
        if (p.alighted_at) destMap[dest].alighted += 1;
      }

      const groups: DestinationGroup[] = Object.entries(destMap)
        .map(([destination, v]) => ({ destination, count: v.count, alighted: v.alighted }))
        .sort((a, b) => b.count - a.count);

      setDestinationGroups(groups);
    } catch (error) {
      console.error('Error loading passenger stats:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh(event: CustomEvent) {
    await loadStats();
    (event.target as HTMLIonRefresherElement).complete();
  }

  return (
    <IonPage>
      <PageHeader
        showBack
        onBack={() => history.push('/live-trip')}
        title="Passenger Count"
        subtitle={currentBus?.plate_number}
        statusBadge={stats ? { label: `${stats.currentOnboard} on board`, variant: 'primary' } : undefined}
      />

      <IonContent className="app-page-bg">
        <div className="page-content page-content--no-nav">
          <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
            <IonRefresherContent />
          </IonRefresher>

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
              {/* ── Main Count Cards ──────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                style={{ marginBottom: 20 }}
              >
                <SoftCard variant="gradient" style={{ marginBottom: 20, textAlign: 'center', padding: 28 }}>
                  <p style={{ margin: '0 0 4px', color: 'rgba(255,255,255,0.8)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase' }}>
                    Currently On Board
                  </p>
                  <p style={{ margin: 0, fontSize: '3.5rem', fontWeight: 900, color: 'white', lineHeight: 1.1 }}>
                    {stats.currentOnboard}
                  </p>
                  <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
                    of {currentBus?.seat_capacity || '?'} seats capacity
                  </p>
                </SoftCard>
              </motion.div>

              {/* ── Stat Grid ─────────────────────────────────────────── */}
              <div className="dashboard-grid" style={{ marginBottom: 20 }}>
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

              {/* ── Destination Breakdown ─────────────────────────────── */}
              {destinationGroups.length > 0 && (
                <SoftCard style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <h3 className="heading-medium">Destinations</h3>
                    <StatusBadge variant="info">{destinationGroups.length} stops</StatusBadge>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {destinationGroups.map((grp, i) => {
                      const onboard = grp.count - grp.alighted;
                      return (
                        <motion.div
                          key={grp.destination}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          style={{
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: 10,
                            background: 'var(--color-neutral-subtle)',
                          }}
                        >
                          <div>
                            <p style={{ margin: '0 0 3px', fontWeight: 700, fontSize: '0.92rem' }}>{grp.destination}</p>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {grp.alighted} alighted · {onboard} still on board
                            </p>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{grp.count}</span>
                            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>passengers</p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </SoftCard>
              )}

              {destinationGroups.length === 0 && (
                <SoftCard style={{ textAlign: 'center', padding: 24, marginBottom: 20 }}>
                  <Users size={32} color="var(--text-tertiary)" style={{ marginBottom: 8 }} />
                  <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    No destination data from QR cards yet
                  </p>
                </SoftCard>
              )}
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default PassengerListPage;
