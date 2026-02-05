/**
 * fxRates.js
 * ==========
 * Foreign exchange rate fetcher using frankfurter.app (ECB rates).
 *
 * Used to display GBP equivalents for non-GBP denominated stocks.
 * The frankfurter.app API is free, requires no API key, and provides
 * daily ECB reference rates.
 */

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest';

/**
 * Fetch current FX rates from GBP to target currencies.
 *
 * Returns an object like: { USD: 1.37, EUR: 1.19 }
 * where the values represent how many units of that currency
 * equal 1 GBP (i.e., GBP is the base currency).
 *
 * To convert e.g. USD to GBP: usdAmount / rates.USD
 *
 * @param {string[]} currencies - Array of currency codes, e.g. ['USD', 'EUR']
 * @returns {Promise<Object|null>} Rates object or null on failure
 */
async function fetchFxRates(currencies = ['USD', 'EUR']) {
  try {
    const targets = currencies.join(',');
    const url = `${FRANKFURTER_URL}?from=GBP&to=${targets}`;

    console.log(`[FX] Fetching rates from ${url}`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      console.warn(`[FX] API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log('[FX] Rates received:', data.rates);

    return data.rates || null;
  } catch (error) {
    console.warn('[FX] Failed to fetch rates:', error.message);
    return null;
  }
}

module.exports = { fetchFxRates };
