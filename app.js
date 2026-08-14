import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  writeBatch,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $app = document.getElementById("app");

const params = new URLSearchParams(location.search);
const accountId = params.get("account");
const isNewAccountPage = params.has("new");
const isChoresPage = params.has("chores");

if (isConfigMissing()) {
  renderConfigMissing();
} else if (isNewAccountPage) {
  renderNewAccountView();
} else if (isChoresPage) {
  renderManageChoresView();
} else if (accountId) {
  renderAccountView(accountId);
} else {
  renderAdminView();
}

function isConfigMissing() {
  return !firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY";
}

function renderConfigMissing() {
  $app.innerHTML = `
    <h1><span class="emoji">🏦</span>Family Bank</h1>
    <div class="card">
      <p>This app isn't connected to a database yet.</p>
      <p class="hint">Fill in <code>firebase-config.js</code> with your free Firebase project's
      web config, then reload this page. See README.md for step-by-step setup instructions.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatUSD(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}

function dollarsToCents(dollarsStr) {
  const val = Math.round(parseFloat(dollarsStr) * 100);
  return Number.isFinite(val) ? val : NaN;
}

function formatDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "";
  return timestamp.toDate().toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function siteUrl() {
  const url = new URL(location.href);
  url.search = "";
  return url.toString();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Clipboard API unavailable (older browsers, some webviews) — fall back below.
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

// ---------------------------------------------------------------------------
// Modal helpers
//
// We use our own in-page modals everywhere instead of window.prompt/alert/confirm.
// Those native dialogs are silently disabled by iOS Safari once a page is opened
// from a home-screen icon (exactly how this app is meant to be used after
// scanning a QR code), so relying on them made PIN entry randomly stop working.
// ---------------------------------------------------------------------------

function buildModal(innerHtml, { onDismiss } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay.remove();
      if (onDismiss) onDismiss();
    }
  });
  document.body.appendChild(overlay);
  return overlay;
}

function openPromptModal({ title, message, inputType = "text", placeholder = "", confirmLabel = "OK" }) {
  return new Promise((resolve) => {
    const overlay = buildModal(
      `
        <h2>${escapeHtml(title)}</h2>
        ${message ? `<p class="hint">${escapeHtml(message)}</p>` : ""}
        <input id="prompt-input" type="${inputType}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" autofocus />
        <div class="modal-actions">
          <button class="secondary" id="prompt-cancel">Cancel</button>
          <button id="prompt-submit">${escapeHtml(confirmLabel)}</button>
        </div>
      `,
      { onDismiss: () => resolve(null) }
    );
    const input = overlay.querySelector("#prompt-input");
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector("#prompt-cancel").addEventListener("click", () => finish(null));
    overlay.querySelector("#prompt-submit").addEventListener("click", () => finish(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value);
    });
    input.focus();
  });
}

function openConfirmModal({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const overlay = buildModal(
      `
        <h2>${escapeHtml(title)}</h2>
        ${message ? `<p class="hint">${escapeHtml(message)}</p>` : ""}
        <div class="modal-actions">
          <button class="secondary" id="confirm-cancel">Cancel</button>
          <button class="${danger ? "danger-solid" : ""}" id="confirm-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      `,
      { onDismiss: () => resolve(false) }
    );
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector("#confirm-cancel").addEventListener("click", () => finish(false));
    overlay.querySelector("#confirm-ok").addEventListener("click", () => finish(true));
  });
}

