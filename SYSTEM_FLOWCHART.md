# CommutAI Conductor App - System Flowcharts & Bug Analysis

This document provides comprehensive flowcharts for all system functionalities and identifies potential bugs and issues.

---

## Table of Contents

1. [User Authentication Flow](#1-user-authentication-flow)
2. [Trip Management Flow](#2-trip-management-flow)
3. [QR Card Boarding Flow](#3-qr-card-boarding-flow)
4. [Temporary Ticket Boarding Flow](#4-temporary-ticket-boarding-flow)
5. [Alighting Flow](#5-alighting-flow)
6. [Fare Calculation Flow](#6-fare-calculation-flow)
7. [GPS Location Tracking Flow](#7-gps-location-tracking-flow)
8. [Destination Alert Flow](#8-destination-alert-flow)
9. [Offline Mode Flow](#9-offline-mode-flow)
10. [Passenger Management Flow](#10-passenger-management-flow)
11. [Baggage Fee Calculation Flow](#11-baggage-fee-calculation-flow)
12. [Irregularity Detection Flow](#12-irregularity-detection-flow)
13. [Offline Sync Flow](#13-offline-sync-flow)
14. [SMS Notification Flow](#14-sms-notification-flow)

---

## 1. User Authentication Flow

### Flowchart

```
START
  │
  ├─→ User opens app
  │   │
  ├─→ Check for stored session
  │   │
  ├─→ [Session exists?]
  │   │   │
  │   ├─→ YES → Validate session with Supabase
  │   │   │   │
  │   │   ├─→ [Valid?]
  │   │   │   │
  │   │   ├─→ YES → Load conductor profile → Navigate to Home
  │   │   │
  │   │   └─→ NO → Clear session → Show Login Page
  │   │
  │   └─→ NO → Show Login Page
  │       │
  │       ├─→ User enters credentials
  │       │
  │       ├─→ Call Supabase auth.signInWithPassword()
  │       │
  │       ├─→ [Success?]
  │       │   │
  │       ├─→ YES → Store session → Load profile → Navigate to Home
  │       │
  │       └─→ NO → Show error message
  │
END
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Session validation not implemented - might use expired sessions | HIGH | LoginPage.tsx | Add session validation on app load |
| 2 | No token refresh mechanism - session expires silently | HIGH | Supabase client | Implement token refresh listener |
| 3 | No logout functionality exposed | MEDIUM | UI | Add logout button in ProfilePage |
| 4 | Profile data might be stale if not refreshed | MEDIUM | AppContext.tsx | Add profile refresh on login |
| 5 | No rate limiting on login attempts | LOW | LoginPage.tsx | Add login attempt throttling |

---

## 2. Trip Management Flow

### Flowchart

```
START TRIP
  │
  ├─→ Conductor clicks "Start Trip"
  │   │
  ├─→ Validate conductor is assigned to a bus
  │   │
  ├─→ [Has assigned bus?]
  │   │   │
  │   ├─→ NO → Show error "No bus assigned"
  │   │
  │   └─→ YES → Continue
  │       │
  ├─→ Check if trip already in progress
  │   │
  ├─→ [Trip in progress?]
  │   │   │
  │   ├─→ YES → Show error "Trip already in progress"
  │   │
  │   └─→ NO → Continue
  │       │
  ├─→ Get GPS location (optional)
  │   │
  ├─→ Prompt for starting point and destination
  │   │
  ├─→ Validate route direction (Agora ↔ Manolo)
  │   │
  ├─→ Create trip record in database
  │   │   - trip_id
  │   │   - bus_id
  │   │   - conductor_id
  │   │   - starting_point
  │   │   - end_point
  │   │   - status = 'in_progress'
  │   │   - started_at
  │   │
  ├─→ Set active trip in context
  │   │
  ├─→ Start GPS tracking
  │   │
  ├─→ Start destination alerts
  │   │
  └─→ Navigate to Scan Page

END TRIP
  │
  ├─→ Conductor clicks "End Trip"
  │   │
  ├─→ Check if all passengers have alighted
  │   │
  ├─→ [Passengers still on board?]
  │   │   │
  │   ├─→ YES → Show warning with passenger count
  │   │   │   │
  │   │   ├─→ [Force end?]
  │   │   │   │
  │   │   ├─→ YES → Mark all remaining as irregular
  │   │   │
  │   │   └─→ NO → Cancel
  │   │
  │   └─→ NO → Continue
  │       │
  ├─→ Calculate final statistics
  │   │   - Total passengers
  │   │   - Total fare collected
  │   │   - Irregularity count
  │   │
  ├─→ Update trip record
  │   │   - status = 'completed'
  │   │   - ended_at
  │   │
  ├─→ Stop GPS tracking
  │   │
  ├─→ Stop destination alerts
  │   │
  ├─→ Sync any pending offline data
  │   │
  └─→ Show trip summary
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Trip can be started without GPS location | MEDIUM | HomePage.tsx | Make GPS mandatory or show warning |
| 2 | No validation that starting point matches actual GPS location | HIGH | HomePage.tsx | Add GPS location validation |
| 3 | Trip direction might be incorrect if stops don't match route | HIGH | fareService.ts | Add route validation against fare matrix |
| 4 | No auto-completion of trip outside operating hours (04:00-22:00) | MEDIUM | HomePage.tsx | Implement auto-completion logic |
| 5 | Offline trips might not sync properly if network lost during trip end | HIGH | HomePage.tsx | Add retry logic for trip sync |
| 6 | No protection against multiple conductors starting trip on same bus | HIGH | Backend | Add RLS policy or unique constraint |
| 7 | GPS tracking might stop silently if permission revoked | HIGH | useDestinationAlerts.ts | Add GPS permission monitoring |
| 8 | Trip summary might not reflect actual database state if sync pending | MEDIUM | TripSummaryPage.tsx | Force sync before showing summary |

---

## 3. QR Card Boarding Flow

### Flowchart

```
START
  │
  ├─→ Conductor selects "Boarding" mode
  │   │
  ├─→ QR scanner activated
  │   │
  ├─→ User scans QR card
  │   │
  ├─→ Normalize QR code (remove special chars)
  │   │
  ├─→ Detect card type from prefix
  │   │
  ├─→ [Online?]
  │   │   │
  │   ├─→ NO → Use offline path
  │   │   │   │
  │   │   ├─→ Check cache for card data
  │   │   │   │
  │   │   ├─→ [Card found in cache?]
  │   │   │   │
  │   │   ├─→ YES → Use cached data
  │   │   │   │
  │   │   └─→ NO → Use prefix-based defaults
  │   │   │       │
  │   │   │       ├─→ Show destination selection
  │   │   │       │
  │   │   │       ├─→ Show boarding point selection
  │   │   │       │
  │   │   │       ├─→ Calculate fare (matrix or default)
  │   │   │       │
  │   │   │       ├─→ Add to offline queue
  │   │   │       │
  │   │   │       └─→ Show success message
  │   │   │
  │   └─→ YES → Use online path
  │       │
  ├─→ Query qr_cards table by card_uid
  │   │
  ├─→ [Card found?]
  │   │   │
  │   ├─→ NO → Show error "Card not found"
  │   │
  │   └─→ YES → Validate card
  │       │
  ├─→ [Card status = 'active'?]
  │   │   │
  │   ├─→ NO → Show error "Card inactive/lost"
  │   │
  │   └─→ YES → Continue
  │       │
  ├─→ Check route restrictions
  │   │
  ├─→ [Route allowed?]
  │   │   │
  │   ├─→ NO → Show error "Invalid route"
  │   │
  │   └─→ YES → Continue
  │       │
  ├─→ Check if already boarded on this trip
  │   │
  ├─→ [Already boarded?]
  │   │   │
  │   ├─→ YES → Log irregularity (double_scan)
  │   │   │   │
  │   │   └─→ Show error "Already boarded"
  │   │
  │   └─→ NO → Continue
  │       │
  ├─→ Show destination selection (if not on card)
  │   │
  ├─→ Show boarding point selection
  │   │
  ├─→ Show payment method selection
  │   │
  ├─→ Show baggage fee selection (optional)
  │   │
  ├─→ Calculate fare
  │   │   - Normalize stop names
  │   │   - Get fare from matrix
  │   │   - Apply passenger type discount
  │   │   - Add baggage fee
  │   │
  ├─→ [Payment method = card/qr_card?]
  │   │   │
  │   ├─→ YES → Check balance
  │   │   │   │
  │   │   ├─→ [Balance >= fare?]
  │   │   │   │
  │   │   ├─→ NO → Show warning + switch to cash/gcash
  │   │   │
  │   │   └─→ YES → Continue
  │   │
  │   └─→ NO → Continue
  │       │
  ├─→ Conductor confirms boarding
  │   │
  ├─→ Call processScan() with all parameters
  │   │
  ├─→ Deduct balance (if card payment)
  │   │
  ├─→ Create transaction record
  │   │   - fare_amount
  │   │   - discount_amount
  │   │   - amount (total)
  │   │   - payment_method
  │   │   - baggage_fee
  │   │
  ├─→ Create boarded_passengers record
  │   │   - card_id
  │   │   - boarding_stop
  │   │   - destination_stop
  │   │   - payment_method
  │   │
  ├─→ Invalidate card cache
  │   │
  ├─→ Update local state
  │   │   - Increment validated count
  │   │   - Increment current passengers
  │   │   - Add to local storage
  │   │
  └─→ Show success message
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Offline path uses default fare (15) which might be wrong | HIGH | ScanPage.tsx | Store fare matrix offline or cache it |
| 2 | Card cache might be stale if balance updated elsewhere | HIGH | fareService.ts | Add cache TTL and refresh logic |
| 3 | No validation that destination is in correct direction | HIGH | ScanPage.tsx | Validate destination against trip direction |
| 4 | Double scan detection only checks current trip, not all trips | MEDIUM | fareService.ts | Check all active trips for double scan |
| 5 | Fare calculation might fail if matrix not loaded | HIGH | fareService.ts | Add fallback and error handling |
| 6 | No retry if transaction creation fails | HIGH | fareService.ts | Add transaction retry logic |
| 7 | Balance deduction and boarding record not atomic | CRITICAL | fareService.ts | Use database transaction |
| 8 | Baggage fee might be charged without category selection | MEDIUM | ScanPage.tsx | Add validation |
| 9 | Payment method fallback might cause duplicate records | MEDIUM | ScanPage.tsx | Add state check before fallback |
| 10 | No audit trail for manual payment method changes | LOW | fareService.ts | Log payment method changes |

---

## 4. Temporary Ticket Boarding Flow

### Flowchart

```
START
  │
  ├─→ Conductor selects "Boarding" mode
  │   │
  ├─→ QR scanner activated
  │   │
  ├─→ User scans temporary ticket
  │   │
  ├─→ Detect ticket type from prefix
  │   │
  ├─→ [Online?]
  │   │   │
  │   ├─→ NO → Use offline path
  │   │   │   │
  │   │   ├─→ Check cache for ticket data
  │   │   │   │
  │   │   ├─→ [Ticket found in cache?]
  │   │   │   │
  │   │   ├─→ YES → Use cached data
  │   │   │   │
  │   │   └─→ NO → Use prefix-based defaults
  │   │   │       │
  │   │   │       ├─→ Show destination selection
  │   │   │       │
  │   │   │       ├─→ Show boarding point selection
  │   │   │       │
  │   │   │       ├─→ Calculate fare + service fee (2 pesos)
  │   │   │       │
  │   │   │       ├─→ Add to offline queue
  │   │   │       │
  │   │   │       └─→ Show success message
  │   │   │
  │   └─→ YES → Use online path
  │       │
  ├─→ Query temporary_tickets table by ticket_uid
  │   │
  ├─→ [Ticket found?]
  │   │   │
  ├─→ NO → Show error "Ticket not found"
  │   │
  └─→ YES → Validate ticket
      │
  ├─→ [Ticket status = 'issued'?]
  │   │
  ├─→ NO → Show error "Ticket already used/expired"
  │
  └─→ YES → Continue
      │
  ├─→ Check if already boarded on this trip
  │   │
  ├─→ [Already boarded?]
  │   │
  ├─→ YES → Log irregularity (double_scan)
  │   │
  └─→ NO → Continue
      │
  ├─→ Show destination (if on ticket) or prompt for selection
  │
  ├─→ Show boarding point selection
  │
  ├─→ Show payment method (cash/gcash only)
  │
  ├─→ Show baggage fee selection (optional)
  │
  ├─→ Calculate fare
  │   - Base fare from ticket
  │   - Add service fee (2 pesos)
  │   - Add baggage fee
  │
  ├─→ Conductor confirms boarding
  │
  ├─→ Call processScan() with all parameters
  │
  ├─→ Update ticket status to 'validated'
  │
  ├─→ Create transaction record
  │   - fare_amount (base)
  │   - amount (base + service + baggage)
  │   - payment_method
  │   - baggage_fee
  │
  ├─→ Create boarded_passengers record
  │   - temp_ticket_id
  │   - boarding_stop
  │   - destination_stop
  │   - payment_method
  │
  ├─→ Invalidate ticket cache
  │
  ├─→ Update local state
  │   - Increment validated count
  │   - Increment current passengers
  │   - Add to local storage
  │
  └─→ Show success message
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Service fee added in fareService but not in offline path | HIGH | fareService.ts vs ScanPage.tsx | Ensure service fee added consistently |
| 2 | Ticket validation not atomic with boarding record | CRITICAL | fareService.ts | Use database transaction |
| 3 | No validation that ticket destination is valid route | MEDIUM | ScanPage.tsx | Validate destination against route |
| 4 | Ticket might be used on multiple trips if validation fails | HIGH | fareService.ts | Use optimistic locking or status check |
| 5 | No refund if boarding fails after validation | MEDIUM | fareService.ts | Add rollback logic |
| 6 | Offline queue might lose ticket status updates | HIGH | offlineQueueService.ts | Add retry with status check |
| 7 | Service fee not stored separately in transaction | LOW | fareService.ts | Add service_fee column |
| 8 | No validation that ticket fare matches matrix fare | MEDIUM | fareService.ts | Add fare validation |
| 9 | Passenger type from ticket might be incorrect | MEDIUM | temporary_tickets table | Add passenger type validation |
| 10 | No expiry time check for temporary tickets | MEDIUM | fareService.ts | Add expiry validation |

---

## 5. Alighting Flow

### Flowchart

```
START
  │
  ├─→ Conductor selects "Alighting" mode
  │   │
  ├─→ QR scanner activated
  │   │
  ├─→ User scans QR card or ticket
  │   │
  ├─→ Detect card/ticket type from prefix
  │   │
  ├─→ [Online?]
  │   │   │
  │   ├─→ NO → Use offline path
  │   │   │   │
  │   │   ├─→ Check offline queue for boarding record
  │   │   │   │
  │   │   ├─→ [Boarding record found?]
  │   │   │   │
  │   │   ├─→ YES → Get fare and destination from queue
  │   │   │   │
  │   │   └─→ NO → Show error "Not boarded"
  │   │   │
  │   │   ├─→ Validate GPS location (optional)
  │   │   │   │
  │   │   ├─→ Show confirmation with fare already paid
  │   │   │   │
  │   │   ├─→ Conductor confirms alighting
  │   │   │   │
  │   │   ├─→ Add to offline queue (type: alighting)
  │   │   │   │
  │   │   ├─→ Mark as alighted in local storage
  │   │   │   │
  │   │   └─→ Show success message
  │   │   │
  │   └─→ YES → Use online path
  │       │
  ├─→ Get boarded passenger record
  │   │
  ├─→ [Boarded on this trip?]
  │   │   │
  ├─→ NO → Show error "Not boarded on this trip"
  │   │
  └─→ YES → Continue
      │
  ├─→ Get boarding transaction details
  │   │   - amount (total fare paid)
  │   │   - baggage_fee
  │   │   - payment_method
  │
  ├─→ Validate GPS location
  │   │
  ├─→ [GPS location matches destination?]
  │   │   │
  ├─→ NO → Calculate actual fare to current location
  │   │   │
  │   ├─→ [Actual fare > paid fare?]
  │   │   │
  │   ├─→ YES → Log irregularity (overshooting)
  │   │   │   │
  │   │   │   └─→ Show fare difference warning
  │   │   │
  │   └─→ NO → Log irregularity (missed_alighting)
  │   │
  └─→ YES → Continue
      │
  ├─→ Show confirmation
  │   │   - Boarding point
  │   │   - Destination
  │   │   - Fare already paid
  │   │   - Baggage fee
  │   │   - Payment method
  │   │
  ├─→ Conductor confirms alighting
  │   │
  ├─→ Call processScan() with type='alighting'
  │   │
  ├─→ Update boarded_passengers record
  │   │   - alighted_at = NOW()
  │   │
  ├─→ [Destination mismatch?]
  │   │   │
  ├─→ YES → Log irregularity with details
  │   │
  └─→ NO → Continue
      │
  ├─→ Queue SMS notification (if contact number)
  │   │
  ├─→ Update local state
  │   │   - Decrement current passengers
  │   │   - Increment alighted count
  │   │   - Remove from local storage
  │   │
  └─→ Show success message
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | GPS validation might fail silently if GPS unavailable | HIGH | geoService.ts | Add fallback and error handling |
| 2 | Alighting at wrong stop charges additional fare but no payment | MEDIUM | ScanPage.tsx | Clarify policy - charge or just log? |
| 3 | Fare recalculation doesn't include service fee for tickets | MEDIUM | ScanPage.tsx | Check if service fee should be included |
| 4 | No validation that alighting is after boarding in sequence | MEDIUM | fareService.ts | Add sequence validation |
| 5 | Offline alighting might succeed without boarding record | HIGH | offlineQueueService.ts | Add boarding record check |
| 6 | SMS queue might fail silently | MEDIUM | smsService.ts | Add error logging and retry |
| 7 | Alighting timestamp might be incorrect if offline | LOW | storageService.ts | Use device time with timezone |
| 8 | No protection against alighting same passenger twice | MEDIUM | fareService.ts | Already checked but add defensive check |
| 9 | GPS mismatch calculation might use wrong fare matrix | MEDIUM | ScanPage.tsx | Ensure correct direction used |
| 10 | Fare difference not charged, only logged - inconsistent | MEDIUM | Business logic | Decide if fare should be charged |

---

## 6. Fare Calculation Flow

### Flowchart

```
START
  │
  ├─→ Receive parameters
  │   - fromStop (boarding point)
  │   - toStop (destination)
  │   - passengerType (regular/student/senior/pwd)
  │   - baggageSelection (optional)
  │
  ├─→ Normalize stop names
  │   - Convert to lowercase
  │   - Remove special characters
  │   - Handle terminal name variants
  │
  ├─→ Determine trip direction
  │   - Check fromStop and toStop in route sequences
  │   - Set direction (agora_to_manolo or manolo_to_agora)
  │
  ├─→ Load fare matrix for direction
  │   │
  ├─→ [Matrix loaded?]
  │   │
  ├─→ NO → Use bundled JSON fallback
  │   │
  └─→ YES → Use live database matrix
      │
  ├─→ Search for fare entry
  │   - Try exact match
  │   - Try normalized match
  │   - Try alias match
  │
  ├─→ [Fare found?]
  │   │
  ├─→ NO → Return null (fare not found)
  │   │
  └─→ YES → Continue
      │
  ├─→ Select fare based on passenger type
  │   - Regular: regular_fare
  │   - Student/Senior/PWD: discounted_fare
  │
  ├─→ Calculate discount
  │   - 20% for discounted types
  │
  ├─→ Calculate baggage fee
  │   - Get from baggage_fee_matrix
  │   - Multiply by weight/quantity
  │
  ├─→ Calculate total fare
  │   - baseFare - discount + baggageFee
  │
  ├─→ Add service fee for temporary tickets (2 pesos)
  │
  └─→ Return fare calculation result
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Fare matrix might not load if network down | HIGH | fareService.ts | Ensure bundled JSON always available |
| 2 | Direction detection might fail for invalid stops | HIGH | fareService.ts | Add validation and error handling |
| 3 | Stop normalization might match wrong stops | MEDIUM | fareService.ts | Improve normalization algorithm |
| 4 | No validation that fromStop and toStop are different | LOW | fareService.ts | Add validation |
| 5 | Discount applied twice (in matrix and calculation) | HIGH | fareService.ts | Use discounted_fare from matrix directly |
| 6 | Baggage fee calculation doesn't validate weight | MEDIUM | fareService.ts | Add weight validation |
| 7 | Service fee only added in fareService, not ScanPage | HIGH | fareService.ts vs ScanPage.tsx | Ensure consistency (FIXED) |
| 8 | No currency validation or formatting | LOW | fareService.ts | Add currency handling |
| 9 | Fare might be null without clear error message | MEDIUM | fareService.ts | Add descriptive error |
| 10 | Matrix real-time sync might overwrite cached fares | MEDIUM | fareService.ts | Add version checking |

---

## 7. GPS Location Tracking Flow

### Flowchart

```
START
  │
  ├─→ Trip started
  │   │
  ├─→ Initialize GPS tracking
  │   │
  ├─→ [Raspberry Pi GPS available?]
  │   │   │
  ├─→ YES → Use Pi GPS (http://commutai.local:5000/api/gps)
  │   │   │
  │   ├─→ Fetch GPS coordinates
  │   │   │
  │   ├─→ [Request successful?]
  │   │   │
  │   ├─→ YES → Use Pi coordinates
  │   │   │
  │   └─→ NO → Fallback to device GPS
  │   │
  └─→ NO → Use device GPS (Capacitor Geolocation)
      │
  ├─→ Request location permissions
  │   │
  ├─→ [Permissions granted?]
  │   │
  ├─→ NO → Show error "GPS required"
  │   │
  └─→ YES → Continue
      │
  ├─→ Get current position
  │   │
  ├─→ [Position available?]
  │   │
  ├─→ NO → Show warning "GPS unavailable"
  │   │
  └─→ YES → Continue
      │
  ├─→ Store GPS coordinates
  │   │
  ├─→ Log to gps_logs table (if online)
  │   │
  ├─→ Update trip current_lat/current_lng
  │   │
  ├─→ Calculate nearest bus stop
  │   │
  ├─→ Start polling interval (10 seconds)
  │   │
  └─→ Repeat for each poll
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Pi GPS might be unavailable without fallback | HIGH | gpsService.ts | Add proper fallback with retry |
| 2 | Device GPS might have poor accuracy | MEDIUM | geoService.ts | Add accuracy threshold |
| 3 | GPS permissions might be revoked during trip | HIGH | useDestinationAlerts.ts | Add permission monitoring |
| 4 | GPS polling might drain battery | MEDIUM | useDestinationAlerts.ts | Adjust interval based on speed |
| 5 | GPS logs might not sync if network lost | HIGH | storageService.ts | Add offline queue for GPS logs |
| 6 | No validation that GPS coordinates are reasonable | MEDIUM | gpsService.ts | Add coordinate validation |
| 7 | Pi GPS endpoint might change or be unreachable | HIGH | gpsService.ts | Add configurable endpoint |
| 8 | GPS update might fail silently | MEDIUM | AppContext.tsx | Add error logging |
| 9 | No timeout for GPS requests | MEDIUM | gpsService.ts | Add request timeout |
| 10 | GPS data might be stale if not updated | LOW | AppContext.tsx | Add timestamp check |

---

## 8. Destination Alert Flow

### Flowchart

```
START
  │
  ├─→ Trip started with passengers
  │   │
  ├─→ Start GPS polling (10 seconds)
  │   │
  ├─→ For each GPS update:
  │   │
  ├─→ Get current location
  │   │
  ├─→ Get all onboard passengers
  │   │   - Filter by alighted_at IS NULL
  │   │   - Get their destinations
  │   │
  ├─→ For each passenger destination:
  │   │
  ├─→ Calculate distance to destination stop
  │   │   - Use Haversine formula
  │   │
  ├─→ [Distance < 500m?]
  │   │   │
  ├─→ YES → Check if already alerted for this stop
  │   │   │
  ├─→ [Already alerted?]
  │   │   │
  ├─→ YES → Skip (cooldown active)
  │   │   │
  ├─→ NO → Show toast notification
  │   │   │   - Stop name
  │   │   │   - Passenger count
  │   │   │   - Passenger names (up to 3)
  │   │   │
  ├─→ Mark stop as alerted (5 min cooldown)
  │   │
  └─→ NO → Check if bus passed destination
      │
      ├─→ [Distance > 1km past destination?]
      │   │
      ├─→ YES → Check if passenger still on board
      │   │   │
      ├─→ [Still on board?]
      │   │   │
      ├─→ YES → Log irregularity (destination_overstay)
      │   │   │   - Passenger details
      │   │   │   - GPS coordinates
      │   │   │   - Distance past destination
      │   │   │
      └─→ NO → Continue
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Alert might trigger multiple times for same stop | MEDIUM | useDestinationAlerts.ts | Add persistent alert tracking |
| 2 | Distance calculation might be inaccurate | MEDIUM | locationService.ts | Validate Haversine implementation |
| 3 | No validation that destination stop exists in config | HIGH | useDestinationAlerts.ts | Add stop validation |
| 4 | Passenger data might be stale if not refreshed | MEDIUM | useDestinationAlerts.ts | Add data refresh interval |
| 5 | Alert might not show if app in background | HIGH | useDestinationAlerts.ts | Use local notifications |
| 6 | Cooldown doesn't persist across app restarts | LOW | useDestinationAlerts.ts | Store cooldown in storage |
| 7 | No sound or vibration for alerts | LOW | useDestinationAlerts.ts | Add haptic feedback |
| 8 | GPS polling might stop if app suspended | HIGH | useDestinationAlerts.ts | Use background task |
| 9 | Distance threshold hardcoded at 500m | LOW | useDestinationAlerts.ts | Make configurable |
| 10 | Overstay detection might trigger incorrectly | MEDIUM | useDestinationAlerts.ts | Add time delay check |

---

## 9. Offline Mode Flow

### Flowchart

```
START
  │
  ├─→ App initialized
  │   │
  ├─→ Check network status
  │   │
  ├─→ [Online?]
  │   │
  ├─→ NO → Set offline mode
  │   │   │
  │   ├─→ Load cached data
  │   │   │   - QR cards
  │   │   │   - Temporary tickets
  │   │   │   - Fare matrix
  │   │   │   - Bus stops
  │   │   │
  │   ├─→ Show offline banner
  │   │   │
  │   └─→ Use offline paths for all operations
  │       │
  │       ├─→ Boarding
  │       │   │
  │       │   ├─→ Use cached card/ticket data
  │       │   │
  │       │   ├─→ Calculate fare (matrix or default)
  │       │   │
  │       │   ├─→ Add to offline queue
  │       │   │
  │       │   └─→ Store in localStorage
  │       │
  │       ├─→ Alighting
  │       │   │
  │       │   ├─→ Check offline queue for boarding
  │       │   │
  │       │   ├─→ Add to offline queue
  │       │   │
  │       │   └─→ Mark as alighted in localStorage
  │       │
  │       └─→ GPS
  │           │
  │           ├─→ Use device GPS only
  │           │
  │           └─→ Queue GPS logs
  │
  └─→ YES → Set online mode
      │
      ├─→ Start background sync service
      │   │
      ├─→ Sync offline queue
      │   │   │
      │   ├─→ For each pending scan:
      │   │   │
      │   │   ├─→ Call processScan()
      │   │   │
      │   │   ├─→ [Success?]
      │   │   │
      │   │   ├─→ YES → Mark as synced, remove from queue
      │   │   │
      │   │   └─→ NO → Increment retry count
      │   │   │
      │   │   ├─→ [Retry count > max?]
      │   │   │
      │   │   ├─→ YES → Mark as failed, keep in queue
      │   │   │
      │   │   └─→ NO → Keep in queue for next sync
      │   │   │
      │   └─→ Update localStorage
      │       │
      ├─→ Refresh cached data
      │   │
      └─→ Hide offline banner
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Offline queue might grow indefinitely | HIGH | offlineQueueService.ts | Add queue size limit |
| 2 | Sync might fail silently | HIGH | backgroundSyncService.ts | Add error logging and user notification |
| 3 | Cached data might be stale | MEDIUM | cacheService.ts | Add cache expiration |
| 4 | No validation that offline scan is valid | MEDIUM | ScanPage.tsx | Add client-side validation |
| 5 | Sync order might cause data inconsistency | HIGH | backgroundSyncService.ts | Order by timestamp |
| 6 | No conflict resolution for duplicate scans | CRITICAL | backgroundSyncService.ts | Add conflict detection |
| 7 | Offline alighting might succeed without boarding | HIGH | offlineQueueService.ts | Add boarding check |
| 8 | Circuit breaker might not recover | MEDIUM | circuitBreaker.ts | Add recovery logic |
| 9 | No way to clear failed offline scans | MEDIUM | offlineQueueService.ts | Add manual clear option |
| 10 | Offline mode might not persist trip state | HIGH | storageService.ts | Add trip state persistence |

---

## 10. Passenger Management Flow

### Flowchart

```
START
  │
  ├─→ Conductor opens Passenger List
  │   │
  ├─→ Load onboard passengers
  │   │   - Query boarded_passengers
  │   │   - Filter by trip_id
  │   │   - Filter by alighted_at IS NULL
  │   │
  ├─→ [Online?]
  │   │
  ├─→ NO → Load from localStorage
  │   │
  └─→ YES → Load from database
      │
  ├─→ Group passengers by destination
  │   │
  ├─→ Display passenger list
  │   │   - Passenger name/ID
  │   │   - Boarding point
  │   │   - Destination
  │   │   - Fare paid
  │   │   - Boarding time
  │   │
  ├─→ Per-passenger actions:
  │   │
  ├─→ Alight button
  │   │   │
  │   ├─→ Redirect to scan with mode=alighting
  │   │   │
  │   └─→ Auto-fill passenger details
  │   │
  ├─→ Cancel Boarding button
  │   │   │
  │   ├─→ Confirm cancellation
  │   │   │
  │   ├─→ [Online?]
  │   │   │
  │   ├─→ NO → Mark as cancelled in localStorage
  │   │   │
  │   └─→ YES → Delete boarded_passengers record
  │   │   │
  │   │   ├─→ Refund fare to card balance
  │   │   │
  │   │   └─→ Create refund transaction
  │   │
  └─→ Report Irregularity button
      │
      ├─→ Open irregularity form
      │
      ├─→ Select irregularity type
      │
      ├─→ Add notes
      │
      ├─→ Submit to fare_irregularities table
      │
      └─→ Update passenger record
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Passenger list might not refresh after boarding | MEDIUM | PassengerListPage.tsx | Add auto-refresh |
| 2 | Cancel boarding might not refund correctly | HIGH | PassengerListPage.tsx | Add refund validation |
| 3 | Refund transaction might fail silently | HIGH | PassengerListPage.tsx | Add error handling |
| 4 | Irregularity report might not include GPS | MEDIUM | PassengerListPage.tsx | Add GPS capture |
| 5 | No validation that passenger exists | LOW | PassengerListPage.tsx | Add existence check |
| 6 | Offline passenger list might be incomplete | MEDIUM | storageService.ts | Add sync indicator |
| 7 | Grouping by destination might fail with null destinations | MEDIUM | PassengerListPage.tsx | Add null handling |
| 8 | No pagination for large passenger lists | LOW | PassengerListPage.tsx | Add pagination |
| 9 | Cancel boarding might not work for temporary tickets | MEDIUM | PassengerListPage.tsx | Add ticket handling |
| 10 | No audit trail for manual irregularity reports | LOW | fareService.ts | Add audit logging |

---

## 11. Baggage Fee Calculation Flow

### Flowchart

```
START
  │
  ├─→ Conductor selects baggage option
  │   │
  ├─→ Load baggage fee matrix
  │   │
  ├─→ [Online?]
  │   │
  ├─→ NO → Use hardcoded fees
  │   │
  └─→ YES → Load from baggage_fee_matrix table
      │
  ├─→ Display baggage categories
  │   │   - Small
  │   │   - Medium
  │   │   - Large
  │   │   - Extra Large
  │
  ├─→ User selects category
  │   │
  ├─→ User enters weight
  │   │
  ├─→ Validate weight
  │   │   - [Weight <= max_weight for category?]
  │   │
  ├─→ NO → Show error "Weight exceeds limit"
  │   │
  └─→ YES → Continue
      │
  ├─→ Calculate baggage fee
  │   - fee per kg × weight
  │   - OR flat fee per category
  │
  ├─→ Add to total fare
  │   │
  ├─→ Store baggage details
  │   │   - category
  │   │   - weight
  │   │   - fee
  │   │
  └─→ Display updated total fare
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Baggage fee might not sync if network lost | MEDIUM | BaggageFeeSelector.tsx | Add offline handling |
| 2 | Weight validation might not work for zero/negative | MEDIUM | BaggageFeeSelector.tsx | Add range validation |
| 3 | No validation that category exists in matrix | MEDIUM | fareService.ts | Add category validation |
| 4 | Fee calculation might be incorrect for partial kg | LOW | fareService.ts | Clarify pricing model |
| 5 | No maximum baggage limit | LOW | fareService.ts | Add limit validation |
| 6 | Baggage fee might be charged without passenger consent | MEDIUM | ScanPage.tsx | Add explicit confirmation |
| 7 | No baggage fee refund if boarding cancelled | MEDIUM | PassengerListPage.tsx | Add refund logic |
| 8 | Baggage details not stored in transaction correctly | MEDIUM | fareService.ts | Validate storage |
| 9 | No baggage fee history or reporting | LOW | Database | Add reporting feature |
| 10 | Hardcoded fees might not match database | MEDIUM | fareService.ts | Ensure consistency |

---

## 12. Irregularity Detection Flow

### Flowchart

```
START
  │
  ├─→ Automatic Detection
  │   │
  ├─→ Double Scan
  │   │   │
  │   ├─→ Scan QR card/ticket
  │   │   │
  │   ├─→ Check if already boarded on this trip
  │   │   │
  │   ├─→ [Already boarded?]
  │   │   │
  │   ├─→ YES → Log irregularity
  │   │   │   - type: 'double_scan'
  │   │   │   - card_uid
  │   │   │   - GPS location
  │   │   │   - Timestamp
  │   │   │
  │   └─→ NO → Continue
  │   │
  ├─→ Destination Mismatch
  │   │   │
  │   ├─→ Passenger alights
  │   │   │
  │   ├─→ Validate GPS location
  │   │   │
  │   ├─→ [Location != destination?]
  │   │   │
  │   ├─→ YES → Log irregularity
  │   │   │   - type: 'destination_mismatch' or 'overshooting'
  │   │   │   - expected destination
  │   │   │   - actual location
  │   │   │   - distance
  │   │   │
  │   └─→ NO → Continue
  │   │
  ├─→ Destination Overstay
  │   │   │
  │   ├─→ GPS polling
  │   │   │
  │   ├─→ [Bus > 1km past destination?]
  │   │   │
  │   ├─→ [Passenger still on board?]
  │   │   │
  │   ├─→ YES → Log irregularity
  │   │   │   - type: 'destination_overstay'
  │   │   │   - GPS coordinates
  │   │   │   - distance past destination
  │   │   │
  │   └─→ NO → Continue
  │   │
  ├─→ Count Mismatch
  │   │   │
  │   ├─→ Get AI camera count
  │   │   │
  │   ├─→ Get QR validated count
  │   │   │
  │   ├─→ [Difference > 5?]
  │   │   │
  │   ├─→ YES → Log irregularity
  │   │   │   - type: 'count_mismatch'
  │   │   │   - camera count
  │   │   │   - validated count
  │   │   │
  │   └─→ NO → Continue
  │
  └─→ Manual Detection
      │
      ├─→ Conductor clicks "Report Irregularity"
      │
      ├─→ Select irregularity type
      │   │   - fare_evasion
      │   │   - other
      │
      ├─→ Add notes
      │
      ├─→ Submit to fare_irregularities table
      │
      └─→ Mark passenger if applicable
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Double scan might not detect if trip changed | MEDIUM | fareService.ts | Check all active trips |
| 2 | Destination mismatch might have false positives | MEDIUM | geoService.ts | Improve distance threshold |
| 3 | Overstay detection might trigger if GPS inaccurate | HIGH | useDestinationAlerts.ts | Add time delay |
| 4 | Count mismatch might fail if camera offline | MEDIUM | AppContext.tsx | Add camera status check |
| 5 | No GPS coordinates for manual reports | MEDIUM | PassengerListPage.tsx | Add GPS capture |
| 6 | Irregularity might not sync if offline | HIGH | fareService.ts | Add offline queue |
| 7 | No validation that irregularity type is valid | LOW | fareService.ts | Add type validation |
| 8 | No resolution workflow for irregularities | MEDIUM | Admin panel | Add resolution UI |
| 9 | Irregularity might be logged multiple times | MEDIUM | fareService.ts | Add deduplication |
| 10 | No notification to admin for irregularities | LOW | fareService.ts | Add notification system |

---

## 13. Offline Sync Flow

### Flowchart

```
START
  │
  ├─→ Network status changes to online
  │   │
  ├─→ Background sync service triggered
  │   │
  ├─→ Check circuit breaker state
  │   │
  ├─→ [Circuit open?]
  │   │
  ├─→ YES → Wait for recovery timeout
  │   │
  └─→ NO → Continue
      │
  ├─→ Get offline queue
  │   │
  ├─→ [Queue empty?]
  │   │
  ├─→ YES → Exit
  │   │
  └─→ NO → Process each item
      │
      ├─→ For each scan in queue:
      │   │
      ├─→ [Retry count > max?]
      │   │
      ├─→ YES → Mark as failed, skip
      │   │
      └─→ NO → Continue
      │   │
      ├─→ Call processScan()
      │   │
      ├─→ [Success?]
      │   │
      ├─→ YES → Mark as synced, remove from queue
      │   │   │
      │   ├─→ Update localStorage
      │   │   │
      │   └─→ Update UI
      │   │
      └─→ NO → Increment retry count
      │   │
      │   ├─→ [Retry count > max?]
      │   │   │
      │   ├─→ YES → Mark as failed
      │   │   │
      │   └─→ NO → Keep in queue
      │   │
      ├─→ [Failure rate > threshold?]
      │   │
      ├─→ YES → Open circuit breaker
      │   │
      └─→ NO → Continue
          │
  ├─→ Sync GPS logs
  │   │
  ├─→ Refresh cached data
  │   │
  └─→ Notify user of sync status
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | Sync might fail silently | HIGH | backgroundSyncService.ts | Add error logging |
| 2 | Circuit breaker might not recover | MEDIUM | circuitBreaker.ts | Add recovery logic |
| 3 | Sync order might cause data issues | HIGH | backgroundSyncService.ts | Order by timestamp |
| 4 | No conflict detection for duplicate scans | CRITICAL | backgroundSyncService.ts | Add conflict resolution |
| 5 | Sync might not handle trip completion | MEDIUM | backgroundSyncService.ts | Add trip sync |
| 6 | No user notification for sync failures | MEDIUM | backgroundSyncService.ts | Add notifications |
| 7 | Sync might be slow with large queue | MEDIUM | backgroundSyncService.ts | Add batching |
| 8 | No retry exponential backoff | LOW | backgroundSyncService.ts | Add backoff |
| 9 | Failed scans might block sync | MEDIUM | backgroundSyncService.ts | Skip failed items |
| 10 | No sync statistics or reporting | LOW | backgroundSyncService.ts | Add metrics |

---

## 14. SMS Notification Flow

### Flowchart

```
START
  │
  ├─→ Event triggers SMS
  │   │
  ├─→ Alighting notification
  │   │   │
  │   ├─→ Passenger alights
  │   │   │
  │   ├─→ [Card has contact number?]
  │   │   │
  │   ├─→ NO → Skip SMS
  │   │   │
  │   └─→ YES → Continue
  │   │   │
  │   ├─→ Prepare SMS data
  │   │   │   - Passenger name
  │   │   │   - Trip summary
  │   │   │   - Fare paid
  │   │   │
  │   ├─→ Add to SMS queue
  │   │   │
  │   └─→ Process queue asynchronously
  │
  ├─→ Emergency notification
  │   │   │
  │   ├─→ Conductor triggers emergency
  │   │   │
  │   ├─→ Get GPS location
  │   │   │
  │   ├─→ Prepare SMS data
  │   │   │   - Emergency type
  │   │   │   - Location
  │   │   │   - Trip info
  │   │   │
  │   ├─→ Add to SMS queue (high priority)
  │   │   │
  │   └─→ Process queue immediately
  │
  └─→ SMS Queue Processing
      │
      ├─→ Get pending SMS
      │   │
      ├─→ [Online?]
      │   │
      ├─→ NO → Keep in queue
      │   │
      └─→ YES → Continue
      │   │
      ├─→ Call SMS API
      │   │
      ├─→ [Success?]
      │   │
      ├─→ YES → Mark as sent, remove from queue
      │   │
      └─→ NO → Increment retry count
      │   │
      ├─→ [Retry count > max?]
      │   │
      ├─→ YES → Mark as failed
      │   │
      └─→ NO → Keep in queue
```

### Potential Bugs & Issues

| # | Issue | Severity | Location | Fix Required |
|---|-------|----------|----------|--------------|
| 1 | SMS might fail silently | MEDIUM | smsService.ts | Add error logging |
| 2 | No validation of phone number format | MEDIUM | smsService.ts | Add phone validation |
| 3 | SMS queue might grow indefinitely | LOW | smsService.ts | Add queue limit |
| 4 | Emergency SMS might not be prioritized | HIGH | smsService.ts | Ensure priority processing |
| 5 | No retry for failed SMS | MEDIUM | smsService.ts | Add retry logic |
| 6 | SMS might be sent multiple times | MEDIUM | smsService.ts | Add deduplication |
| 7 | No rate limiting for SMS API | MEDIUM | smsService.ts | Add rate limiting |
| 8 | SMS content might be too long | LOW | smsService.ts | Add length validation |
| 9 | No notification if SMS fails | LOW | smsService.ts | Add error notification |
| 10 | SMS queue not persisted offline | HIGH | smsService.ts | Add offline persistence |

---

## Summary of Critical Issues

### CRITICAL (Fix Immediately)
1. **Balance deduction and boarding record not atomic** - fareService.ts
2. **Ticket validation not atomic with boarding record** - fareService.ts
3. **No conflict resolution for duplicate scans** - backgroundSyncService.ts
4. **GPS permissions might be revoked during trip** - useDestinationAlerts.ts

### HIGH (Fix Soon)
1. **Trip can be started without GPS location** - HomePage.tsx
2. **No validation that starting point matches actual GPS location** - HomePage.tsx
3. **Trip direction might be incorrect if stops don't match route** - fareService.ts
4. **Offline trips might not sync properly if network lost during trip end** - HomePage.tsx
5. **No protection against multiple conductors starting trip on same bus** - Backend
6. **GPS tracking might stop silently if permission revoked** - useDestinationAlerts.ts
7. **Card cache might be stale if balance updated elsewhere** - fareService.ts
8. **No retry if transaction creation fails** - fareService.ts
9. **Offline alighting might succeed without boarding record** - offlineQueueService.ts
10. **Pi GPS might be unavailable without fallback** - gpsService.ts

### MEDIUM (Fix in Next Sprint)
1. **No auto-completion of trip outside operating hours** - HomePage.tsx
2. **Trip summary might not reflect actual database state if sync pending** - TripSummaryPage.tsx
3. **No validation that destination is in correct direction** - ScanPage.tsx
4. **Double scan detection only checks current trip, not all trips** - fareService.ts
5. **Fare calculation might fail if matrix not loaded** - fareService.ts
6. **Baggage fee might be charged without category selection** - ScanPage.tsx
7. **Payment method fallback might cause duplicate records** - ScanPage.tsx
8. **Ticket might be used on multiple trips if validation fails** - fareService.ts
9. **No refund if boarding fails after validation** - fareService.ts
10. **Offline queue might lose ticket status updates** - offlineQueueService.ts

---

## Recommendations

### Immediate Actions
1. Implement database transactions for boarding/alighting operations
2. Add GPS permission monitoring and recovery
3. Implement conflict resolution for offline sync
4. Add offline queue size limits and error handling
5. Improve cache invalidation and refresh logic

### Short-term Improvements
1. Add GPS location validation for trip start
2. Implement auto-completion for trips outside operating hours
3. Add route validation against fare matrix
4. Improve fare calculation error handling
5. Add comprehensive validation for all user inputs

### Long-term Enhancements
1. Implement comprehensive testing for all flows
2. Add monitoring and alerting for system health
3. Implement admin dashboard for irregularity management
4. Add analytics for fare collection and passenger patterns
5. Implement comprehensive audit logging

---

**Document Version:** 1.0
**Last Updated:** 2026-11-21
**Generated For:** CommutAI Conductor App
