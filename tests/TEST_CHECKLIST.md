# Live-project acceptance checklist

Run this on a **staging** Supabase project with the deployed function and your actual frontend origin. Automated verification uses a PostgreSQL engine with simulated Supabase Auth roles and mocked Auth APIs/browser responses; this checklist verifies the real deployment. Use a fresh browser profile/private window for each role, or Logout between users. Record the observed result beside each checkbox.

## Setup and accounts

- [ ] SQL 01, 02 and 03 run successfully in order; public tables have RLS enabled; `private` is not exposed by the Data API.
- [ ] Public signup, anonymous login and unused providers are disabled. Password minimum is at least 8. The deployed `admin-users` function has its handler JWT check intact and `ALLOWED_ORIGINS` correctly set.
- [ ] Bootstrap `plant.admin`, sign in with its temporary password, and confirm only the forced password screen and Logout are accessible.
- [ ] Try `dashboard.html#dashboard`, `#users`, `#orders` and a known `#order/UUID` before changing the password: all stay on forced password change.
- [ ] A 7-character password and mismatched repeats are rejected. A password over 72 UTF-8 bytes is rejected with a clear message. A new password equal to the temporary one is rejected even after Auth has rehashed it.
- [ ] Set a different valid password; the admin dashboard loads. Create a second admin for recovery.
- [ ] Create these accounts from Users: `marketing.one`, `marketing.two`, `head.one` (production_head), `production.one`, `inspection.one`, `warehouse.one`, `viewer.one`. Leave all real emails blank; creation must work.
- [ ] Every account signs in using only username/password and must replace its own temporary password first.
- [ ] Login activity contains successful sign-ins and verified password changes. No audit row contains a password or password hash.
- [ ] Run optional SQL 04; five fabrics, eight processes, three customers and three `DEMO-` orders appear.

## One order through every department

### Marketing

- [ ] Sign in as `marketing.one`: initial screen is Orders.
- [ ] Create PO `QA-1000`, customer Acacia Textiles, quality Cotton Poplin, shade Sky Blue, grade A, quantity **1000** meters, status **Draft**. Enter an order date and a delivery date; leave roll/lot, GSM, width, article and notes blank. Save succeeds.
- [ ] Blank PO/customer/quality/shade/grade/quantity or quantity zero is blocked with a clear validation message.
- [ ] Creating another `QA-1000` for **the same customer** fails. The same PO for a **different customer** is allowed. Leading/trailing whitespace on a submitted PO does not bypass its customer/PO uniqueness.
- [ ] Edit the draft and optional fields; then clear the optional fields and save again. None is mandatory.
- [ ] As `marketing.two`, view `QA-1000`: no Edit/Confirm/Cancel action is available, and a direct API edit affects no row.
- [ ] As `production.one`, try entering meters against this draft via a direct API call: blocked.
- [ ] As `marketing.one`, open its detail and Confirm with a reason, or save the draft form as Confirmed. Status history records Draft → Confirmed and the marketing actor.
- [ ] The marketing Edit action disappears. Direct API changes to confirmed quantity/status are denied or affect zero rows.

### Production head

- [ ] Sign in as `head.one`: dashboard opens and shows the Confirmed order.
- [ ] Open `QA-1000` and Acknowledge. Confirmed → Acknowledged is recorded with the correct user's ID, UTC timestamp and note. The acknowledgement fields cannot be supplied or changed through raw client writes.
- [ ] Production now sees the order. Head can enter production records too.
- [ ] On a separate confirmed order, use Reject, enter a reason and verify Rejected history; it disappears from operational entry lists. Head can return it to Confirmed with a reason, then acknowledge it.
- [ ] Head cannot edit marketing's business fields such as quantity, customer or quality via a direct API update.

### Production

