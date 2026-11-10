# Fare Irregularity System - Quick Reference

## What Changed

The destination alert system has been enhanced to **automatically log detailed fare irregularities** to the database when suspicious activities are detected.

## New Irregularity Types

### 1. **destination_overstay**
Passenger fails to alight at their designated stop

**Triggers when:**
- Bus reaches passenger's destination (alerts conductor)
- Bus travels >1 km past the destination
- Passenger still hasn't alighted

**What's logged:**
- Passenger name and card UID
- Designated destination vs. current location
- Distance traveled past destination
- Time elapsed since boarding
- GPS coordinates

### 2. **double_scan** (enhanced)
Duplicate boarding attempt on same trip

**Now logs:**
- Card/ticket UID
- Conductor ID
- GPS location of attempt
- Full context description

### 3. **count_mismatch** (planned)
Manual count differs from QR validated count

## Database Changes

### New Columns in `fare_irregularities`:
- `conductor_id` - Who detected it
- `card_uid` - Card/ticket identifier  
- `passenger_id` - Reference to boarded_passengers
- `location_lat` / `location_lng` - GPS coordinates
- `destination_stop` - Expected destination
- `current_stop` - Actual current stop
- `distance_km` - Distance from expected stop
- `notes` - Additional context

### New Enum Values:
- `destination_overstay`
- `missed_alighting`

## How It Works

```
Passenger boards → Destination recorded
     ↓
GPS tracks bus location
     ↓
Within 500m of stop → Alert conductor
     ↓
Bus passes stop (>1km) + Passenger still onboard
     ↓
AUTOMATICALLY LOG IRREGULARITY to database
```

## Files Modified

1. **`supabase/schema.sql`** - Enhanced table structure
2. **`supabase/migrations/add_destination_irregularities.sql`** - Migration script
3. **`src/hooks/useDestinationAlerts.ts`** - Auto-logging logic
4. **`src/pages/ScanPage.tsx`** - Double scan logging
5. **`src/pages/HomePage.tsx`** - Hook integration

## Configuration Required

### 1. Apply Database Migration

Run the migration to update your Supabase database:
```sql
-- File: supabase/migrations/add_destination_irregularities.sql
-- This adds new columns and enum values
```

### 2. Add Bus Stops

Edit `src/config/busStops.ts` with your route stops:
```typescript
export const BUS_STOP_LOCATIONS = {
  'Your Stop Name': {
    lat: 23.1234,  // From Google Maps
    lng: 58.5678,
    description: 'Optional'
  }
};
```

## What Conductors See

### During Trip:
1. **Approaching stop:** Orange toast notification
   - "Approaching Airport - Passenger: Ahmed Al-Said"
2. **Irregularity logged:** No interruption, automatic background logging

### After Trip:
Review irregularities in admin dashboard to see:
- All flagged passengers
- GPS locations
- Timestamps
- Detailed descriptions

## For Administrators

### Query Irregularities:
```sql
SELECT * FROM fare_irregularities
WHERE trip_id = 'trip-uuid'
AND resolved = FALSE
ORDER BY detected_at DESC;
```

### Review Details:
Each irregularity includes:
- Type (destination_overstay, double_scan, etc.)
- Passenger information
- GPS coordinates
- Distance from expected stop
- Time context
- Full description

### Mark as Resolved:
```sql
UPDATE fare_irregularities
SET resolved = TRUE,
    resolved_by = 'admin-uuid',
    resolved_at = NOW(),
    notes = 'Resolution notes here'
WHERE id = 'irregularity-uuid';
```

## Benefits

1. **Automatic Detection** - No manual conductor logging required
2. **Detailed Context** - GPS, timing, distance all recorded
3. **Audit Trail** - Complete history for review
4. **Pattern Detection** - Identify repeat offenders
5. **Revenue Protection** - Catch fare evasion attempts
6. **Operational Insights** - Understand passenger behavior

## Example Irregularity Record

```json
{
  "id": "uuid-123",
  "trip_id": "trip-456",
  "conductor_id": "conductor-789",
  "card_uid": "1234567890",
  "passenger_id": "passenger-abc",
  "type": "destination_overstay",
  "description": "Passenger 'Ahmed Al-Said' (student) failed to alight at designated stop 'University Campus'. Boarded 25 minutes ago. Bus is now 1.50 km past the stop. This may indicate a missed stop, fare evasion, or passenger confusion.",
  "detected_at": "2026-09-19T10:25:15Z",
  "location_lat": 23.5908,
  "location_lng": 58.4062,
  "destination_stop": "University Campus",
  "current_stop": "Mall of Muscat",
  "distance_km": 1.500,
  "resolved": false,
  "notes": "Passenger boarded at 10:00:15 AM"
}
```

## Next Steps

1. ✅ Run database migration
2. ✅ Configure your bus stops in `busStops.ts`
3. ✅ Test with a trip
4. ✅ Review irregularities in database
5. ⬜ Build admin dashboard to view/manage irregularities
6. ⬜ Train conductors on the system
7. ⬜ Establish resolution procedures

## Support

See full documentation: `docs/DESTINATION_ALERTS.md`

For questions:
- Check browser console for errors
- Verify GPS is enabled
- Ensure stop names match exactly
- Check database migration applied successfully

---

**Status**: ✅ Ready for production  
**Version**: 2.0 - Enhanced Irregularity Tracking
