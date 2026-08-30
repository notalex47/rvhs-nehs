# WordGrid Live — beginner setup guide

WordGrid Live is a 4×4 adjacent-letter word game with two modes:

- **Practice:** one player, entirely browser-side. It does **not** initialize or connect to Firebase.
- **Multiplayer:** up to **10 simultaneous room slots**, identified by the single digits **0–9**. Firebase Realtime Database synchronizes the board, timer, players, and scores.

The frontend is plain HTML/CSS/JavaScript, so there is no build step and it can be hosted on GitHub Pages.

This is an independent implementation of the adjacent-letter word-grid genre. It does not use GamePigeon branding, artwork, code, sounds, or proprietary assets.

---

## What changed in this version

- Room codes are now exactly **one digit: 0 through 9**.
- The app will never create more than 10 room keys.
- Room creation uses an atomic Firebase transaction, so two hosts cannot claim the same digit at the same time.
- A finished room is recyclable after 5 minutes.
- A room has a 30-minute lease. Starting/rematching refreshes the lease. This prevents an abandoned browser tab from permanently consuming one of the ten codes.
- If a host deliberately presses **Leave room**, that room is deleted immediately and its digit becomes available again.
- New **Practice solo** mode runs without Firebase. Firebase libraries are lazy-loaded only when a user chooses Create or Join.
- A room has a session ID internally, so if a digit is eventually recycled, players from the old room are not silently dropped into the new game.

For a school site that normally has only 3–4 rooms at once, ten single-digit room slots should be plenty.

---

# The exact setup order I recommend

Do these sections in order. You can test Practice mode **before touching Firebase**.

## Part A — Put the files in a GitHub repository

### 1. Download and unzip the project

The folder should contain at least:

```text
wordgrid-live/
├── index.html
├── styles.css
├── app.js
├── game-core.js
├── firebase-config.js
├── database.rules.json
├── favicon.svg
├── .nojekyll
├── LICENSE
├── tests.mjs
└── tools/
    └── download-wordlist.py
```

You may also add `wordlist.txt` later; I recommend doing so.

### 2. Decide whether this will be its own repository or a subfolder

**Simplest option:** create a brand-new public repository, for example:

```text
wordgrid-live
```

Then put all the files above directly in the repository root.

Your future URL will look like:

```text
https://YOUR-USERNAME.github.io/wordgrid-live/
```

If you instead want this inside an existing Pages repository, upload the whole folder as a subfolder, for example:

```text
your-existing-repo/
└── wordgrid-live/
    ├── index.html
    ├── app.js
    └── ...
```

Then the URL will normally be:

```text
https://YOUR-USERNAME.github.io/YOUR-EXISTING-REPO/wordgrid-live/
```

All asset paths in this project are relative, so subfolder hosting is supported.

### 3. Upload through the GitHub website if you do not want to use Git

For a new repository:

1. Sign in to GitHub.
2. Click **New repository**.
3. Give it a name such as `wordgrid-live`.
4. Make it **Public** if you are using GitHub Free Pages.
5. Create the repository.
6. In the repository, choose **Add file → Upload files**.
7. Drag in all files from inside the `wordgrid-live` folder.
8. Make sure `index.html` is at the level you intend to publish.
9. Commit the files to the `main` branch.

Do **not** upload the ZIP itself as the website. GitHub Pages needs the extracted files.

---

# Part B — Turn on GitHub Pages

For a repository where `index.html` is in the repository root:

1. Open the repository on GitHub.
2. Click **Settings**.
3. In the left sidebar, click **Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
5. Select branch **main**.
6. Select folder **/(root)**.
7. Click **Save**.
8. Open the Pages URL GitHub shows you after deployment finishes.

For this project you do **not** need a custom GitHub Actions workflow.

If your project lives in a subfolder of a larger Pages site, the Pages source is still the repository root; you simply browse to the subfolder URL afterward.

### First test: Practice mode

At this point Firebase can still be completely unconfigured.

Open the site and check:

1. The page loads.
2. The dictionary indicator eventually says roughly `264k words ready`.
3. Enter a name.
4. Click **Practice solo**.
5. Choose 60, 90, or 120 seconds.
6. Click **Start practice**.
7. A 3-second countdown should appear.
8. You should be able to drag through adjacent tiles and score valid words.
9. Click **New board** after the round and verify another local round starts.

If Practice works, your GitHub Pages side is basically correct.

---

# Part C — Recommended: host the dictionary yourself

The game can fall back to the public YAWL word-list CDN, but for a school deployment I recommend putting the dictionary directly in your own repository.

