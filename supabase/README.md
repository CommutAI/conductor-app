# CommutAI · Supabase Schema — OMANFORTSCO

This directory contains the Supabase (PostgreSQL) schema for **CommutAI**, shared across four applications. Run the migrations in order using the Supabase CLI or the SQL editor in the Supabase dashboard.

```
supabase/migrations/
  001_initial_schema.sql     — All tables + enums
  002_rls_policies.sql       — Row Level Security for every table
  003_realtime_and_public_view.sql  — Realtime + public dashboard view
```

---

## Tables

| Table | Purpose |
|---|---|
| `staff_users` | Profile rows linked to Supabase Auth. Stores role: `admin`, `conductor`, or `cs_desk`. |
| `buses` | Bus fleet. Conductors see only `active` buses. |
| `trips` | One row per bus run. Created by conductor at trip start; closed at trip end. |
| `qr_cards` | Registered, reloadable QR cards issued at the CS Desk. |
| `temporary_tickets` | Single-use walk-in tickets. Validated (and linked to a trip) by the conductor. |
| `transactions` | Immutable ledger — every fare deduction, top-up, or card issuance is appended here. |
| `gps_logs` | Real-time GPS positions from the bus device. |
| `passenger_counts` | Headcounts from the YOLO AI camera system. |
| `fare_irregularities` | Flags raised by the conductor app (double scan, count mismatch, etc.) or auto-detected. |
| `customer_service_logs` | Audit trail of every CS Desk action against a QR card. |

---

## How the four apps connect

### 1. Conductor Android App (`com.omanfortsco.conductor`)
- Authenticates with Supabase Auth (email + password). Role check: must be `conductor`.
- Reads `buses` (active only) for trip setup.
- Writes to `trips` (insert on start, update status + ended_at on end).
- Reads and writes `qr_cards` (balance deduction during scan).
- Updates `temporary_tickets` (set validated + trip_id).
- Inserts into `transactions` (every fare validation).
- Inserts into `fare_irregularities` (duplicate scans, etc.).
- Subscribes via **Realtime** to `passenger_counts` and `fare_irregularities` for the Live Trip Panel.

### 2. Administrator Dashboard (web)
- Authenticates as `admin` role.
- Full read/write access to all tables (enforced by RLS).
- Uses Realtime on `trips`, `gps_logs`, `passenger_counts`, and `fare_irregularities` for live fleet monitoring.
- Manages `staff_users` (create accounts, toggle `is_active`, change roles).

### 3. Customer Service Desk Module (web)
- Authenticates as `cs_desk` role.
- Issues new `qr_cards` and `temporary_tickets`.
- Processes top-ups (inserts `transactions` of type `balance_topup`).
- Writes `customer_service_logs` for every action.
- Can view a passenger's card balance and transaction history.

### 4. Public Dashboard (read-only web)
- Connects with the **anon** key (no authentication required).
- Can only `SELECT` from the `public_dashboard` view — a safe join of `buses`, `trips`, `gps_logs`, and `passenger_counts`.
- Has **zero** access to `qr_cards`, `transactions`, `staff_users`, or any PII.

---

## Security notes

- **Row Level Security is enabled on every table.** No table is open by default.
- The `service_role` key (used by server-side services like the YOLO AI system) bypasses RLS and should never be embedded in any client app.
- Top-up channel is GCash only (enforced at application layer); `channel` field on `transactions` stores the value.
- Balance updates on `qr_cards` are NOT done inside a database trigger intentionally, so the conductor app can handle optimistic UI. A future migration can add a trigger for extra safety.
