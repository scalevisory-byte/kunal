# Assets module — availability report and reconciliation (v2.36.0)

Written in answer to the "BOOKNFLY HRMS ASSETS MODULE" brief: inspect what exists
before building anything, say what each feature's state is, reconcile the figures
without hardcoding them or bending a record, and only then fill the gaps.

The audit was done on the code. The live database on the BNF server cannot be
reached from here, so the figures quoted from his screens (968 / 359 vs 363 / 603 /
2 / 22) were explained by reading how each screen counts, not by querying them.
After installing v2.36.0, **Assets → Dashboard → How the figures add up** shows
his own numbers and names any record that pulls two ways.

## 1. Availability

Classification: **Done** (built and working), **Fixed** (built, was wrong, corrected
in v2.36.0), **Partial** (some of it), **Not built** (and why).

| Feature | Existing UI | Backend | Database | Working | Required action |
|---|---|---|---|---|---|
| Asset master (add / edit / code series) | Assets → Register, Add form, edit in the sheet | `createAsset`, `updateAsset`, `shared/assetCode.js` | `assets`, `asset_code_series` | Done | — |
| Company code prefixes, renumbering | Assets → Lists | `asset_code_series`, renumber | `asset_masters` | Done | — |
| Status (available / assigned / maintenance / damaged / missing / written off / disposed) | Pills on every row, state picker | `shared/assetStatus.js` `assetStatus` | `assets.state`, `written_off_on`, `employee_id` | Done — 3 derived, 4 stored | — |
| **Central counts** | Register figures, dashboard cards | was two definitions | — | **Fixed** | One `assetCounts` read by both screens (§2) |
| Handover / issue | Give it to…, Add for X | `issueAsset` | `asset_handovers` | Done | — |
| Return (single and bulk) | Return / Return ticked | `returnAsset`, `returnAssets` | `asset_handovers` | Done | — |
| Transfer person → person | Pass on | `transferAssets` (closes first handover) | `asset_handovers` | Done | — |
| Transfer between branches / companies | Edit branch / company on the row | `updateAsset` (audited) | `assets.branch_id` | Partial | No transfer slip or log row of its own; history is the audit trail. Say if a printed branch-transfer note is wanted. |
| Expected return date, overdue | Handover form, dashboard alert | `overdueBy` | `asset_handovers.expected_return_on` | Done | — |
| Handover slip to sign | Person ledger → slip | `handoverSlip` | — | Done | — |
| Person ledger (who holds what) | Click a holder | `shared/assetLedger.js` | — | Done | — |
| Staff declare what they hold | Portal → My assets; office match / add / dismiss | `declareAsset`, claims | `asset_claims` | Done | — |
| Write off | Write off (asks why) | `writeOffAsset` — returns first | `written_off_on` | Done | — |
| Disposal | State "Disposed" | `setAssetState` | `assets.state` | **Fixed** | Disposed items were listed and counted as "in the office". Now off the register, under *Written off / disposed*. |
| Delete | Only for something never issued | refuses otherwise | — | Done | — |
| Stock take | Assets → Stock take | rounds, verdicts | `asset_verifications` | Done ("not checked" ≠ "missing") | — |
| Maintenance / services | Assets → Maintenance, per asset | duplicate check asks | `asset_services` | Done | — |
| Warranty and AMC | Fields, dashboard + register alerts | `shared/assetAlerts.js` | `warranty_until`, AMC columns | Done (shown as a table since v2.35.0) | — |
| Documents (invoice, warranty card) | Invoice column, asset page | `backend/src/assetDocs.js` | `asset_documents`, files on disk | Done | — |
| Photos | Asset page | | `asset_photos` | Done | — |
| QR labels | Labels for N | `shared/assetLabels.js` | — | **Fixed in v2.35.0** — the sheet threw on every press since it moved into `shared/` | — |
| Description stickers (patti) | Description stickers | `labelSheet(as: 'patti')` | — | Done (v2.35.0) | — |
| Scan lands on the asset | QR → `/asset/<code>` | | | Done (asks to sign in) | — |
| Voucher for accounts | Voucher per asset | `voucherHtml` | — | Done | — |
| Reports | Register CSV, handovers CSV, column-picker export, print | `shared/assetReport.js`, `assetExport.js` | — | Done | — |
| Import from Excel | Import | `shared/assetImport.js` (dry run first) | — | Done | — |
| Audit trail | People → Trail | `audit()` on create, edit, state, write-off, delete | `audit_log` | Done | — |
| Permissions | Admin → Logins → Assets area | gated by path in `routes/people.js` | `users.areas` | Done | — |
| Staff portal (their own only) | My assets | `forHolder` fields only — no cost, vendor or invoice | — | Done | — |
| Rent agreements, insurance | License tab | `shared/licenses.js` kinds | `licenses` | Done (v2.35.0) | — |
| **Approvals** (purchase, write-off, disposal) | — | — | — | **Not built** | Needs a decision: who approves (Manager/Admin?), and which actions. Writing off is already limited to logins with the write right. Proposal below. |
| Depreciation / book value | — | — | — | Not built, deliberately | Every figure is cost. A rate and method is a business decision; a guessed one reads as authoritative. |
| Responsive (phone width) | | | | Done — register in a scroll frame, dashboard tiles wrap | — |

## 2. Why the figures disagreed

Every asset now sits in exactly **one** status, and both screens read
`assetCounts()` (`shared/assetStatus.js`):

```
on the register = with staff + in the office + being repaired + damaged + missing
off the register = written off + disposed
ever bought      = on the register + off the register
```

| Figure | Before | After |
|---|---|---|
| "With staff" on the register | anybody **holding** it, whatever its state | status **Assigned** — issued and in use |
| "With staff" on the dashboard | status Assigned | unchanged |
| A laptop with somebody **and** being repaired | counted in both "with staff" (register) and "under maintenance" | counted once, under *being repaired*; the holder is still named |
| Disposed (not written off) | "in the office" and in the cost total on the register | off the register on both screens |
| "Bought, in all" on the register | cost of everything not written off (disposed included) | renamed **Cost, on the register** — live assets only |
| "Bought, in all" on the dashboard | everything ever bought | unchanged, and the reconcile panel shows both |

So **363 vs 359** is, almost certainly, four assets held by somebody while marked
under maintenance, damaged or missing — that is exactly the gap the two definitions
open, and nothing else counts differently between the two "with staff" figures.
It cannot be confirmed from here; the panel's first list names them by code.

The register's figure strip now ends with the sum itself
(`359 out with staff + 603 in the office + 2 being repaired + … = 968`), and the
dashboard's **How the figures add up** shows the same lines with cost and an
`adds up` check.

## 3. Records worth a look (named, never changed)

The panel lists, by code, without editing anything:

- held by somebody **and** marked under maintenance / damaged / missing;
- written off or disposed while still in somebody's name (no return recorded);
- marked disposed but never written off;
- written off and still carrying a repair / damaged / missing mark;
- on the register with **no purchase cost** — why money totals can read low.

## 4. What was deliberately not done

- No historical asset record was modified to make a number come out.
- No dummy assets were created anywhere but the throwaway test database.
- Payroll and attendance calculations were not touched (2,572 tests, all passing).
- No database change in this release — the counts are computed on read.

## 5. Proposal: approvals (needs an answer)

If wanted: a request row (`asset_requests`) for **buy / write off / dispose**,
raised by anybody with the Assets right, decided by a login with the `approve`
ability (Manager and Admin — the same right that approves Sunday pay). A
request changes nothing until approved, exactly like leave. Before building:
which of the three actions need it, and whether a write-off below some amount
can skip it.