function openAlertModal(message) {
  return new Promise((resolve) => {
    const overlay = buildModal(
      `
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          <button id="alert-ok">OK</button>
        </div>
      `,
      { onDismiss: () => resolve() }
    );
    overlay.querySelector("#alert-ok").addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// PIN handling (see firestore.rules for the security model / limitations)
// ---------------------------------------------------------------------------

async function getStoredPin() {
  const snap = await getDoc(doc(db, "settings", "config"));
  return snap.exists() ? snap.data().pin : null;
}

async function requirePin(actionLabel) {
  const storedPin = await getStoredPin();

  if (!storedPin) {
    const newPin = await openPromptModal({
      title: "Set up a PIN",
      message: `No PIN is set up yet. Choose one to protect edits like "${actionLabel}".`,
      inputType: "password",
      placeholder: "New PIN",
      confirmLabel: "Set PIN",
    });
    if (!newPin) return false;
    const confirmPin = await openPromptModal({
      title: "Confirm PIN",
      message: "Enter the same PIN again to confirm.",
      inputType: "password",
      placeholder: "Confirm PIN",
      confirmLabel: "Confirm",
    });
    if (newPin !== confirmPin) {
      await openAlertModal("Those PINs didn't match. Please try again.");
      return false;
    }
    await setDoc(doc(db, "settings", "config"), { pin: newPin });
    return true;
  }

  const entered = await openPromptModal({
    title: "Enter PIN",
    message: `Enter the PIN to ${actionLabel}.`,
    inputType: "password",
    placeholder: "PIN",
    confirmLabel: "Submit",
  });
  if (entered === null) return false;
  if (entered !== storedPin) {
    await openAlertModal("Incorrect PIN.");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Admin view: list of all accounts
// ---------------------------------------------------------------------------

function renderAdminView() {
  $app.innerHTML = `
    <div class="top-bar">
      <h1><span class="emoji">🏦</span>Family Bank</h1>
      <button class="secondary small" id="site-qr-btn">Show QR code</button>
    </div>
    <div id="account-list"></div>
    <a class="btn primary-action" href="?new">+ Create account</a>
    <div class="section-title row-title">
      <span>Chores</span>
      <a class="inline-link" href="?chores">Manage</a>
    </div>
    <div class="chore-list" id="chore-list"><p class="loading">Loading…</p></div>
  `;

  document.getElementById("site-qr-btn").addEventListener("click", () => {
    openQrModal(siteUrl(), "Scan to open Family Bank");
  });

  mountChoreList(document.getElementById("chore-list"));

  const listEl = document.getElementById("account-list");
  onSnapshot(collection(db, "accounts"), (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p class="empty">No accounts yet. Create one to get started.</p>`;
      return;
    }
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const negative = data.balanceCents < 0 ? "negative" : "";
      rows.push(`
        <div class="card account-row" data-id="${docSnap.id}">
          <span class="name">${escapeHtml(data.name)}</span>
          <span class="balance ${negative}">${formatUSD(data.balanceCents)}</span>
        </div>
      `);
    });
    listEl.innerHTML = rows.join("");
    listEl.querySelectorAll(".account-row").forEach((row) => {
      row.addEventListener("click", () => {
        location.search = `?account=${row.dataset.id}`;
      });
    });
  });
}

// ---------------------------------------------------------------------------
// New account view: a dedicated page for creating a child's account
// ---------------------------------------------------------------------------

function renderNewAccountView() {
  $app.innerHTML = `
    <a class="back-link" href="./">&larr; All accounts</a>
    <h1><span class="emoji">🏦</span>New account</h1>
    <div class="card">
      <form id="new-account-form" class="new-account-form">
        <input id="new-account-name" type="text" placeholder="Child's name" required autofocus />
        <input id="new-account-balance" type="number" step="0.01" min="0" placeholder="Starting balance (optional, e.g. 20.00)" />
        <button type="submit">Create account</button>
      </form>
    </div>
  `;

  document.getElementById("new-account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-account-name").value.trim();
    if (!name) return;
    const balanceInput = document.getElementById("new-account-balance").value;
    const startingCents = balanceInput ? dollarsToCents(balanceInput) : 0;
    if (Number.isNaN(startingCents)) {
      await openAlertModal("Please enter a valid starting balance.");
      return;
    }

    const ok = await requirePin("create a new account");
    if (!ok) return;

    const accountRef = await addDoc(collection(db, "accounts"), {
      name,
      balanceCents: startingCents,
      createdAt: serverTimestamp(),
    });

    if (startingCents !== 0) {
      await addDoc(collection(db, "accounts", accountRef.id, "transactions"), {
        amountCents: startingCents,
        note: "Starting balance",
        createdAt: serverTimestamp(),
      });
    }

    location.search = `?account=${accountRef.id}`;
  });
}

// ---------------------------------------------------------------------------
// Account view: balance + transaction history for one child
// ---------------------------------------------------------------------------

function renderAccountView(id) {
  $app.innerHTML = `
    <a class="back-link" href="./">&larr; All accounts</a>
    <div class="card balance-hero" id="hero">
      <p class="loading">Loading account…</p>
    </div>
  `;

  const accountRef = doc(db, "accounts", id);

  onSnapshot(accountRef, (snap) => {
    if (!snap.exists()) {
      $app.innerHTML = `
        <a class="back-link" href="./">&larr; All accounts</a>
        <div class="card"><p class="empty">This account doesn't exist (maybe it was deleted).</p></div>
      `;
      return;
    }
    renderAccountBody(id, snap.data());
  });
}

function renderAccountBody(id, data) {
  // Only rebuild the shell once; called on every balance update, so keep it idempotent.
  const negative = data.balanceCents < 0 ? "negative" : "";

  if (!document.getElementById("hero-amount")) {
    $app.innerHTML = `
      <a class="back-link" href="./">&larr; All accounts</a>
      <div class="card balance-hero">
        <div class="name" id="hero-name"></div>
        <div class="amount" id="hero-amount"></div>
      </div>
      <div class="action-row">
        <button class="add-btn" id="add-btn">+ Add money</button>
        <button class="subtract-btn" id="subtract-btn">&minus; Subtract</button>
      </div>
      <div class="card pie-card">
        <div class="section-title" style="margin-top:0">Money in vs. money out (this month)</div>
        <div class="pie-row">
          <svg viewBox="0 0 36 36" class="pie-chart-svg" id="pie-chart-svg">
            <circle cx="18" cy="18" r="16" fill="var(--red)"></circle>
            <path id="pie-chart-fg" fill="var(--green)" d=""></path>
          </svg>
          <p class="pie-empty" id="pie-empty" style="display:none">No activity yet this month.</p>
          <div class="pie-legend" id="pie-legend">
            <div class="pie-legend-item"><span class="dot in"></span>In <strong id="pie-in"></strong></div>
            <div class="pie-legend-item"><span class="dot out"></span>Out <strong id="pie-out"></strong></div>
          </div>
        </div>
      </div>
      <div class="section-title row-title">
        <span>Chores</span>
        <a class="inline-link" href="?chores">Manage</a>
      </div>
      <div class="chore-list" id="chore-list"><p class="loading">Loading…</p></div>
      <div class="single-action">
        <button class="ghost" id="delete-btn">Delete account</button>
      </div>
      <div class="section-title">Recent activity</div>
      <div class="tx-list" id="tx-list"><p class="loading">Loading…</p></div>
    `;

    document.getElementById("add-btn").addEventListener("click", () => openTxModal(id, 1));
    document.getElementById("subtract-btn").addEventListener("click", () => openTxModal(id, -1));
    document.getElementById("delete-btn").addEventListener("click", () => deleteAccount(id, data.name));

    listenTransactions(id);
    listenMonthlyTotals(id);
    mountChoreList(document.getElementById("chore-list"), { accountId: id, accountName: data.name });
  }

  document.getElementById("hero-name").textContent = data.name;
  const amountEl = document.getElementById("hero-amount");
  amountEl.textContent = formatUSD(data.balanceCents);
  amountEl.className = `amount ${negative}`;
}

function startOfMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

// Builds an SVG path for a pie wedge covering `pct` percent of the circle,
// starting at 12 o'clock and sweeping clockwise. Drawn over a full circle in
// the "out" color, so the uncovered remainder reads as the other slice.
function pieSlicePath(pct) {
  const cx = 18;
  const cy = 18;
  const r = 16;
  if (pct <= 0.01) return "";
  if (pct >= 99.99) {
    // A single arc can't describe a full circle, so draw it as two halves.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`;
  }
  const point = (percent) => {
    const angle = ((percent * 3.6 - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };
  const start = point(0);
  const end = point(pct);
  const largeArcFlag = pct > 50 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;
}

function listenMonthlyTotals(id) {
  const monthQuery = query(
    collection(db, "accounts", id, "transactions"),
    where("createdAt", ">=", startOfMonth())
  );
  onSnapshot(monthQuery, (snap) => {
    let inCents = 0;
    let outCents = 0;
    snap.forEach((docSnap) => {
      const amount = docSnap.data().amountCents;
      if (amount >= 0) inCents += amount;
      else outCents += Math.abs(amount);
    });

    const total = inCents + outCents;
    const inPct = total > 0 ? (inCents / total) * 100 : 0;
    const hasActivity = total > 0;
    document.getElementById("pie-chart-svg").style.display = hasActivity ? "" : "none";
    document.getElementById("pie-legend").style.display = hasActivity ? "" : "none";
    document.getElementById("pie-empty").style.display = hasActivity ? "none" : "";
    if (hasActivity) {
      document.getElementById("pie-chart-fg").setAttribute("d", pieSlicePath(inPct));
    }
    document.getElementById("pie-in").textContent = formatUSD(inCents);
    document.getElementById("pie-out").textContent = formatUSD(outCents);
  });
}

function listenTransactions(id) {
  const txQuery = query(
    collection(db, "accounts", id, "transactions"),
    orderBy("createdAt", "desc"),
    limit(50)
  );
  onSnapshot(txQuery, (snap) => {
    const listEl = document.getElementById("tx-list");
    if (!listEl) return;
    if (snap.empty) {
      listEl.innerHTML = `<p class="empty">No transactions yet.</p>`;
      return;
    }
    const rows = [];
    snap.forEach((docSnap) => {
      const tx = docSnap.data();
      const positive = tx.amountCents >= 0;
      rows.push(`
        <div class="tx-row">
          <span>
            <span class="tx-note">${escapeHtml(tx.note || "Transaction")}</span>
            <span class="tx-date">${formatDate(tx.createdAt)}</span>
          </span>
          <span class="tx-amount ${positive ? "positive" : "negative"}">
            ${positive ? "+" : ""}${formatUSD(tx.amountCents)}
          </span>
        </div>
      `);
    });
    listEl.innerHTML = rows.join("");
  });
}

async function deleteAccount(id, name) {
  const confirmed = await openConfirmModal({
    title: "Delete account?",
    message: `Delete ${name}'s account? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  const ok = await requirePin(`delete ${name}'s account`);
  if (!ok) return;
  await deleteDoc(doc(db, "accounts", id));
  location.search = "";
}

// ---------------------------------------------------------------------------
// Add / subtract money modal
// ---------------------------------------------------------------------------

function openTxModal(accountId, sign) {
  const isAdd = sign > 0;
  const overlay = buildModal(`
    <h2>${isAdd ? "Add money" : "Subtract money"}</h2>
    <label for="tx-amount">Amount (USD)</label>
    <input id="tx-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0.00" autofocus />
    <label for="tx-note">Reason (optional)</label>
    <input id="tx-note" type="text" placeholder="${isAdd ? "e.g. Allowance, chores" : "e.g. Toy, snack"}" />
    <div class="modal-actions">
      <button class="secondary" id="modal-cancel">Cancel</button>
      <button id="modal-submit">${isAdd ? "Add" : "Subtract"}</button>
    </div>
  `);

  overlay.querySelector("#modal-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#modal-submit").addEventListener("click", async () => {
    const amountStr = overlay.querySelector("#tx-amount").value;
    const cents = dollarsToCents(amountStr);
    if (!cents || Number.isNaN(cents) || cents <= 0) {
      await openAlertModal("Please enter a valid amount greater than $0.");
      return;
    }
    const note = overlay.querySelector("#tx-note").value.trim();

    overlay.remove();
    // Adding money is PIN-protected (so a kid can't just give themselves money);
    // subtracting isn't, so kids can freely log what they spent.
    if (isAdd) {
      const ok = await requirePin("add money");
      if (!ok) return;
    }

    const signedCents = cents * sign;
    const batch = writeBatch(db);
    batch.update(doc(db, "accounts", accountId), { balanceCents: increment(signedCents) });
    batch.set(doc(collection(db, "accounts", accountId, "transactions")), {
      amountCents: signedCents,
      note: note || (isAdd ? "Deposit" : "Withdrawal"),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    showToast(isAdd ? "Money added" : "Money subtracted");
  });
}

// ---------------------------------------------------------------------------
// Chores
//
// Chores live in a top-level `chores` collection. There's no server or cron job
// behind this app, so nothing ever writes a chore back to "unclaimed" -- instead
// each claim records the period it belongs to (today's date for a daily chore,
// the week's Sunday for a weekly one, the month for a monthly one). A chore is
// up for grabs again the moment the current period key stops matching the stored
// one, so resets just happen on their own as the clock rolls over.
//
// Claiming is deliberately PIN-free (any kid can call a chore, and un-call it),
// but turning a claimed chore into money needs the same PIN as "Add money".
// ---------------------------------------------------------------------------

// A one-time chore is just a chore whose period never ends: `resets` is empty
// because there's no "and then it comes back" to promise, and its period key is
// a constant, so the claim on it stays current forever instead of aging out.
const RESET_PERIODS = {
  daily: { label: "Daily", resets: "Resets tomorrow" },
  weekly: { label: "Weekly", resets: "Resets Sunday" },
  monthly: { label: "Monthly", resets: "Resets on the 1st" },
  once: { label: "One-time", resets: "" },
};

function resetPeriodOf(chore) {
  return RESET_PERIODS[chore.resetPeriod] ? chore.resetPeriod : "daily";
}

function repeats(chore) {
  return resetPeriodOf(chore) !== "once";
}

// Every chore list reads the same way: daily first, then weekly, then monthly,
// then the one-offs, alphabetical within each. The database query orders by
// `createdAt`, which only matters now as a stable tiebreak between two chores
// with the same name.
const RESET_PERIOD_ORDER = Object.keys(RESET_PERIODS);

function compareChores(a, b) {
  const byPeriod =
    RESET_PERIOD_ORDER.indexOf(resetPeriodOf(a)) - RESET_PERIOD_ORDER.indexOf(resetPeriodOf(b));
  if (byPeriod !== 0) return byPeriod;
  return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// "Resets Sunday" -> "resets Sunday" (only the first letter, so day names keep
// their capital when the label is used mid-sentence).
function lowerFirst(str) {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

// Without this, a rejected read leaves the chore list sitting on "Loading…"
// forever with the reason buried in the browser console. The overwhelmingly
// likely cause is the `chores` rules block not being published yet, so say so.
function choreLoadErrorHtml(err) {
  console.error(err);
  const message =
    err && err.code === "permission-denied"
      ? "The database is refusing to load chores. Publish the updated firestore.rules in the Firebase console (Firestore Database → Rules), then reload."
      : "Couldn't load chores. Check your connection and reload.";
  return `<p class="empty chore-empty">${message}</p>`;
}

// A stable id for "the stretch of time a claim belongs to", in local time, for
// whichever period `date` falls in.
function periodKeyFor(resetPeriod, date) {
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  if (resetPeriod === "once") return "once";
  if (resetPeriod === "monthly") return `m:${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  if (resetPeriod === "weekly") {
    const sunday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay());
    return `w:${ymd(sunday)}`;
  }
  return `d:${ymd(date)}`;
}

function currentPeriodKey(resetPeriod, now = new Date()) {
  return periodKeyFor(resetPeriod, now);
}

// The claim on a chore, but only if it's from the period we're currently in --
// an older claim means the chore has already reset and is free again.
function activeClaim(chore) {
  const claim = chore.claim;
  if (!claim || !claim.accountId) return null;
  return claim.periodKey === currentPeriodKey(resetPeriodOf(chore)) ? claim : null;
}

// How many finished periods back "Credit a past chore" will offer.
const PAST_CREDIT_LOOKBACK = { daily: 6, weekly: 4, monthly: 3 };

// The finished periods a chore can still be credited for, most recent first.
// Each one carries the key it would be recorded under, a label for the picker,
// and the shorter wording that goes in the transaction note.
function pastPeriods(resetPeriod, now = new Date()) {
  const monthDay = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const periods = [];

  for (let ago = 1; ago <= PAST_CREDIT_LOOKBACK[resetPeriod]; ago++) {
    let start;
    let label;
    let note;

    if (resetPeriod === "monthly") {
      start = new Date(now.getFullYear(), now.getMonth() - ago, 1);
      const sameYear = start.getFullYear() === now.getFullYear();
      const month = start.toLocaleDateString(undefined, {
        month: "long",
        ...(sameYear ? {} : { year: "numeric" }),
      });
      label = ago === 1 ? `Last month (${month})` : month;
      note = month;
    } else if (resetPeriod === "weekly") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7 * ago);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      label = ago === 1 ? `Last week (${monthDay(start)}–${monthDay(end)})` : `Week of ${monthDay(start)}`;
      note = `week of ${monthDay(start)}`;
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago);
      const weekday = start.toLocaleDateString(undefined, { weekday: "long" });
      label = ago === 1 ? `Yesterday (${monthDay(start)})` : `${weekday} (${monthDay(start)})`;
      note = monthDay(start);
    }

    periods.push({ key: periodKeyFor(resetPeriod, start), label, note });
  }

  return periods;
}

// Who already got paid for `periodKey`, if anyone: either a past credit, or a
// claim that was checked off back while that period was still the current one.
function paidNameFor(chore, periodKey) {
  const credit = (chore.pastCredits || {})[periodKey];
  if (credit) return credit.accountName;
  const claim = chore.claim;
  if (claim && claim.approved && claim.periodKey === periodKey) return claim.accountName;
  return null;
}

// The frequency doubles as the row's color (see `.chore-row[data-period]`), so
// every row carries the period it belongs to.
function choreRowAttrs(chore, extraClass = "") {
  return `class="chore-row${extraClass ? ` ${extraClass}` : ""}" data-period="${resetPeriodOf(chore)}" data-id="${chore.id}"`;
}

// "Daily · Resets tomorrow", but just "One-time" for a chore that never comes
// back -- there's no reset to describe.
function chorePeriodMeta(chore) {
  const period = RESET_PERIODS[resetPeriodOf(chore)];
  return `<span class="chore-period">${period.label}</span>${period.resets ? ` · ${period.resets}` : ""}`;
}

function choreRowHtml(chore, claim) {
  const period = RESET_PERIODS[resetPeriodOf(chore)];
  const name = escapeHtml(chore.name);
  const amount = formatUSD(chore.amountCents);

  if (!claim) {
    return `
      <div ${choreRowAttrs(chore)}>
        <span class="chore-info">
          <span class="chore-name">${name}</span>
          <span class="chore-meta">${chorePeriodMeta(chore)}</span>
        </span>
        <span class="chore-amount">${amount}</span>
        <span class="chore-actions">
          <button class="small" data-act="claim">Claim</button>
        </span>
      </div>
    `;
  }

  if (claim.approved) {
    // A one-time chore is finished for good once it's paid, so it offers a way
    // off the list instead of a promise to come back.
    return `
      <div ${choreRowAttrs(chore, "done")}>
        <span class="chore-info">
          <span class="chore-name">✓ ${name}</span>
          <span class="chore-meta">${escapeHtml(claim.accountName)} got paid${
            period.resets ? ` · ${lowerFirst(period.resets)}` : ""
          }</span>
        </span>
        <span class="chore-amount">${amount}</span>
        ${
          repeats(chore)
            ? ""
            : `<span class="chore-actions"><button class="ghost" data-act="remove">Remove</button></span>`
        }
      </div>
    `;
  }

  return `
    <div ${choreRowAttrs(chore, "pending")}>
      <span class="chore-info">
        <span class="chore-name">${name}</span>
        <span class="chore-meta">Claimed by ${escapeHtml(claim.accountName)} · needs checking</span>
      </span>
      <span class="chore-amount">${amount}</span>
      <span class="chore-actions">
        <button class="small approve" data-act="approve">Check off</button>
        <button class="ghost" data-act="unclaim">Unclaim</button>
      </span>
    </div>
  `;
}

// Renders the chore list into `containerEl` and keeps it live. On an account
// page (`accountId` given) claiming is one tap and other kids' claims are
// hidden; on the dashboard, claiming asks who's claiming.
function mountChoreList(containerEl, { accountId = null, accountName = null } = {}) {
  let chores = [];

  const render = () => {
    if (!chores.length) {
      containerEl.innerHTML = `<p class="empty chore-empty">No chores yet. Tap “Manage” to add one.</p>`;
      return;
    }

    const groups = { available: [], pending: [], done: [], finished: [] };
    for (const chore of chores) {
      const claim = activeClaim(chore);
      // On a child's own page, only their own claims are worth showing.
      if (claim && accountId && claim.accountId !== accountId) continue;
      const group = !claim
        ? "available"
        : !claim.approved
          ? "pending"
          : repeats(chore)
            ? "done"
            : "finished";
      groups[group].push([chore, claim]);
    }

    const section = (title, rows) =>
      rows.length
        ? `<div class="chore-group-label">${title}</div>${rows
            .map(([chore, claim]) => choreRowHtml(chore, claim))
            .join("")}`
        : "";

    const rows =
      section("Up for grabs", groups.available) +
      section("Waiting to be checked", groups.pending) +
      section("Done for now", groups.done) +
      section("Finished", groups.finished) ||
      `<p class="empty chore-empty">Nothing to claim right now.</p>`;

    // A recurring chore that reset before anyone checked it off can't be claimed
    // any more, so there's a way in to pay one out after the fact. One-time
    // chores never reset, so a list of only those has nothing to offer here.
    containerEl.innerHTML = `${rows}${
      chores.some(repeats)
        ? `<button class="ghost past-credit-btn" data-act="past-credit">Credit a past chore</button>`
        : ""
    }`;
  };

  containerEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-act]");
    if (!button) return;
    if (button.dataset.act === "past-credit") {
      openPastCreditModal(chores.filter(repeats), { accountId, accountName });
      return;
    }
    const id = button.closest(".chore-row").dataset.id;
    const chore = chores.find((c) => c.id === id);
    if (!chore) return;
    if (button.dataset.act === "claim") claimChore(chore, accountId, accountName);
    else if (button.dataset.act === "approve") approveChore(chore);
    else if (button.dataset.act === "unclaim") unclaimChore(chore);
    else if (button.dataset.act === "remove") deleteChore(chore);
  });

  onSnapshot(
    query(collection(db, "chores"), orderBy("createdAt")),
    (snap) => {
      chores = [];
      snap.forEach((docSnap) => chores.push({ id: docSnap.id, ...docSnap.data() }));
      chores.sort(compareChores);
      render();
    },
    (err) => {
      containerEl.innerHTML = choreLoadErrorHtml(err);
    }
  );

  // Nothing writes to the database when a chore resets, so a page left open
  // overnight would keep showing yesterday's list. Re-render when the day flips.
  let dayKey = currentPeriodKey("daily");
  setInterval(() => {
    const key = currentPeriodKey("daily");
    if (key === dayKey) return;
    dayKey = key;
    render();
  }, 60000);
}

async function claimChore(chore, accountId, accountName) {
  let claimer = accountId ? { id: accountId, name: accountName } : await openAccountPickerModal(chore);
  if (!claimer) return;

  try {
    await runTransaction(db, async (tx) => {
      const choreRef = doc(db, "chores", chore.id);
      const snap = await tx.get(choreRef);
      if (!snap.exists()) throw new Error("This chore was deleted.");
      if (activeClaim({ id: chore.id, ...snap.data() })) {
        throw new Error("Someone else just claimed that chore.");
      }
      tx.update(choreRef, {
        "claim.accountId": claimer.id,
        "claim.accountName": claimer.name,
        "claim.periodKey": currentPeriodKey(resetPeriodOf(snap.data())),
        "claim.claimedAt": serverTimestamp(),
        "claim.approved": false,
        "claim.approvedAt": null,
      });
    });
  } catch (err) {
    await openAlertModal(err.message || "Couldn't claim that chore.");
    return;
  }
  showToast(`Claimed by ${claimer.name}`);
}

async function unclaimChore(chore) {
  await updateDoc(doc(db, "chores", chore.id), { claim: null });
  showToast("Chore released");
}

// Used from the manage screen and from a finished one-time chore's "Remove".
async function deleteChore(chore) {
  const confirmed = await openConfirmModal({
    title: "Delete chore?",
    message: `Remove “${chore.name}” from the chore list? Money already paid out stays put.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  const ok = await requirePin(`delete “${chore.name}”`);
  if (!ok) return;
  await deleteDoc(doc(db, "chores", chore.id));
  showToast("Chore deleted");
}

// Checking off a claimed chore is what actually moves money, so it takes the
// same PIN as "Add money". Balance, transaction, and chore all update together.
async function approveChore(chore) {
  const claim = activeClaim(chore);
  if (!claim) return;

  const ok = await requirePin(`check off “${chore.name}”`);
  if (!ok) return;

  try {
    await runTransaction(db, async (tx) => {
      const choreRef = doc(db, "chores", chore.id);
      const accountRef = doc(db, "accounts", claim.accountId);
      const choreSnap = await tx.get(choreRef);
      const accountSnap = await tx.get(accountRef);

      if (!choreSnap.exists()) throw new Error("This chore was deleted.");
      const current = activeClaim({ id: chore.id, ...choreSnap.data() });
      if (!current) throw new Error("That claim is no longer active.");
      if (current.approved) throw new Error("That chore was already checked off.");
      if (!accountSnap.exists()) throw new Error("That account no longer exists.");

      const amountCents = choreSnap.data().amountCents;
      tx.update(accountRef, { balanceCents: increment(amountCents) });
      tx.set(doc(collection(db, "accounts", current.accountId, "transactions")), {
        amountCents,
        note: `Chore: ${choreSnap.data().name}`,
        createdAt: serverTimestamp(),
      });
      tx.update(choreRef, { "claim.approved": true, "claim.approvedAt": serverTimestamp() });
    });
  } catch (err) {
    await openAlertModal(err.message || "Couldn't check off that chore.");
    return;
  }
  showToast(`${formatUSD(chore.amountCents)} added to ${claim.accountName}`);
}

// "They did it yesterday and nobody checked it off." A claim only ever covers
// the period it was made in, so once a chore resets there's nothing left to
// check off -- this pays the chore out against the finished period it was
// actually done in, and records that period on the chore so it can't be paid
// twice. Like checking off, it moves money, so it takes the PIN.
async function openPastCreditModal(chores, { accountId = null, accountName = null } = {}) {
  if (!chores.length) return;

  let accounts = accountId ? [{ id: accountId, name: accountName }] : [];
  if (!accountId) {
    const snap = await getDocs(collection(db, "accounts"));
    snap.forEach((docSnap) => accounts.push({ id: docSnap.id, name: docSnap.data().name }));
    if (!accounts.length) {
      await openAlertModal("Create an account first, then past chores can be credited.");
      return;
    }
  }

  const overlay = buildModal(`
    <h2>Credit a past chore</h2>
    <p class="hint">For a chore that got done but never checked off before it reset.</p>
    <label for="past-chore">Chore</label>
    <select id="past-chore">
      ${chores
        .map(
          (chore) =>
            `<option value="${escapeHtml(chore.id)}">${escapeHtml(chore.name)} — ${formatUSD(chore.amountCents)}</option>`
        )
        .join("")}
    </select>
    <label for="past-when">When was it done?</label>
    <select id="past-when"></select>
    ${
      accountId
        ? ""
        : `<label for="past-who">Who did it?</label>
           <select id="past-who">
             ${accounts
               .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`)
               .join("")}
           </select>`
    }
    <div class="modal-actions">
      <button class="secondary" id="past-cancel">Cancel</button>
      <button id="past-submit">Give credit</button>
    </div>
  `);

  const choreSelect = overlay.querySelector("#past-chore");
  const whenSelect = overlay.querySelector("#past-when");
  const whoSelect = overlay.querySelector("#past-who");
  const submitButton = overlay.querySelector("#past-submit");
  let periods = [];

  // The "when" choices depend on how the selected chore resets, so they're
  // rebuilt whenever it changes. Periods somebody was already paid for stay
  // visible (they explain themselves) but can't be picked again.
  const fillWhenOptions = () => {
    const chore = chores.find((c) => c.id === choreSelect.value);
    periods = pastPeriods(resetPeriodOf(chore));
    whenSelect.innerHTML = periods
      .map((period) => {
        const paidName = paidNameFor(chore, period.key);
        const label = paidName ? `${period.label} — already paid to ${paidName}` : period.label;
        return `<option value="${period.key}"${paidName ? " disabled" : ""}>${escapeHtml(label)}</option>`;
      })
      .join("");
    const firstOpen = periods.find((period) => !paidNameFor(chore, period.key));
    if (firstOpen) whenSelect.value = firstOpen.key;
    submitButton.disabled = !firstOpen;
  };

  choreSelect.addEventListener("change", fillWhenOptions);
  fillWhenOptions();

  overlay.querySelector("#past-cancel").addEventListener("click", () => overlay.remove());
  submitButton.addEventListener("click", () => {
    const chore = chores.find((c) => c.id === choreSelect.value);
    const period = periods.find((p) => p.key === whenSelect.value);
    const account = accounts.find((a) => a.id === (accountId || whoSelect.value));
    if (!chore || !period || !account) return;
    overlay.remove();
    creditPastChore(chore, period, account);
  });
}

async function creditPastChore(chore, period, account) {
  const ok = await requirePin(`credit “${chore.name}” to ${account.name}`);
  if (!ok) return;

  let amountCents = chore.amountCents;
  try {
    await runTransaction(db, async (tx) => {
      const choreRef = doc(db, "chores", chore.id);
      const accountRef = doc(db, "accounts", account.id);
      const choreSnap = await tx.get(choreRef);
      const accountSnap = await tx.get(accountRef);

      if (!choreSnap.exists()) throw new Error("This chore was deleted.");
      if (!accountSnap.exists()) throw new Error("That account no longer exists.");
      const data = { id: chore.id, ...choreSnap.data() };
      const paidName = paidNameFor(data, period.key);
      if (paidName) throw new Error(`${paidName} was already paid for that one.`);

      amountCents = data.amountCents;
      tx.update(accountRef, { balanceCents: increment(amountCents) });
      tx.set(doc(collection(db, "accounts", account.id, "transactions")), {
        amountCents,
        note: `Chore: ${data.name} (${period.note})`,
        createdAt: serverTimestamp(),
      });
      tx.update(choreRef, {
        pastCredits: withPastCredit(data, period.key, account),
      });
    });
  } catch (err) {
    await openAlertModal(err.message || "Couldn't credit that chore.");
    return;
  }
  showToast(`${formatUSD(amountCents)} added to ${account.name}`);
}

// Past credits are a map on the chore itself, keyed by period, which is what
// keeps a period from being paid twice. The whole map is rewritten rather than
// patched because the keys contain characters Firestore field paths reserve.
// Periods older than the picker's own window can never be chosen again, so they
// get dropped on the way through and the map stays small.
function withPastCredit(chore, periodKey, account, now = new Date()) {
  const stillOffered = new Set(pastPeriods(resetPeriodOf(chore), now).map((period) => period.key));
  const credits = {};
  for (const [key, credit] of Object.entries(chore.pastCredits || {})) {
    if (stillOffered.has(key)) credits[key] = credit;
  }
  credits[periodKey] = {
    accountId: account.id,
    accountName: account.name,
    creditedAt: serverTimestamp(),
  };
  return credits;
}

function openAccountPickerModal(chore) {
  return new Promise((resolve) => {
    getDocs(collection(db, "accounts")).then(async (snap) => {
      const accounts = [];
      snap.forEach((docSnap) => accounts.push({ id: docSnap.id, name: docSnap.data().name }));
      if (!accounts.length) {
        await openAlertModal("Create an account first, then chores can be claimed.");
        resolve(null);
        return;
      }

      const overlay = buildModal(
        `
          <h2>Who's claiming this?</h2>
          <p class="hint">${escapeHtml(chore.name)} — ${formatUSD(chore.amountCents)}</p>
          <div class="picker-list">
            ${accounts
              .map(
                (a) =>
                  `<button class="secondary picker-option" data-id="${escapeHtml(a.id)}">${escapeHtml(a.name)}</button>`
              )
              .join("")}
          </div>
          <div class="modal-actions">
            <button class="secondary" id="picker-cancel">Cancel</button>
          </div>
        `,
        { onDismiss: () => resolve(null) }
      );

      overlay.querySelectorAll(".picker-option").forEach((button) => {
        button.addEventListener("click", () => {
          overlay.remove();
          resolve(accounts.find((a) => a.id === button.dataset.id));
        });
      });
      overlay.querySelector("#picker-cancel").addEventListener("click", () => {
        overlay.remove();
        resolve(null);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Manage chores view: add and remove the chores that show up on the dashboard
// ---------------------------------------------------------------------------

function renderManageChoresView() {
  $app.innerHTML = `
    <a class="back-link" href="./">&larr; All accounts</a>
    <h1><span class="emoji">🧹</span>Chores</h1>
    <div class="card">
      <form id="new-chore-form" class="new-account-form">
        <input id="chore-name" type="text" placeholder="Chore (e.g. Take out the trash)" required autofocus />
        <input id="chore-amount" type="number" step="0.01" min="0" inputmode="decimal" placeholder="Worth (e.g. 1.50)" required />
        <select id="chore-period">
          <option value="daily">Resets daily</option>
          <option value="weekly">Resets weekly (Sunday)</option>
          <option value="monthly">Resets monthly (the 1st)</option>
          <option value="once">One-time (never resets)</option>
        </select>
        <button type="submit">Add chore</button>
      </form>
      <p class="hint">Once a chore is claimed it's off the list until it resets. A parent
      checks it off with the PIN to move the money into that account. A one-time chore
      never resets — once it's checked off it's finished, and you can remove it.</p>
    </div>
    <div class="section-title">All chores</div>
    <div class="chore-list" id="manage-chore-list"><p class="loading">Loading…</p></div>
  `;

  document.getElementById("new-chore-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("chore-name").value.trim();
    const amountCents = dollarsToCents(document.getElementById("chore-amount").value);
    const resetPeriod = document.getElementById("chore-period").value;
    if (!name) return;
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      await openAlertModal("Please enter an amount greater than $0.");
      return;
    }

    const ok = await requirePin("add a chore");
    if (!ok) return;

    await addDoc(collection(db, "chores"), {
      name,
      amountCents,
      resetPeriod,
      claim: null,
      createdAt: serverTimestamp(),
    });
    e.target.reset();
    document.getElementById("chore-name").focus();
    showToast("Chore added");
  });

  const listEl = document.getElementById("manage-chore-list");
  let chores = [];

  onSnapshot(
    query(collection(db, "chores"), orderBy("createdAt")),
    (snap) => {
      chores = [];
      snap.forEach((docSnap) => chores.push({ id: docSnap.id, ...docSnap.data() }));
      chores.sort(compareChores);
      if (!chores.length) {
        listEl.innerHTML = `<p class="empty">No chores yet.</p>`;
        return;
      }
      listEl.innerHTML = chores
        .map((chore) => {
          const claim = activeClaim(chore);
          const label = `<span class="chore-period">${RESET_PERIODS[resetPeriodOf(chore)].label}</span>`;
          const status = !claim
            ? label
            : `${label} · ${claim.approved ? "done by" : "claimed by"} ${escapeHtml(claim.accountName)}`;
          return `
            <div ${choreRowAttrs(chore)}>
              <span class="chore-info">
                <span class="chore-name">${escapeHtml(chore.name)}</span>
                <span class="chore-meta">${status}</span>
              </span>
              <span class="chore-amount">${formatUSD(chore.amountCents)}</span>
              <span class="chore-actions">
                <button class="ghost" data-act="delete">Delete</button>
              </span>
            </div>
          `;
        })
        .join("");
    },
    (err) => {
      listEl.innerHTML = choreLoadErrorHtml(err);
    }
  );

  listEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-act='delete']");
    if (!button) return;
    const chore = chores.find((c) => c.id === button.closest(".chore-row").dataset.id);
    if (chore) deleteChore(chore);
  });
}

// ---------------------------------------------------------------------------
// QR code modal (used for the site's own home-screen QR code)
// ---------------------------------------------------------------------------

function openQrModal(url, title) {
  const hasCanvasQr = !!window.QRCode;
  // If the QR-generating script never loaded (e.g. blocked by network/device
  // filtering), fall back to a plain <img> from a public QR-image API. Images
  // are sometimes allowed through filters that block third-party <script>
  // domains. If that fails too, its onerror handler below drops to text-only.
  const fallbackImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;

  const overlay = buildModal(`
    <div class="qr-wrap">
      <h2>${escapeHtml(title)}</h2>
      ${
        hasCanvasQr
          ? `<canvas id="qr-canvas"></canvas>`
          : `<img id="qr-fallback-img" width="240" height="240" alt="QR code" src="${fallbackImgUrl}" />
             <p class="hint" id="qr-fallback-hint" style="display:none">The QR code image couldn't load, but you can still copy or print the link below.</p>`
      }
      <div class="qr-link">${escapeHtml(url)}</div>
      <div class="qr-actions no-print">
        <button class="secondary small" id="copy-link-btn">Copy link</button>
        <button class="secondary small" id="print-btn">Print</button>
        ${hasCanvasQr ? `<button class="secondary small" id="download-btn">Download PNG</button>` : ""}
      </div>
    </div>
    <div class="modal-actions no-print">
      <button id="modal-close">Close</button>
    </div>
  `);

  let canvas = null;
  let fallbackImgSrc = null;
  if (hasCanvasQr) {
    canvas = overlay.querySelector("#qr-canvas");
    window.QRCode.toCanvas(canvas, url, { width: 240, margin: 2 }, (err) => {
      if (err) console.error(err);
    });
    overlay.querySelector("#download-btn").addEventListener("click", () => {
      const link = document.createElement("a");
      link.download = "family-bank-qr-code.png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  } else {
    fallbackImgSrc = fallbackImgUrl;
    const fallbackImgEl = overlay.querySelector("#qr-fallback-img");
    fallbackImgEl.addEventListener("error", () => {
      fallbackImgEl.style.display = "none";
      overlay.querySelector("#qr-fallback-hint").style.display = "block";
      fallbackImgSrc = null;
    });
  }

  overlay.querySelector("#copy-link-btn").addEventListener("click", async () => {
    await copyToClipboard(url);
    showToast("Link copied");
  });
  overlay.querySelector("#print-btn").addEventListener("click", () => {
    openPrintableWindow(title, url, canvas, fallbackImgSrc);
  });
  overlay.querySelector("#modal-close").addEventListener("click", () => overlay.remove());
}

// Prints from a dedicated, minimal page in a new tab rather than the app itself.
// This is far more reliable across browsers than calling window.print() on the
// live app page, and still works even when the QR image itself failed to load.
function openPrintableWindow(title, url, canvas, fallbackImgSrc) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    // Pop-up blocked -- fall back to printing the current page (styled by the
    // @media print rules in style.css to show just this modal's contents).
    window.print();
    return;
  }

  const imgSrc = canvas ? canvas.toDataURL("image/png") : fallbackImgSrc;
  const imgTag = imgSrc ? `<img src="${imgSrc}" alt="QR code" />` : "";
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 48px 24px; }
          h1 { font-size: 1.3rem; margin-bottom: 24px; }
          img { width: 280px; height: 280px; }
          p { word-break: break-all; color: #555; margin-top: 20px; font-size: 0.95rem; }
          .note { color: #888; font-size: 0.8rem; margin-top: 32px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        ${imgTag}
        <p>${escapeHtml(url)}</p>
        <p class="note">If a print dialog didn't open automatically, use your browser's Print option.</p>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    try {
      printWindow.print();
    } catch {
      // Ignore -- the note above tells the user how to print manually.
    }
  }, 250);
}
