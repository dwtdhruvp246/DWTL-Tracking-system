# DWTL-Tracking-system

Fabric Order & Tracking System for a textile manufacturing plant.

A static, responsive plant application with Supabase Auth, PostgreSQL RLS, immutable audit records and one server-only user administration function. No frontend build, package installation, bundler or application server is needed. The browser runs HTML, vanilla JavaScript ES modules, Tailwind CSS via CDN and supabase-js v2 via CDN.

**Start here:** create a new Supabase project; run SQL 01, 02 and 03; configure Auth; bootstrap the first admin; optionally run SQL 04; deploy `admin-users`; fill `config.js`; upload this folder to GitHub and connect Cloudflare Pages. Then run `tests/TEST_CHECKLIST.md` against your configured project before using real orders.

## Files

```text
/
  index.html                       Username/password login
  dashboard.html                   App shell with hash routes
  config.js                        The only browser Supabase configuration
  _headers                         Cloudflare security/cache headers
  .gitignore
  .nojekyll
  package.json                     Optional local source checks; no build script
  css/app.css
  js/client.js                     Supabase access, pagination and error handling
  js/auth.js                       Login, logout and password changes
  js/ui.js                         Safe rendering, forms, dialogs and CSV
  js/permissions.js                UI capabilities (RLS is authoritative)
  js/forms.js                      Orders, status and operational entry forms
  js/orders.js                     Dashboard, order trace and work screens
  js/admin.js                      Masters, users and login activity
  js/app.js                        Role routing and session guard
  sql/01_schema.sql
  sql/02_rls_policies.sql
  sql/03_views_triggers.sql
  sql/04_seed.sql
  supabase/config.toml
  supabase/functions/admin-users/index.ts
  scripts/bootstrap-admin.mjs
  scripts/check.mjs
  tests/database.mjs
  tests/TEST_CHECKLIST.md
  VERIFICATION.md
```

Routes are `dashboard.html#dashboard`, `#orders`, `#order/UUID`, `#production`, `#inspection`, `#warehouse`, `#masters/fabrics`, `#masters/processes`, `#masters/customers`, `#users`, `#activity`, `#reports` and `#password`. Direct links are checked against the current profile, including password-change state. An unauthenticated user is redirected to login.

## 1. Supabase project and SQL

1. Create a **new project** on Supabase and retain its database password privately. This is a single-plant installation; use separate projects for independent plants.
2. Open SQL Editor, paste the complete `sql/01_schema.sql` and run it. Then run `02_rls_policies.sql` and `03_views_triggers.sql`, in that order. Each file is transactional. These initial setup files are for a new schema; do not repeatedly run them against an existing installation. If a run fails, inspect the error and resolve it before proceeding.
3. These files create the `pgcrypto` extension in `extensions` (the standard Supabase extension schema), the business tables, a non-exposed `private` schema, RLS, functions, triggers and a PostgreSQL 15+ security-invoker dashboard view. Keep the exposed Data API schemas at their defaults; **never expose `private`**.
4. Do **not** run `04_seed.sql` yet. It includes sample orders and needs the first admin's profile for ownership. Once the admin is created in step 3 below, run it. It is optional and repeatable, with `DEMO-` POs; remove the sample orders by cancelling them, or use a separate project for testing.
5. No bucket is created: no file-upload workflow was requested. All plant records are in PostgreSQL. Supabase remains the designated storage provider if attachments are added later.

## 2. Authentication settings — before creating users

In Supabase Dashboard → Authentication settings:

