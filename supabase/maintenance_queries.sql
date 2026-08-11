-- ============================================================
-- CommutAI · Maintenance & Utility Queries
-- Run these queries as needed for maintenance tasks
-- ============================================================

-- ── 1. Update Staff User Roles ──────────────────────────────────────────────────
-- Update a specific user's role to customer service desk
-- UPDATE staff_users 
-- SET role = 'cs_desk' 
-- WHERE id = '1654f098-c2b0-4ab3-9f59-6cf6fb2fafba';

-- Update all admin users to cs_desk (run this to convert all admins to customer service desk)
-- UPDATE staff_users 
-- SET role = 'cs_desk' 
-- WHERE role = 'admin';

-- ── 2. Fix Inconsistent Card Data ────────────────────────────────────────────────
-- Fix card data inconsistencies (run as needed when card data becomes inconsistent)

-- Fix specific card (SC-170-60-383 - should be Student)
-- UPDATE qr_cards 
-- SET 
--   card_type = 'student',
--   allowed_routes = ARRAY['type:Student']
-- WHERE card_uid = 'SC-170-60-383';

-- Fix incorrectly formatted card (CARDMSJVQL2G - incorrect format, should be RC- format)
-- UPDATE qr_cards 
-- SET 
--   card_uid = 'RC-' || substr(md5(random()::text), 1, 3) || '-' || substr(md5(random()::text), 4, 2) || '-' || substr(md5(random()::text), 6, 3),
--   card_type = 'regular',
--   allowed_routes = ARRAY['type:Regular']
-- WHERE card_uid = 'CARDMSJVQL2G';

-- Fix specific card (SC-787-07-359 - should be Student, not regular)
-- UPDATE qr_cards 
-- SET 
--   card_type = 'student',
--   allowed_routes = ARRAY['type:Student']
-- WHERE card_uid = 'SC-787-07-359';

-- ── 3. System Admin Role Management ────────────────────────────────────────────────
-- These queries help manage system admin access and permissions

-- Grant admin role to a specific user
-- UPDATE staff_users 
-- SET role = 'admin' 
-- WHERE id = '<user-uuid-here>';

-- Remove admin role from a specific user (convert to cs_desk)
-- UPDATE staff_users 
-- SET role = 'cs_desk' 
-- WHERE id = '<user-uuid-here>';

-- List all admin users
-- SELECT id, full_name, email, role, is_active, created_at 
-- FROM staff_users 
-- WHERE role = 'admin';

-- List all users with their roles
-- SELECT id, full_name, email, role, is_active, created_at 
-- FROM staff_users 
-- ORDER BY role, full_name;

-- ── 4. Additional Useful Queries ──────────────────────────────────────────────────────

-- View all active trips with conductor and bus info
-- SELECT 
--   t.id,
--   t.started_at,
--   t.status,
--   s.full_name as conductor_name,
--   b.plate_number,
--   b.bus_number
-- FROM trips t
-- JOIN staff_users s ON t.conductor_id = s.id
-- JOIN buses b ON t.bus_id = b.id
-- WHERE t.status = 'in_progress'
-- ORDER BY t.started_at DESC;

-- View recent transactions for a specific trip
-- SELECT 
--   tr.id,
--   tr.type,
--   tr.amount,
--   tr.channel,
--   tr.created_at,
--   q.card_uid,
--   q.owner_name
-- FROM transactions tr
-- LEFT JOIN qr_cards q ON tr.card_id = q.id
-- WHERE tr.trip_id = '<trip-uuid-here>'
-- ORDER BY tr.created_at DESC;

-- View passenger count statistics for a trip
-- SELECT 
--   trip_id,
--   COUNT(*) as total_recordings,
--   AVG(count) as average_passengers,
--   MAX(count) as max_passengers,
--   MIN(count) as min_passengers,
--   MIN(recorded_at) as first_recording,
--   MAX(recorded_at) as last_recording
-- FROM passenger_counts
-- WHERE trip_id = '<trip-uuid-here>'
-- GROUP BY trip_id;

-- View unresolved fare irregularities
-- SELECT 
--   fi.id,
--   fi.type,
--   fi.description,
--   fi.detected_at,
--   s.full_name as conductor_name,
--   b.plate_number
-- FROM fare_irregularities fi
-- JOIN trips t ON fi.trip_id = t.id
-- JOIN staff_users s ON t.conductor_id = s.id
-- JOIN buses b ON t.bus_id = b.id
-- WHERE fi.resolved = FALSE
-- ORDER BY fi.detected_at DESC;

