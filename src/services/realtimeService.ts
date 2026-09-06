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
  private retryAttempts: Map<string, number> = new Map();
  private maxRetries = 3;
  private retryDelays = [1000, 3000, 5000]; // Exponential backoff: 1s, 3s, 5s
  private connectionState: Map<string, 'connecting' | 'connected' | 'disconnected' | 'error'> = new Map();

  /**
   * Subscribe to a table for real-time changes.
   * If a channel for this table+filter already exists, the callbacks are
   * updated in-place so the latest React state is always captured.
   * Includes retry logic for unstable connections.
   */
  subscribe(config: RealtimeSubscriptionConfig): () => void {
    const { table, filter, onInsert, onUpdate, onDelete } = config;
    const channelName = `realtime:${table}:${filter || 'all'}`;

    // Always update the stored callbacks so they capture the latest closure
    this.callbacks.set(channelName, { onInsert, onUpdate, onDelete });

    // Only create the channel once; subsequent calls just update callbacks above
    if (!this.channels.has(channelName)) {
      this.connectionState.set(channelName, 'connecting');
      this.createChannelWithRetry(channelName, table, filter);
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
   * Create a channel with retry logic for unstable connections
   */
  private createChannelWithRetry(channelName: string, table: string, filter?: string) {
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
        this.handleSubscriptionStatus(channelName, table, status, filter);
      });

    this.channels.set(channelName, channel);
  }

  /**
   * Handle subscription status with retry logic
   */
  private handleSubscriptionStatus(channelName: string, table: string, status: string, filter?: string) {
    if (status === 'SUBSCRIBED') {
      console.log(`[Realtime] Successfully subscribed to ${table}`);
      this.connectionState.set(channelName, 'connected');
      this.retryAttempts.set(channelName, 0); // Reset retry counter on success
    } else if (status === 'CLOSED') {
      console.log(`[Realtime] Channel closed: ${channelName}`);
      this.connectionState.set(channelName, 'disconnected');
    } else if (status === 'CHANNEL_ERROR') {
      console.error(`[Realtime] Channel error: ${channelName}`);
      this.connectionState.set(channelName, 'error');
      this.handleConnectionError(channelName, table, filter);
    } else if (status === 'TIMED_OUT') {
      console.warn(`[Realtime] Connection timeout: ${channelName}`);
      this.connectionState.set(channelName, 'error');
      this.handleConnectionError(channelName, table, filter);
    }
  }

  /**
   * Handle connection errors with exponential backoff retry
   */
  private handleConnectionError(channelName: string, table: string, filter?: string) {
    const currentAttempt = this.retryAttempts.get(channelName) || 0;
    
    if (currentAttempt < this.maxRetries && navigator.onLine) {
      const nextAttempt = currentAttempt + 1;
      this.retryAttempts.set(channelName, nextAttempt);
      
      const delay = this.retryDelays[Math.min(currentAttempt, this.retryDelays.length - 1)];
      console.log(`[Realtime] Retry ${nextAttempt}/${this.maxRetries} for ${table} in ${delay}ms`);
      
      setTimeout(() => {
        if (this.channels.has(channelName)) {
          // Remove old channel and create new one
          const oldChannel = this.channels.get(channelName);
          if (oldChannel) {
            supabase.removeChannel(oldChannel);
          }
          this.connectionState.set(channelName, 'connecting');
          this.createChannelWithRetry(channelName, table, filter);
        }
      }, delay);
    } else if (currentAttempt >= this.maxRetries) {
      console.error(`[Realtime] Max retries reached for ${table}, giving up`);
      this.connectionState.set(channelName, 'error');
    } else {
      console.log(`[Realtime] Offline, skipping retry for ${table}`);
    }
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
        this.retryAttempts.delete(channelName);
        this.connectionState.delete(channelName);
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
    this.retryAttempts.clear();
    this.connectionState.clear();
  }

  /**
   * Reconnect all channels when network is restored
   */
  reconnectAll() {
    console.log('[Realtime] Reconnecting all channels after network restoration');
    
    // Store current channel configurations before clearing
    const channelConfigs = new Map<string, { table: string; filter?: string }>();
    this.channels.forEach((channel, channelName) => {
      // Parse channel name to extract table and filter
      const match = channelName.match(/realtime:([^:]+):(.+)/);
      if (match) {
        const [, table, filter] = match;
        channelConfigs.set(channelName, { table, filter: filter === 'all' ? undefined : filter });
      }
    });

    // Remove all existing channels
    this.channels.forEach((channel) => {
      supabase.removeChannel(channel);
    });
    this.channels.clear();
    this.retryAttempts.clear();
    this.connectionState.clear();

    // Recreate channels with retry logic
    channelConfigs.forEach((config, channelName) => {
      this.connectionState.set(channelName, 'connecting');
      this.createChannelWithRetry(channelName, config.table, config.filter);
    });
  }

  /**
   * Get connection state for monitoring
   */
  getConnectionState(): Map<string, 'connecting' | 'connected' | 'disconnected' | 'error'> {
    return new Map(this.connectionState);
  }
}

export const realtimeService = new RealtimeService();
