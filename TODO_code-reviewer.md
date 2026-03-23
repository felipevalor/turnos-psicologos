# Code Review — Turnos Psicólogos

## Context

- **Repository**: `turnos-psicologos` (main branch)
- **Files reviewed**: `worker/src/**` (all routes, lib, middleware), `frontend/src/lib/api.ts`, `frontend/src/lib/types.ts`, `worker/src/index.ts`
- **Stack**: Cloudflare Workers + Hono (TypeScript), React + Vite, Cloudflare D1 (SQLite)
- **Scope**: Security, correctness, performance, and code quality across the full backend and API client

---

## Review Plan

- [x] **CR-PLAN-1.1 [Security Scan]**: Auth flows, public endpoint access control, injection surface, token handling, CORS, PII exposure
- [x] **CR-PLAN-1.2 [Bug Detection]**: Race conditions, atomicity guarantees, logic errors, off-by-one risks
- [x] **CR-PLAN-1.3 [Performance Audit]**: Unbounded queries, N+1 patterns, cache behavior
- [x] **CR-PLAN-1.4 [Code Quality]**: Duplication, validation gaps, type safety, convention compliance

---

## Review Findings

### 🔴 Critical

---

- [x] **CR-ITEM-1.1 [Auth bypass on DELETE /api/recurring/:id]** ✅ Applied
  - **Severity**: Critical
  - **Location**: `worker/src/routes/recurring.ts:311-312`
  - **Description**: `isPsychologist` is determined by whether the `Authorization` header merely *starts with* `"Bearer "` — the token is never verified. Any request with `Authorization: Bearer garbage` will be treated as a psychologist, bypassing the patient identity check entirely. An unauthenticated attacker who knows any recurring booking ID can cancel it without knowing the patient's email or phone.
  - **Recommendation**: Verify the JWT the same way every other mixed-auth endpoint does.
  ```diff
  - const isPsychologist = authHeader?.startsWith('Bearer ') ?? false;
  + let isPsychologist = false;
  + if (authHeader?.startsWith('Bearer ')) {
  +   const payload = await verifyJWT(authHeader.slice(7), c.env.JWT_SECRET);
  +   if (payload) isPsychologist = true;
  + }
  ```
  This pattern is already implemented correctly in `bookings.ts` (PATCH/DELETE) and `recurring.ts` PATCH `/:id/reschedule-from` — apply the same here.

---

- [x] **CR-ITEM-1.2 [No rate limiting on login endpoint]** ✅ Applied — KV-backed counter (falls back to in-memory per-isolate when CACHE not configured)
  - **Severity**: Critical
  - **Location**: `worker/src/routes/auth.ts:117` — `POST /api/auth/login`
  - **Description**: There is no rate limiting, account lockout, or failed attempt tracking on the login endpoint. PBKDF2 with 100k iterations protects against offline attacks, but the endpoint itself is open to unlimited online brute-force attempts. The app has a single known account (`admin@turnospsi.com`), making it a targeted attack surface.
  - **Recommendation**: Add rate limiting via Cloudflare's built-in rate limit rules (no code required) or use a KV-backed counter. A simple approach: track failed attempts by IP in KV with a 15-minute TTL and block after 10 failures.

---

### 🟠 High

---

- [x] **CR-ITEM-2.1 [PII logged in production]** ✅ Applied
  - **Severity**: High
  - **Location**: `worker/src/routes/bookings.ts:195`, `bookings.ts:176`, `bookings.ts:310`, `bookings.ts:427`, `worker/src/routes/recurring.ts:98,125,133,158,175,182`
  - **Description**: Multiple `console.log` / `console.error` calls emit patient email, phone, booking policy details, and full slot datetimes to Cloudflare's log tail. The CLAUDE.md conventions explicitly forbid `console.log` in production. Patient email/phone is PII and should not be logged.
  - **Recommendation**: Remove all `console.log`/`console.error` debug calls from the production code paths. The project convention is "no `console.log` in production — use Wrangler's logger." Only keep structured error logging in catch blocks if needed, and never include patient identifiers.
  - **Affected lines**:
    - `bookings.ts:176` — `[policy]` logs `slotDatetime`, `diffHours`, `policy`, `unit`
    - `bookings.ts:195` — `[search] body:` logs the full request body including email/phone
    - `bookings.ts:310`, `427` — `[policy]` logs policy details
    - `recurring.ts:98,125,133,158,175,182` — `[generateSlots]` logs dates, slot IDs, counts
    - `index.ts:15` — `[Request]` logs the full request URL (may expose query params)