-- View active emergency alerts
-- SELECT 
--   ea.id,
--   ea.status,
--   ea.notes,
--   ea.triggered_at,
--   s.full_name as conductor_name,
--   b.plate_number
-- FROM emergency_alerts ea
-- JOIN trips t ON ea.trip_id = t.id
-- JOIN staff_users s ON t.conductor_id = s.id
-- JOIN buses b ON ea.bus_id = b.id
-- WHERE ea.status != 'resolved'
-- ORDER BY ea.triggered_at DESC;

-- Check hardware status
-- SELECT 
--   component,
--   status,
--   details,
--   last_check
-- FROM hardware_status
-- ORDER BY last_check DESC;

-- ── 5. Bus Assignment for Conductors ──────────────────────────────────────────────────────

-- Assign a bus to a conductor (replace with actual UUIDs)
-- UPDATE staff_users 
-- SET bus_id = '<bus-uuid-here>'
-- WHERE id = '<conductor-uuid-here>';

-- View all conductors with their assigned buses
-- SELECT 
--   s.id,
--   s.full_name,
--   s.email,
--   s.role,
--   b.plate_number,
--   b.bus_number,
--   b.route
-- FROM staff_users s
-- LEFT JOIN buses b ON s.bus_id = b.id
-- WHERE s.role = 'conductor'
-- ORDER BY s.full_name;

-- View unassigned conductors
-- SELECT 
--   id,
--   full_name,
--   email
-- FROM staff_users
-- WHERE role = 'conductor' 
--   AND bus_id IS NULL;

-- View available buses (not assigned to any conductor)
-- SELECT 
--   b.id,
--   b.plate_number,
--   b.bus_number,
--   b.route,
--   b.status
-- FROM buses b
-- LEFT JOIN staff_users s ON b.id = s.bus_id
-- WHERE b.status = 'active'
--   AND s.id IS NULL;

-- ── 6. Trip Management ──────────────────────────────────────────────────────────────

-- View all in-progress trips (stuck trips)
-- SELECT 
--   t.id,
--   t.started_at,
--   t.status,
--   s.full_name as conductor_name,
--   s.email as conductor_email,
--   b.plate_number,
--   b.bus_number
-- FROM trips t
-- JOIN staff_users s ON t.conductor_id = s.id
-- JOIN buses b ON t.bus_id = b.id
-- WHERE t.status = 'in_progress'
-- ORDER BY t.started_at DESC;

-- End stuck trips for a specific conductor (replace with actual UUID)
-- UPDATE trips 
-- SET status = 'completed', 
--     ended_at = COALESCE(ended_at, NOW())
-- WHERE status = 'in_progress' 
--   AND conductor_id = '<conductor-uuid-here>';

-- End all stuck trips (use with caution - only if you're sure)
-- UPDATE trips 
-- SET status = 'completed', 
--     ended_at = COALESCE(ended_at, NOW())
-- WHERE status = 'in_progress';

-- View recent completed trips for a conductor
-- SELECT 
--   t.id,
--   t.started_at,
--   t.ended_at,
--   t.status,
--   b.plate_number,
--   b.bus_number,
--   (SELECT COUNT(*) FROM boarded_passengers bp WHERE bp.trip_id = t.id) as passenger_count
-- FROM trips t
-- JOIN buses b ON t.bus_id = b.id
-- WHERE t.conductor_id = '<conductor-uuid-here>'
--   AND t.status = 'completed'
-- ORDER BY t.started_at DESC
-- LIMIT 10;

-- ── 7. Test Data Insertion Examples ──────────────────────────────────────────────────────

-- Insert test QR card (for testing purposes)
-- INSERT INTO qr_cards (card_uid, owner_name, contact_number, balance, status, card_type, allowed_routes, destination)
-- VALUES (
--   'SCC-882-95-8493',
--   'Test Passenger',
--   '09123456789',
--   100.00,
--   'active',
--   'regular',
--   ARRAY['Manalo Fortich Terminal ↔ Agora Terminal'],
--   'Agora Terminal'
-- )
-- ON CONFLICT (card_uid) DO UPDATE SET
--   balance = EXCLUDED.balance,
--   status = EXCLUDED.status,
--   destination = EXCLUDED.destination;
