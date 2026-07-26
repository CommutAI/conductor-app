# QR Card Scanning Fix - Customer Service Notice

## Issue Summary
Some QR cards were not scannable due to special dash characters (en dashes, em dashes) in the card UID format. This affected both onboarding and alighting processes.

## Changes Made

### 1. QR Code Normalization
- **What changed**: The scanning system now automatically normalizes special dash characters to regular hyphens before database lookup
- **Characters affected**: En dashes (–), em dashes (—), horizontal bars, minus signs, and fullwidth hyphen-minus characters
- **Example**: `SCC—882-95-8493` is now automatically converted to `SCC-882-95-8493`

### 2. Database Schema Updates
- Added missing columns to support full onboarding/alighting workflow:
  - `destination` column for storing passenger destinations
  - `passenger_type` for fare calculation (student, senior, PWD discounts)
  - `passenger_id` for linking to passenger profiles
  - `route_id` for route validation
  - `issued_by` for tracking card issuance

### 3. Transaction Type Updates
- Added `'boarding'` transaction type to track when passengers board (fare collected on alighting)
- Existing `'fare_validation'` type continues to work for alighting fare collection

### 4. Existing Card Data
- All existing QR card UIDs in the database have been automatically normalized
- Old cards with special dashes will now work with the new scanning system
- No action required from passengers - their existing cards are now compatible

## Impact on Customers

### For Passengers
- **No action required** - existing QR cards will now work correctly
- Scanning is more reliable with improved character handling
- Both onboarding and alighting processes work seamlessly

### For Conductors
- QR codes scan correctly regardless of dash character type
- Improved debouncing prevents duplicate scans
- Better error messages for troubleshooting

## Troubleshooting

### If a QR card still doesn't scan:
1. Check the card status in the system (should be 'active')
2. Verify the card has sufficient balance
3. Ensure the card is on the correct route
4. Contact technical support if the issue persists

### Common Error Messages:
- **"QR code not recognised"**: Card UID not found in database or card is inactive
- **"Insufficient balance"**: Card balance below required fare
- **"Card is inactive"**: Card status is not 'active'
- **"Destination mismatch"**: Card destination doesn't match selected alighting stop

## Support Contact
For any issues related to QR card scanning, please contact the technical support team with:
- Card UID (if available)
- Error message displayed
- Bus route and stop information
- Time of incident

---
**Document Version**: 1.0  
**Date**: July 24, 2026  
**System Version**: Conductor App v1.0