---

- [x] **CR-ITEM-2.2 [Non-atomic slot adoption in generateSlots]** ✅ Applied
  - **Severity**: High
  - **Location**: `worker/src/routes/recurring.ts:111-124`
  - **Description**: When adopting an existing free slot, the code performs two sequential operations that are NOT in a D1 batch:
    1. `INSERT INTO reservas ...`
    2. `UPDATE slots SET disponible = 0 WHERE id = ?`
  If the first succeeds and the second fails, there is a dangling `reservas` row with `disponible` still `1`. This orphaned booking would allow the slot to appear available and be double-booked.
  - **Recommendation**: Wrap both statements in a single `db.batch([...])` call, the same way `POST /api/bookings` handles atomic slot reservation.
  ```ts
  await db.batch([
    db.prepare('INSERT INTO reservas (slot_id, ...) VALUES (?, ?, ?, ?)').bind(existingSlot.id, patientName, patientEmail, patientPhone),
    db.prepare('UPDATE slots SET disponible = 0 WHERE id = ?').bind(existingSlot.id),
  ]);
  ```

---

- [x] **CR-ITEM-2.3 [JWT stored in localStorage — XSS risk]** ✅ Applied — HttpOnly cookie (psi_session); frontend uses credentials: 'include'; psi_token removido de localStorage
  - **Severity**: High
  - **Location**: `frontend/src/lib/api.ts:20`, `frontend/src/pages/Login.tsx`
  - **Description**: The admin JWT token is stored in `localStorage` under the key `psi_token`. `localStorage` is accessible to any JavaScript running on the page. An XSS vulnerability anywhere in the app (including third-party dependencies) would allow an attacker to steal the admin token.
  - **Recommendation**: Consider migrating to `HttpOnly` cookies for the session token. If cookies are not feasible in this deployment model, ensure all user-generated content is strictly sanitized (React's default JSX escaping helps, but review dangerouslySetInnerHTML usage) and consider shortening the JWT TTL from 8 hours.

---

- [x] **CR-ITEM-2.4 [No input length validation on patient fields]** ✅ Applied
  - **Severity**: High
  - **Location**: `worker/src/routes/bookings.ts:92-100`, `recurring.ts:208-226`
  - **Description**: `patient_name`, `patient_email` are accepted without any maximum length check. An attacker could submit multi-megabyte strings for these fields, wasting D1 storage and potentially causing issues downstream. Only `patient_phone` is validated via regex.
  - **Recommendation**: Add length guards before the DB insert:
  ```ts
  if (patient_name.length > 100) return c.json({ success: false, error: 'Nombre demasiado largo' }, 400);
  if (patient_email.length > 254) return c.json({ success: false, error: 'Email inválido' }, 400);
  ```
  Also add basic email format validation (e.g., `patient_email.includes('@')`).

---

### 🟡 Medium

---

- [x] **CR-ITEM-3.1 [isValidTime allows out-of-range values]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/slots.ts:43-45`, `recurring.ts:52-54`
  - **Description**: `isValidTime` only checks the format `/^\d{2}:\d{2}$/`. Values like `99:99` or `25:61` pass validation and are stored in the DB. The `addMinutes` function then uses `% 24` which silently wraps times around midnight, producing incorrect slot end times. For example, a slot starting at `23:30` with 45-minute sessions would compute end time as `00:15` — crossing midnight — which would break slot ordering and overlap checks.
  - **Recommendation**:
  ```ts
  function isValidTime(timeStr: string): boolean {
    if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
    const [h, m] = timeStr.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }
  ```

---

- [x] **CR-ITEM-3.2 [Timing-unsafe password comparison]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/lib/password.ts:56`
  - **Description**: `computedHex === hashHex` uses JavaScript string equality, which is not guaranteed to be constant-time. A remote timing oracle attack is theoretically possible. In practice the PBKDF2 computation dominates timing (100k iterations), but the final string comparison should still use a constant-time comparison.
  - **Recommendation**: Use `crypto.subtle.timingSafeEqual` or compare the raw `ArrayBuffer` outputs before hex-encoding using `crypto.subtle.verify` with HMAC, or implement a constant-time byte comparison:
  ```ts
  // Compare ArrayBuffer outputs directly (constant-time at the typed array level)
  const computedArr = new Uint8Array(hashBits);
  const storedArr = new Uint8Array(Uint8Array.from(hashHex.match(/.{2}/g)!.map(b => parseInt(b, 16))));
  if (computedArr.length !== storedArr.length) return false;
  let diff = 0;
  for (let i = 0; i < computedArr.length; i++) diff |= computedArr[i] ^ storedArr[i];
  return diff === 0;
  ```

---

- [x] **CR-ITEM-3.3 [recurring_bookings."time" updated even when 0 slots are rescheduled]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/recurring.ts:546-552`
  - **Description**: The `UPDATE recurring_bookings SET "time" = ?` statement is always appended to `finalBatch`, even when `rescheduledCount === 0` (all candidate slots had conflicts). The caller receives `{ rescheduled_count: 0 }` indicating nothing changed, but the recurrence's canonical `time` has been silently updated in the DB. This means future slot generation will use the new time even though no slots were moved.
  - **Recommendation**: Only update the recurrence time if at least one slot was successfully rescheduled:
  ```ts
  if (rescheduledCount > 0) {
    finalBatch.push(
      c.env.DB.prepare('UPDATE recurring_bookings SET "time" = ? WHERE id = ?').bind(new_time, id),
    );
  }
  if (finalBatch.length > 0) {
    await c.env.DB.batch(finalBatch);
  }
  ```

---

- [x] **CR-ITEM-3.4 [GET /api/bookings returns all records without pagination]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/bookings.ts:52-73`
  - **Description**: The admin endpoint returns every booking for the psychologist in a single query with no `LIMIT` clause. Over time this will grow unbounded. D1 has a row limit per query response and large result sets will cause high memory usage in the Worker and slow UI rendering.
  - **Recommendation**: Add pagination support (e.g., `?limit=100&offset=0`) or at minimum a hard ceiling `LIMIT 500`. Similarly consider adding date-range filtering (`?from=YYYY-MM-DD&to=YYYY-MM-DD`).

---

- [x] **CR-ITEM-3.5 [CORS wildcard allows all origins]** ✅ Applied — configurable via ALLOWED_ORIGIN env var
  - **Severity**: Medium
  - **Location**: `worker/src/index.ts:19-27`
  - **Description**: `origin: '*'` allows any website on the internet to make cross-origin requests to the API. While JWTs in `Authorization` headers bypass the CORS cookie restrictions, the public endpoints (bookings, search) accept unauthenticated POSTs from any origin. This enables cross-site request forgery from malicious sites for those public endpoints.
  - **Recommendation**: Restrict the `origin` to the production frontend domain (e.g., `https://turnospsi.com`). Vite's local dev proxy means the frontend never makes direct cross-origin requests during development.
  ```ts
  cors({
    origin: (origin) => origin === 'https://turnospsi.com' ? origin : null,
    ...
  })
  ```

---

- [x] **CR-ITEM-3.6 [whatsapp_number stored without format/length validation]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/auth.ts:93-95`
  - **Description**: `PATCH /api/auth/me` stores `whatsapp_number` directly without validating format or length. An arbitrary string (including HTML or script fragments) could be stored and later surfaced in the patient-facing `outside_policy` responses that include `whatsapp_number`.
  - **Recommendation**: Validate the WhatsApp number format before storing. At minimum check it matches a phone number pattern (e.g., `^\+\d{7,15}$`) and has a reasonable max length.

---

- [x] **CR-ITEM-3.7 [Holiday year parameter has no range validation]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/holidays.ts:52-55`
  - **Description**: `parseInt(yearQuery, 10)` is validated only for `isNaN`. A request with `year=999999` or `year=-1` passes validation and gets forwarded to `https://date.nager.at/api/v3/PublicHolidays/{year}/AR`. This causes unnecessary external API calls and potentially unexpected behavior.
  - **Recommendation**:
  ```ts
  const year = yearQuery ? parseInt(yearQuery, 10) : new Date().getFullYear();
  if (isNaN(year) || year < 2020 || year > 2100) {
    return c.json({ success: false, error: 'Año inválido' }, 400);
  }
  ```

---

- [x] **CR-ITEM-3.8 [Module-level holiday cache is unreliable in Cloudflare Workers]** ✅ Applied — usa KV cuando CACHE está configurado; fallback a in-memory
  - **Severity**: Medium
  - **Location**: `worker/src/routes/holidays.ts:16-17`
  - **Description**: `holidaysCache` is a module-level `Map`. Cloudflare Workers uses V8 isolates: each new isolate starts with an empty cache, and multiple concurrent isolates will each make redundant external API calls. The 24-hour TTL is also not honored across cold starts. In high-traffic scenarios this means the external holiday API will be hit far more than expected.
  - **Recommendation**: Use Cloudflare's `Cache API` (`caches.default`) or a KV namespace for cross-request caching. Alternatively, accept that the in-memory cache only works within a single isolate lifetime and document this behavior. For this app's traffic level it may be acceptable.

---

- [x] **CR-ITEM-3.9 [PATCH /api/auth/me issues N separate DB writes]** ✅ Applied
  - **Severity**: Medium
  - **Location**: `worker/src/routes/auth.ts:61-104`
  - **Description**: Each optional field (`session_duration_minutes`, `cancel_min_hours`, etc.) triggers a separate `UPDATE` query. If the client sends 5 fields, 5 round-trips to D1 are made. This is inefficient and means the update is not atomic — a partial failure leaves the profile in an inconsistent intermediate state.
  - **Recommendation**: Build a single `UPDATE psicologos SET field1 = ?, field2 = ? WHERE id = ?` query dynamically, or use `D1.batch()` to execute all updates in a single round-trip.

---

### 🔵 Low

---

- [x] **CR-ITEM-4.1 [SELECT * in recurring.ts reschedule-from]** ✅ Applied
  - **Severity**: Low
  - **Location**: `worker/src/routes/recurring.ts:479-483`
  - **Description**: `SELECT * FROM recurring_bookings WHERE id = ? AND active = 1` fetches all columns when only specific fields are used. This is a minor efficiency issue and violates the principle of selecting only what you need.
  - **Recommendation**: Replace with explicit column selection: `SELECT id, psychologist_id, patient_email, patient_phone, frequency_weeks, start_date, "time"`.

---

- [x] **CR-ITEM-4.2 [addMinutes is duplicated across files]** ✅ Applied — moved to lib/date.ts
  - **Severity**: Low
  - **Location**: `worker/src/routes/slots.ts:18-22`, `worker/src/routes/recurring.ts:24-28`
  - **Description**: Identical `addMinutes` helper function is copy-pasted in two route files. If the wrapping behavior needs to change (e.g., to handle midnight crossing), it must be updated in two places.
  - **Recommendation**: Move `addMinutes` to `worker/src/lib/date.ts` (which already exports date helpers) and import it in both routes.

---

- [x] **CR-ITEM-4.3 [todayUTC and todayStr are unnecessary wrappers]** ✅ Applied
  - **Severity**: Low
  - **Location**: `worker/src/routes/slots.ts:26-28`, `worker/src/routes/recurring.ts:32-34`
  - **Description**: Both files define a one-line wrapper function that immediately delegates to `getTodayDateString()`. These wrappers add no value.
  - **Recommendation**: Call `getTodayDateString()` directly at the call sites and remove the wrappers.

---

- [x] **CR-ITEM-4.4 [isValidDate and isValidTime are duplicated across route files]** ✅ Applied — moved to lib/date.ts
  - **Severity**: Low
  - **Location**: `worker/src/routes/slots.ts:38-44`, `worker/src/routes/recurring.ts:48-54`
  - **Description**: Both `isValidDate` and `isValidTime` are copy-pasted between `slots.ts` and `recurring.ts`. Any correction (like the range validation fix in CR-ITEM-3.1) must be applied in two places.
  - **Recommendation**: Move both to `worker/src/lib/date.ts` and export them.

---

- [x] **CR-ITEM-4.5 [Full request URL logged in production]** ✅ Applied — request logger removed
  - **Severity**: Low
  - **Location**: `worker/src/index.ts:14-17`
  - **Description**: `console.log('[Request] ${c.req.method} ${c.req.url}')` logs the complete URL for every request. Query parameters such as `?date=YYYY-MM-DD` are benign, but if URL structure ever changes to include sensitive data (e.g., tokens in query params), this would become a data exposure issue.
  - **Recommendation**: Remove the request logger or limit it to method + path only: `${c.req.method} ${new URL(c.req.url).pathname}`.

---

- [ ] **CR-ITEM-4.6 [Partial cancellation orphan slots not cleaned up]** ⚠️ Deferred — low priority, intentional design
  - **Severity**: Low
  - **Location**: `worker/src/routes/recurring.ts:383-391`
  - **Description**: During a partial cancellation (`from_date` provided), the `orphanQuery` (slots belonging to the series but with no reserva) is only executed during total cancellation (`isTotalCancellation = true`). Orphaned recurring slots in the future (which may exist from partial previous operations) will remain as phantom available slots.
  - **Recommendation**: Consider collecting orphaned future slots matching the recurrence pattern even during partial cancellation, or document this as intentional behavior.

---

## Positive Aspects

- **Atomic booking via D1 batch**: The race condition check in `POST /api/bookings` (lines 146-156) — `UPDATE slots SET disponible = 0 WHERE id = ? AND disponible = 1` with `changes === 0` guard — is a well-implemented pattern for concurrency safety.
- **PBKDF2 with 100k iterations**: Strong password hashing using the Web Crypto API natively, with per-password random salts. No third-party dependency needed.
- **Custom JWT with HS256**: Clean, lightweight, standards-compliant JWT implementation using `crypto.subtle`.
- **TypeScript types on D1 queries**: All `db.prepare().first<T>()` and `.all<T>()` calls use typed row generics, avoiding loose typing at the database boundary.
- **Policy enforcement on both client and server**: Booking/cancel/reschedule policies are checked server-side (with DB state) and reflected to the client with `warning: 'outside_policy'` responses, giving a good UX while maintaining server authority.
- **Batch slot batch creation** with per-slot overlap checks is resilient and skips duplicates gracefully.
- **Holiday override system** correctly handles the idempotent `INSERT OR IGNORE` pattern.

---

## Proposed Code Changes

### Fix CR-ITEM-1.1 — Auth bypass in DELETE /api/recurring/:id

```diff
--- a/worker/src/routes/recurring.ts
+++ b/worker/src/routes/recurring.ts
@@ -309,8 +309,12 @@ recurringRouter.delete('/:id', async (c) => {
-  const authHeader = c.req.header('Authorization');
-  const isPsychologist = authHeader?.startsWith('Bearer ') ?? false;
+  let isPsychologist = false;
+  const authHeader = c.req.header('Authorization');
+  if (authHeader?.startsWith('Bearer ')) {
+    const token = authHeader.slice(7);
+    const payload = await verifyJWT(token, c.env.JWT_SECRET);
+    if (payload) isPsychologist = true;
+  }
```

Add the missing import at the top if not already present:
```ts
import { verifyJWT } from '../lib/jwt';
```

### Fix CR-ITEM-3.1 — isValidTime range validation

```diff
--- a/worker/src/routes/slots.ts
+++ b/worker/src/routes/slots.ts
-function isValidTime(timeStr: string): boolean {
-  return /^\d{2}:\d{2}$/.test(timeStr);
-}
+function isValidTime(timeStr: string): boolean {
+  if (!/^\d{2}:\d{2}$/.test(timeStr)) return false;
+  const [h, m] = timeStr.split(':').map(Number);
+  return h <= 23 && m <= 59;
+}
```
Apply the same fix in `recurring.ts`.

### Fix CR-ITEM-2.2 — Atomic slot adoption in generateSlots

```diff
--- a/worker/src/routes/recurring.ts
+++ b/worker/src/routes/recurring.ts
     if (existingSlot.disponible === 1) {
       try {
-        await db.prepare('INSERT INTO reservas ...').bind(...).run();
-        await db.prepare('UPDATE slots SET disponible = 0 WHERE id = ?').bind(existingSlot.id).run();
+        await db.batch([
+          db.prepare('INSERT INTO reservas (slot_id, paciente_nombre, paciente_email, paciente_telefono) VALUES (?, ?, ?, ?)').bind(existingSlot.id, patientName, patientEmail, patientPhone),
+          db.prepare('UPDATE slots SET disponible = 0 WHERE id = ?').bind(existingSlot.id),
+        ]);
```

### Fix CR-ITEM-3.3 — Conditional time update in reschedule-from

```diff
--- a/worker/src/routes/recurring.ts
+++ b/worker/src/routes/recurring.ts
-  finalBatch.push(
-    c.env.DB.prepare('UPDATE recurring_bookings SET "time" = ? WHERE id = ?').bind(new_time, id),
-  );
-
-  if (finalBatch.length > 0) {
-    await c.env.DB.batch(finalBatch);
-  }
+  if (rescheduledCount > 0) {
+    finalBatch.push(
+      c.env.DB.prepare('UPDATE recurring_bookings SET "time" = ? WHERE id = ?').bind(new_time, id),
+    );
+  }
+  if (finalBatch.length > 0) {
+    await c.env.DB.batch(finalBatch);
+  }
```

---

## Commands

```bash
# Run existing tests locally
cd frontend && npx vitest run

# Type-check the worker
cd worker && npx tsc --noEmit

# Type-check the frontend
cd frontend && npx tsc --noEmit

# Deploy (after fixes)
npx wrangler deploy
```

---

## Effort & Priority Assessment

| ID | Severity | Description | Effort | Priority |
|---|---|---|---|---|
| CR-ITEM-1.1 | Critical | Auth bypass DELETE /api/recurring/:id | 10 min | P0 — fix before next deploy |
| CR-ITEM-1.2 | Critical | No login rate limiting | 1–2 h | P0 — add Cloudflare rate limit rule |
| CR-ITEM-2.1 | High | PII in production logs | 30 min | P1 — remove all debug console calls |
| CR-ITEM-2.2 | High | Non-atomic slot adoption | 20 min | P1 |
| CR-ITEM-2.3 | High | JWT in localStorage | 2–4 h | P2 — architectural change |
| CR-ITEM-2.4 | High | No input length limits | 30 min | P1 |
| CR-ITEM-3.1 | Medium | isValidTime range validation | 15 min | P2 |
| CR-ITEM-3.2 | Medium | Timing-unsafe password comparison | 20 min | P2 |
| CR-ITEM-3.3 | Medium | Recurrence time updated with 0 slots | 10 min | P1 — logic bug |
| CR-ITEM-3.4 | Medium | Unbounded GET /api/bookings | 30 min | P2 |
| CR-ITEM-3.5 | Medium | CORS wildcard | 15 min | P2 |
| CR-ITEM-3.6 | Medium | whatsapp_number no validation | 15 min | P2 |
| CR-ITEM-3.7 | Medium | Holiday year no range check | 10 min | P2 |
| CR-ITEM-3.8 | Medium | In-memory cache isolate behavior | 1 h | P3 |
| CR-ITEM-3.9 | Medium | N sequential DB writes in PATCH /me | 30 min | P3 |
| CR-ITEM-4.1–4.6 | Low | Duplication, wrappers, SELECT * | 1–2 h total | P4 |

---

## Quality Assurance Checklist

- [x] Every finding has a severity level and a clear remediation path
- [x] Critical and High security issues appear first
- [x] Each finding includes a specific location (file + line)
- [x] Code examples provided for non-trivial fixes
- [x] Positive aspects acknowledged
- [x] Findings are prioritized so P0/P1 items are actionable immediately
