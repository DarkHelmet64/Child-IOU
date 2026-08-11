# Family Bank

A free, pretend "bank account" tracker for kids. One QR code / link opens
the app, which shows every child's balance and transaction history, plus a
simple pie chart of that month's money in vs. money out for each one. The
balance updates live on every device, since it's backed by a small free
cloud database — nothing connects to a real bank.

No build step, no framework — plain HTML/CSS/JS, hosted for free on GitHub
Pages, data stored for free in Firebase Firestore.

## How it works

- **Admin screen** (the site's root URL, no `?account=` in it): view all
  accounts and their balances, and a "+ Create account" button.
- **New account screen** (`?new`): a small form for a child's name and an
  optional starting balance.
- **Account screen** (`?account=<id>`): shows one child's balance, a pie
  chart of money in vs. out, and recent transactions, with "Add money" /
  "Subtract money" buttons and a "Delete account" button.
- **PIN**: adding money, creating an account, or deleting an account asks
  for a PIN (the first time, the app has you set one). Subtracting money
  does **not** require the PIN, so kids can freely log what they spent —
  only adding money (or removing an account) needs a parent. See the
  security note below — this PIN is a soft deterrent, not real security.

## One-time setup

### 1. Create a free Firebase project

1. Go to <https://console.firebase.google.com/> and create a new project
   (the free "Spark" plan is all you need).
2. In the project, click the **Web** icon (`</>`) to register a new web app.
   You don't need Firebase Hosting for this — just registering the app.
3. Firebase will show you a code snippet with an `import ... from "firebase/app"`
   line and a `const firebaseConfig = { ... }` object. **Only copy the values
   inside `firebaseConfig`** (apiKey, authDomain, projectId, etc.) — ignore
   the `import` line and the `initializeApp(...)` call, those are for a
   different (bundler-based) project setup and will break this site if pasted
   in as-is.
4. Open `firebase-config.js` in this repo and replace just the placeholder
   values inside `export const firebaseConfig = { ... }` with the ones you
   copied. Leave the `export const firebaseConfig = {` line and the file
   structure as they are.

### 2. Turn on Firestore

1. In the Firebase console, go to **Build > Firestore Database** and click
   **Create database** (choose any nearby region, "production mode" is fine).
2. Go to the **Rules** tab and replace the default rules with the contents of
   [`firestore.rules`](./firestore.rules) from this repo, then **Publish**.

### 3. Host it for free on GitHub Pages

1. In this repository on GitHub, go to **Settings > Pages**.
2. Under "Build and deployment", set **Source** to "Deploy from a branch",
   pick the branch this code lives on (e.g. `main`) and folder `/ (root)`.
3. Save. GitHub will give you a URL like
   `https://<your-username>.github.io/<repo-name>/` — that's your app.

### 4. Create accounts and get a QR code

1. Open your GitHub Pages URL. You'll land on the admin screen.
2. Tap **+ Create account** and fill in a name (and an optional starting
   balance) for each child. You're dropped straight into that child's account
   page once it's created.
3. From the admin screen, tap **Show QR code** to get one QR code / link for
   the whole app (not one per child) — print it, download it as a PNG, or
   copy the link. Scanning it opens the admin screen, where anyone can tap
   into a child's account.

## Adding / subtracting money

Open a child's account page and tap **Add money** or **Subtract money**,
then enter an amount and an optional note (e.g. "Allowance", "Bought a
toy"). Adding money asks for the PIN; subtracting doesn't, so a kid can
freely log what they spent without needing a parent. The balance, pie
chart, and history update immediately, and any other device with that
child's page open will see the change too.

## Security note

This app has no server of its own — it's static files talking directly to
Firestore, which keeps it free and simple. That means:

- The PIN is checked **in the app**, not by the database. It stops a kid from
  casually editing their own balance, but it is not cryptographically secure.
- Anyone with a link to your app (admin page or a specific account) can view
  balances. Don't share the links/QR codes outside your family.

This is the right amount of security for a fun, low-stakes pretend account —
it is **not** meant to hold or represent real money.

## Local development

No build step is required. Any static file server works, e.g.:

```bash
npx serve .
```

Then open the printed URL. Firestore reads/writes will work as soon as
`firebase-config.js` and the Firestore rules are set up (steps above).
