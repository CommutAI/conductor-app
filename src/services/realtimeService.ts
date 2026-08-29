import { supabase } from '../supabaseClient';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface RealtimeSubscriptionConfig {
  table: string;
  filter?: string;
  onInsert?: (record: any) => void;
  onUpdate?: (record: any, oldRecord: any) => void;
  onDelete?: (record: any) => void;
}

class RealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();
  private subscriptions: Map<string, Set<() => void>> = new Map();
  // Stores the latest callbacks per channel so closures are always fresh
  private callbacks: Map<string, {
    onInsert?: (record: any) => void;
    onUpdate?: (record: any, oldRecord: any) => void;
    onDelete?: (record: any) => void;
  }> = new Map();

  /**
   * Subscribe to a table for real-time changes.
   * If a channel for this table+filter already exists, the callbacks are
   * updated in-place so the latest React state is always captured.
   */
  subscribe(config: RealtimeSubscriptionConfig): () => void {
    const { table, filter, onInsert, onUpdate, onDelete } = config;
    const channelName = `realtime:${table}:${filter || 'all'}`;

    // Always update the stored callbacks so they capture the latest closure
    this.callbacks.set(channelName, { onInsert, onUpdate, onDelete });

    // Only create the channel once; subsequent calls just update callbacks above
    if (!this.channels.has(channelName)) {
      const channel = supabase.channel(channelName);

      const subscriptionConfig: any = {
        event: '*',
        schema: 'public',
        table,
      };

      if (filter) {
        subscriptionConfig.filter = filter;
      }

      channel
        .on('postgres_changes', subscriptionConfig, (payload) => {
          // Dispatch through the latest callbacks, not the original closure
          const cbs = this.callbacks.get(channelName);
          if (cbs) {
            this.handlePayload(payload, cbs.onInsert, cbs.onUpdate, cbs.onDelete);
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[Realtime] Subscribed to ${table}`);
          } else if (status === 'CLOSED') {
            console.log(`[Realtime] Channel closed: ${channelName}`);
          } else if (status === 'CHANNEL_ERROR') {
            console.error(`[Realtime] Channel error: ${channelName}`);
          }
        });

      this.channels.set(channelName, channel);
    }

    // Track this subscription's cleanup function
    const cleanup = () => {
      this.unsubscribe(channelName, cleanup);
    };

    if (!this.subscriptions.has(channelName)) {
      this.subscriptions.set(channelName, new Set());
    }
    this.subscriptions.get(channelName)!.add(cleanup);

    return cleanup;
  }

  /**
   * Handle incoming realtime payloads
   */
  private handlePayload(payload: any, onInsert?: (record: any) => void, onUpdate?: (record: any, oldRecord: any) => void, onDelete?: (record: any) => void) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    switch (eventType) {
      case 'INSERT':
        if (onInsert) onInsert(newRecord);
        break;
      case 'UPDATE':
        if (onUpdate) onUpdate(newRecord, oldRecord);
        break;
      case 'DELETE':
        if (onDelete) onDelete(oldRecord);
        break;
      default:
        console.log('[Realtime] Unknown event type:', eventType);
    }
  }

  /**
   * Unsubscribe from a specific channel
   */
  private unsubscribe(channelName: string, cleanupFn: () => void) {
    const subscriptions = this.subscriptions.get(channelName);
    if (subscriptions) {
      subscriptions.delete(cleanupFn);

      // If no more subscriptions for this channel, close it
      if (subscriptions.size === 0) {
        const channel = this.channels.get(channelName);
        if (channel) {
          supabase.removeChannel(channel);
          this.channels.delete(channelName);
        }
        this.subscriptions.delete(channelName);
        this.callbacks.delete(channelName);
      }
    }
  }

  /**
   * Subscribe to trips for a specific conductor
   */
  subscribeToTrips(conductorId: string, callbacks: {
    onInsert?: (trip: any) => void;
    onUpdate?: (trip: any, oldTrip: any) => void;
    onDelete?: (trip: any) => void;
  }): () => void {
    return this.subscribe({
      table: 'trips',
      filter: `conductor_id=eq.${conductorId}`,
      onInsert: callbacks.onInsert,
      onUpdate: callbacks.onUpdate,
      onDelete: callbacks.onDelete,
    });
  }

  /**
   * Subscribe to boarding/alighting events for a specific trip.
   *
   * BUG 7 FIX: The original implementation subscribed to a table named 'passengers'
   * which does not exist. The actual table is 'boarded_passengers'. Additionally,
   * 'boarded_passengers' has no conductor_id column — the correct filter is trip_id.
   * Without this fix, real-time passenger updates NEVER fired across devices.
   */
  subscribeToPassengers(tripId: string, callbacks: {
    onInsert?: (passenger: any) => void;
    onUpdate?: (passenger: any, oldPassenger: any) => void;
    onDelete?: (passenger: any) => void;
  }): () => void {
    return this.subscribe({
      table: 'boarded_passengers',
      filter: `trip_id=eq.${tripId}`,
      onInsert: callbacks.onInsert,
      onUpdate: callbacks.onUpdate,
      onDelete: callbacks.onDelete,
    });
  }

  /**
   * Subscribe to emergency alerts for a specific conductor
   */
  subscribeToEmergencyAlerts(conductorId: string, callbacks: {
    onInsert?: (alert: any) => void;
    onUpdate?: (alert: any, oldAlert: any) => void;
  }): () => void {
    return this.subscribe({
      table: 'emergency_alerts',
      filter: `conductor_id=eq.${conductorId}`,
      onInsert: callbacks.onInsert,
      onUpdate: callbacks.onUpdate,
    });
  }

  /**
   * Cleanup all subscriptions
   */
  cleanup() {
    this.channels.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    this.subscriptions.clear();
    this.callbacks.clear();
  }
}

export const realtimeService = new RealtimeService();