- [ ] Sign in as `production.one`: Production opens; `QA-1000` is listed.
- [ ] Add two issues: **600** meters (`LOT-A`) and **400** meters (`LOT-B`), with dates and remarks. Total issued = **1000**.
- [ ] Add two actual production receipts: **580** and **390** meters. Total received = **970**.
- [ ] Set status to In Production with a reason. Saving an entry alone does not silently move status.
- [ ] Log Dyeing, **580 in / 570 out**, with date in/out and operator.
- [ ] Log Stenter, **570 in / 565 out**. Grey Inspection/Desizing/Bleaching/Printing/Finishing were skipped; these passes are still accepted.
- [ ] Log Dyeing again, **565 in / 560 out**, for re-dyeing. The repeated process is accepted regardless of typical order.
- [ ] Add an open process pass with date in/meters in only. Later edit it to add date out/meters out. Providing only one closing value is rejected; date out before date in is rejected.
- [ ] Record zero meters out for a total-loss pass; accepted. Zero meters in or zero issue/receipt meters is rejected. Delete this test pass with confirmation.
- [ ] Edit the re-dyeing operator/remarks. The original and updated values, actor and time remain in Change audit.
- [ ] Delete an extra test process pass; it disappears from Process timeline but its original data remains in Change audit and full trace export.
- [ ] Set In Inspection with a reason, then back to In Production with a reason for rework. Both are allowed and both appear in history. A blank/whitespace reason is rejected. Return to In Inspection.
- [ ] Production cannot edit master data, users or order quantities, and cannot create inspection or warehouse records through raw API writes.

### Inspection

- [ ] Sign in as `inspection.one`: Inspection opens and `QA-1000` appears.
- [ ] Add `LOT-A`: **580 inspected, 570 passed, 10 rejected**, final grade A.
- [ ] Add `LOT-B`: **390 inspected, 380 passed, 10 rejected**, final grade A.
- [ ] Inspection totals = **970 inspected / 950 passed / 20 rejected**.
- [ ] Passed + rejected unequal to inspected is rejected. Blank lot/final grade or negative passed/rejected is rejected. Zero rejected is allowed when all meters pass.
- [ ] Entries are accepted even though many master processes were skipped.
- [ ] Set In Warehouse with a reason. Inspection can move back to In Production for rework with a reason, but cannot change order quantity, issue meters, edit process logs, receive warehouse stock, or manage masters/users.

### Warehouse

- [ ] Sign in as `warehouse.one`: Warehouse opens and `QA-1000` appears.
- [ ] Receive **570** meters to Rack A and **380** meters to Rack B, each with a date. Total warehouse = **950**.
- [ ] Warehouse can receive on an acknowledged open order even if no process passes exist, or the manually selected status is still In Production; no machine sequence is imposed.
- [ ] Set Completed with a reason. The order leaves operational entry lists. New issues/receipts/process/inspection/warehouse entries are blocked until reopened by head/admin.
- [ ] Completed is an authorized manual decision; a non-zero balance does not block it.
- [ ] Warehouse cannot issue/produce meters, inspect, edit process logs, modify order business fields or manage masters/users.

### Viewer, totals and reports

- [ ] Sign in as `viewer.one`: dashboard opens. No write actions appear anywhere.
- [ ] `QA-1000` totals show **ordered 1000 / issued 1000 / received 970 / passed 950 / rejected 20 / warehouse 950 / balance 50**. No join multiplication occurs from multiple child rows.
- [ ] Progress labels show **100% issued / 97% received / 95% warehouse**. An intentional overrun is labelled over 100% while the bar remains within its track.
- [ ] Filter by status/customer/quality/shade/grade/date range/PO; multiple filters combine. Reset restores all rows. Summary cards reflect the filters.
- [ ] All sort options work; null delivery dates sort last. Reversed order-date range gives a clear message.
- [ ] Choose a past delivery date for a nonterminal order: highlighted. Lower the inactivity threshold for an old order: no-activity highlighted. Completed/Rejected/Cancelled orders are not flagged as overdue/stale.
- [ ] Export filtered CSV: contains exactly the matching orders and the documented totals. Export a full trace: contains order, all operational records, status history and original before/after values for edited/deleted entries.
- [ ] Try a remark/PO/customer containing HTML (`<img src=x onerror=alert(1)>`) in staging: it displays literally and never executes. CSV fields starting with `=`, `+`, `-` or `@` cannot run spreadsheet formulas.
- [ ] Viewer can read/export the trace but cannot insert/update/delete any business record through direct API calls.

## Masters and admin actions

