import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSearchbar,
  IonModal,
  IonHeader,
  IonToolbar,
  IonButtons,
  IonButton,
  IonTitle,
} from '@ionic/react';
import { Calendar, Users, Wallet, AlertTriangle, Bus, X, MapPin, Clock, User } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { supabase } from '../supabaseClient';
import PageHeader from '../components/layout/PageHeader';
import InteractiveBackground from '../components/layout/InteractiveBackground';
import {
  SoftCard, StatusBadge, LoadingSkeleton, EmptyState,
} from '../components/ui';

interface Trip {
  id: string;
  started_at: string;
  ended_at?: string;
  status: 'active' | 'completed' | 'cancelled';
  route: string;
  plate_number: string;
  passenger_count: number;
  fare_collected: number;
  irregularities: number;
}

interface TripDetails {
  id: string;
  started_at: string;
  ended_at?: string;
  status: string;
  route: string;
  plate_number: string;
  passengers: Array<{
    id: string;
    card_id?: string;
    temp_ticket_id?: string;
    card_uid?: string;
    ticket_uid?: string;
    boarded_at: string;
    alighted_at?: string;
    fare?: number;
    baggage_fee?: number;
  }>;
  transactions: Array<{
    id: string;
    amount: number;
    channel: string;
    created_at: string;
    baggage_fee?: number;
    card_id?: string;
    temp_ticket_id?: string;
  }>;
}