- Keep Email/password authentication enabled.
- Turn **Allow new users to sign up OFF**. Also disable anonymous sign-ins and any OAuth, phone or other providers you are not using. The additional `auth.users` provisioning trigger rejects any new user missing trusted `app_metadata.plant_provisioned` even if signup is accidentally enabled later.
- Set the minimum password length to **8**, or higher if your plant policy requires it. The app accepts at least 8 characters and at most 72 UTF-8 bytes because Auth's bcrypt passwords have a byte limit. Temporary and permanent passwords must differ.
- Disable **secure password change by email/reauthentication nonce** for this installation. Synthetic `@plant.local` accounts have no inbox and cannot receive those nonces. Users change passwords using their authenticated session; admins provide temporary resets. This is distinct from the app's enforced first-login password change, which remains enabled. If policy requires recent password reauthentication, add a current-password sign-in flow rather than enabling an undeliverable email flow.
- Do not send confirmation, invitation or recovery emails to `@plant.local`. Admin creation uses `email_confirm: true`. The optional profile real email is informational and is not the Auth identity.
- Set Site URL to your eventual HTTPS Cloudflare domain. No email redirects or public signup routes are used.
- Review Authentication → Rate Limits for your factory's shared public IP. Supabase enforces server-side endpoint limits; the app additionally delays login for 60 seconds after five failures in the current tab. The local delay can be bypassed and is **not** the security boundary. Do not weaken Supabase's rate limits to accommodate a single failing device; balance settings for the number of legitimate shared-IP staff. Auth endpoint limits and available controls can change: use the current dashboard and official documentation rather than relying on hardcoded quotas.
- Failed password attempts and Auth errors are recorded in **Supabase Auth logs**. The application's `login_audit` records successful sign-ins, sign-outs, verified password changes and admin user actions. It intentionally accepts no anonymous writes to avoid forged failure logs or username enumeration.

