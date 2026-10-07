# Order Change Tracker

Internal web application that detects **quantity changes** between successive uploads of the
WebEDI *Supplier Requirements* Excel export, keeps every upload as an immutable version, and emails
the admin when existing order rows change quantity.

```
frontend/   Next.js 16 (App Router, TypeScript, Tailwind)  — UI only, proxies /api/* to Rails
backend/    Rails 8.1 API (modular monolith) + Sidekiq + PostgreSQL + Active Storage
```

## Running locally

Requirements: Ruby 4.0.2, Node 24, PostgreSQL, Redis (Sidekiq's job store).

```bash
# backend
cd backend
bundle install
bin/rails db:prepare
EMAIL=you@company.com NAME="Your Name" ROLE=admin bin/rails users:create   # prompts for a password (min 12 chars)
bin/rails server                                                           # API on http://localhost:4000
bundle exec sidekiq -C config/sidekiq.yml                                  # background jobs (separate terminal)

# frontend
cd frontend
npm install
npm run dev                   # http://localhost:3000 (proxies /api to BACKEND_URL, default http://localhost:4000)
```

Emails are sent through Resend (`RESEND_API_KEY`, `RESEND_FROM`). In development without `RESEND_API_KEY`, emails are written to `backend/tmp/mails/`.
There is no self-registration. Admins add users on the **Users** page (sign-in details are emailed; the user chooses their own password at first sign-in); from the command line, `bin/rails users:create` (ROLE=`admin` or `warehouse_manager`) still works.

## Business rules (as implemented)

| Rule | Implementation |
|---|---|
| Business key | Ship To Location + Type + PO Number + PO Line Number + Part Number + Ship Date, normalized (trimmed, whitespace collapsed, Part Number / Ship To upper-cased, Type canonicalized) and hashed with SHA-256. All key fields are also stored. |
| Effective quantity | `Qty` if present, else `Previous Qty`, else **unknown**. Unknown is never treated as 0. |
| Unknown quantity rows | Stored, shown as a warning count, never compared (unknown→50 and 50→unknown produce no change). |
| Duplicates | Prefer rows with Qty, then rows with Previous Qty. Remaining candidates must agree on effective quantity and Commodity Type, otherwise the file is rejected with a conflict listing the Excel rows. |
| Comparison | Against the immediately previous *completed* version. Only keys present in both versions with known quantities on both sides. New rows and missing rows are counted but ignored. Only quantity is compared. |
| V1 / no changes | V1 is a baseline: no comparison, no email. Identical re-uploads are accepted as new versions; no email when there are no changes. |
| Validation | Whole file is rejected on any error (missing columns, invalid dates/quantities/Type, missing key values, conflicting duplicates, corrupt workbook). Failed uploads are kept in history but never get a version number. |
| Dates | Real Excel dates or `YYYY-MM-DD` text only. Other text formats (e.g. `03/04/2027`) are rejected because day/month order differs between countries. |
| Products | Auto-created from uploads or added manually. A differing Commodity Type never overwrites a product; it opens a conflict that a user resolves on the Products page. A blank Commodity Type is filled in. |

## Data model

```
users ─┬─< upload_batches (version_number unique, status, file sha256, counts, errors, warnings)
       │        │  └─ Active Storage attachment: original .xlsx (never purged)
       │        ├─< order_snapshot_rows   UNIQUE(upload_batch_id, business_key_hash)
       │        ├─< quantity_changes      UNIQUE(upload_batch_id, business_key_hash) → both snapshot rows
       │        └── notifications (outbox, one per batch)
       ├─< products (part_number unique) ──< product_conflicts
       └─< audit_logs
```

Integrity is enforced in PostgreSQL, not only in Ruby:

- Triggers make `order_snapshot_rows`, `quantity_changes` and `audit_logs` append-only, and make
  `completed`/`failed` upload batches unchangeable and undeletable.
- Check constraints: a version number exists **iff** status is `completed`; `difference = new_qty - old_qty`,
  non-zero, and direction matches its sign; quantities are non-negative; effective quantity is null iff unknown.
- The schema is dumped as `db/structure.sql` so triggers are preserved.

**Current state** is the snapshot of the latest completed version (`UploadBatch.latest_completed`), read through
the `(upload_batch_id, business_key_hash)` index. A separate `current_order_state` table was deliberately not
added: it would duplicate the latest snapshot and need to be kept in sync on every upload.

## Upload flow

```
POST /api/uploads ─ Uploads::Intake: extension, size, ZIP signature → store original (Active Storage),
                    SHA-256, create batch (pending) → enqueue Uploads::ProcessJob          → 202
Sidekiq ───────────  Uploads::Processor
                       verify stored checksum → ExcelImport::WorkbookReader (streaming, zip-bomb guard,
                       header detection) → ExcelImport::OrderRowParser (validate, normalize, dedupe)
                       invalid → batch failed with row-level errors (nothing imported)
                       valid   → ONE transaction, serialized by a PostgreSQL advisory lock:
                                   insert snapshot rows · sync products · compare in SQL ·
                                   assign next version · mark completed · outbox row (if changes) · audit
                       after commit → Notifications::DeliverJob
Sidekiq ───────────  Notifications::DeliverJob: row-locked, at-least-once, retried with backoff;
                       status/attempts/last error shown on the upload page ("Retry now")
UI ────────────────  polls GET /api/uploads/:id until completed/failed
```

Unexpected processing errors are retried (3 attempts); the transaction guarantees a failed attempt leaves nothing behind.

## Security

- Passwords: bcrypt (`has_secure_password`), timing-safe `authenticate_by`, minimum length 12.
- Sessions: httpOnly, SameSite=Lax, Secure in production, 12h absolute lifetime, session reset on sign-in.
- CSRF: Rails authenticity token sent as `X-CSRF-Token` on every mutating request.
- Rate limits (Redis-backed): sign-in 10/5 min per IP and 20/15 min per email; uploads 30/hour per user.
- Uploads: server-side extension, size (20 MB) and signature checks; uncompressed-size and row limits; stored under
  random Active Storage keys (no user-controlled paths); Active Storage public routes are disabled, and files are
  only downloadable through the authenticated endpoint.
- Audit log: sign-in/out and failures, uploads, downloads, product edits, conflict resolutions, notifications.
- Roles: `admin` can also manage users, vendors, manual orders, product MOQ and vendor orders;
  `warehouse_manager` works with orders, uploads, products and vendors without those admin changes.
  `require_role` in `ApplicationController` restricts an action.

## Operations

```bash
bin/rails uploads:reenqueue_stale        # re-enqueue uploads stuck in pending/processing (e.g. Redis outage)
bin/rails notifications:redeliver        # enqueue every pending/failed notification
bin/rails users:create EMAIL=… ROLE=…    # create/update a user or reset a password
bin/rails users:deactivate EMAIL=…
```

Deployment notes:

- Run three processes: Puma (Rails), Sidekiq, and `next start` with `BACKEND_URL` pointing at Rails. Only the
  Next.js server needs to be publicly reachable.
- **The edge proxy / load balancer must overwrite `X-Forwarded-For`** (not append client-supplied values);
  otherwise per-IP rate limits and audit IPs can be spoofed.
- With `ACTIVE_STORAGE_SERVICE=local`, `STORAGE_ROOT` must be a persistent, backed-up volume — it holds the
  original files that make the history auditable. Back it up together with PostgreSQL.
- Redis is required by Sidekiq (job queue) and holds rate-limit counters; it is not used as an application cache.
- Configure environment variables from `backend/.env.example` and `frontend/.env.example`.
