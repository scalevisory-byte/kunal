# Pending work list

> **Updated 1 November 2026.** Phase 1 (items 1–3, 6) and Phase 2 (items 4, 5, 7, 8, 23) are
> **done**. A fifth attendance bug was found while fixing the first four and is recorded in
> BUGS_AND_IMPROVEMENTS.md. Items 9–22 (assets, maintenance, the dashboard tiles and the
> missing reports) and item 24 (deploy) are what remain of the Essential list.

Status key: **Complete** · **Partial** · **Missing** · **Bug** · **Not verified**
Priority key: **Essential** (must develop) · **Useful** (if required) · **Future** (later)

---

## 1. Essential — must develop

| No. | Module | Feature | Status | Pending work | Priority |
|---|---|---|---|---|---|
| 1 | Attendance | GPS punch writes no attendance mark | **Bug — FIXED** | A punch stores a clock time with `code: ''` and `minutes: 0`. A blank mark is paid in full, so a month attended entirely by phone pays everybody as present with no hours effect. Set the mark and the minutes on write, the way the biometric import already does | Essential |
| 2 | Attendance | Short-hour minutes are computed only in the browser | **Bug — FIXED** | The server never derives minutes from clock times. The Time tab shows "−32m" for a punched day while the salary sheet charges ₹0. Move the derivation into `setAttendance` so every write path agrees | Essential |
| 3 | Attendance | Approving a missing-punch request pays nothing | **Bug — FIXED** | `entryFor` sends times but no minutes, so an approved correction records the hours and not the money. Fixed by item 2 | Essential |
| 4 | Admin | Login with real users | **FIXED** | One shared password today. Needs a `users` table, hashed passwords (scrypt from `node:crypto`), a signed session cookie, and a change-password screen | Essential |
| 5 | Admin | Roles and permissions | **FIXED** | Three roles are enough: **Admin** (everything), **HR** (everything but payroll amounts and settings), **Viewer** (read-only reports). Enforce on the server, not only by hiding buttons | Essential |
| 6 | Admin | Refuse to run wide open | **Bug — FIXED** | `APP_PASSWORD` unset disables auth silently. The server should refuse to start unless `ALLOW_OPEN=true` is set deliberately | Essential |
| 7 | Admin | Branch management | **FIXED** | Decide first (see DEVELOPMENT_PLAN §2): rename companies to branches, or add branches beneath a company. Do not build both | Essential |
| 8 | Employee | Branch allocation | **FIXED** | Follows item 7 | Essential |
| 9 | Asset | Asset ID | **Missing** | A human code (`BNF-LAP-014`) with a per-company series, unique, printed on the label | Essential |
| 10 | Asset | Purchase details | **Partial** | Only `value` exists. Add purchase date, vendor, invoice number, warranty-until | Essential |
| 11 | Asset | Barcode / QR generation | **Missing** | QR carrying the asset code, rendered as inline SVG and printable as a sheet of labels. No paid service, no large library | Essential |
| 12 | Asset | Asset verification | **Missing** | A stock-take: scan or tick down a list, record who verified and when, report what was not found | Essential |
| 13 | Asset | Asset-wise history view | **Partial** | Issue and return are on the audit trail; one asset's own timeline is not shown anywhere | Essential |
| 14 | Maintenance | Maintenance records | **Missing** | One table: asset, date, what was done, vendor, cost, next service date | Essential |
| 15 | Maintenance | Service cost and total cost of ownership | **Missing** | Purchase cost + all service cost per asset, with a guard against the same service being entered twice (same asset, same date, same amount) | Essential |
| 16 | Maintenance | AMC and warranty | **Missing** | Dates on the asset; a flag when either is within 30 days or expired | Essential |
| 17 | Maintenance | Maintenance reminders | **Missing** | Next-service dates due or overdue, on the dashboard and in the existing reminder digest. No new sending channel | Essential |
| 18 | Dashboard | Pending approvals | **Missing** | The counts already exist in People → Reminders. Surface them as a tile that opens the right tab | Essential |
| 19 | Dashboard | Asset and maintenance summary | **Missing** | Follows items 9–17 | Essential |
| 20 | Reports | Asset register file | **Missing** | CSV / Excel of the register with purchase and cost columns | Essential |
| 21 | Reports | Asset handover report | **Missing** | Who holds what, since when; and a handover slip per employee to sign | Essential |
| 22 | Reports | Maintenance and service cost report | **Missing** | Follows items 14–16 | Essential |
| 23 | Technical | Server backup and restore | **FIXED** | Nightly `VACUUM INTO` to the data volume, retention, and a written restore procedure. The single-file build already has its own backup | Essential |
| 24 | Technical | Deploy it | **Not verified** | `Dockerfile` and `railway.json` exist but the image has never been built. Nothing has ever run outside a laptop | Essential |