On a computer with Python installed, open Terminal / Command Prompt inside the project folder and run:

```bash
python tools/download-wordlist.py
```

If your computer uses `python3` instead:

```bash
python3 tools/download-wordlist.py
```

This creates:

```text
wordlist.txt
```

beside `index.html`.

Upload/commit `wordlist.txt` to GitHub too.

Why this is useful:

- Practice no longer depends on a third-party dictionary host after the page loads from GitHub Pages.
- The dictionary can be cached in IndexedDB by the browser.
- You avoid a third-party CDN being blocked by a school network.

The YAWL source list is public domain. The app accepts alphabetic entries of 3–16 letters from it.

### Important local-computer note

Do not expect all browser features to work by double-clicking `index.html` and opening a `file://` URL. ES modules and `fetch()` are often restricted in that mode.

If you want to test on your own computer instead of GitHub Pages, open a terminal in the folder and run:

```bash
python -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

Practice mode itself uses no Firebase.

---

# Part D — Create the Firebase project for multiplayer

Practice mode does not need this. Create/Join multiplayer does.

## 1. Create a Firebase project

1. Go to the Firebase Console: `https://console.firebase.google.com/`
2. Click **Create a project**.
3. Give it a simple name such as `wordgrid-live`.
4. Google Analytics is **not required** for this game. You can leave it off.
5. Create the project.

### Stay on the free plan

You want the **Spark** plan.

Do not upgrade to Blaze for this project unless you intentionally want billing enabled. The Realtime Database Spark allowance is far beyond what a few school games should normally require.

---

# Part E — Register the website with Firebase

## 1. Add a Web App

Inside your Firebase project:

1. Open **Project Overview**.
2. Click the Web icon, shown as **`</>`**, to add an app.
3. Give the app a nickname such as `WordGrid Web`.
4. You do **not** need Firebase Hosting because GitHub Pages is hosting the website.
5. Register the app.

Firebase will show you a configuration object similar to:

```js
const firebaseConfig = {
  apiKey: "...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

Keep that page open for now.

### The config is not a password

A Firebase browser configuration object is expected to appear in client-side code. Security comes from Authentication + Realtime Database Security Rules.

Never put a Firebase **service-account private key** into this repository. This project does not need one.

---

# Part F — Enable Anonymous Authentication

Multiplayer players should not need accounts.

In Firebase:

1. Open **Authentication**.
2. If prompted, click **Get started**.
3. Open the **Sign-in method** tab.
4. Find **Anonymous**.
5. Enable it.
6. Save.

The game uses this only to give each browser a Firebase UID so the database rules can distinguish players.

### Authorized domains

Firebase usually handles common localhost/default domains automatically, but if multiplayer authentication fails on GitHub Pages:

1. Open **Authentication → Settings**.
2. Find **Authorized domains**.
3. Add your Pages hostname, for example:

```text
YOUR-USERNAME.github.io
```

Do not include `https://`, a path, or a trailing slash in the authorized-domain entry.

---

# Part G — Create Realtime Database

This project uses **Realtime Database**, not Cloud Firestore.

1. In Firebase, open **Realtime Database**.
2. Click **Create database**.
3. Choose a location near your users. For a US school, a US location is sensible.
4. When asked about security mode, **Locked mode is fine** because you will immediately install the supplied rules. If the console guides you toward Test mode, do not leave the database on permissive Test-mode rules.
5. Finish creating the database.

You will now have a database URL. Depending on the region it can look like either:

```text
https://YOUR-DATABASE.firebaseio.com
```

or:

```text
https://YOUR-DATABASE.REGION.firebasedatabase.app
```

Copy the exact URL Firebase gives you.

---

# Part H — Install the supplied database rules

This step is important. Do not leave the database publicly writable.

1. In Firebase, open **Realtime Database**.
2. Click the **Rules** tab.
3. Open `database.rules.json` from this project on your computer/GitHub.
4. Copy everything in that file.
5. Replace the rules currently shown in Firebase with those contents.
6. Click **Publish**.

The supplied rules do several useful things:

- require Firebase authentication;
- only allow one-character numeric room keys (`0`–`9`);
- let a host create/control its room;
- let a player write only to that player's own player/word path;
- permit an expired/old room digit to be safely claimed by a new host;
- validate basic data structure and scoring fields.

This is still a casual-game security model. A technically sophisticated student who deliberately modifies browser JavaScript can falsify their own score; preventing that requires trusted server-side validation.

---

# Part I — Fill in `firebase-config.js`

Open:

```text
firebase-config.js
```

