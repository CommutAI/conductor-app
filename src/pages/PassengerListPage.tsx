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
import { Users, CheckCircle } from 'lucide-react';
import { useHistory } from 'react-router-dom';
import { useTrip } from '../context/TripContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabaseClient';
import PageHeader from '../components/layout/PageHeader';
import ProfileAvatar from '../components/ProfileAvatar';
import {
  SoftCard, StatusBadge, LoadingSkeleton, EmptyState,
} from '../components/ui';

interface Passenger {
  id: string;
  passenger_id?: string;
  name: string;
  boarded_at: string;
  card_id?: string;
  temp_ticket_id?: string;
  fare_amount?: number;
}

const PassengerListPage: React.FC = () => {
  const [segment, setSegment] = useState<'current' | 'boarded'>('current');
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState('');

  const { currentTrip, currentBus } = useTrip();
  const { profile } = useAuth();
  const history = useHistory();

  useEffect(() => {
    if (!currentTrip) {
      history.replace('/trip-setup');
      return;
    }
    loadPassengers();
  }, [currentTrip?.id, segment]);

  async function loadPassengers() {
    if (!currentTrip) return;
    setLoading(true);
    try {
      if (segment === 'current') {
        const { data } = await supabase
          .from('boarded_passengers')
          .select(`
            id, passenger_id, boarded_at, card_id, temp_ticket_id,
            qr_cards!inner(owner_name),
            temporary_tickets!inner(fare_amount)
          `)
          .eq('trip_id', currentTrip.id)
          .order('boarded_at', { ascending: false });

        const formatted = data?.map(p => ({
          id: p.id,
          passenger_id: p.passenger_id,
          name: (p.qr_cards as any)?.owner_name || 'Unknown',
          boarded_at: p.boarded_at,
          card_id: p.card_id,
          temp_ticket_id: p.temp_ticket_id,
          fare_amount: (p.temporary_tickets as any)?.fare_amount,
        })) || [];
        setPassengers(formatted);
      } else {
        const { data } = await supabase
          .from('boarded_passengers')
          .select(`
            id, passenger_id, boarded_at, card_id, temp_ticket_id,
            qr_cards!inner(owner_name),
            temporary_tickets!inner(fare_amount),
            trips!inner(route)
          `)
          .order('boarded_at', { ascending: false })
          .limit(50);

        const formatted = data?.map(p => ({
          id: p.id,
          passenger_id: p.passenger_id,
          name: (p.qr_cards as any)?.owner_name || 'Unknown',
          boarded_at: p.boarded_at,
          card_id: p.card_id,
          temp_ticket_id: p.temp_ticket_id,
          fare_amount: (p.temporary_tickets as any)?.fare_amount,
        })) || [];
        setPassengers(formatted);
      }
    } catch (error) {
      console.error('Error loading passengers:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh(event: CustomEvent) {
    await loadPassengers();
    (event.target as HTMLIonRefresherElement).complete();
  }

  const filteredPassengers = passengers.filter(p =>
    p.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <IonPage>
      <PageHeader
        showBack
        title="Passengers"
        subtitle={currentBus?.plate_number}
        statusBadge={{ label: `${filteredPassengers.length} boarded`, variant: 'primary' }}
      />

      <IonContent className="app-page-bg">
        <div className="page-content page-content--no-nav">
          <IonSegment
            value={segment}
            onIonChange={(e) => setSegment(e.detail.value as 'current' | 'boarded')}
            style={{ marginBottom: 16 }}
          >
            <IonSegmentButton value="current"><IonLabel>Current Trip</IonLabel></IonSegmentButton>
            <IonSegmentButton value="boarded"><IonLabel>All Boarded</IonLabel></IonSegmentButton>
          </IonSegment>

          <IonSearchbar
            value={searchText}
            onIonInput={(e) => setSearchText(e.detail.value as string)}
            placeholder="Search passengers..."
            style={{ marginBottom: 16, padding: 0 }}
          />

          <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
            <IonRefresherContent />
          </IonRefresher>

          {loading ? (
            <LoadingSkeleton variant="list" count={4} />
          ) : filteredPassengers.length === 0 ? (
            <EmptyState
              title="No Passengers"
              description={segment === 'current' ? 'No passengers boarded yet on this trip' : 'No boarding history found'}
              icon={Users}
            />
          ) : (
            <>
              {filteredPassengers.map((passenger, i) => (
                <SoftCard
                  key={passenger.id}
                  padding="sm"
                  style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 14 }}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <ProfileAvatar name={passenger.name} size="sm" showBorder={false} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.95rem' }}>{passenger.name}</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {passenger.card_id ? (
                        <StatusBadge variant="info">QR Card</StatusBadge>
                      ) : (
                        <StatusBadge variant="warning">Ticket</StatusBadge>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ margin: '0 0 2px', fontWeight: 800, color: 'var(--color-primary)' }}>
                      ₱{(passenger.fare_amount || 12).toFixed(0)}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                      {new Date(passenger.boarded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </SoftCard>
              ))}

              <SoftCard style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle size={20} color="var(--color-success)" />
                    <span style={{ fontWeight: 700 }}>Total Passengers</span>
                  </div>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                    {filteredPassengers.length}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="text-secondary">QR Cards</span>
                    <span style={{ fontWeight: 700 }}>{filteredPassengers.filter(p => p.card_id).length}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                    <span className="text-secondary">Tickets</span>
                    <span style={{ fontWeight: 700 }}>{filteredPassengers.filter(p => p.temp_ticket_id).length}</span>
                  </div>
                </div>
              </SoftCard>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
};

export default PassengerListPage;
