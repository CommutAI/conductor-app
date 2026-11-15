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

## Console Logs to Check
1. [FareMatrix] Successfully loaded and cached X fare entries for direction: X
2. [FareMatrix] No fare data found for forward route: X → X
3. [AppContext] Switched active trip direction to: X
