import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  increment,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $app = document.getElementById("app");

const params = new URLSearchParams(location.search);
const accountId = params.get("account");

if (isConfigMissing()) {
  renderConfigMissing();
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

function accountUrl(id) {
  const url = new URL(location.href);
  url.search = `?account=${id}`;
  return url.toString();
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
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
    const newPin = prompt(
      `No PIN is set up yet. Choose a PIN to protect edits like "${actionLabel}":`
    );
    if (!newPin) return false;
    const confirmPin = prompt("Enter the same PIN again to confirm:");
    if (newPin !== confirmPin) {
      alert("Those PINs didn't match. Please try again.");
      return false;
    }
    await setDoc(doc(db, "settings", "config"), { pin: newPin });
    return true;
  }

  const entered = prompt(`Enter PIN to ${actionLabel}:`);
  if (entered === null) return false;
  if (entered !== storedPin) {
    alert("Incorrect PIN.");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Admin view: list of all accounts
// ---------------------------------------------------------------------------

function renderAdminView() {
  $app.innerHTML = `
    <h1><span class="emoji">🏦</span>Family Bank</h1>
    <div id="account-list"></div>
    <div class="card">
      <div class="section-title" style="margin-top:0">New account</div>
      <form id="new-account-form" class="new-account-form">
        <input id="new-account-name" type="text" placeholder="Child's name" required />
        <input id="new-account-balance" type="number" step="0.01" min="0" placeholder="Starting balance (optional, e.g. 20.00)" />
        <button type="submit">Create account</button>
      </form>
    </div>
  `;

  const listEl = document.getElementById("account-list");
  onSnapshot(collection(db, "accounts"), (snap) => {
    if (snap.empty) {
      listEl.innerHTML = `<p class="empty">No accounts yet. Create one below to get started.</p>`;
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

  document.getElementById("new-account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("new-account-name").value.trim();
    if (!name) return;
    const balanceInput = document.getElementById("new-account-balance").value;
    const startingCents = balanceInput ? dollarsToCents(balanceInput) : 0;
    if (Number.isNaN(startingCents)) {
      alert("Please enter a valid starting balance.");
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

    e.target.reset();
    showToast(`Created account for ${name}`);
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
      <div class="action-row">
        <button class="secondary" id="qr-btn">Show QR code</button>
        <button class="ghost" id="delete-btn">Delete account</button>
      </div>
      <div class="section-title">Recent activity</div>
      <div class="tx-list" id="tx-list"><p class="loading">Loading…</p></div>
    `;

    document.getElementById("add-btn").addEventListener("click", () => openTxModal(id, 1));
    document.getElementById("subtract-btn").addEventListener("click", () => openTxModal(id, -1));
    document.getElementById("qr-btn").addEventListener("click", () => openQrModal(id, data.name));
    document.getElementById("delete-btn").addEventListener("click", () => deleteAccount(id, data.name));

    listenTransactions(id);
  }

  document.getElementById("hero-name").textContent = data.name;
  const amountEl = document.getElementById("hero-amount");
  amountEl.textContent = formatUSD(data.balanceCents);
  amountEl.className = `amount ${negative}`;
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
  if (!confirm(`Delete ${name}'s account? This cannot be undone.`)) return;
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
      alert("Please enter a valid amount greater than $0.");
      return;
    }
    const note = overlay.querySelector("#tx-note").value.trim();

    overlay.remove();
    const ok = await requirePin(isAdd ? "add money" : "subtract money");
    if (!ok) return;

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
// QR code modal
// ---------------------------------------------------------------------------

function openQrModal(accountId, name) {
  const url = accountUrl(accountId);
  const overlay = buildModal(`
    <h2>${escapeHtml(name)}'s QR code</h2>
    <div class="qr-wrap">
      <canvas id="qr-canvas"></canvas>
      <div class="qr-link">${escapeHtml(url)}</div>
      <button class="secondary small" id="copy-link-btn">Copy link</button>
    </div>
    <div class="modal-actions">
      <button id="modal-close">Close</button>
    </div>
  `);

  const canvas = overlay.querySelector("#qr-canvas");
  if (window.QRCode) {
    window.QRCode.toCanvas(canvas, url, { width: 220, margin: 1 }, (err) => {
      if (err) console.error(err);
    });
  }

  overlay.querySelector("#copy-link-btn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(url);
    showToast("Link copied");
  });
  overlay.querySelector("#modal-close").addEventListener("click", () => overlay.remove());
}

// ---------------------------------------------------------------------------
// Modal helper
// ---------------------------------------------------------------------------

function buildModal(innerHtml) {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="modal">${innerHtml}</div>`;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return overlay;
}
