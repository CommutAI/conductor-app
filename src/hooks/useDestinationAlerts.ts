import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import { calculateDistance } from '../services/locationService';
import { BUS_STOP_LOCATIONS, PROXIMITY_THRESHOLD_KM } from '../config/busStops';

/**
 * Hook to monitor passengers' destination stops and log fare irregularities
 * when passengers fail to alight at their designated stops
 */

interface PassengerDestination {
  passengerId: string;
  cardUid: string;
  destination: string;
  ownerName?: string;
  passengerType: string;
  boardedAt: string;
}

interface IrregularityLog {
  passengerId: string;
  stopName: string;
  timestamp: number;
}

export function useDestinationAlerts(
  tripId: string | undefined,
  conductorId: string | undefined,
  currentLocation: { lat: number; lng: number } | null,
  isOnline: boolean,
  onAlert: (destination: string, passengers: string[], count: number) => void
) {
  const [boardedPassengers, setBoardedPassengers] = useState<PassengerDestination[]>([]);
  const alertedStopsRef = useRef<Set<string>>(new Set());
  const passedStopsRef = useRef<Map<string, IrregularityLog[]>>(new Map()); // Track passengers who passed their stops
  const lastCheckRef = useRef<number>(0);

  // Load boarded passengers
  useEffect(() => {
    if (!tripId || !isOnline) return;

    loadBoardedPassengers();

    const interval = setInterval(() => {
      loadBoardedPassengers();
    }, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, [tripId, isOnline]);

  async function loadBoardedPassengers() {
    if (!tripId) return;

    try {
      // Fetch boarded passengers
      const { data: boardedData, error: boardedError } = await supabase
        .from('boarded_passengers')
        .select('id, card_id, destination_stop, alighted_at, boarded_at')
        .eq('trip_id', tripId)
        .is('alighted_at', null) // Only passengers still on board
        .not('card_id', 'is', null); // Only QR card passengers (not temp tickets)

      if (boardedError) {
        console.error('[useDestinationAlerts] Error loading passengers:', boardedError);
        return;
      }

      if (!boardedData || boardedData.length === 0) {
        setBoardedPassengers([]);
        return;
      }

      // Get card IDs
      const cardIds = boardedData.map(p => p.card_id).filter(Boolean);

      // Fetch card details
      const { data: cardsData, error: cardsError } = await supabase
        .from('qr_cards')
        .select('id, card_uid, owner_name, passenger_type')
        .in('id', cardIds);

      if (cardsError) {
        console.error('[useDestinationAlerts] Error loading card details:', cardsError);
        return;
      }

      // Create a map for quick lookup
      const cardsMap = new Map(cardsData?.map(c => [c.id, c]) || []);

      // Combine the data
      const passengers: PassengerDestination[] = boardedData
        .filter(p => p.destination_stop && p.destination_stop !== 'Open Stop')
        .map(p => {
          const card = cardsMap.get(p.card_id!);
          return {
            passengerId: p.id,
            cardUid: card?.card_uid || 'Unknown',
            destination: p.destination_stop || '',
            ownerName: card?.owner_name,
            passengerType: card?.passenger_type || 'regular',
            boardedAt: p.boarded_at,
          };
        });

      setBoardedPassengers(passengers);
    } catch (err) {
      console.error('[useDestinationAlerts] Exception loading passengers:', err);
    }
  }

  // Check proximity to destination stops
  useEffect(() => {
    if (!currentLocation || !tripId || boardedPassengers.length === 0) return;

    // Throttle checks to every 10 seconds
    const now = Date.now();
    if (now - lastCheckRef.current < 10000) return;
    lastCheckRef.current = now;

    checkProximityAlerts();
  }, [currentLocation, boardedPassengers, tripId]);

  function checkProximityAlerts() {
    if (!currentLocation || !tripId || !conductorId) return;

    // Group passengers by destination
    const destinationMap = new Map<string, PassengerDestination[]>();
    boardedPassengers.forEach(p => {
      if (!destinationMap.has(p.destination)) {
        destinationMap.set(p.destination, []);
      }
      destinationMap.get(p.destination)!.push(p);
    });

    // Check each destination
    destinationMap.forEach((passengers, destination) => {
      const stopLocation = BUS_STOP_LOCATIONS[destination];
      if (!stopLocation) {
        // No coordinates defined for this stop
        return;
      }

      const distance = calculateDistance(
        currentLocation.lat,
        currentLocation.lng,
        stopLocation.lat,
        stopLocation.lng
      );

      const stopKey = `${destination}`;

      // APPROACHING: Within proximity threshold
      if (distance <= PROXIMITY_THRESHOLD_KM) {
        // Alert conductor (only once per stop)
        if (!alertedStopsRef.current.has(stopKey)) {
          alertedStopsRef.current.add(stopKey);

          const passengerNames = passengers
            .map(p => p.ownerName || `${p.passengerType} passenger`)
            .slice(0, 3);

          if (passengers.length > 3) {
            passengerNames.push(`+${passengers.length - 3} more`);
          }

          onAlert(destination, passengerNames, passengers.length);
        }
      }
      
      // PASSED: Beyond the stop (distance increasing or > 2x threshold)
      // This indicates passengers missed their stop
      else if (distance > PROXIMITY_THRESHOLD_KM * 2 && alertedStopsRef.current.has(stopKey)) {
        // Log irregularity for passengers who didn't alight
        passengers.forEach(passenger => {
          const logKey = `${passenger.passengerId}-${destination}`;
          
          // Check if already logged
          const existingLogs = passedStopsRef.current.get(logKey);
          if (!existingLogs) {
            // Log this irregularity
            logDestinationIrregularity(
              passenger,
              destination,
              distance,
              stopLocation
            );
            
            // Mark as logged
            if (!passedStopsRef.current.has(logKey)) {
              passedStopsRef.current.set(logKey, []);
            }
            passedStopsRef.current.get(logKey)!.push({
              passengerId: passenger.passengerId,
              stopName: destination,
              timestamp: Date.now(),
            });
          }
        });
      }
    });
  }

  async function logDestinationIrregularity(
    passenger: PassengerDestination,
    destinationStop: string,
    currentDistance: number,
    stopLocation: { lat: number; lng: number }
  ) {
    if (!tripId || !conductorId || !isOnline) return;

    try {
      const now = new Date().toISOString();
      const minutesSinceBoarding = Math.round(
        (Date.now() - new Date(passenger.boardedAt).getTime()) / 60000
      );

      const description = `Passenger "${passenger.ownerName || passenger.cardUid}" (${passenger.passengerType}) failed to alight at designated stop "${destinationStop}". ` +
        `Boarded ${minutesSinceBoarding} minutes ago. Bus is now ${currentDistance.toFixed(2)} km past the stop. ` +
        `This may indicate a missed stop, fare evasion, or passenger confusion.`;

      const { error } = await supabase
        .from('fare_irregularities')
        .insert({
          trip_id: tripId,
          conductor_id: conductorId,
          card_uid: passenger.cardUid,
          passenger_id: passenger.passengerId,
          type: 'destination_overstay',
          description: description,
          detected_at: now,
          location_lat: currentLocation?.lat,
          location_lng: currentLocation?.lng,
          destination_stop: destinationStop,
          current_stop: findNearestStop(currentLocation!),
          distance_km: currentDistance,
          notes: `Passenger boarded at ${new Date(passenger.boardedAt).toLocaleTimeString()}`,
        });

      if (error) {
        console.error('[useDestinationAlerts] Error logging irregularity:', error);
      } else {
        console.log(`[useDestinationAlerts] Logged destination overstay for passenger ${passenger.cardUid} at ${destinationStop}`);
      }
    } catch (err) {
      console.error('[useDestinationAlerts] Exception logging irregularity:', err);
    }
  }

  function findNearestStop(location: { lat: number; lng: number }): string {
    let nearestStop = 'Unknown';
    let minDistance = Infinity;

    Object.entries(BUS_STOP_LOCATIONS).forEach(([stopName, stopLoc]) => {
      const distance = calculateDistance(
        location.lat,
        location.lng,
        stopLoc.lat,
        stopLoc.lng
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearestStop = stopName;
      }
    });

    return nearestStop;
  }

  // Reset alerted stops and irregularity logs when trip changes
  useEffect(() => {
    alertedStopsRef.current.clear();
    passedStopsRef.current.clear();
  }, [tripId]);

  return {
    boardedPassengers,
    stopLocations: BUS_STOP_LOCATIONS,
  };
}
