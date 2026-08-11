# Family Bank

A free, pretend "bank account" tracker for kids. Each child gets their own QR
code / link that opens a page showing their balance and transaction history.
A parent can add or subtract money (behind a PIN); the balance updates live
on every device, since it's backed by a small free cloud database — nothing
connects to a real bank.

No build step, no framework — plain HTML/CSS/JS, hosted for free on GitHub
Pages, data stored for free in Firebase Firestore.

## How it works

- **Admin screen** (the site's root URL, no `?account=` in it): create, view,
  and delete child accounts.
- **Account screen** (`?account=<id>`): shows one child's balance and recent
  transactions, with "Add money" / "Subtract money" buttons. This is the page
  the QR code links to.
- **PIN**: the first time anyone adds/subtracts money or creates/deletes an
  account, the app asks you to set a PIN. From then on, that PIN is required
  for those actions. See the security note below — it's a soft deterrent for
  kids, not real security.

## One-time setup

### 1. Create a free Firebase project

1. Go to <https://console.firebase.google.com/> and create a new project
   (the free "Spark" plan is all you need).
2. In the project, click the **Web** icon (`</>`) to register a new web app.
   You don't need Firebase Hosting for this — just registering the app.
3. Copy the `firebaseConfig` object it shows you.
4. Paste those values into `firebase-config.js` in this repo, replacing the
   placeholder values.

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

### 4. Create accounts and get QR codes

1. Open your GitHub Pages URL. You'll land on the admin screen.
2. Create an account for each child (name + optional starting balance).
3. Tap into an account and hit **Show QR code**. Scan it with your child's
   device (or your own) to open that child's balance page directly, or use
   **Copy link** to send/save it another way. Save the QR image (screenshot,
   or print it) so it's easy to scan again later.

## Adding / subtracting money

Open a child's account page, tap **Add money** or **Subtract money**, enter
an amount and an optional note (e.g. "Allowance", "Bought a toy"), and enter
the PIN when asked. The balance and history update immediately, and any other
device with that child's page open (or that scans the QR again) will see the
new balance too.

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
