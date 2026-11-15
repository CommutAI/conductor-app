# Fare Matrix QA Analysis

## Issue Report
The fare is not matching on the database.

## Trip Data
- Starting Point: Agora Terminal
- End Point: Manolo Fortich Terminal
- Expected Direction: agora_to_manolo

## Analysis Checklist

### 1. Direction Detection
✓ normalizeStopName('Agora Terminal') → 'agora'
✓ normalizeStopName('Manolo Fortich Terminal') → 'maluko manolo'
✓ determineTripDirection should return 'agora_to_manolo'

### 2. Stop Sequences
AGORA_TO_MANOLO_STOPS: ['Agora', 'Gusa', 'Cugman', 'Tablon Baloi', 'Tablon', 'Agusan', 'Puerto', 'Bae Upper Puerto', 'Mambatangan', 'Balubal', 'Maitum', 'Alae Manolo', 'Lunocan', 'Cawayanon', 'San Miguel', 'Dicklum', 'Tankulan', 'Dalirig', 'Maluko Manolo']

MANOLO_TO_AGORA_STOPS: ['Maluko Manolo', 'Dalirig', 'Tankulan', 'Dicklum', 'San Miguel', 'Cawayanon', 'Lunocan', 'Alae Manolo', 'Maitum', 'Balubal', 'Mambatangan', 'Bae Upper Puerto', 'Puerto', 'Agusan', 'Tablon', 'Tablon Baloi', 'Cugman', 'Gusa', 'Agora']

### 3. Database Matrix
The database has 342 rows:
- 171 rows for Agora → Manolo direction
- 171 rows for Manolo → Agora direction

### 4. Potential Issues
- Direction detection might be incorrect
- Fare matrix filtering might be using wrong direction
- Local cache might have stale data
- Database might not have the migration applied

## Test Queries
Run these in Supabase SQL Editor to verify:

```sql
-- Check total fare matrix rows
SELECT COUNT(*) FROM fare_matrix;

-- Check fares for Agora → Maluko Manolo
SELECT * FROM fare_matrix
WHERE route_from = 'Agora' AND route_to = 'Maluko Manolo';

-- Check fares for Agora → Gusa (first leg)
SELECT * FROM fare_matrix
WHERE route_from = 'Agora' AND route_to = 'Gusa';

-- Check what fare matrix data exists
SELECT route_from, route_to, regular_fare, discounted_fare
FROM fare_matrix
WHERE route_from = 'Agora'
ORDER BY route_to
LIMIT 10;
```

## Debugging with New Logs

### Console Logs Added
The following logs have been added to help diagnose the issue:

1. **Direction Detection Logs:**
   - `[FareMatrix] determineTripDirection:` - Shows original and normalized stop names
   - `[FareMatrix] Detected direction: X` - Shows detected direction
   - `[FareMatrix] Fallback to X` - Shows fallback logic

2. **Fare Lookup Logs:**
   - `[FareMatrix] getFareFromMatrix called:` - Shows original and normalized stop names, passenger type, active direction, matrix size
   - `[FareMatrix] No match in active matrix, trying bundled data` - Shows fallback to bundled data
   - `[FareMatrix] No fare data found for forward route:` - Shows fare not found warning
   - `[FareMatrix] Available stops in matrix:` - Shows sample matrix data
   - `[FareMatrix] Fare found:` - Shows successful fare lookup

## Steps to Diagnose

### Step 1: Install the Updated APK
```
Location: C:\Users\joshu\conductor-app\android\app\build\outputs\apk\debug\app-debug.apk
```

### Step 2: Run the Database Migration
If not already done, run the SQL migration in Supabase:
1. Open Supabase Dashboard → SQL Editor
2. Copy contents of `supabase/migrations/update_fare_matrix.sql`
3. Run the migration

### Step 3: Test and Check Console Logs
1. Install the APK on your device
2. Start a trip (Agora Terminal → Manolo Fortich Terminal)
3. Scan a passenger card or select boarding/alighting points
4. Check the browser console for the debug logs:
   - Look for `[FareMatrix] determineTripDirection:` to verify direction detection
   - Look for `[FareMatrix] getFareFromMatrix called:` to see fare lookup details
   - Look for `[FareMatrix] Fare found:` or `[FareMatrix] No fare data found` to see result

### Step 4: Verify Database Data
Run the test queries in Supabase to verify the fare matrix has the correct data:
```sql
SELECT COUNT(*) FROM fare_matrix;
-- Should return 342

SELECT route_from, route_to, regular_fare, discounted_fare
FROM fare_matrix
WHERE route_from = 'Agora' AND route_to = 'Gusa';
-- Should return: ('Agora', 'Gusa', NULL, 15, 15)
```

## Expected Behavior

### For Agora → Gusa (First Leg)
- Direction: agora_to_manolo
- Normalized from: agora
- Normalized to: gusa
- Expected fare: 15 (regular), 15 (discounted)

### For Agora → Maluko Manolo (Full Trip)
- Direction: agora_to_manolo
- Normalized from: agora
- Normalized to: maluko manolo
- Expected fare: 110 (regular), 100 (discounted)

## What to Report

Please provide the following information after testing:

1. **Console Logs:**
   - `[FareMatrix] determineTripDirection:` output
   - `[FareMatrix] getFareFromMatrix called:` output
   - Any `[FareMatrix] No fare data found` warnings

2. **Database Status:**
   - Result of `SELECT COUNT(*) FROM fare_matrix;`
   - Result of fare lookup queries

3. **Actual vs Expected:**
   - What fare is being displayed in the app
   - What fare should be displayed based on the database
