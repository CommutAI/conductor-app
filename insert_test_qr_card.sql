-- Insert test QR card matching the scanned code
INSERT INTO qr_cards (card_uid, owner_name, contact_number, balance, status, passenger_type, allowed_routes, destination)
VALUES (
  'SCC-882-95-8493',
  'Test Passenger',
  '09123456789',
  100.00,
  'active',
  'regular',
  ARRAY['Manalo Fortich Terminal ↔ Agora Terminal'],
  'Agora Terminal'
)
ON CONFLICT (card_uid) DO UPDATE SET
  balance = EXCLUDED.balance,
  status = EXCLUDED.status,
  destination = EXCLUDED.destination;