It currently contains placeholders similar to:

```js
export const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_DATABASE_NAME-default-rtdb.firebaseio.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};
```

Replace those values with the values from your Firebase Web App.

Make sure you have `databaseURL`. If the original config snippet does not show it because you created the Web App before Realtime Database, go back to Firebase **Project settings → Your apps**, retrieve the config again, and/or copy the exact database URL from Realtime Database.

A finished file should resemble:

```js
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "wordgrid-live-123.firebaseapp.com",
  databaseURL: "https://wordgrid-live-123-default-rtdb.firebaseio.com",
  projectId: "wordgrid-live-123",
  storageBucket: "wordgrid-live-123.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

Use **your actual values**, not this example.

Upload/commit the edited `firebase-config.js` to GitHub.

---

# Part J — Test multiplayer correctly

Do this only after Practice works and Firebase is configured.

## Test with two separate Firebase sessions

1. Open your GitHub Pages site normally.
2. Enter a name such as `Alex`.
3. Click **Create a room**.
4. You should receive one digit, for example `4`.
5. Open the site in either:
   - an incognito/private window;
   - a different browser; or
   - another phone/computer.
6. Enter a second name.
7. Enter `4` in the room-code box.
8. Click **Join**.
9. Both players should appear in the lobby.
10. On the host browser, select a round length and press **Start round**.
11. Both devices should show the same board and countdown.
12. Find a valid word on one device and confirm its score appears in the live leaderboard.

Using two ordinary tabs in the exact same browser profile may share the same anonymous Firebase identity. For a proper two-player test, use incognito/different browser/different device.

---

# How the one-digit room system works

There are only ten possible room paths:

```text
rooms/0
rooms/1
rooms/2
...
rooms/9
```

When a host clicks **Create a room**:

1. The browser randomizes which digit to try first.
2. It uses a Firebase transaction to attempt to claim that digit.
3. If another active room already occupies it, the transaction is rejected and the app tries another digit.
4. It continues through all ten digits.
5. If all ten are occupied, the app displays:

```text
All 10 rooms (0–9) are in use.
```

A room becomes reusable when:

- the host deliberately leaves, which deletes the room immediately;
- the finished-round grace period has passed; or
- its 30-minute lease expires.

Starting a round or a rematch refreshes the lease.

The 30-minute lease is deliberately much longer than a 60–120 second game but short enough that abandoned school-browser tabs should not consume codes forever.

---

# How Practice mode works

Practice creates a temporary room-shaped object only in JavaScript memory. It does not call Firebase.

The browser locally handles:

- board generation;
- timer;
- accepted-word duplicate tracking;
- dictionary validation;
- score calculation;
- word history;
- rematches.

Firebase JavaScript modules are dynamically imported only when someone presses **Create a room**, **Join**, or opens a valid multiplayer invite URL.

That means you can leave `firebase-config.js` untouched and still use Practice mode.

---

# Dictionary behavior

The loader tries, in order:

1. `./wordlist.txt` from your own site;
2. the YAWL list through jsDelivr;
3. the YAWL list through GitHub raw content.

Once loaded, the dictionary is cached in browser IndexedDB.

For a school network, I strongly recommend adding your own `wordlist.txt` using:

```bash
python tools/download-wordlist.py
```

YAWL is intentionally broad. It includes obscure, archaic, technical, variant, and potentially offensive entries. If this becomes a classroom concern, you can later substitute a curated school-safe dictionary.

---

# Board generation

The board is not uniformly random A–Z noise.

For each round, the generator:

1. samples letters using approximate English frequencies;
2. strongly favors common letters such as E, T, A, O, I, N, S, H, and R;
3. makes Q/J/X/Z rare;
4. tries to put U next to Q;
5. creates multiple candidate 4×4 boards;
6. evaluates vowel balance and letter diversity;
7. checks whether many common English words can actually be traced;
8. keeps the strongest candidate.

The comprehensive YAWL list is used for actual word acceptance; the smaller common-word list inside `game-core.js` is used only to judge whether a generated board is likely to be fun.

---

# Scoring

| Word length | Points |
|---:|---:|
| 3 | 100 |
| 4 | 300 |
| 5 | 600 |
| 6 | 1,000 |
| 7 | 1,500 |
| 8 | 2,200 |
| 9+ | +400 for each letter beyond 8 |

Change `scoreWord()` in `game-core.js` if you want a different scoring curve.

---

# Why the free Firebase plan should be enough

This design sends only small JSON room/player/score updates through Realtime Database. The large dictionary stays on the static website/browser side; it is **not** repeatedly transferred through Firebase.

Firebase's Spark plan currently lists Realtime Database allowances of:

- 100 simultaneous connections;
- 1 GB stored;
- 10 GB downloaded per month.

Your game itself also limits room keys to ten. At the usage you described—normally only a few simultaneous school games—Firebase traffic should be very small relative to those limits.

On Spark, Firebase caps service instead of billing you for overage; do not upgrade to Blaze unless you intentionally want pay-as-you-go behavior.

---

# Troubleshooting

## Practice button says to wait for the dictionary

Wait until the top-right status changes to roughly `264k words ready`.

If it never does:

1. Add `wordlist.txt` to your repository using `tools/download-wordlist.py`.
2. Confirm this URL works in your browser:

```text
https://YOUR-USERNAME.github.io/YOUR-REPO/wordlist.txt
```

3. Hard-refresh the site.

## GitHub Pages shows 404

Check:

- repository **Settings → Pages**;
- Source is **Deploy from a branch**;
- branch is `main`;
- folder is `/(root)` if your `index.html` is at the repository root;
- `index.html` is actually named exactly `index.html`.

Also check the repository's **Actions** tab for a failed Pages deployment.

## Create/Join says Firebase is not configured

You still have placeholder values in `firebase-config.js`. Replace them with the Web App configuration from Firebase.

## `auth/operation-not-allowed`

Anonymous Authentication is not enabled. Go to Firebase Authentication → Sign-in method → Anonymous and enable it.

## Authentication/domain error on GitHub Pages

Add:

```text
YOUR-USERNAME.github.io
```

to Firebase Authentication → Settings → Authorized domains.

## `PERMISSION_DENIED` from Realtime Database

Usually one of these is wrong:

1. Anonymous Authentication was not enabled.
2. `database.rules.json` was not copied into Realtime Database → Rules and published.
3. `databaseURL` in `firebase-config.js` is not the URL of this exact Realtime Database.
4. You edited the security rules but forgot to click **Publish**.

## Room creation says all ten rooms are in use

For normal school usage this should be rare. Possible causes:

- ten rooms really are occupied;
- several hosts closed browser tabs without pressing Leave, so their 30-minute room leases have not expired yet.

You can inspect the ten room keys in Firebase Realtime Database's **Data** tab. For emergency cleanup, you can manually delete stale room entries there.

## Two test players appear as one player

Use a private/incognito window, another browser, or another device. Two normal tabs can share the same anonymous Firebase login.

## Players see different boards

That means they are not actually in the same Firebase room/session. Verify both displays show the same one-digit code and that both names appear in the same lobby before starting.

---

# Optional developer test

If you have Node.js installed, run:

```bash
node tests.mjs
```

Expected output:

```text
All WordGrid core tests passed.
```

The tests cover adjacency, diagonal tracing, row-wrap rejection, no tile reuse, scoring, one-digit room-code handling, and randomized board generation.

---

# Files you normally edit

- `firebase-config.js` — **you must edit this once** for multiplayer.
- `database.rules.json` — normally do not modify; copy it into Firebase Rules.
- `styles.css` — colors/appearance.
- `game-core.js` — scoring and board generation.
- `index.html` — visible page wording/layout.
- `app.js` — multiplayer/practice behavior.

---

# Final deployment checklist

Before calling the site finished, verify every box:

- [ ] Project files extracted; ZIP itself is not being served as the site.
- [ ] `index.html` is in the intended GitHub Pages location.
- [ ] GitHub Pages is set to `main` + `/(root)` for a root deployment.
- [ ] The public Pages URL loads.
- [ ] Dictionary reaches approximately 264k words.
- [ ] Practice starts without Firebase configured/connected.
- [ ] `wordlist.txt` has been added to the repository (recommended).
- [ ] Firebase project created on Spark/no-cost plan.
- [ ] Firebase Web App registered.
- [ ] Anonymous Authentication enabled.
- [ ] Realtime Database created.
- [ ] `database.rules.json` copied to Realtime Database Rules and published.
- [ ] `firebase-config.js` replaced with your real config, including the correct `databaseURL`.
- [ ] Updated `firebase-config.js` committed to GitHub.
- [ ] Create Room returns one digit from 0–9.
- [ ] A second browser/incognito window can join using that digit.
- [ ] Both players receive the same board/countdown.
- [ ] Scores update on both devices.
- [ ] Host leaving closes/frees the room.
- [ ] Practice still works after Firebase is configured.

## License

Application code: MIT (`LICENSE`).  
YAWL `word.list`: Public Domain; credit to M. Leo Cooper.
