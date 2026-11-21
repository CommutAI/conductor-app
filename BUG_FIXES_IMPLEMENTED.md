# Bug Fixes Implemented

This document summarizes all critical and high-priority bug fixes implemented.

---

## Fixes Applied

### 1. Balance Deduction Rollback (CRITICAL)
**File:** `src/services/fareService.ts`
**Issue:** Balance deduction and boarding record not atomic - could lead to data inconsistency
**Fix:** Added rollback logic for balance updates when transaction or boarding record creation fails
- Store old balance before deduction
- Rollback balance if transaction fails
- Rollback transaction and balance if boarding record fails
- Invalidate cache on rollback

### 2. Ticket Validation Rollback (CRITICAL)
**File:** `src/services/fareService.ts`
**Issue:** Ticket validation not atomic with boarding record - could allow duplicate ticket use
**Fix:** Added rollback logic for ticket status updates
- Rollback ticket status to 'issued' if transaction fails
- Rollback transaction and ticket status if boarding record fails
- Invalidate cache on rollback

### 3. Card Cache TTL (HIGH)
**File:** `src/services/fareService.ts`
**Issue:** Card cache might be stale if balance updated elsewhere
**Fix:** Reduced cache TTL from MEDIUM to 1 minute (60000ms)
- Added explicit TTL constants
- Card data expires after 1 minute
- Forces refresh of stale data

### 4. GPS Permission Monitoring (HIGH)
**File:** `src/hooks/useDestinationAlerts.ts`
**Issue:** GPS permissions might be revoked during trip
**Fix:** Added GPS permission monitoring
- Check permissions every 30 seconds
- Stop proximity alerts if permission revoked
- Prevent errors when GPS unavailable

### 5. Offline Queue Size Limit (HIGH)
**File:** `src/services/offlineQueueService.ts`
**Issue:** Offline queue might grow indefinitely
**Fix:** Added maximum queue size limit (100 items)
- Throws error when queue is full
- Prevents localStorage overflow
- Forces user to sync before adding more

### 6. Offline Alighting Validation (HIGH)
**File:** `src/pages/ScanPage.tsx`
**Issue:** Offline alighting might succeed without boarding record
**Fix:** Added boarding record check before alighting
- Check if corresponding boarding exists in queue
- Prevent alighting without boarding
- Added `hasPendingBoardingForAlighting` method

### 7. GPS Coordinate Validation (HIGH)
**File:** `src/services/gpsService.ts`
**Issue:** No validation that GPS coordinates are reasonable
**Fix:** Added coordinate validation
- Validate latitude (-90 to 90)
- Validate longitude (-180 to 180)
- Reject invalid coordinates from Pi GPS
- Fallback to mobile GPS on invalid data

### 8. GPS Request Timeout (HIGH)
**File:** `src/services/gpsService.ts`
**Issue:** No timeout for GPS requests
**Fix:** Already implemented - 5 second timeout for Pi GPS, 10 second for mobile GPS
- No changes needed (already present)

### 9. Transaction Creation Retry Mechanism (CRITICAL/HIGH)
**File:** `src/services/fareService.ts`
**Issue:** Transient network errors during transaction or boarding insertion immediately triggered a full rollback
**Fix:** Added exponential retry mechanism (`executeWithRetry`)
- Retries Supabase transaction and boarding record inserts up to 2 times with backoff
- Only initiates rollback if all retries fail
- Prevents spurious scan failures caused by brief network jitter

### 10. Card Cache Force-Refresh on Onboarding (HIGH)
**File:** `src/services/fareService.ts`
**Issue:** Memory card cache might hold a stale balance if passenger topped up externally or at a kiosk
**Fix:** Force refresh card from Supabase on onboarding when online
- Directly queries latest card balance and details from Supabase during onboarding
- Refreshes cache with latest data
- Gracefully falls back to cached card if network request fails

### 11. Offline Trip-End Sync Exponential Backoff (HIGH)
**File:** `src/services/storageService.ts`
**Issue:** Trip completion sync could fail permanently if network dropped mid-call
**Fix:** Added 3-attempt exponential retry loop (500ms, 1000ms, 2000ms)
- Automatically retries trip completion status updates
- Retains `pendingTripEndSync` flag if network remains down so subsequent sync passes retry cleanly

### 12. Rapid Duplicate Scan Cooldown (CRITICAL/HIGH)
**File:** `src/pages/ScanPage.tsx`
**Issue:** Accidental double-taps by passenger or conductor caused duplicate scan requests
**Fix:** Added 10-second client-side cooldown per card UID
- Rejects repeat scans of the same card within 10 seconds (`SCAN_COOLDOWN_MS = 10000`)
- Alerts conductor with remaining cooldown seconds
- Protects against duplicate billing and duplicate queue entries

### 13. Pi GPS Circuit Breaker & Fast Fallback (HIGH)
**File:** `src/services/gpsService.ts`
**Issue:** When Raspberry Pi GPS was offline or unreachable, every GPS request stalled on a 5-second fetch timeout before falling back to mobile GPS
**Fix:** Added a circuit breaker with 60-second cooldown
- Tracks consecutive Pi GPS failures (threshold: 2)
- Automatically trips circuit breaker for 60 seconds on repeated failures
- Directly routes to mobile GPS with 0ms delay while circuit is open
- Automatically resets when Pi GPS connectivity recovers

### 14. Baggage Fee & Weight Limit Validation (MEDIUM)
**File:** `src/services/fareService.ts`
**Issue:** Missing input validation for baggage fees and weights
**Fix:** Added `validateBaggage()` helper and `MAX_BAGGAGE_WEIGHT_KG = 50` limit
- Rejects negative baggage fees or negative weights
- Enforces maximum weight limit of 50kg
- Validates that baggage fee is provided when a baggage category is selected

---

## Remaining Issues (Not Yet Fixed)

### High
- **Trip can be started without GPS location** - Driver-only console functionality (Conductor app operates in subscriber/read-only mode for trip lifecycle)
- **No validation that starting point matches actual GPS location** - Driver console location comparison
- **No protection against multiple conductors starting trip on same bus** - Requires backend RLS constraint on active trip per bus

### Medium
- Offline SMS queue background drain worker
- Real-time passenger list push sync optimization
- Trip auto-completion reminder outside operating hours

---

## Testing Recommendations

1. **Test rollback scenarios:**
   - Simulate transaction failure during boarding
   - Verify balance is restored
   - Verify ticket status is restored

2. **Test GPS scenarios:**
   - Revoke GPS permissions during trip
   - Verify alerts stop gracefully
   - Test Pi GPS disconnection: confirm instant switch to mobile GPS via circuit breaker

3. **Test offline scenarios:**
   - Fill offline queue to 100 items
   - Verify error thrown
   - Test alighting without boarding (should fail)

4. **Test cache & deduplication scenarios:**
   - Update card balance externally; verify fresh balance fetched on onboarding
   - Double-tap card within 10 seconds: verify rapid tap cooldown rejection

---

## Next Steps

1. Add backend database unique constraints or RPC functions for multi-conductor race protections
2. Implement background worker for automated offline SMS queue draining
3. Add driver-side console GPS validation at trip initialization

---

**Date:** 2026-11-21
**Version:** 1.1
