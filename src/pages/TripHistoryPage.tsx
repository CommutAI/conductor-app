import React, { useState, useEffect } from 'react';
import {
  IonPage,
  IonContent,
  IonRefresher,
  IonRefresherContent,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonSearchbar,
} from '@ionic/react';
import { Calendar, Users, Wallet, AlertTriangle, Bus } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import PageHeader from '../components/layout/PageHeader';
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

const TripHistoryPage: React.FC = () => {
  const [segment, setSegment] = useState<'all' | 'completed' | 'active'>('all');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  const { profile } = useAuth();
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
            <SoftCard variant="gradient" style={{ marginBottom: 20 }}>
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
              <SoftCard
                key={trip.id}
                style={{ marginBottom: 12 }}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
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
            ))
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default TripHistoryPage;
