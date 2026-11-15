# BuildBoard V2

A small offline-first project workspace built with plain HTML, CSS and JavaScript.

## Features
- Projects, tasks and notes stored in IndexedDB
- Link tasks and notes to projects
- Edit and delete projects, tasks and notes without creating duplicates
- Set Planned, In progress or Completed status on every entry
- Keep the same IndexedDB database version, object stores and key paths
- Automatic project progress from linked tasks
- Search and type/status filters
- JSON export and restore
- Service-worker app-shell caching

## Files
- `index.html` — app structure
- `styles.css` — responsive styling
- `app.js` — IndexedDB and application logic
- `sw.js` — offline app-shell cache
- `manifest.webmanifest` — installable web-app metadata

## Run locally
1. Open this folder in VS Code.
2. Start it with Live Server (or another local HTTP server).
3. Visit the local URL and add a project.
4. Refresh to confirm the data remains.
5. Export a JSON backup and test restoring it.

Service workers require HTTPS or localhost. Do not test by opening `index.html` directly with `file://`.

## Publish with GitHub Pages
1. Open **Settings → Pages**.
2. Select **Deploy from a branch**, choose `main` and `/(root)`, then save.
3. Open the published URL once while online so the service worker can install and cache the app shell.

## Important data notes
- IndexedDB data is local to the browser profile on that device. It does not sync automatically.
- JSON export is a manual backup and a way to move data between devices.
- Import replaces the current local workspace after confirmation.
- Browser storage is not unlimited and users can clear it. Export backups regularly.
- Offline use requires a successful first visit and successful caching. A browser may evict site storage under storage pressure.

## Backup compatibility
This version exports `schemaVersion: 2` with separate `projects`, `tasks`, and `notes` arrays. It does not import the earlier single-array V1 backup format.

## Update notes
- This update keeps `BuildBoardDB`, IndexedDB version `1`, and the existing `projects`, `tasks`, and `notes` stores unchanged.
- Existing V2 records with `open`/`done` task statuses remain readable and display as Planned/Completed.
- The service-worker cache name is `buildboard-shell-20261115-0850` so browsers request the refreshed app shell.