---

## 2. Useful — develop if required

| No. | Module | Feature | Status | Pending work | Priority |
|---|---|---|---|---|---|
| 25 | Reports | Leave report as a file | **Partial** | On screen only. Add CSV and print, like the attendance report | Useful |
| 26 | Reports | Employee master export | **Partial** | A per-employee report exists; the staff list cannot be exported | Useful |
| 27 | Dashboard | Birthdays and anniversaries | **Partial** | The card works but `dob` and `joined_on` are blank for most staff. The fix is data entry, not code — the card already says how many people have neither | Useful |
| 28 | Attendance | Selfie capture | **Missing** | Camera in the browser, image to disk beside the punch, shown next to it. Note honestly that it raises the cost of a forwarded link but does not stop it | Useful |
| 29 | Attendance | Device verification | **Missing** | Remember the first device a link is used from and flag a new one. It is a flag, not a lock — a new phone is normal | Useful |
| 30 | Admin | Settings screen | **Partial** | Per-month settings are scattered across tabs. One screen for shift times, concession, PT slab, hours per day | Useful |
| 31 | Admin | Login audit | **Missing** | Who signed in, when, from where. Follows items 4–5 | Useful |
| 32 | Asset | Asset photographs | **Missing** | Same pattern as employee documents — file on disk, expiring signed link | Useful |
| 33 | Payroll | TDS | **Missing** | Nobody has asked for it and no salary here is near the threshold. Build only when somebody crosses it | Useful |

---

## 3. Future — keep for later

| No. | Module | Feature | Status | Pending work | Priority |
|---|---|---|---|---|---|
| 34 | Attendance | Real-time eSSL device link | **Missing** | Needs the device's ADMS push and a public URL. File import works today; the device model is still unconfirmed | Future |
| 35 | Notifications | Actually sending the digest | **Partial** | The text and the endpoint exist. Sending needs a channel and credentials — WhatsApp through the task assistant's existing session is the safe route | Future |
| 36 | Admin | Per-employee self-service login | **Missing** | 115 logins is a support burden. The signed personal link already covers punching, leave and the helpdesk | Future |
| 37 | Asset | Depreciation | **Missing** | Only if the accounts side asks for it. Purchase cost and service cost come first | Future |
| 38 | Leave | Leave encashment outside an exit | **Partial** | The engine exists and is used by the full and final. A year-end encashment run would reuse it | Future |
| 39 | Payroll | Arrears and revision with effect from a past month | **Missing** | Appraisals carry an effective date but do not back-pay. Raised only when it happens | Future |

---

## 4. Cannot be tested — nothing to test

The brief's §6 asks for checks on three figures that have no implementation:

| Check asked for | Why it cannot run |
|---|---|
| Service cost | No maintenance module |
| Total asset ownership cost | No purchase or service cost to total |
| Duplicate service cost entries | No service entries exist |

These become testable after items 14–15.

---

## 5. Counts

| Status | Count |
|---|---|
| Complete | 34 features across modules 1–5 |
| Partial | 13 |
| Missing | 19 |
| Bug (confirmed, reproduced) | 4 |
| Not verified | 1 (deployment — the image has never been built) |

| Priority | Items |
|---|---|
| Essential | 24 |
| Useful | 9 |
| Future | 6 |
