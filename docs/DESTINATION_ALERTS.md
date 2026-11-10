# Destination Alert System

## Overview

The destination alert system automatically notifies the conductor when the bus approaches a stop where passengers need to alight. This helps ensure passengers don't miss their stops.

## How It Works

1. **GPS Tracking**: The app continuously tracks the bus location using GPS
2. **Passenger Destinations**: When passengers board with QR cards, their destination stops are recorded
3. **Proximity Detection**: The system monitors the distance to each destination stop
4. **Alert Notification**: When the bus comes within 500 meters of a stop with waiting passengers, a toast notification appears

## Features

- **Real-time Monitoring**: Checks proximity every 10 seconds
- **Smart Grouping**: Groups multiple passengers going to the same stop
- **One-time Alerts**: Each stop alerts only once per trip to avoid spam
- **Passenger Details**: Shows passenger names (up to 3) and total count
- **Configurable Threshold**: Adjust the proximity distance as needed

## Configuration

### Adding Bus Stop Locations

Bus stop coordinates are configured in:
```
src/config/busStops.ts
```

#### Step 1: Find Coordinates

1. Open [Google Maps](https://maps.google.com)
2. Navigate to the bus stop location
3. Right-click on the exact location
4. Select "What's here?" from the menu
5. Copy the coordinates shown (format: latitude, longitude)

#### Step 2: Add to Configuration

Edit `src/config/busStops.ts`:

```typescript
export const BUS_STOP_LOCATIONS: Record<string, BusStopLocation> = {
  'Your Stop Name': {
    lat: 23.1234,      // Replace with actual latitude
    lng: 58.5678,      // Replace with actual longitude
    description: 'Optional description'
  },
  
  // Add more stops...
};
```

**Important**: The stop name in the config file MUST exactly match the destination names used in your QR cards or ticket system.

### Adjusting Proximity Threshold

The default alert distance is 500 meters (0.5 km). To change it:

```typescript
export const PROXIMITY_THRESHOLD_KM = 0.5; // Change this value
```

Recommended ranges:
- **Urban routes**: 0.3 - 0.5 km (300-500 meters)
- **Highway routes**: 1.0 - 2.0 km (1-2 kilometers)
- **Rural routes**: 2.0 - 5.0 km (2-5 kilometers)

## Alert Format

When approaching a stop, the conductor sees a toast notification:

**Single Passenger:**
```
⚠️ Approaching Downtown Terminal - Passenger: Ahmed Al-Said
```

**Multiple Passengers:**
```
⚠️ Approaching Mall of Muscat - 5 passengers: Sara Ali, Mohammed Hassan, Fatima Ahmed, +2 more
```

## Troubleshooting

### Alerts Not Showing

**Check GPS Status:**
- Ensure GPS is enabled on the device
- Check that location permissions are granted
- Look for the GPS status indicator on the home screen

**Verify Stop Configuration:**
- Confirm stop names match exactly between QR cards and busStops.ts
- Check that coordinates are correct (latitude, longitude order)
- Ensure PROXIMITY_THRESHOLD_KM is not too small

**Check Network:**
- Alerts require an internet connection to load passenger data
- In offline mode, alerts won't trigger until reconnected

### Duplicate Alerts

If you see repeated alerts for the same stop:
- This shouldn't happen - alerts are designed to trigger once per trip
- If it does, check the browser console for errors
- The alert cooldown system may need adjustment

### Missing Stops

If a destination doesn't trigger an alert:
- The stop name might not match exactly (check case sensitivity)
- Coordinates may not be defined in busStops.ts
- Bus may not have come within the proximity threshold

## Technical Details

### Files Modified

- `src/hooks/useDestinationAlerts.ts` - Main alert logic
- `src/config/busStops.ts` - Stop location configuration
- `src/pages/HomePage.tsx` - Integration with home page
- `src/services/locationService.ts` - Distance calculation utilities

### Database Queries

The system queries the `boarded_passengers` table every minute to get:
- Passengers still on board (alighted_at IS NULL)
- Their destination stops
- Passenger names from linked QR cards

### Performance

- GPS checks run every 10 seconds
- Passenger data refreshes every 60 seconds
- Distance calculations use the Haversine formula (accurate for Earth's curvature)
- Minimal battery impact with optimized intervals

## Future Enhancements

Potential improvements:
- Voice announcements for stops
- Map view showing stops and current location
- Historical alert logs
- Custom alert sounds per route
- Support for route variations
- Automatic stop learning from GPS patterns

## Support

For issues or questions:
1. Check the browser console for error messages
2. Verify your busStops.ts configuration
3. Test GPS functionality on the device
4. Review passenger destination data in the database

---

**Last Updated**: 2026-09-19
