/**
 * SMS Service
 * Handles SMS queueing for Raspberry Pi SIM900A module processing
 * SMS requests are queued in the database and processed by the Raspberry Pi
 */

import { supabase } from '../supabaseClient';
import { offlineQueueService } from './offlineQueueService';

export interface SMSRequest {
  phone_number: string;
  message: string;
  type: 'emergency' | 'alighting' | 'other';
  priority?: number;
  related_id?: string;
  trip_id?: string;
}

export interface EmergencySMSData {
  emergencyType: string;
  location?: { lat: number; lng: number };
  locationName?: string;
  tripId?: string;
  busInfo?: {
    plateNumber: string;
    route: string;
  };
  driverName?: string;
  conductorName?: string;
}

export interface AlightingSMSData {
  passengerName: string;
  tripSummary: {
    route: string;
    boardingPoint: string;
    destination: string;
    fare: number;
    duration?: string;
  };
  tripId: string;
}

class SMSService {
  /**
   * Queue an SMS for sending via Raspberry Pi
   */
  async queueSMS(request: SMSRequest): Promise<{ success: boolean; error?: string; smsId?: string }> {
    try {
      // Check if offline and use offline queue
      if (!navigator.onLine) {
        console.log('[SMS] Offline mode, queuing SMS locally');
        const smsId = offlineQueueService.addSMS({
          type: request.type,
          phoneNumber: request.phone_number,
          message: request.message,
          priority: request.priority || 5,
          relatedId: request.related_id,
          tripId: request.trip_id,
        });
        console.log(`[SMS] Queued ${request.type} SMS offline for ${request.phone_number}, ID: ${smsId}`);
        return { success: true, smsId };
      }

      const { data, error } = await supabase
        .from('sms_queue')
        .insert({
          phone_number: request.phone_number,
          message: request.message,
          type: request.type,
          priority: request.priority || 5,
          related_id: request.related_id,
          trip_id: request.trip_id,
          status: 'pending'
        })
        .select('id')
        .single();

      if (error) throw error;
      
      console.log(`[SMS] Queued ${request.type} SMS for ${request.phone_number}, ID: ${data.id}`);
      return { success: true, smsId: data.id };
    } catch (error) {
      console.error('[SMS] Failed to queue SMS:', error);
      
      // Fallback to offline queue if database fails
      console.log('[SMS] Database failed, falling back to offline queue');
      try {
        const smsId = offlineQueueService.addSMS({
          type: request.type,
          phoneNumber: request.phone_number,
          message: request.message,
          priority: request.priority || 5,
          relatedId: request.related_id,
          tripId: request.trip_id,
        });
        console.log(`[SMS] Queued ${request.type} SMS offline (fallback) for ${request.phone_number}, ID: ${smsId}`);
        return { success: true, smsId };
      } catch (offlineError) {
        console.error('[SMS] Failed to queue SMS offline:', offlineError);
      }
      
      return { success: false, error: String(error) };
    }
  }

  /**
   * Queue emergency alert SMS
   */
  async queueEmergencySMS(
    phoneNumber: string,
    data: EmergencySMSData
  ): Promise<{ success: boolean; error?: string; smsId?: string }> {
    const locationText = data.location 
      ? `Location: ${data.locationName || `${data.location.lat.toFixed(6)}, ${data.location.lng.toFixed(6)}`}`
      : 'Location: Unknown';
    
    const busInfo = data.busInfo 
      ? `Bus: ${data.busInfo.plateNumber} (${data.busInfo.route})`
      : 'Bus: Unknown';
    
    const personnel = [];
    if (data.driverName) personnel.push(`Driver: ${data.driverName}`);
    if (data.conductorName) personnel.push(`Conductor: ${data.conductorName}`);
    const personnelText = personnel.length > 0 ? personnel.join(', ') : '';
    
    const message = `EMERGENCY: ${data.emergencyType.toUpperCase()} on your bus. ${busInfo}. ${locationText}. ${personnelText}. Time: ${new Date().toISOString()}`;
    
    return this.queueSMS({
      phone_number: phoneNumber,
      message,
      type: 'emergency',
      priority: 1, // Highest priority
      trip_id: data.tripId
    });
  }

  /**
   * Queue alighting notification SMS
   */
  async queueAlightingSMS(
    phoneNumber: string,
    data: AlightingSMSData
  ): Promise<{ success: boolean; error?: string; smsId?: string }> {
    const message = `Happy boarding! Thanks for riding with us, ${data.passengerName}. Trip: ${data.tripSummary.route}, From: ${data.tripSummary.boardingPoint}, To: ${data.tripSummary.destination}, Fare: ₱${data.tripSummary.fare.toFixed(2)}. Come ride again!`;
    
    return this.queueSMS({
      phone_number: phoneNumber,
      message,
      type: 'alighting',
      priority: 5, // Normal priority
      trip_id: data.tripId
    });
  }

  /**
   * Queue custom SMS message
   */
  async queueCustomSMS(
    phoneNumber: string,
    message: string,
    priority: number = 5,
    tripId?: string
  ): Promise<{ success: boolean; error?: string; smsId?: string }> {
    return this.queueSMS({
      phone_number: phoneNumber,
      message,
      type: 'other',
      priority,
      trip_id: tripId
    });
  }

  /**
   * Get SMS delivery status
   */
  async getSMSStatus(smsId: string): Promise<{ status: string; sent_at?: string; error_message?: string } | null> {
    try {
      const { data, error } = await supabase
        .from('sms_queue')
        .select('status, sent_at, error_message')
        .eq('id', smsId)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[SMS] Failed to get SMS status:', error);
      return null;
    }
  }

  /**
   * Cancel pending SMS
   */
  async cancelSMS(smsId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('sms_queue')
        .update({ status: 'cancelled' })
        .eq('id', smsId)
        .eq('status', 'pending');

      if (error) throw error;
      
      console.log(`[SMS] Cancelled SMS ${smsId}`);
      return { success: true };
    } catch (error) {
      console.error('[SMS] Failed to cancel SMS:', error);
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get SMS queue statistics for current trip
   */
  async getTripSMSStats(tripId: string): Promise<{
    pending: number;
    sent: number;
    failed: number;
    total: number;
  }> {
    try {
      const { data, error } = await supabase
        .from('sms_queue')
        .select('status')
        .eq('trip_id', tripId);

      if (error) throw error;

      const stats = {
        pending: 0,
        sent: 0,
        failed: 0,
        total: data?.length || 0
      };

      data?.forEach(sms => {
        if (sms.status === 'pending') stats.pending++;
        else if (sms.status === 'sent') stats.sent++;
        else if (sms.status === 'failed') stats.failed++;
      });

      return stats;
    } catch (error) {
      console.error('[SMS] Failed to get trip SMS stats:', error);
      return { pending: 0, sent: 0, failed: 0, total: 0 };
    }
  }
}

export const smsService = new SMSService();