- [ ] Admin and head add/edit fabrics, customers and processes. Typical order is optional and only affects process display ordering; zero/no value is accepted.
- [ ] Deactivate a master item: it disappears from new selections, but an existing order/pass still displays its linked item. Reusing an unchanged historical reference when editing that record works. Activate it again.
- [ ] A raw API insert using an inactive fabric/customer/process fails. Other roles cannot mutate masters even if they construct their own requests.
- [ ] Admin edits an existing issue/receipt/inspection/warehouse entry and sees old/new values in Change audit. Head/production may edit/delete process logs; they cannot edit/delete inspection or warehouse records.
- [ ] Admin completes an order, corrects/deletes an existing process entry on the closed order, and sees an audit record. Head/production cannot edit a closed order's process entries; head/admin can reopen it first.
- [ ] Admin resets `viewer.one` to a temporary password. The viewer's already open session immediately loses data access on its next request, and is forced to change password on refresh/focus or the next 30-second identity check.
- [ ] Change `production.one` to viewer while its session is open: direct production inserts fail without needing token refresh. UI routes change on focus/identity check.
- [ ] Deactivate `warehouse.one` while signed in elsewhere: reads return no business rows, writes fail immediately and future sign-ins are banned. Reactivate, sign in again and verify restored permissions.
- [ ] Admin cannot deactivate or demote itself. Non-admin callers, inactive admins, forced-password admins, missing/invalid JWTs and unapproved origins cannot call `admin-users`.
- [ ] No app user, including admin, can directly alter/delete status_history, change_audit or login_audit, promote itself via profiles, forge acknowledgement actor/time or change created_by/created_at.
- [ ] Direct URL `#users` and `#activity` is blocked for every non-admin. `#masters` is blocked except admin/head. `#production`, `#inspection`, `#warehouse` each allow only their documented roles.

## Session, deployment and devices

- [ ] Wrong username/password shows a clear message without revealing whether a username exists. Five failed attempts delay this tab for a minute. Confirm server Auth rate limits in the real project; clearing local browser storage does not remove server enforcement.
- [ ] Reload keeps the signed-in session. Logout clears it and returns to login. Browser Back does not restore access to protected data.
- [ ] Expire/revoke a staging session in Supabase Auth and try a refresh/query: app redirects to login when authentication is invalid. A temporary connection loss yields a friendly error and permits retry after the connection returns.
- [ ] All pages work at 390px phone width, tablet width and desktop width. The mobile menu expands/collapses, all inputs/buttons are touch usable, and only data tables scroll horizontally.
- [ ] Keyboard navigation reaches every field, focus is visible, dialog focus is trapped, Escape/Cancel closes it, and field labels focus the correct inputs even when a dialog repeats a dashboard filter name.
- [ ] Cloudflare Pages uses no build command and output `.`. Security/cache headers are present on deployed responses, HTTPS works, CDN modules load, and a direct order hash URL loads after login.
- [ ] Keep the service-role key out of frontend source/network payloads/GitHub. Verify that only the public anon key appears in config.js.
- [ ] Test a backup restore in a separate project before storing real plant data.

## Direct RLS checks from the browser console

On your staging deployment, you can import the same public client and attempt unauthorized operations using the current staff session. Replace only the order ID. Never use a service key for permission tests.

```js
const { db } = await import('./js/client.js');
const { data: { user } } = await db.auth.getUser();
const targetOrder = 'REPLACE_WITH_ORDER_UUID';
// Every ordinary staff role: self-promotion must fail.
await db.from('profiles').update({ role: 'admin' }).eq('id', user.id).select();
// Viewer/inspection/warehouse/marketing: production insert must fail.
await db.from('order_issues').insert({ order_id: targetOrder, meters: 1 }).select();
// Production/head: changing a marketing business field must fail.
await db.from('orders').update({ quantity: 9999 }).eq('id', targetOrder).select();
// Everyone: audit edits must fail.
await db.from('status_history').update({ reason: 'tampered' }).eq('order_id', targetOrder).select();
```

An RLS-blocked **UPDATE/DELETE** may return success with **zero rows** rather than an exception. Verify both the returned rows and unchanged data. Inserts usually return a permission/constraint error. After deactivation or forced password reset, **SELECT** can return an empty array by design. These are enforcement outcomes, not missing frontend data bugs.
