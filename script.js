let balance = Number(
  localStorage.getItem("robocoins_balance") || 11
);

let pendingPurchase = 0;

let transactions = JSON.parse(
  localStorage.getItem("robocoins_transactions") || "[]"
);

const navBalance = document.getElementById("navBalance");
const mainBalance = document.getElementById("mainBalance");

function updateBalance() {

  navBalance.textContent =
    balance.toLocaleString();

  mainBalance.textContent =
    balance.toLocaleString();

  localStorage.setItem(
    "robocoins_balance",
    balance
  );
}


/* MOBILE MENU */

function toggleMenu() {

  const menu =
    document.getElementById("mobileMenu");

  if (menu.style.display === "block") {
    menu.style.display = "none";
  } else {
    menu.style.display = "block";
  }
}


/* SEND SCROLL */

function scrollToSend() {

  document
    .getElementById("send")
    .scrollIntoView({
      behavior: "smooth"
    });
}


/* PURCHASE */

function openPurchase(amount, price) {

  pendingPurchase = amount;

  document.getElementById(
    "purchaseAmount"
  ).textContent =
    amount.toLocaleString();

  document.getElementById(
    "purchasePrice"
  ).textContent =
    price;

  document.getElementById(
    "purchaseModal"
  ).style.display = "flex";
}


function closePurchase() {

  document.getElementById(
    "purchaseModal"
  ).style.display = "none";

  pendingPurchase = 0;
}


function confirmPurchase() {

  if (!pendingPurchase) return;

  balance += pendingPurchase;

  addTransaction(
    "Demo purchase",
    "+" + pendingPurchase.toLocaleString()
  );

  updateBalance();

  closePurchase();

  showToast(
    "+" +
    pendingPurchase.toLocaleString() +
    " RoboCoins added"
  );
}


/* SEND */

function sendCoins() {

  const recipient =
    document
      .getElementById("recipient")
      .value
      .trim();

  const amount =
    Number(
      document
        .getElementById("sendAmount")
        .value
    );

  if (!recipient) {

    showToast(
      "Enter a demo username"
    );

    return;
  }

  if (!amount || amount <= 0) {

    showToast(
      "Enter a valid amount"
    );

    return;
  }

  if (amount > balance) {

    showToast(
      "Not enough RoboCoins"
    );

    return;
  }

  balance -= amount;

  addTransaction(
    "Sent to @" + recipient,
    "-" + amount.toLocaleString()
  );

  updateBalance();

  document.getElementById(
    "recipient"
  ).value = "";

  document.getElementById(
    "sendAmount"
  ).value = "";

  showToast(
    "Sent " +
    amount.toLocaleString() +
    " RoboCoins to @" +
    recipient
  );
}


/* TRANSACTIONS */

function addTransaction(title, amount) {

  transactions.unshift({

    title: title,

    amount: amount,

    time: new Date().toLocaleString()

  });

  transactions =
    transactions.slice(0, 10);

  localStorage.setItem(
    "robocoins_transactions",
    JSON.stringify(transactions)
  );

  renderTransactions();
}


function renderTransactions() {

  const container =
    document.getElementById(
      "transactionList"
    );

  if (!transactions.length) {

    container.innerHTML =
      '<div class="empty">No transactions yet</div>';

    return;
  }

  container.innerHTML =
    transactions
      .map(function (item) {

        return `
          <div class="transaction">

            <div>
              <div class="transaction-title">
                ${escapeHTML(item.title)}
              </div>

              <div class="transaction-time">
                ${escapeHTML(item.time)}
              </div>
            </div>

            <div class="transaction-amount">
              ${escapeHTML(item.amount)}
            </div>

          </div>
        `;

      })
      .join("");
}


/* RESET */

function resetWallet() {

  balance = 11;

  transactions = [];

  localStorage.removeItem(
    "robocoins_transactions"
  );

  updateBalance();

  renderTransactions();

  showToast(
    "Demo wallet reset"
  );
}


/* TOAST */

function showToast(message) {

  const toast =
    document.getElementById("toast");

  toast.textContent = message;

  toast.style.display = "block";

  clearTimeout(window.toastTimer);

  window.toastTimer =
    setTimeout(function () {

      toast.style.display = "none";

    }, 2500);
}


/* BASIC HTML ESCAPING */

function escapeHTML(value) {

  return String(value)

    .replaceAll("&", "&amp;")

    .replaceAll("<", "&lt;")

    .replaceAll(">", "&gt;")

    .replaceAll('"', "&quot;")

    .replaceAll("'", "&#039;");
}


/* CLOSE MODAL WHEN CLICKING OUTSIDE */

document
  .getElementById("purchaseModal")
  .addEventListener(
    "click",
    function(event) {

      if (
        event.target === this
      ) {

        closePurchase();

      }

    }
  );


/* INITIALIZE */

updateBalance();

renderTransactions();
