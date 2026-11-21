/**
 * Centralized UI Messages
 * Ensures consistency across the application
 */

export const ERROR_MESSAGES = {
  // Authentication
  AUTH_REQUIRED: 'Please login to continue',
  SESSION_EXPIRED: 'Session expired. Please login again',
  NOT_AUTHENTICATED: 'Not authenticated. Please login again.',

  // Trip
  NO_ACTIVE_TRIP: 'No active trip found',
  TRIP_ALREADY_ACTIVE: 'Trip already in progress',
  NO_BUS_ASSIGNED: 'No bus assigned to your account',
  MISSING_TRIP_DATA: 'Missing trip or profile data',

  // QR/Card
  CARD_NOT_FOUND: 'QR code not recognized',
  CARD_INACTIVE: 'Card is inactive',
  CARD_WRONG_ROUTE: (route: string) => `Wrong route. Card is for: ${route}`,
  CARD_NO_DESTINATION: 'Card has no destination set',
  CARD_FAKE: (reason: string) => `Invalid QR: ${reason}`,
  
  // Ticket
  TICKET_NOT_FOUND: 'Ticket not found',
  TICKET_EXPIRED: 'Ticket expired',
  TICKET_ALREADY_USED: 'Ticket already used',
  TICKET_INVALID: 'Invalid ticket',

  // Boarding/Alighting
  ALREADY_BOARDED: 'Already boarded on this trip',
  ALREADY_BOARDED_OFFLINE: 'Already boarded — pending offline sync',
  NOT_BOARDED: 'Passenger not boarded on this trip',
  NOT_BOARDED_NO_BOARDING: 'Passenger not boarded - cannot alight',
  ALREADY_ALIGHTED: 'Already alighted — pending offline sync',
  BOARDING_LOCATION_REQUIRED: 'Boarding location is required. Please select your current stop.',
  DESTINATION_REQUIRED: 'Destination is required. Please select passenger destination.',
  ALIGHTING_LOCATION_REQUIRED: 'Alighting location is required.',

  // Balance
  INSUFFICIENT_BALANCE: (balance: number) => 
    `Insufficient balance (₱${balance.toFixed(2)}). Please pay via Cash or GCash.`,

  // Network
  NETWORK_ERROR: 'Unable to reach server. Check your connection or try again.',
  NETWORK_TIMEOUT: 'Request timed out. Please try again.',
  OFFLINE_MODE: 'You are offline. Some features may be limited.',

  // GPS
  GPS_UNAVAILABLE: 'GPS unavailable. Please enable location services.',
  GPS_PERMISSION_DENIED: 'Location permission denied. Please enable in settings.',
  GPS_SEARCHING: 'Searching for GPS...',

  // General
  UNKNOWN_ERROR: 'An error occurred. Please try again.',
  MISSING_DATA: 'Missing required data',
  INVALID_INPUT: 'Invalid input provided',
} as const;

export const SUCCESS_MESSAGES = {
  // Boarding
  BOARDED: (paymentMethod: string, amount: number) => {
    const method = paymentMethod.toUpperCase();
    return `Boarded — ${method} payment recorded (₱${amount.toFixed(2)})`;
  },
  BOARDED_OFFLINE: (amount: number) => 
    `Boarded — saved offline, will sync when online (₱${amount.toFixed(2)})`,
  TICKET_BOARDED: (amount: number) => 
    `Ticket boarded successfully (₱${amount.toFixed(2)})`,
  
  // Alighting
  ALIGHTED: 'Alighted successfully',
  ALIGHTED_OFFLINE: 'Alighted — saved offline, will sync when online',

  // Sync
  SYNC_COMPLETE: 'Data synced successfully',
  SYNC_FAILED: 'Sync failed. Will retry later.',

  // General
  OPERATION_COMPLETE: 'Operation completed successfully',
} as const;

export const WARNING_MESSAGES = {
  // GPS
  GPS_WEAK_SIGNAL: 'GPS signal weak. Location may be inaccurate.',
  GPS_NOT_MATCHING: 'Current location does not match expected stop.',
  
  // Trip
  PASSENGERS_ON_BOARD: (count: number) => 
    `${count} passenger(s) still on board. Continue ending trip?`,
  
  // General
  CONFIRM_ACTION: 'Are you sure you want to proceed?',
} as const;

export const INFO_MESSAGES = {
  // GPS
  GPS_ACTIVE: 'GPS active',
  GPS_SEARCHING: 'GPS connecting...',
  GPS_INACTIVE: 'GPS unavailable',

  // Network
  ONLINE: 'Connected to server',
  OFFLINE: 'Offline mode active',
  SYNCING: 'Syncing data...',

  // Trip
  TRIP_ACTIVE: 'Trip in progress',
  TRIP_ENDED: 'Trip completed',
} as const;
