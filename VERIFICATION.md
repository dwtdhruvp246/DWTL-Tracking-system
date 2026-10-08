# Verification performed

Verified on 2026-10-08. A hosted first-admin attempt reported by the user exposed an Auth provisioning timing bug: custom app metadata arrives after the Auth user INSERT. The correction was tested against that transaction ordering in PostgreSQL; retrying bootstrap on the hosted project is still required. Hosted Edge Function deployment and Cloudflare delivery have not been tested. Finish the included live-project acceptance checklist before entering production data.

## Database: 35 checks passed

All setup and repair SQL files executed in PostgreSQL through PGlite 0.5.8 with pgcrypto. The harness simulates Supabase's `auth.users`, JWT subject and database roles and executes the actual supplied RLS policies, functions and triggers. It covers:

- Auth Admin API INSERT followed by app metadata UPDATE provisions profiles at commit; forged user metadata and unprovisioned signups roll back. Repair migration is repeatable and was tested on both original and corrected SQL 03.
- Temporary-password read blocking and verified distinct password change; rehashing the same temporary password cannot bypass the flag.
- Read-only viewer and anonymous restrictions; profile self-promotion and non-admin profile-audit reads denied.
- Own-draft marketing writes, confirmation lock, another marketer's ownership restriction and required/optional fields.
- Pre-acknowledgement production denial and server-recorded acknowledgement identity/time.
- Flexible repeated processes, process edits/deletions with retained audit, backward stages/reasons and stale status rejection.
- Role-specific inspection/warehouse writes, skipped processes, inspection arithmetic, positive meters and valid process dates; NULL password and NaN meter boundary cases.
- Independent dashboard totals with multiple child rows, terminal-order restrictions and admin reopening.
- Immediate deactivation and live role changes under an existing JWT identity; atomic temporary resets; self-deactivation protection.
- Audit append-only restrictions.

Reproduce locally from the project root if Node/npm is installed:

```bash
npm install --no-save --package-lock=false @electric-sql/pglite@0.5.8
node tests/database.mjs
```

This is optional testing only; it is not a frontend installation or build requirement. It never contacts or alters a real Supabase project. Delete `node_modules` afterward if desired; it is ignored by Git.

## Browser: 34 checks passed

Executed in Chromium at desktop and 390px mobile widths, with mocked Supabase network responses. Browser tests verified rendering and connected handlers, not hosted Auth behavior:

- Dashboard counts, filters/reset, filtered CSV and full trace CSV downloads.
- Order creation with optional fields omitted.
- Each operational entry form; process edit/delete confirmation; manual status changes.
- Fabric/process/customer add, edit and deactivate controls.
- Admin create-user, change-role, password-reset and activation controls; empty login activity state.
- Relevant role screens and non-admin direct admin-route denial for six staff roles.
- Forced password screen/navigation blocking and return after password save.
- Mobile menu and page-overflow check; wrong-credential feedback and username routing.

Screenshots were inspected for layout. An issue with duplicate field IDs across a page and its dialogs was found and corrected; a subsequent full run passed.

## Edge Function: 15 checks passed

The TypeScript source was transpiled successfully and its handler executed in a Deno-compatible test harness with mocked Supabase Admin APIs. Tests covered missing/invalid JWT, non-admin/inactive/temporary-password callers, origin restrictions, CORS preflight, invalid username/short password, trusted synthetic-account provisioning, omission of passwords from audit, atomic reset payload, guarded role RPC, correct ban/activation ordering and fail-closed database access on simulated ban failure.

This is not a `deno check` or hosted Edge runtime test. The actual function still needs deployment and the user-management checks in the live checklist.

## Source checks

All ES modules and the bootstrap script passed Node syntax checks. HTML local asset references resolve. Required tables, RLS enablement, the security-invoker dashboard view and public configuration were checked. Run `node scripts/check.mjs` (no dependencies) from this folder to repeat these checks.
