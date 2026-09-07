let products = [];
let cart = JSON.parse(localStorage.getItem("vibrantBarclaysCart") || "[]");

const $ = (id) => document.getElementById(id);
const money = (n) => `S$${Number(n).toLocaleString("en-SG", {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;

document.addEventListener("DOMContentLoaded", async () => {
  bindUI();
  renderCart();
  await loadPortfolio();
});

function bindUI() {
  $("searchInput").addEventListener("input", renderProducts);
  $("regionFilter").addEventListener("change", renderProducts);
  $("typeFilter").addEventListener("change", renderProducts);
  $("grapeFilter").addEventListener("change", renderProducts);

  $("openCart").onclick = openCart;
  $("closeCart").onclick = closeCart;
  $("closeCartBackdrop").onclick = closeCart;
  $("continueShopping").onclick = closeCart;
  $("checkoutButton").onclick = openCheckout;

  $("closeCheckout").onclick = closeCheckout;
  $("closeCheckoutBackdrop").onclick = closeCheckout;
  $("orderForm").addEventListener("submit", submitOrder);
  $("finishOrder").onclick = () => {
    closeCheckout();
    closeCart();
  };
}

async function loadPortfolio() {
  try {
    // Load the portfolio through the Apps Script JSONP bridge.
    // This avoids browser CORS restrictions between two different GitHub Pages sites.
    if (!CONFIG.APPS_SCRIPT_URL) {
      throw new Error("Google Apps Script URL is not configured.");
    }

    const html = await loadPortfolioViaJsonp(CONFIG.APPS_SCRIPT_URL);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    products = parsePortfolio(doc);

    if (!products.length) {
      throw new Error("No products were found in the portfolio page.");
    }

    populateFilters(products);
    $("loading").classList.add("hidden");
    renderProducts();
  } catch (error) {
    console.error(error);
    $("loading").classList.add("hidden");
    $("error").classList.remove("hidden");
    $("errorMessage").textContent =
      "The portfolio could not be loaded. Please refresh the page or contact Vibrant Wines.";
  }
}

function loadPortfolioViaJsonp(endpoint) {
  return new Promise((resolve, reject) => {
    const callbackName = "vibrantPortfolio_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Portfolio request timed out."));
    }, 20000);

    window[callbackName] = (html) => {
      clearTimeout(timeout);
      cleanup();
      resolve(html);
    };

    script.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new Error("Portfolio bridge request failed."));
    };

    function cleanup() {
      delete window[callbackName];
      script.remove();
    }

    script.src = endpoint + (endpoint.includes("?") ? "&" : "?") +
      "callback=" + encodeURIComponent(callbackName);
    document.head.appendChild(script);
  });
}

/*
  The current Vibrant price list is a static HTML/Markdown-style portfolio.
  This parser intentionally reads the visible portfolio tables instead of
  duplicating the whole wine catalogue into this project.

  This means:
  - change the price in Pricelist-Vibrant → Barclays portal updates
  - add/remove a wine there → Barclays portal updates
  - no need to edit this code for ordinary price-list maintenance
*/
function parsePortfolio(doc) {
  const result = [];
  const tables = [...doc.querySelectorAll("table")];

  tables.forEach((table, tableIndex) => {
    const producer = findPreviousHeading(table, "h1");
    const region = findPreviousRegion(table);
    if (!producer) return;

    const rows = [...table.querySelectorAll("tbody tr, tr")];

    rows.forEach((row, rowIndex) => {
      const cells = [...row.querySelectorAll("td, th")].map(c => c.textContent.trim());
      if (cells.length < 3) return;
      if (/^cuvée$/i.test(cells[0])) return;

      const rawName = cells[0];
      const note = cells[1] || "";
      const priceRaw = cells[cells.length - 1].replace(/\s+/g, " ").trim();

      if (!rawName || !priceRaw) return;
      if (/sold out/i.test(priceRaw)) return;

      const price = parseFloat(priceRaw.replace(/[^0-9.]/g, ""));
      if (!Number.isFinite(price)) return;

      // The source format commonly has the grape/style appended to the wine name.
      const parsed = splitWineMeta(rawName);

      const key = rawName;
      const finalPrice =
        Object.prototype.hasOwnProperty.call(CONFIG.PRICE_OVERRIDES, key)
          ? CONFIG.PRICE_OVERRIDES[key]
          : price;

      result.push({
        id: slugify(`${producer}-${rawName}-${tableIndex}-${rowIndex}`),
        producer,
        region,
        name: parsed.name,
        vintage: parsed.vintage,
        type: parsed.type,
        grape: parsed.grape,
        note,
        price: Number(finalPrice),
        sourceName: rawName
      });
    });
  });

  // Deduplicate
  const seen = new Set();
  return result.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function findPreviousHeading(element, selector) {
  let node = element.previousElementSibling;
  while (node) {
    if (node.matches(selector)) return node.textContent.trim();
    node = node.previousElementSibling;
  }

  // Tables may sit inside section containers.
  const parent = element.closest("section, article, div");
  if (parent) {
    const heading = parent.querySelector(selector);
    if (heading) return heading.textContent.trim();
  }
  return "";
}

function findPreviousRegion(element) {
  let node = element.previousElementSibling;
  while (node) {
    if (node.matches("h2, h3, h4")) {
      const text = node.textContent.trim();
      if (text && !/^why vibrant$/i.test(text) && !/^cuvée$/i.test(text)) return text;
    }
    node = node.previousElementSibling;
  }
  return "Vibrant Wines";
}

function splitWineMeta(raw) {
  let text = raw.replace(/\s+/g, " ").trim();

  const types = ["White", "Red", "Sparkling", "Rosé", "Rose"];
  let type = "";
  for (const t of types) {
    if (new RegExp(`\\b${t}\\b`, "i").test(text)) {
      type = t === "Rose" ? "Rosé" : t;
      text = text.replace(new RegExp(`\\b${t}\\b`, "i"), " ");
      break;
    }
  }

  // Extract a 4-digit vintage.
  const vintageMatch = text.match(/\b(19|20)\d{2}\b/);
  const vintage = vintageMatch ? vintageMatch[0] : "";
  if (vintageMatch) text = text.replace(vintageMatch[0], " ");

  // Common grape varieties. We intentionally keep this conservative.
  const grapes = [
    "Pinot Noir", "Pinot Meunier", "Chardonnay", "Aligoté", "Sauvignon Blanc",
    "Sauvignon", "Riesling", "Silvaner", "Pinot Blanc", "Pinot Gris",
    "Grenache", "Syrah", "Mourvèdre", "Mourvedre", "Cinsault", "Carignan",
    "Sangiovese", "Sémillon", "Semillon", "Cabernet Sauvignon", "Merlot",
    "Cabernet Franc", "Petit Verdot", "Gamay"
  ];
  let grape = "";
  for (const g of grapes) {
    const re = new RegExp(`\\b${escapeRegex(g)}\\b`, "i");
    if (re.test(text)) {
      grape = g;
      text = text.replace(re, " ");
      break;
    }
  }

  // Remove some parenthetical grape descriptors left by the source.
  text = text.replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim();

  return { name: text, vintage, type, grape };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function slugify(s) {
  return s.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function populateFilters(items) {
  const regions = [...new Set(items.map(x => x.region).filter(Boolean))].sort();
  const grapes = [...new Set(items.map(x => x.grape).filter(Boolean))].sort();

  $("regionFilter").innerHTML = `<option value="">All regions</option>` +
    regions.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");

  $("grapeFilter").innerHTML = `<option value="">All grapes</option>` +
    grapes.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
}

function renderProducts() {
  const search = $("searchInput").value.trim().toLowerCase();
  const region = $("regionFilter").value;
  const type = $("typeFilter").value;
  const grape = $("grapeFilter").value;

  const filtered = products.filter(p => {
    const haystack = [p.producer, p.name, p.vintage, p.grape, p.region, p.note].join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (!region || p.region === region) &&
      (!type || p.type === type) &&
      (!grape || p.grape === grape);
  });

  $("resultCount").textContent = `${filtered.length} wine${filtered.length === 1 ? "" : "s"}`;

  $("productGrid").innerHTML = filtered.map(productCard).join("");

  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.onclick = () => addToCart(btn.dataset.add);
  });
}

function productCard(p) {
  const inCart = cart.find(i => i.id === p.id);
  const qty = inCart ? inCart.qty : 0;

  return `
    <article class="product-card">
      <div class="product-meta">
        <span>${escapeHtml(p.region || "Vibrant Wines")}</span>
        <span>${escapeHtml(p.type || "")}</span>
      </div>
      <div class="producer">${escapeHtml(p.producer)}</div>
      <h3>${escapeHtml(p.name)}</h3>
      <div class="subline">${escapeHtml([p.vintage, p.grape].filter(Boolean).join(" · "))}</div>
      <p class="note">${escapeHtml(p.note)}</p>
      <div class="product-bottom">
        <div class="price">${money(p.price)}</div>
        ${qty
          ? `<div class="qty-control">
               <button type="button" data-add="${escapeHtml(p.id)}" onclick="changeQty('${escapeJs(p.id)}', -1)">−</button>
               <span>${qty}</span>
               <button type="button" data-add="${escapeHtml(p.id)}" onclick="changeQty('${escapeJs(p.id)}', 1)">+</button>
             </div>`
          : `<button class="add-button" type="button" data-add="${escapeHtml(p.id)}">Add to cart</button>`
        }
      </div>
    </article>`;
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const item = cart.find(i => i.id === id);
  if (item) item.qty += 1;
  else cart.push({ id, qty: 1 });
  saveCart();
  renderProducts();
  renderCart();
}

function changeQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  saveCart();
  renderProducts();
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  saveCart();
  renderProducts();
  renderCart();
}

function saveCart() {
  localStorage.setItem("vibrantBarclaysCart", JSON.stringify(cart));
}

function getCartDetailed() {
  return cart.map(i => {
    const p = products.find(x => x.id === i.id);
    return p ? {...p, qty: i.qty, lineTotal: p.price * i.qty} : null;
  }).filter(Boolean);
}

function cartTotal() {
  return getCartDetailed().reduce((sum, x) => sum + x.lineTotal, 0);
}

function renderCart() {
  const detailed = getCartDetailed();
  const totalQty = detailed.reduce((sum, x) => sum + x.qty, 0);

  $("cartCount").textContent = totalQty;
  $("cartItems").innerHTML = detailed.map(x => `
    <div class="cart-line">
      <div class="cart-line-top">
        <div>
          <h4>${escapeHtml(x.name)}</h4>
          <small>${escapeHtml(x.producer)} · ${escapeHtml(x.vintage || "")}</small>
        </div>
        <strong>${money(x.lineTotal)}</strong>
      </div>
      <div class="cart-line-actions">
        <div class="qty-control">
          <button type="button" onclick="changeQty('${escapeJs(x.id)}', -1)">−</button>
          <span>${x.qty}</span>
          <button type="button" onclick="changeQty('${escapeJs(x.id)}', 1)">+</button>
        </div>
        <button class="remove" type="button" onclick="removeFromCart('${escapeJs(x.id)}')">Remove</button>
      </div>
    </div>
  `).join("");

  const empty = detailed.length === 0;
  $("cartEmpty").classList.toggle("hidden", !empty);
  $("cartSummary").classList.toggle("hidden", empty);
  $("cartTotal").textContent = money(cartTotal());
}

function openCart() {
  $("cartDrawer").classList.add("open");
  $("cartDrawer").setAttribute("aria-hidden", "false");
}

function closeCart() {
  $("cartDrawer").classList.remove("open");
  $("cartDrawer").setAttribute("aria-hidden", "true");
}

function openCheckout() {
  if (!getCartDetailed().length) return;
  renderCheckoutOrder();
  $("checkoutModal").classList.remove("hidden");
  $("checkoutModal").setAttribute("aria-hidden", "false");
}

function closeCheckout() {
  $("checkoutModal").classList.add("hidden");
  $("checkoutModal").setAttribute("aria-hidden", "true");
}

function renderCheckoutOrder() {
  const items = getCartDetailed();
  $("checkoutOrder").innerHTML =
    items.map(x => `<div class="checkout-line"><span>${escapeHtml(x.name)} × ${x.qty}</span><strong>${money(x.lineTotal)}</strong></div>`).join("") +
    `<div class="checkout-line checkout-total"><span>Total</span><strong>${money(cartTotal())}</strong></div>`;
}

async function submitOrder(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const data = new FormData(form);
  const required = ["name", "email", "phone", "address"];
  for (const key of required) {
    if (!String(data.get(key) || "").trim()) {
      showSubmitError("Please complete all required fields.");
      return;
    }
  }
  if (!data.get("confirm")) {
    showSubmitError("Please confirm that your information is correct.");
    return;
  }

  const items = getCartDetailed();
  if (!items.length) {
    showSubmitError("Your cart is empty.");
    return;
  }

  const orderId = "BW-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);

  const payload = {
    orderId,
    client: CONFIG.clientName,
    orderEmail: CONFIG.orderEmail,
    submittedAt: new Date().toISOString(),
    customer: {
      name: String(data.get("name")).trim(),
      email: String(data.get("email")).trim(),
      phone: String(data.get("phone")).trim(),
      address: String(data.get("address")).trim(),
      remarks: String(data.get("remarks") || "").trim()
    },
    items: items.map(x => ({
      productId: x.id,
      producer: x.producer,
      wine: x.name,
      vintage: x.vintage,
      grape: x.grape,
      qty: x.qty,
      unitPrice: x.price,
      lineTotal: x.lineTotal
    })),
    total: cartTotal(),
    currency: CONFIG.currency
  };

  const button = $("submitOrder");
  button.disabled = true;
  button.textContent = "Sending…";
  hideSubmitError();

  try {
    if (!CONFIG.APPS_SCRIPT_URL) {
      throw new Error("The Google Apps Script URL has not been configured yet.");
    }

    // Google Apps Script does not expose CORS response headers for a normal cross-origin
    // fetch. Submit through a hidden HTML form/iframe instead. This is a normal browser
    // form POST, so the order reaches Apps Script without a CORS preflight.
    await submitViaHiddenForm(CONFIG.APPS_SCRIPT_URL, payload);

    $("successOrderId").textContent = orderId;
    $("orderForm").classList.add("hidden");
    $("checkoutOrder").classList.add("hidden");
    $("successState").classList.remove("hidden");

    cart = [];
    saveCart();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error(error);
    showSubmitError(
      "We could not submit the order automatically. Please try again. If the problem continues, contact info@vibrantwines.com."
    );
  } finally {
    button.disabled = false;
    button.textContent = "Submit order";
  }
}

function submitViaHiddenForm(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const frameName = "vibrantOrderFrame_" + Date.now();
    const iframe = document.createElement("iframe");
    iframe.name = frameName;
    iframe.style.display = "none";
    document.body.appendChild(iframe);

    const form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint;
    form.target = frameName;
    form.style.display = "none";

    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "payload";
    input.value = JSON.stringify(payload);
    form.appendChild(input);
    document.body.appendChild(form);

    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      form.remove();
      iframe.remove();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("The order submission did not complete."));
    };

    // The iframe load fires after Apps Script has received/returned the request.
    iframe.addEventListener("load", () => {
      if (document.body.contains(form)) {
        // Ignore the initial about:blank load.
        return;
      }
      finish();
    });

    // If the browser suppresses the iframe load event, give Apps Script enough time
    // to write the order and send the email, then complete the customer flow.
    const timer = setTimeout(finish, 5000);

    form.submit();
  });
}

function showSubmitError(message) {
  $("submitError").textContent = message;
  $("submitError").classList.remove("hidden");
}
function hideSubmitError() {
  $("submitError").classList.add("hidden");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}
function escapeJs(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
