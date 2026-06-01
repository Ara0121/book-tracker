# BookKit — Personal Book Tracker

A zero-cost iPhone PWA for tracking books across three statuses: **Want to Read**, **Reading**, and **Read**.  
Your reading data lives in a private GitHub repo you own — not any third-party service.

---

## How it works

| Component | What it does |
|---|---|
| **Code repo** (public) | Hosts the static app via GitHub Pages. Zero personal data here. |
| **Data repo** (private) | Stores `books.json` with your full reading history. Only you can access it. |
| **GitHub API + PAT** | The app reads/writes `books.json` using a fine-grained token stored only on your device. |
| **IndexedDB** | Local source of truth. Works offline; syncs to GitHub when back online. |

---

## Deploy: step-by-step

### Step 1 — Create the private data repo

1. Go to **github.com → New repository**
2. Name it something like `book-data`
3. Set visibility to **Private**
4. Check **"Add a README file"** (this initialises the repo)
5. Click **Create repository**

> This repo will hold `books.json`. It never needs to be pushed from your computer — the app writes to it directly via the API.

---

### Step 2 — Create a fine-grained Personal Access Token

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
2. Click **Generate new token**
3. Fill in:
   - **Token name:** `BookKit`
   - **Expiration:** 1 year (or No expiration)
   - **Resource owner:** your account
   - **Repository access:** Only select repositories → choose `book-data`
4. Under **Permissions**, set:
   - **Contents:** Read and write  
   *(everything else stays at No access)*
5. Click **Generate token**
6. **Copy the token immediately** — you won't see it again. Paste it somewhere safe.

> The token only has write access to `book-data`. If it were ever leaked, it could not touch any other repo.

---

### Step 3 — Create the code repo and push

1. Go to **github.com → New repository**
2. Name it `book-tracker`
3. Set visibility to **Public** (required for free GitHub Pages)
4. Do **not** add a README (you'll push from your computer)
5. Click **Create repository**
6. Push the `book-tracker/` folder from this speckit as the root of that repo:

```bash
cd path/to/book-tracker   # the folder containing docs/ and scripts/
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/book-tracker.git
git push -u origin main
```

---

### Step 4 — Enable GitHub Pages

1. In the `book-tracker` repo, go to **Settings → Pages**
2. Under **Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: `main`
   - Folder: `/docs`
3. Click **Save**
4. Wait ~1 minute. GitHub will show the live URL at the top of the Pages settings page.
   It will look like: `https://YOUR_USERNAME.github.io/book-tracker/`

---

### Step 5 — First launch and setup

1. Open the Pages URL in **iPhone Safari**
2. You'll see the BookKit setup screen
3. Enter:
   - **GitHub PAT** — the token you copied in Step 2
   - **Data repo** — `YOUR_USERNAME/book-data`
4. Tap **Connect →**
   - The app verifies your token and loads (or creates) `books.json`
   - On success, the home screen appears

---

### Step 6 — Install to iPhone home screen

In Safari (while on the BookKit URL):

> **Share button (□↑) → Add to Home Screen → Add**

The app will now launch in standalone mode (no browser chrome) just like a native app.

---

## Adding a book

Tap the **+** button on the home screen, then:

- **Paste an ISBN** (e.g. `9784167158057`) → auto-fills title, author, cover
- **Paste an Amazon JP link** (e.g. `https://www.amazon.co.jp/dp/4167158051/`) → extracts ISBN, auto-fills
- **Type a title** → searches Open Library, shows a list of results to pick from
- **Type manually** if the lookup finds nothing

After selecting a book, choose the status and language, then tap **Add Book**.

---

## Data and privacy

- `books.json` in your private `book-data` repo is the durable store.
- Your PAT is stored in **IndexedDB on your device only** — it never leaves except to `api.github.com`.
- If you uninstall Safari data / clear site data, the app re-prompts for your PAT on next launch, but your books are safe in the GitHub repo.
- To migrate to a new phone: install the app, enter the same PAT + repo, and your full history reloads.

---

## Offline use

The app is fully usable offline (subway/airplane mode):

- All reads come from IndexedDB (local).
- Any changes (status moves, memos, ratings) are saved locally immediately and queued.
- When back online, changes sync to GitHub automatically within 5 seconds.
- The service worker caches the app shell so the app loads even with no network.

---

## Rotating your token

If your PAT expires or is compromised:

1. Create a new fine-grained token (same scopes, same repo)
2. In BookKit, tap ⚙️ → re-enter the new token → tap Connect

---

## Local development

```bash
# Serve the docs/ folder locally
python -m http.server 8000 --directory docs
# Then open http://localhost:8000
```

ES modules require an HTTP server — opening `index.html` directly via `file://` will not work.
