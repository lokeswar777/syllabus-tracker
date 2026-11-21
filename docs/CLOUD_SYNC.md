# Cloud sync with Supabase

Signed-in users keep their progress across devices and after clearing browser data. Without Supabase settings, or without signing in, the app works as a local-only tracker.

## How it works

- **Local first.** Every edit is saved to IndexedDB, then uploaded. Being offline never blocks an edit.
- **One database per account.** People sharing a device do not see each other's progress or restore points. Signing out removes that account's local copy after confirming the cloud has it.
- **Versioned writes.** Each collection has a version. The server refuses a write based on an old version, so one device cannot silently overwrite another.
- **Conflicts.** If two devices changed the same collection, the app takes a local restore point and combines them with the backup merge rules, then uploads the result.
- **Existing progress.** On first sign-in, the app asks before adding this browser's progress to the account.
- **Validation.** Cloud data goes through the backup checks before it is saved locally.

Only the user's preparation data is stored in Supabase. The syllabus and weightage data stay in the app.

## Setup

### 1. Create the Supabase project

Create a project at [supabase.com](https://supabase.com/dashboard).

### 2. Create the database table

Open **SQL Editor**, paste the contents of [`supabase/migrations/20261122000000_cloud_sync.sql`](../supabase/migrations/20261122000000_cloud_sync.sql), and run it once.

### 3. Set up Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), configure the OAuth consent screen.
2. Create an **OAuth client ID** of type **Web application**.
3. Under **Authorized redirect URIs**, add `https://<your-project-ref>.supabase.co/auth/v1/callback`.
4. In Supabase, open **Authentication > Sign In / Providers > Google**, enable it, and paste the client ID and client secret.

### 4. Allow the app's addresses

In Supabase, open **Authentication > URL Configuration**:

- Set **Site URL** to the published site, or `http://localhost:5173/` during development.
- Add `http://localhost:5173/` and the published URL to **Redirect URLs**.

### 5. Add the settings to the app

Copy `app/.env.example` to `app/.env.local` and fill in the project URL and **publishable** (or anon) key. Restart the app.

The publishable key is designed to be included in browser code. Your data is protected by sign-in and row-level security. **Never put the secret or `service_role` key in the app.**

For a published site, set the same two `VITE_` values in the build environment.

## Data model

`public.user_collections` has one row per user and collection:

| Column | Meaning |
|---|---|
| `user_id` | Owner, deleted with the account |
| `key` | `progress`, `practice`, `sharedLearning`, `syncSettings`, `weightOverrides`, `planner`, `progressConfig`, or `history` |
| `data` | The collection as JSON, up to 5 MB |
| `version` | Increases with every saved change |
| `updated_at` | Time of the last change |

Row-level security lets users read only their own rows. Clients cannot write to the table directly. They use `sync_push_collections`, which identifies the user from the sign-in token and saves all submitted collections together or none of them.

## Known limits

- If an item is deleted on one device while another device edits the same collection offline, the deleted item can come back after they combine. The merge favors keeping data over losing it.
- Settings without timestamps keep the current device's value during a conflict.
- **Reset all data** while signed in clears the account on every device. A restore point stays only in that browser.
- Supabase's free projects can pause when inactive and have no automatic backups. Use a paid plan or scheduled exports before relying on this for many users.
