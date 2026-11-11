# OrgCollab

A minimal, dark Org-mode-inspired notebook with shared notes, live presence, and
conflict-free collaborative text editing.

## Run it

1. Create a Firebase project and register a web app.
2. Create a **Realtime Database** in the Firebase console.
3. Copy the web app settings into [`firebase-config.js`](./firebase-config.js),
   including the Realtime Database URL.
4. Configure the database rules below.
5. Serve this directory from a static web server (ES modules do not work from
   `file://`) and open `index.html`.

No Firebase Authentication is used. A notebook token is a shared room name,
not a password; anyone who knows or guesses it can read and change that
notebook. Do not store sensitive information.

### Realtime Database rules

These rules allow unauthenticated access to notebook paths only, which is
necessary for the no-account shared-token flow:

```json
{
  "rules": {
    "notebooks": {
      "$notebook": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

Use Firebase's usage limits and alerts to monitor the free-tier database. This
prototype uses Yjs to merge concurrent text edits and stores the merged state
in Realtime Database; it is intended for small shared notebooks rather than
large-scale or private collaboration.
