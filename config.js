/*
  VIBRANT WINES × BARCLAYS
  CONFIGURATION

  1. Paste your Google Apps Script Web App URL into APPS_SCRIPT_URL.
  2. If you later want Barclays-specific prices, add overrides to PRICE_OVERRIDES.
  3. Leave an override out to use the current price from the Vibrant price list.
*/

const CONFIG = {
  clientName: "Barclays",
  orderEmail: "info@vibrantwines.com",

  // Google Apps Script Web App URL.
  // Example: https://script.google.com/macros/s/XXXXXXXX/exec
  APPS_SCRIPT_URL: "",

  // Source portfolio. Because this portal lives under the same
  // vibrantwinessg.github.io domain, the browser can load the current
  // portfolio and use its latest prices.
  PORTFOLIO_URL: "https://vibrantwinessg.github.io/Pricelist-Vibrant/",

  currency: "SGD",

  // Optional future Barclays-specific price overrides.
  // Key = exact product name shown in the portfolio.
  // Example:
  // PRICE_OVERRIDES: {
  //   "Pommard “Les Bœufs” 2024": 139
  // }
  PRICE_OVERRIDES: {},

  // Set true to hide products marked "sold out" on the source portfolio.
  HIDE_SOLD_OUT: true
};
