/**
 * Bus Stop Locations Configuration
 * 
 * IMPORTANT: This file controls destination alerts for passengers.
 * When the bus comes within 500m of a stop where passengers need to alight,
 * the conductor will receive a notification.
 * 
 * TO ADD A NEW STOP:
 * 1. Find coordinates using Google Maps:
 *    - Open Google Maps (https://maps.google.com)
 *    - Right-click on the bus stop location
 *    - Select "What's here?"
 *    - Copy the coordinates (format: latitude, longitude)
 * 
 * 2. Add entry below in this format:
 *    'Stop Name': {
 *      lat: 23.1234,  // First number (latitude)
 *      lng: 58.5678,  // Second number (longitude)
 *      description: 'Optional notes about this stop'
 *    },
 * 
 * 3. CRITICAL: Stop names must EXACTLY match the destination names
 *    used in your QR card system (case-sensitive!)
 * 
 * Example: If QR cards show "Airport" as destination, use "Airport" here,
 * not "airport" or "The Airport" or "Airport Terminal"
 */

export interface BusStopLocation {
  lat: number;
  lng: number;
  description?: string;
}

export const BUS_STOP_LOCATIONS: Record<string, BusStopLocation> = {
  // Example stops for Muscat, Oman
  // Replace with your actual bus route stops
  
  'Downtown Terminal': {
    lat: 23.6139,
    lng: 58.5451,
    description: 'Main bus terminal in downtown Muscat'
  },
  
  'University Campus': {
    lat: 23.5880,
    lng: 58.3829,
    description: 'Sultan Qaboos University'
  },
  
  'Airport': {
    lat: 23.5933,
    lng: 58.2844,
    description: 'Muscat International Airport'
  },
  
  'Mall of Muscat': {
    lat: 23.5908,
    lng: 58.4062,
    description: 'Shopping mall stop'
  },
  
  'Qurum Beach': {
    lat: 23.6145,
    lng: 58.4832,
    description: 'Beach area stop'
  },
  
  'Muttrah Souq': {
    lat: 23.6222,
    lng: 58.5636,
    description: 'Traditional market area'
  },
  
  'Al Khuwair': {
    lat: 23.5980,
    lng: 58.4120,
    description: 'Al Khuwair district'
  },
  
  'Ruwi': {
    lat: 23.5903,
    lng: 58.5456,
    description: 'Ruwi commercial district'
  },
  
  // Add more stops as needed:
  // 'Your Stop Name': {
  //   lat: 0.0000,
  //   lng: 0.0000,
  //   description: 'Optional description'
  // },
};

/**
 * Proximity threshold in kilometers
 * Alert will trigger when bus is within this distance of a stop
 */
export const PROXIMITY_THRESHOLD_KM = 0.5; // 500 meters

/**
 * Alert cooldown in milliseconds
 * Prevents duplicate alerts for the same stop
 */
export const ALERT_COOLDOWN_MS = 300000; // 5 minutes