const TripHistoryPage: React.FC = () => {
  const [segment, setSegment] = useState<'all' | 'completed' | 'active'>('all');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [showTripDetails, setShowTripDetails] = useState(false);
  const [selectedTripDetails, setSelectedTripDetails] = useState<TripDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { profile } = useApp();
  const history = useHistory();

  useEffect(() => {
    loadTrips();
  }, [segment]);

  async function loadTrips() {
    if (!profile) return;
    setLoading(true);
    try {
      let query = supabase
        .from('trips')
        .select(`id, started_at, ended_at, status, buses!inner(route, plate_number)`)
        .eq('conductor_id', profile.id)
        .order('started_at', { ascending: false });

      if (segment !== 'all') query = query.eq('status', segment);

      const { data } = await query;

      const tripsWithStats = await Promise.all(
        (data || []).map(async (trip: any) => {
          const { data: txData } = await supabase.from('transactions').select('amount').eq('trip_id', trip.id);
          const fareCollected = txData?.reduce((sum, tx) => sum + tx.amount, 0) || 0;
          const { data: passengerData } = await supabase.from('boarded_passengers').select('id').eq('trip_id', trip.id);
          const { data: irregData } = await supabase.from('fare_irregularities').select('id').eq('trip_id', trip.id);

          return {
            id: trip.id,
            started_at: trip.started_at,
            ended_at: trip.ended_at,
            status: trip.status,
            route: (trip.buses as any).route,
            plate_number: (trip.buses as any).plate_number,
            passenger_count: passengerData?.length || 0,
            fare_collected: fareCollected,
            irregularities: irregData?.length || 0,
          };
        })
      );

      setTrips(tripsWithStats);
    } catch (error) {
      console.error('Error loading trips:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh(event: CustomEvent) {
    await loadTrips();
    (event.target as HTMLIonRefresherElement).complete();
  }

  async function loadTripDetails(tripId: string) {
    setLoadingDetails(true);
    try {
      // Get trip details with bus info
      const { data: tripData } = await supabase
        .from('trips')
        .select(`id, started_at, ended_at, status, buses!inner(route, plate_number)`)
        .eq('id', tripId)
        .single();

      if (!tripData) return;

      // Get boarded passengers
      const { data: passengers } = await supabase
        .from('boarded_passengers')
        .select('id, card_id, temp_ticket_id, boarded_at, alighted_at')
        .eq('trip_id', tripId);

      // Get transactions for this trip
      const { data: transactions } = await supabase
        .from('transactions')
        .select('id, amount, channel, created_at, baggage_fee, card_id, temp_ticket_id')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: false });

      // Collect all card IDs and ticket IDs to fetch UIDs in bulk
      const cardIds = (passengers || []).map(p => p.card_id).filter(Boolean);
      const ticketIds = (passengers || []).map(p => p.temp_ticket_id).filter(Boolean);

      const [{ data: cardRows }, { data: ticketRows }] = await Promise.all([
        cardIds.length > 0
          ? supabase.from('qr_cards').select('id, card_uid').in('id', cardIds)
          : Promise.resolve({ data: [] }),
        ticketIds.length > 0
          ? supabase.from('temporary_tickets').select('id, ticket_uid').in('id', ticketIds)
          : Promise.resolve({ data: [] }),
      ]);

      const cardUidMap: Record<string, string> = {};
      (cardRows || []).forEach((c: any) => { cardUidMap[c.id] = c.card_uid; });
      (ticketRows || []).forEach((t: any) => { cardUidMap[t.id] = t.ticket_uid; });

      // Map passengers with their transaction data and card UIDs
      const passengersWithFare = (passengers || []).map((passenger: any) => {
        const passengerTx = (transactions || []).find(tx =>
          (passenger.card_id && tx.card_id === passenger.card_id) ||
          (passenger.temp_ticket_id && tx.temp_ticket_id === passenger.temp_ticket_id)
        );

        const cardUid =
          (passenger.card_id && cardUidMap[passenger.card_id]) ||
          (passenger.temp_ticket_id && cardUidMap[passenger.temp_ticket_id]) ||
          passenger.card_id ||
          passenger.temp_ticket_id ||
          null;

        return {
          ...passenger,
          card_uid: cardUid,
          fare: passengerTx?.amount || 0,
          baggage_fee: passengerTx?.baggage_fee || 0,
        };
      });

      setSelectedTripDetails({
        id: tripData.id,
        started_at: tripData.started_at,
        ended_at: tripData.ended_at,
        status: tripData.status,
        route: (tripData.buses as any).route,
        plate_number: (tripData.buses as any).plate_number,
        passengers: passengersWithFare,
        transactions: transactions || [],
      });
      setShowTripDetails(true);
    } catch (error) {
      console.error('Error loading trip details:', error);
    } finally {
      setLoadingDetails(false);
    }
  }

  const filteredTrips = trips.filter(trip =>
    trip.route.toLowerCase().includes(searchText.toLowerCase()) ||
    trip.plate_number.toLowerCase().includes(searchText.toLowerCase())
  );

  const totalFareCollected = filteredTrips.reduce((sum, trip) => sum + trip.fare_collected, 0);
  const totalPassengers = filteredTrips.reduce((sum, trip) => sum + trip.passenger_count, 0);

  const statusVariant = (status: string) =>
    status === 'completed' ? 'success' : status === 'active' ? 'info' : 'danger';

  return (
    <IonPage>
      <InteractiveBackground />
      <PageHeader showBack title="Trip History" subtitle="Your past trips" />

      <IonContent className="app-page-bg">
        <div className="page-content page-content--no-nav">
          <IonSegment
            value={segment}
            onIonChange={(e) => setSegment(e.detail.value as 'all' | 'completed' | 'active')}
            style={{ marginBottom: 16 }}
          >
            <IonSegmentButton value="all"><IonLabel>All</IonLabel></IonSegmentButton>
            <IonSegmentButton value="completed"><IonLabel>Completed</IonLabel></IonSegmentButton>
            <IonSegmentButton value="active"><IonLabel>Active</IonLabel></IonSegmentButton>
          </IonSegment>

          <IonSearchbar
            value={searchText}
            onIonInput={(e) => setSearchText(e.detail.value as string)}
            placeholder="Search trips..."
            style={{ marginBottom: 16, padding: 0 }}
          />

          {!loading && filteredTrips.length > 0 && (
            <SoftCard variant="hero" style={{ marginBottom: 20 }}>
              <p style={{ margin: '0 0 4px', fontSize: '0.75rem', opacity: 0.85, fontWeight: 600, textTransform: 'uppercase', color: 'white' }}>
                Total Earnings
              </p>
              <p style={{ margin: '0 0 16px', fontSize: '2rem', fontWeight: 900, color: 'white' }}>
                ₱{totalFareCollected.toFixed(0)}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {[
                  { label: 'Trips', value: filteredTrips.length },
                  { label: 'Passengers', value: totalPassengers },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: 'rgba(255,255,255,0.15)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
                    <p style={{ margin: '0 0 2px', fontSize: '1.25rem', fontWeight: 800, color: 'white' }}>{value}</p>
                    <p style={{ margin: 0, fontSize: '0.7rem', opacity: 0.85, color: 'white' }}>{label}</p>
                  </div>
                ))}
              </div>
            </SoftCard>
          )}

          <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
            <IonRefresherContent />
          </IonRefresher>

          {loading ? (
            <LoadingSkeleton variant="card" count={3} />
          ) : filteredTrips.length === 0 ? (
            <EmptyState
              title="No Trips Found"
              description="Start your first trip to see history here"
              icon={Bus}
              actionLabel="Start Trip"
              onAction={() => history.push('/trip-setup')}
            />
          ) : (
            filteredTrips.map((trip, i) => (
              <motion.div
                key={trip.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <SoftCard
                  variant="glass"
                  style={{ marginBottom: 12, cursor: 'pointer' }}
                  onClick={() => loadTripDetails(trip.id)}
                >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <StatusBadge variant={statusVariant(trip.status)} style={{ marginBottom: 8 }}>
                      {trip.status}
                    </StatusBadge>
                    <h3 className="heading-small" style={{ marginBottom: 4 }}>{trip.route}</h3>
                    <p className="text-secondary" style={{ margin: 0 }}>{trip.plate_number}</p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Calendar size={16} color="var(--color-primary)" style={{ marginBottom: 4 }} />
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      {new Date(trip.started_at).toLocaleDateString()}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {new Date(trip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                  paddingTop: 12, borderTop: '1px solid var(--border-subtle)',
                }}>
                  {[
                    { icon: Users, value: trip.passenger_count, label: 'Passengers' },
                    { icon: Wallet, value: `₱${trip.fare_collected.toFixed(0)}`, label: 'Fare' },
                    { icon: AlertTriangle, value: trip.irregularities, label: 'Issues', color: trip.irregularities > 0 ? 'var(--color-warning)' : 'var(--color-success)' },
                  ].map(({ icon: Icon, value, label, color }) => (
                    <div key={label} style={{ textAlign: 'center' }}>
                      <Icon size={18} color={color || 'var(--color-primary)'} />
                      <p style={{ margin: '4px 0 0', fontWeight: 700 }}>{value}</p>
                      <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{label}</p>
                    </div>
                  ))}
                </div>
              </SoftCard>
              </motion.div>
            ))
          )}
        </div>
      </IonContent>

      {/* Trip Details Modal */}
      <IonModal 
        isOpen={showTripDetails} 
        onDidDismiss={() => setShowTripDetails(false)}
        style={{ '--background': 'var(--bg-primary)' }}
      >
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonButton onClick={() => setShowTripDetails(false)}>
                <X size={20} />
              </IonButton>
            </IonButtons>
            <IonTitle>Trip Details</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent style={{ '--background': 'var(--bg-primary)' }} className="app-page-bg">
          <div className="page-content">
            {loadingDetails ? (
              <LoadingSkeleton variant="card" count={3} />
            ) : selectedTripDetails ? (
              <>
                {/* Trip Overview */}
                <SoftCard style={{ marginBottom: 16, background: 'var(--bg-primary)', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <StatusBadge variant={statusVariant(selectedTripDetails.status)} style={{ marginBottom: 8 }}>
                        {selectedTripDetails.status}
                      </StatusBadge>
                      <h3 className="heading-small" style={{ marginBottom: 4 }}>{selectedTripDetails.route}</h3>
                      <p className="text-secondary" style={{ margin: 0 }}>{selectedTripDetails.plate_number}</p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <Calendar size={16} color="var(--color-primary)" style={{ marginBottom: 4 }} />
                      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {new Date(selectedTripDetails.started_at).toLocaleDateString()}
                      </p>
                      <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {new Date(selectedTripDetails.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>

                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                    paddingTop: 12, borderTop: '1px solid var(--border-subtle)',
                  }}>
                    {[
                      { icon: Users, value: selectedTripDetails.passengers.length, label: 'Passengers' },
                      { icon: Wallet, value: `₱${selectedTripDetails.transactions.reduce((sum, tx) => sum + tx.amount, 0).toFixed(0)}`, label: 'Fare' },
                      { icon: Clock, value: selectedTripDetails.ended_at ? 
                        `${Math.round((new Date(selectedTripDetails.ended_at).getTime() - new Date(selectedTripDetails.started_at).getTime()) / 60000)}m` : 
                        'Active', label: 'Duration' },
                    ].map(({ icon: Icon, value, label }) => (
                      <div key={label} style={{ textAlign: 'center' }}>
                        <Icon size={18} color="var(--color-primary)" />
                        <p style={{ margin: '4px 0 0', fontWeight: 700 }}>{value}</p>
                        <p style={{ margin: 0, fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{label}</p>
                      </div>
                    ))}
                  </div>
                </SoftCard>

                {/* Passengers List */}
                <h4 className="heading-small" style={{ marginBottom: 12 }}>Passengers</h4>
                {selectedTripDetails.passengers.length === 0 ? (
                  <EmptyState
                    title="No Passengers"
                    description="No passengers boarded on this trip"
                    icon={Users}
                  />
                ) : (
                  selectedTripDetails.passengers.map((passenger, i) => (
                    <SoftCard
                      key={passenger.id}
                      style={{ marginBottom: 8, background: 'var(--bg-secondary)', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{
                            width: 40, height: 40, borderRadius: '50%',
                            background: passenger.alighted_at ? 'var(--color-success-subtle)' : 'var(--color-primary-subtle)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}>
                            <User size={18} color={passenger.alighted_at ? 'var(--color-success)' : 'var(--color-primary)'} />
                          </div>
                          <div>
                            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>
                              {passenger.card_uid
                                ? passenger.card_uid.toUpperCase()
                                : passenger.ticket_uid
                                ? passenger.ticket_uid.toUpperCase()
                                : 'Unknown'}
                            </p>
                            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {new Date(passenger.boarded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {passenger.alighted_at && ` - ${new Date(passenger.alighted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                            </p>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-primary)' }}>
                            ₱{(passenger.fare || 0).toFixed(2)}
                          </p>
                          {passenger.baggage_fee && passenger.baggage_fee > 0 && (
                            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                              +₱{passenger.baggage_fee.toFixed(2)} baggage
                            </p>
                          )}
                        </div>
                      </div>
                    </SoftCard>
                  ))
                )}

                {/* Transactions Summary */}
                <h4 className="heading-small" style={{ marginBottom: 12, marginTop: 20 }}>Transactions</h4>
                <SoftCard style={{ background: 'var(--bg-secondary)', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}>
                  {selectedTripDetails.transactions.length === 0 ? (
                    <p style={{ margin: 0, textAlign: 'center', color: 'var(--text-secondary)' }}>No transactions</p>
                  ) : (
                    selectedTripDetails.transactions.map((tx, i) => (
                      <div key={tx.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '12px 0', borderBottom: i < selectedTripDetails.transactions.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                      }}>
                        <div>
                          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.85rem' }}>{tx.channel}</p>
                          <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                            {new Date(tx.created_at).toLocaleString()}
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ margin: 0, fontWeight: 700, color: 'var(--color-primary)' }}>
                            ₱{tx.amount.toFixed(2)}
                          </p>
                          {tx.baggage_fee && tx.baggage_fee > 0 && (
                            <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                              (incl. ₱{tx.baggage_fee.toFixed(2)} baggage)
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </SoftCard>
              </>
            ) : null}
          </div>
        </IonContent>
      </IonModal>
    </IonPage>
  );
};

export default TripHistoryPage;