Official references: [Auth settings](https://supabase.com/docs/guides/auth/general-configuration), [rate limits](https://supabase.com/docs/guides/auth/rate-limits), [password authentication](https://supabase.com/docs/guides/auth/passwords).

## 3. Bootstrap the very first admin

The public app has no signup. A first admin must be created through the Auth Admin API. The supplied Node script is the supported bootstrap route and correctly provisions the related profile and temporary-password guard through the database trigger. **Do not insert manually into `auth.users`.** Node 20+ is needed only for this script; it is not needed to host the app.

Find the project URL and the **legacy service_role secret** in your project API settings. This secret is used only in your local terminal for bootstrap and on Supabase's Edge Function server. Never put it in `config.js`, GitHub, screenshots or Cloudflare frontend variables. Use your project's legacy service-role key with this script; the Edge runtime supplies `SUPABASE_SERVICE_ROLE_KEY` automatically.

### Windows PowerShell

Open a terminal in the extracted project folder:

```powershell
$env:SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co'
$plantKey = Read-Host 'Supabase service-role secret' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $plantKey).Password
$plantPassword = Read-Host 'Temporary first-admin password (minimum 8 characters)' -AsSecureString
$env:PLANT_ADMIN_TEMP_PASSWORD = [System.Net.NetworkCredential]::new('', $plantPassword).Password
node .\scripts\bootstrap-admin.mjs
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:PLANT_ADMIN_TEMP_PASSWORD
Remove-Variable plantKey, plantPassword
```

Enter the admin username and full name when the script asks. The password input above is hidden. Choose, for example, `plant.admin` as the username; use your own strong password.

### macOS/Linux Bash

```bash
export SUPABASE_URL='https://YOUR_PROJECT.supabase.co'
read -rsp 'Supabase service-role secret: ' PLANT_BOOTSTRAP_KEY
export SUPABASE_SERVICE_ROLE_KEY="$PLANT_BOOTSTRAP_KEY"
read -rsp 'Temporary first-admin password: ' PLANT_BOOTSTRAP_PASSWORD
export PLANT_ADMIN_TEMP_PASSWORD="$PLANT_BOOTSTRAP_PASSWORD"
node scripts/bootstrap-admin.mjs
unset SUPABASE_SERVICE_ROLE_KEY PLANT_ADMIN_TEMP_PASSWORD PLANT_BOOTSTRAP_KEY PLANT_BOOTSTRAP_PASSWORD
```

The script creates `username@plant.local`, confirms it server-side, and assigns the trusted admin role. On the first browser login, set a **different** password before viewing any business data. Then create a second admin for recovery and the staff users through the app. The database blocks self-deactivation and self-demotion.

Now run **`sql/04_seed.sql`** if you want the five sample fabrics, eight processes, three customers and three sample orders. To install masters without demo orders, use only the first three `INSERT` statements from that file.

## 4. Deploy the single Edge Function

The full Deno/TypeScript function is `supabase/functions/admin-users/index.ts`. It checks the supplied bearer token using `auth.getUser(token)`, then reads the caller's **current** profile: active admin with a completed password change is required. It handles create, reset password, role change and activate/deactivate. User-provided metadata can never grant a role.

`ALLOWED_ORIGINS` is a comma-separated list of exact approved frontend origins, without trailing slashes. For local development and your real site, use e.g. `http://localhost:8080,https://fabric-orders.pages.dev,https://orders.example.com`. Include actual preview URLs only if you intend to allow administrators to use them. There is no wildcard default. CORS is additional browser protection; bearer authentication and live profile checks are the actual access controls.

### Supabase CLI deployment

Install the current Supabase CLI using the official supported installation method. From this folder:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set ALLOWED_ORIGINS='http://localhost:8080,https://YOUR_SITE.pages.dev'
supabase functions deploy admin-users --no-verify-jwt
```

`supabase/config.toml` explicitly sets `verify_jwt = false`. This bypasses only the gateway's legacy JWT precheck, to work with current project signing-key formats. **The function still requires and validates a real user JWT through Supabase Auth**, then verifies live admin permissions. Never remove that handler verification. The default Supabase URL and service-role secret are injected automatically; do not redefine reserved `SUPABASE_` secrets.

### Dashboard deployment (no CLI)

1. Open Edge Functions in your project and choose the dashboard editor/create function option.
2. Name it **`admin-users`** and paste all of `supabase/functions/admin-users/index.ts` into `index.ts`.
3. Deploy the function. In its function settings, turn OFF the gateway option called **Verify JWT / Enforce JWT verification** (the exact label can vary). Leave the function's own `getUser` verification intact.
4. In Edge Function Secrets, add `ALLOWED_ORIGINS` with your exact approved origins. Redeploy if prompted.
5. After configuring the frontend, log in as the first admin and create a test viewer from Users. If it fails, inspect the function logs without copying secrets or passwords into them.

References: [Function configuration](https://supabase.com/docs/guides/functions/function-configuration), [function authentication](https://supabase.com/docs/guides/functions/auth), [Auth Admin API](https://supabase.com/docs/reference/javascript/auth-admin-createuser).

## 5. Configure and run the static frontend

Edit **only `config.js`** for browser credentials:

```js
export const CONFIG = Object.freeze({
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',
  plantName: 'Your Plant · Fabric Tracking',
  inactiveDays: 5
});
```

Use the public **anon** key, never the service-role key. The anon key is expected to be visible in a static app. Database RLS supplies authorization.

For local testing, serve the folder over HTTP; do not double-click `index.html` as a `file://` URL because ES modules require an HTTP origin. If Python is installed:

```bash
python -m http.server 8080
```

Open `http://localhost:8080`. Add this origin to the function secret. On Windows, `py -m http.server 8080` also works. Local source checks are optional: `node scripts/check.mjs` (or `npm run check`); no npm install is needed for these checks.

The browsers need internet access to Supabase and the CDN hosts. No service worker or offline write queue is included: concurrent offline fabric records require reconciliation and are outside this scope.

## 6. Push to GitHub and host on Cloudflare Pages

Create an empty GitHub repository, then run these commands **inside the folder containing `index.html`**, not its parent:

```bash
git init
git add .
git commit -m "Initial fabric order tracking system"
git branch -M main
git remote add origin https://github.com/dwtdhruvp246/DWTL-Tracking-system.git
git push -u origin main
```

Do not add `.env` files, service secrets or terminal transcripts. The supplied ignore file excludes common secret files.

In Cloudflare Dashboard → Workers & Pages → create a Pages project → connect GitHub:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None |
| Build command | **Leave empty** |
| Build output directory | `.` (repository root) |
| Root directory | Leave empty if these files are at repo root |
| Frontend environment variables | None |

Deploy. Add the actual Cloudflare/custom domain to `ALLOWED_ORIGINS`. If Cloudflare initially generates a different domain, update the secret; admins cannot call the function from unlisted origins. `_headers` supplies security and caching headers on Pages. For a custom Supabase API domain, update the `connect-src` directive in `_headers` as well as `config.js`.

This application uses hash routing, so no server rewrite or `_redirects` file is necessary. Git pushes update the site without a build. Supabase SQL changes and Edge Function deployments are separate operations.

## How permissions and flexible flow work

| Role | Write capabilities |
|---|---|
| admin | All business screens, order fields and statuses, masters, users; audited corrections/removal of operational entries |
| marketing | Create orders and edit own Drafts; Confirm or Cancel a Draft; read-only afterwards |
| production_head | Acknowledge/reject and manually change stages; fabrics, processes and customers; all production operations |
| production | Issues, receipts and any repeated process passes on open acknowledged orders; edit/delete those passes; set In Production or In Inspection |
| inspection | Inspection entries; set In Production, In Inspection or In Warehouse on open acknowledged orders |
| warehouse | Warehouse receipts; set In Inspection, In Warehouse or Completed on open acknowledged orders |
| viewer | Read dashboard, order details and reports only |

All active users with a completed password change can read business data; Users and Login activity are admin-only. A marketing user can create another draft after confirming an order but cannot alter the confirmed order. An admin can correct its business fields after confirmation; this is audited. Master items are deactivated through the UI and remain selectable on an existing unchanged historical reference.

The production head acknowledges a **Confirmed** order through the dedicated button; actor/time are generated server-side. Orders retain their original acknowledgement even if later moved backward. Process routes are independent records: no fixed route, no unique order/process pair, no typical-order validation, and no required process before inspection or warehouse. An open process pass may have no date out or meters out; closing it requires both. Meters out can be zero for total loss and can exceed meters in for measured gain. The UI displays `meters_in - meters_out`.

Status does not automatically move when an entry is saved. Use Change status, with a required reason. Head/admin can reopen a Completed, Rejected or Cancelled order. Operational entry screens contain open acknowledged orders (including previously acknowledged orders returned to Confirmed). Completed, Rejected and Cancelled orders block new operational entries. Admin can correct/delete existing entries on closed orders; reopen before adding new entries. Status and audit history are immutable from the browser, including for admins; this preserves accountability.

`set_order_status` uses RLS and a row lock, and checks the UI's expected status to reject stale changes. Direct API writes are also constrained by database triggers: staff cannot turn a status-change permission into permission to edit quantity, customer, acknowledgement actor or creator. Operational writes lock the parent order, so a simultaneous cancellation cannot race an entry insert.

## Totals and reports

- **Ordered:** order quantity. **Issued:** sum of issue meters. **Received:** sum of actual production receipts.
- **Inspected/passed/rejected:** cumulative inspection records, including repeat inspection. **Warehouse:** cumulative warehouse receipts.
- **Balance:** ordered minus warehouse. Negative values show over-delivery. Quantities are not capped automatically: yield, partial lots and repeated inspections can legitimately differ. The plant must avoid duplicating the same physical receipt.
- Progress percentages independently show issued, received and warehouse meters divided by ordered meters. Bars cap visually at 100%; labels show the actual percentage, including overrun.
- Dashboard filter dates refer to **order dates**. Delivery alerts use the browser's local calendar date. Activity timestamps are stored in UTC and shown in local time. Login activity date filters use UTC dates.
- Last activity includes audited changes/deletions; deleting the latest process entry does not make activity appear older.
- The dashboard/export reads all REST pages (500 rows at a time), avoiding Supabase's per-response row limit. CSV files neutralize formula prefixes and quote fields. An order's trace export has a `section` column and includes the full order, entries, status history and original before/after audit values.
- Browser filters and summaries are convenient for a small/medium single plant. Reads/exports are not a transaction snapshot; avoid exporting during a large correction/import. For very large archives, add server-side cursor pagination and dedicated reporting snapshots.

## Security and maintenance

- Live RLS checks block plant data for inactive users and users who must change their password, regardless of session/JWT age. UI refreshes account state on focus and every 30 seconds. Already displayed data or previously downloaded CSV files cannot be recalled.
- Deactivation first turns off the profile, then applies an Auth ban. If the Auth ban fails, the function reports partial failure and data stays blocked; retry deactivation to finish. Reactivation removes the ban before enabling the profile.
- Admin password resets update the Auth password and a server-generated nonce in one transaction. An Auth trigger atomically records the temporary password's bcrypt hash in `private.password_guards` and blocks data. `complete_password_change` verifies the submitted new password against the current Auth hash and rejects it if it still matches the temporary hash. No hash is accessible in the API, frontend or audit. Passwords are transmitted only over HTTPS in Auth/RPC requests and are never saved in application files or logs. Do not enable database statement/parameter logging that captures password RPC payloads.
- Profiles have no browser insert/update/delete privileges. Roles use trusted server `app_metadata` only for initial provisioning and the **live profile role** afterwards. Editing Auth user metadata cannot grant permissions.
- All database helper functions pin their search path, and definer function execution is explicitly restricted. The `admin_profile_action` RPC is service-role only and serializes role/activation changes to protect admin recovery.
- All dynamic HTML is escaped, passwords never enter audit records, and dialogs use text content for errors. CDN versions are pinned. Tailwind's runtime CDN requires the supplied CSP to allow inline generated styles/config; stricter deployments can self-host pre-generated CSS and the JS dependency as a future hardening step.
- Session persistence uses Supabase's default local storage. On shared factory devices, staff must use the visible Logout button; use managed browser profiles or kiosk session policies where appropriate. Logout clears this device's session; deactivation and password-reset RLS restrictions apply project-wide.
- Maintain Supabase database backups and periodically test restores. Restrict Dashboard access and service-role secrets to trusted operators. Audit records are append-only for app users; SQL project owners can still perform database maintenance.
- A transient failure after an Auth user has been created but before the supplemental login-audit insert can leave a successfully created user with an error response. Check Users before retrying; username uniqueness prevents duplicate accounts. Database change audit still captures the profile creation.

## Recovery and troubleshooting

- **Login fails:** check username spelling, active state and that the admin created a synthetic Auth identity. The login page always displays Username, not email. Ask an admin for a reset; no email recovery exists.
- **"Database error saving new user":** all SQL files 01–03 must be installed and the Admin API must supply the trusted metadata. Do not use the Dashboard's generic Add User/Invite form; it will not set the provisioning metadata.
- **Users function fails:** check function name, gateway JWT verification setting, CORS origin secret, caller role, password-change flag and function logs. Never replace the frontend anon key with a service secret.
- **Only login works:** change the temporary password. A new password matching the temporary one is intentionally rejected, even if Auth rehashes it.
- **No production orders:** confirmation does not equal acknowledgement. The production head must acknowledge the order. Completed/Cancelled/Rejected orders must be reopened by the head/admin for new entries.
- **RLS error:** verify current live profile role and state. A hidden UI action is not authorization. Do not disable RLS to fix it.
- **First admin lost:** run the bootstrap script with a new unused username and a new temporary password from a secure operator terminal, then deactivate the lost account after logging in. This requires possession of the service secret and is not accessible from the app.

## Assumptions

1. One plant, one installation. All active staff can read all plant orders; role restrictions govern writes. No customer portal or plant tenancy was requested.
2. Marketing ownership is immutable; confirmation locks marketing edits. Marketing cancellation is allowed only while Draft because the requested rule says read-only afterwards. Head/admin can cancel other stages with a reason.
3. Inspection and warehouse require an acknowledged, open order, but **no specific production-process records or stage sequence**. Every stage move is manual and audited.
4. Inspection passed + rejected equals inspected for each entry. Warehouse location and inspection lot/final grade are required so recorded entries can be traced. Optional order fields are never mandatory.
5. Three decimal places for meters; no forced cap against ordered meters. Reinspection totals are cumulative. No automatic dispatch, invoicing, stock allocation or shipment deduction is included.
6. Admin can correct existing operational records, but no app role can rewrite audit history or physically delete orders. Deactivation replaces ordinary master deletion.
7. The attached image depicts food and does not contain textile/order specifications; it has not been used as a UI or manufacturing reference.

## Optional improvements

- Plant-specific machine names, locations and grade dictionaries.
- Barcode/QR roll labels and lot-level genealogy (receipts currently link to orders, not to individual issue rows).
- Private Supabase Storage attachments with separate bucket RLS and file validation.
- CAPTCHA integration, MFA and current-password reauthentication for admin-sensitive actions, with a recovery procedure compatible with synthetic usernames.
- Large-data server pagination, export snapshots, realtime updates and notification rules.
- Self-hosted frontend dependencies, accessibility audit on actual factory devices, automated live-project staging tests and scheduled backup/restore drills.
