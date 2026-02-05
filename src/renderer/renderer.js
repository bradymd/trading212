/**
 * renderer.js
 * ===========
 * UI Logic for Trading 212 Portfolio Viewer
 *
 * This script runs in the browser window (renderer process) and handles:
 * - Receiving data from the main process via IPC
 * - Rendering the positions table
 * - Sorting and filtering
 * - Displaying alerts
 * - Updating the UI
 *
 * COMMUNICATION:
 * - We communicate with the main process via `window.api` (exposed by preload.js)
 * - Main process sends us data updates
 * - We can request refreshes
 *
 * DATA FLOW:
 * 1. Main process fetches data from Trading 212 API
 * 2. Main process sends data via IPC: POSITIONS_UPDATE
 * 3. We receive it in onPositionsUpdate callback
 * 4. We render the data to the DOM
 */


// =============================================================================
// STATE
// =============================================================================
//
// Local state to track current data and UI settings

const state = {
  // Current positions data (array of position objects)
  positions: [],

  // Cash balance data
  cash: null,

  // Current alerts
  alerts: [],

  // Trend warnings
  downtrends: [],
  uptrends: [],

  // FX rates for GBP conversion (e.g., { USD: 1.37, EUR: 1.19 })
  fxRates: null,

  // Sorting preference
  sortBy: 'totalReturnPercent',
  sortDirection: 'asc', // 'asc' = losers first

  // Last update timestamp
  lastUpdate: null
};


// =============================================================================
// DOM ELEMENT REFERENCES
// =============================================================================
//
// Cache references to DOM elements we'll update frequently

const elements = {
  // Summary cards
  totalValue: document.getElementById('total-value'),
  cashAvailable: document.getElementById('cash-available'),
  totalInvested: document.getElementById('total-invested'),
  totalPnl: document.getElementById('total-pnl'),
  totalPnlPercent: document.getElementById('total-pnl-percent'),

  // Positions table
  positionsBody: document.getElementById('positions-body'),
  positionCount: document.getElementById('position-count'),
  sortSelect: document.getElementById('sort-select'),
  dailyChangeHeader: document.getElementById('daily-change-header'),

  // Alerts & Downtrends
  alertsContainer: document.getElementById('alerts-container'),
  alertCount: document.getElementById('alert-count'),
  alertsBtn: document.getElementById('alerts-btn'),
  alertsPanel: document.getElementById('alerts-panel'),
  downtrendsContainer: document.getElementById('downtrends-container'),
  downtrendsList: document.getElementById('downtrends-list'),
  downtrendsBtn: document.getElementById('downtrends-btn'),
  downtrendsPanel: document.getElementById('downtrends-panel'),
  downtrendCount: document.getElementById('downtrend-count'),
  uptrendsBtn: document.getElementById('uptrends-btn'),
  uptrendsPanel: document.getElementById('uptrends-panel'),
  uptrendsList: document.getElementById('uptrends-list'),
  uptrendCount: document.getElementById('uptrend-count'),

  // Header
  lastUpdate: document.getElementById('last-update'),
  refreshBtn: document.getElementById('refresh-btn'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),

  // Error handling
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-message'),
  errorDismiss: document.getElementById('error-dismiss')
};


// =============================================================================
// FORMATTING UTILITIES
// =============================================================================

/**
 * Check if a position is priced in pence (GBX) rather than pounds (GBP)
 *
 * UK stocks trade in GBX (pence), so prices need to be divided by 100.
 * ONLY use the instrument currency code - ticker patterns are unreliable
 * (e.g., "BNKEl" is a European ETF, not a UK stock, despite ending in 'l')
 *
 * @param {Object} position - Position object with instrumentCurrency
 * @returns {boolean} True if priced in pence
 */
function isPricedInPence(position) {
  // Only trust the instrument currency code
  return position?.instrumentCurrency === 'GBX';
}


/**
 * Convert price from pence to pounds if needed
 *
 * @param {number} price - The price value
 * @param {Object} position - Position object to check currency
 * @returns {number} Price in pounds (converted if in pence)
 */
function normalizePriceToGbp(price, position) {
  if (isPricedInPence(position)) {
    return price / 100; // Convert pence to pounds
  }
  return price;
}


/**
 * Get the display currency code for an instrument
 *
 * Maps instrument currencies to valid ISO 4217 codes for formatting.
 * GBX (pence) becomes GBP since prices are normalized to pounds before display.
 *
 * @param {string} instrumentCurrency - The instrument's currency code from the API
 * @returns {string} Valid currency code for display
 */
function getDisplayCurrency(instrumentCurrency) {
  if (!instrumentCurrency) return 'GBP';
  if (instrumentCurrency === 'GBX') return 'GBP';
  return instrumentCurrency;
}


/**
 * Format a number as currency (GBP)
 *
 * @param {number} value - The number to format
 * @param {string} currency - Currency code (default: GBP)
 * @returns {string} Formatted currency string
 */
function formatCurrency(value, currency = 'GBP') {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}


/**
 * Format a GBP equivalent for display in brackets
 *
 * For non-GBP instruments, returns HTML like "(£21.22)" on a new line.
 * For GBP/GBX instruments or if the value can't be calculated, returns ''.
 *
 * @param {number} gbpValue - The value already converted to GBP
 * @param {string} instrumentCurrency - The instrument's native currency
 * @returns {string} HTML string for the GBP equivalent, or ''
 */
function formatGbpEquivalent(gbpValue, instrumentCurrency) {
  if (!instrumentCurrency) return '';
  if (instrumentCurrency === 'GBP' || instrumentCurrency === 'GBX') return '';
  if (gbpValue === null || gbpValue === undefined || isNaN(gbpValue)) return '';

  return `<br><small class="gbp-equivalent">(${formatCurrency(gbpValue, 'GBP')})</small>`;
}


/**
 * Format a number as a percentage
 *
 * @param {number} value - The percentage value
 * @param {boolean} includeSign - Whether to include +/- sign
 * @returns {string} Formatted percentage string
 */
function formatPercent(value, includeSign = true) {
  if (value === null || value === undefined || isNaN(value)) {
    return '--';
  }

  const sign = includeSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}


/**
 * Format a timestamp as a readable time
 *
 * @param {string} isoString - ISO timestamp string
 * @returns {string} Formatted time (e.g., "14:32:05")
 */
function formatTime(isoString) {
  if (!isoString) return '--';

  const date = new Date(isoString);
  return date.toLocaleTimeString('en-GB');
}


/**
 * Get CSS class for gain/loss coloring
 *
 * @param {number} value - The value to check
 * @returns {string} CSS class name ('gain', 'loss', or 'neutral')
 */
function getChangeClass(value) {
  if (value > 0) return 'gain';
  if (value < 0) return 'loss';
  return 'neutral';
}


// =============================================================================
// SORTING
// =============================================================================

/**
 * Sort positions based on current sort settings
 *
 * @param {Array} positions - Array of positions to sort
 * @returns {Array} Sorted positions array
 */
function sortPositions(positions) {
  const sorted = [...positions]; // Don't mutate original

  sorted.sort((a, b) => {
    let aValue, bValue;

    // Get values to compare based on sort field
    switch (state.sortBy) {
      case 'dailyChangePercent':
        aValue = a.dailyChangePercent || 0;
        bValue = b.dailyChangePercent || 0;
        break;

      case 'totalReturnPercent':
        // Calculate total return % from purchase price
        aValue = a.averagePrice > 0
          ? ((normalizePriceToGbp(a.currentPrice, a) - normalizePriceToGbp(a.averagePrice, a)) / normalizePriceToGbp(a.averagePrice, a)) * 100
          : 0;
        bValue = b.averagePrice > 0
          ? ((normalizePriceToGbp(b.currentPrice, b) - normalizePriceToGbp(b.averagePrice, b)) / normalizePriceToGbp(b.averagePrice, b)) * 100
          : 0;
        break;

      case 'ppl':
        // P/L is already in account currency (GBP), no normalization needed
        aValue = a.ppl || 0;
        bValue = b.ppl || 0;
        break;

      case 'currentValue':
        // Normalize prices for UK stocks when sorting by value
        aValue = (a.quantity * normalizePriceToGbp(a.currentPrice, a)) || 0;
        bValue = (b.quantity * normalizePriceToGbp(b.currentPrice, b)) || 0;
        break;

      case 'shortTicker':
        aValue = a.shortTicker || '';
        bValue = b.shortTicker || '';
        // String comparison
        if (state.sortDirection === 'asc') {
          return aValue.localeCompare(bValue);
        } else {
          return bValue.localeCompare(aValue);
        }

      default:
        aValue = 0;
        bValue = 0;
    }

    // Numeric comparison
    if (state.sortDirection === 'asc') {
      return aValue - bValue;
    } else {
      return bValue - aValue;
    }
  });

  return sorted;
}


/**
 * Handle sort selection change
 */
function onSortChange(event) {
  const value = event.target.value;
  const [sortBy, sortDirection] = value.split('-');

  state.sortBy = sortBy;
  state.sortDirection = sortDirection;

  // Re-render with new sort
  renderPositions();
}


// =============================================================================
// RENDERING FUNCTIONS
// =============================================================================

/**
 * Render the account summary cards
 *
 * @param {Object} data - Data containing positions and cash info
 */
function renderSummary(data) {
  const { positions, cash } = data;

  // Use the values directly from the API's cash endpoint
  // The API already handles currency conversion and returns correct GBP totals
  // - cash.total = total portfolio value (positions + cash)
  // - cash.free = available cash
  // - cash.invested = amount invested in positions
  // - cash.ppl = total profit/loss on positions
  const totalValue = cash?.total || 0;
  const cashFree = cash?.free || 0;
  const totalInvested = cash?.invested || 0;
  const totalPnl = cash?.ppl || 0;

  // Calculate P/L percentage from the API values
  const pnlPercent = totalInvested > 0
    ? (totalPnl / totalInvested) * 100
    : 0;

  // Update DOM
  elements.totalValue.textContent = formatCurrency(totalValue);

  elements.cashAvailable.textContent = formatCurrency(cashFree);

  elements.totalInvested.textContent = formatCurrency(totalInvested);

  elements.totalPnl.textContent = formatCurrency(totalPnl);
  elements.totalPnl.className = `card-value ${getChangeClass(totalPnl)}`;

  elements.totalPnlPercent.textContent = formatPercent(pnlPercent);
  elements.totalPnlPercent.className = `card-subvalue ${getChangeClass(pnlPercent)}`;
}


/**
 * Render the positions table
 *
 * Creates table rows for each position, sorted according to current settings.
 */
function renderPositions() {
  const positions = sortPositions(state.positions);

  // Update position count badge
  elements.positionCount.textContent = positions.length;

  // Check if we have any yesterday data
  const hasYesterdayData = positions.some(pos => pos.hasYesterdayData);

  // Update daily change options styling and text
  const dailyChangeOptions = document.querySelectorAll('.daily-change-option');
  dailyChangeOptions.forEach(option => {
    if (!hasYesterdayData && positions.length > 0) {
      option.classList.add('unavailable');
      if (!option.textContent.includes('(no data yet)')) {
        option.textContent = option.textContent + ' (no data yet)';
      }
    } else {
      option.classList.remove('unavailable');
      option.textContent = option.textContent.replace(' (no data yet)', '');
    }
  });

  // Update header styling and tooltip (no banner, just subtle indicators)
  if (!hasYesterdayData && positions.length > 0) {
    elements.dailyChangeHeader.style.color = 'var(--color-warning)';
    elements.dailyChangeHeader.title = 'Daily change data will appear after 24 hours of tracking';
  } else {
    elements.dailyChangeHeader.style.color = '';
    elements.dailyChangeHeader.title = '';
  }

  // Build table HTML
  // (Using innerHTML for simplicity; for large lists, consider virtual scrolling)
  let html = '';

  if (positions.length === 0) {
    html = `
      <tr class="loading-row">
        <td colspan="8">No positions found. Check your API configuration.</td>
      </tr>
    `;
  } else {
    for (const pos of positions) {
      // Debug specific tickers
      if (pos.shortTicker === 'BNKEI' || pos.shortTicker === 'BNKEIl' || pos.shortTicker === 'VUKGl') {
        console.log(`[Renderer] ${pos.shortTicker}:`, {
          ticker: pos.ticker,
          instrumentCurrency: pos.instrumentCurrency,
          isPence: isPricedInPence(pos),
          averagePrice_raw: pos.averagePrice,
          currentPrice_raw: pos.currentPrice,
          quantity: pos.quantity,
          ppl_raw: pos.ppl
        });
      }

      // Normalize prices from pence to pounds for UK stocks
      const avgPrice = normalizePriceToGbp(pos.averagePrice, pos);
      const curPrice = normalizePriceToGbp(pos.currentPrice, pos);
      const currentValue = pos.quantity * curPrice;
      const displayCurrency = getDisplayCurrency(pos.instrumentCurrency);

      // P/L is already in account currency (GBP), don't normalize it
      // (API returns prices in pence for UK stocks, but P/L is always in GBP)
      const ppl = pos.ppl || 0;

      // Calculate GBP equivalents for non-GBP stocks
      let avgPriceGbpHtml = '';
      let curPriceGbpHtml = '';
      let currentValueGbpHtml = '';

      const currency = pos.instrumentCurrency;
      if (state.fxRates && currency && currency !== 'GBP' && currency !== 'GBX') {
        const fxRate = state.fxRates[currency];
        if (fxRate) {
          // Current price in GBP: price / fxRate (fxRate is GBP->currency)
          const curPriceGbp = curPrice / fxRate;
          curPriceGbpHtml = formatGbpEquivalent(curPriceGbp, currency);

          // Current value in GBP
          const currentValueGbp = pos.quantity * curPriceGbp;
          currentValueGbpHtml = formatGbpEquivalent(currentValueGbp, currency);

          // Avg price in GBP: derived from ppl (captures historical FX rate)
          // costBasisGBP = currentValueGBP - ppl (ppl includes FX effects)
          const costBasisGbp = currentValueGbp - ppl;
          const avgPriceGbp = pos.quantity > 0 ? costBasisGbp / pos.quantity : 0;
          avgPriceGbpHtml = formatGbpEquivalent(avgPriceGbp, currency);
        }
      }

      // Calculate total return % since purchase
      const totalReturnPercent = avgPrice > 0
        ? ((curPrice - avgPrice) / avgPrice) * 100
        : 0;
      const totalReturnClass = getChangeClass(totalReturnPercent);

      const dailyChangeClass = getChangeClass(pos.dailyChangePercent);
      const pplClass = getChangeClass(ppl);

      // Format daily change display
      let dailyChangeDisplay = '--';
      if (pos.hasYesterdayData) {
        // Daily change also needs normalization for UK stocks
        const normalizedDailyChange = normalizePriceToGbp(pos.dailyChange, pos);
        const changeAmount = normalizedDailyChange * pos.quantity;
        const arrow = normalizedDailyChange > 0 ? '▲' : normalizedDailyChange < 0 ? '▼' : '';

        // For non-GBP stocks, show total in GBP (portfolio impact); otherwise native currency
        let totalChangeCurrency = displayCurrency;
        let totalChangeAmount = changeAmount;
        const fxRate = state.fxRates && currency && currency !== 'GBP' && currency !== 'GBX'
          ? state.fxRates[currency]
          : null;
        if (fxRate) {
          totalChangeAmount = changeAmount / fxRate;
          totalChangeCurrency = 'GBP';
        }

        dailyChangeDisplay = `
          <span class="${dailyChangeClass}">${arrow} ${formatCurrency(Math.abs(normalizedDailyChange), displayCurrency)}</span>
          <br>
          <small class="${dailyChangeClass}">${formatCurrency(totalChangeAmount, totalChangeCurrency)} (${formatPercent(pos.dailyChangePercent)})</small>
        `;
      }

      // Display ticker and company name
      const tickerDisplay = pos.shortTicker || pos.ticker;
      const companyName = pos.companyName || '';
      const hoverTitle = companyName || pos.ticker;

      // Build ticker cell content
      let tickerCellContent = '<div class="ticker-display">' + tickerDisplay + '</div>';
      if (companyName) {
        tickerCellContent += '<div class="company-name">' + companyName + '</div>';
      }

      html += `
        <tr data-ticker="${pos.ticker}">
          <td class="ticker-cell" title="${hoverTitle}">${tickerCellContent}</td>
          <td>${pos.quantity.toFixed(4)}</td>
          <td class="number">${formatCurrency(avgPrice, displayCurrency)}${avgPriceGbpHtml}</td>
          <td class="number">${formatCurrency(curPrice, displayCurrency)}${curPriceGbpHtml}</td>
          <td class="number">${formatCurrency(currentValue, displayCurrency)}${currentValueGbpHtml}</td>
          <td class="number">
            <span class="${totalReturnClass}">${formatPercent(totalReturnPercent)}</span>
          </td>
          <td class="number">${dailyChangeDisplay}</td>
          <td class="number">
            <span class="${pplClass}">${formatCurrency(ppl)}</span>
          </td>
        </tr>
      `;
    }
  }

  elements.positionsBody.innerHTML = html;
}


/**
 * Render alerts section
 *
 * @param {Array} alerts - Array of alert objects
 */
function renderAlerts(alerts) {
  elements.alertCount.textContent = alerts.length;

  if (alerts.length === 0) {
    elements.alertsContainer.innerHTML = '<p class="no-alerts">No alerts triggered today.</p>';
    return;
  }

  // Build a lookup for company names from current positions
  const nameMap = new Map();
  for (const pos of state.positions) {
    nameMap.set(pos.ticker, pos.companyName || '');
  }

  let html = '';

  for (const alert of alerts) {
    const icon = alert.type === 'daily_loss' ? '📉' : '📈';
    const time = formatTime(alert.timestamp);
    const companyName = nameMap.get(alert.ticker) || '';
    const titleDisplay = companyName
      ? `${alert.shortTicker} <small class="company-name-inline">${companyName}</small>`
      : alert.shortTicker;

    html += `
      <div class="alert-item clickable" data-scroll-to="${alert.ticker}">
        <span class="alert-icon">${icon}</span>
        <div class="alert-content">
          <div class="alert-title ${alert.type === 'daily_loss' ? 'loss' : 'gain'}">
            ${titleDisplay}
          </div>
          <div class="alert-message">${alert.message}</div>
        </div>
        <span class="alert-time">${time}</span>
      </div>
    `;
  }

  elements.alertsContainer.innerHTML = html;

  // Add click handlers to scroll to the position row and close panel
  elements.alertsContainer.querySelectorAll('[data-scroll-to]').forEach(el => {
    el.addEventListener('click', () => {
      scrollToPosition(el.dataset.scrollTo);
      closeAllPanels();
    });
  });
}


/**
 * Render downtrend warnings
 *
 * @param {Array} downtrends - Array of downtrend objects
 */
function renderDowntrends(downtrends) {
  // Update the badge count
  const count = (downtrends && downtrends.length) || 0;
  elements.downtrendCount.textContent = count;

  if (!downtrends || downtrends.length === 0) {
    elements.downtrendsList.innerHTML = '<li class="no-alerts">No downtrends detected.</li>';
    return;
  }

  // Build lookups from current positions
  const posMap = new Map();
  for (const pos of state.positions) {
    posMap.set(pos.ticker, pos);
  }

  let html = '';

  for (const trend of downtrends) {
    const pos = posMap.get(trend.ticker);
    const currency = pos ? getDisplayCurrency(pos.instrumentCurrency) : 'GBP';
    const startPrice = pos ? normalizePriceToGbp(trend.startPrice, pos) : trend.startPrice;
    const endPrice = pos ? normalizePriceToGbp(trend.endPrice, pos) : trend.endPrice;
    const companyName = pos?.companyName || '';
    const nameDisplay = companyName ? ` <small class="company-name-inline">${companyName}</small>` : '';

    html += `
      <li class="clickable" data-scroll-to="${trend.ticker}">
        <strong class="loss">${trend.shortTicker}</strong>${nameDisplay}:
        Down ${Math.abs(trend.changePercent).toFixed(2)}% over ${trend.days} days
        (${formatCurrency(startPrice, currency)} → ${formatCurrency(endPrice, currency)})
      </li>
    `;
  }

  elements.downtrendsList.innerHTML = html;

  // Add click handlers to scroll to the position row and close panel
  elements.downtrendsList.querySelectorAll('[data-scroll-to]').forEach(el => {
    el.addEventListener('click', () => {
      scrollToPosition(el.dataset.scrollTo);
      closeAllPanels();
    });
  });
}


/**
 * Render uptrend warnings
 *
 * @param {Array} uptrends - Array of uptrend objects
 */
function renderUptrends(uptrends) {
  const count = (uptrends && uptrends.length) || 0;
  elements.uptrendCount.textContent = count;

  if (!uptrends || uptrends.length === 0) {
    elements.uptrendsList.innerHTML = '<li class="no-alerts">No uptrends detected.</li>';
    return;
  }

  // Build lookups from current positions
  const posMap = new Map();
  for (const pos of state.positions) {
    posMap.set(pos.ticker, pos);
  }

  let html = '';

  for (const trend of uptrends) {
    const pos = posMap.get(trend.ticker);
    const currency = pos ? getDisplayCurrency(pos.instrumentCurrency) : 'GBP';
    const startPrice = pos ? normalizePriceToGbp(trend.startPrice, pos) : trend.startPrice;
    const endPrice = pos ? normalizePriceToGbp(trend.endPrice, pos) : trend.endPrice;
    const companyName = pos?.companyName || '';
    const nameDisplay = companyName ? ` <small class="company-name-inline">${companyName}</small>` : '';

    html += `
      <li class="clickable" data-scroll-to="${trend.ticker}">
        <strong class="gain">${trend.shortTicker}</strong>${nameDisplay}:
        Up ${trend.changePercent.toFixed(2)}% over ${trend.days} days
        (${formatCurrency(startPrice, currency)} → ${formatCurrency(endPrice, currency)})
      </li>
    `;
  }

  elements.uptrendsList.innerHTML = html;

  // Add click handlers to scroll to the position row and close panel
  elements.uptrendsList.querySelectorAll('[data-scroll-to]').forEach(el => {
    el.addEventListener('click', () => {
      scrollToPosition(el.dataset.scrollTo);
      closeAllPanels();
    });
  });
}


/**
 * Close all popup panels and deactivate their toggle buttons
 */
function closeAllPanels() {
  elements.alertsPanel.classList.add('hidden');
  elements.downtrendsPanel.classList.add('hidden');
  elements.uptrendsPanel.classList.add('hidden');
  elements.alertsBtn.classList.remove('active');
  elements.downtrendsBtn.classList.remove('active');
  elements.uptrendsBtn.classList.remove('active');
}


/**
 * Toggle a popup panel open/closed
 *
 * @param {HTMLElement} panel - The panel element to toggle
 * @param {HTMLElement} btn - The button that triggered it
 */
function togglePanel(panel, btn) {
  const isOpen = !panel.classList.contains('hidden');
  closeAllPanels();
  if (!isOpen) {
    panel.classList.remove('hidden');
    btn.classList.add('active');
  }
}


/**
 * Scroll to a position row in the table and briefly highlight it
 *
 * @param {string} ticker - The full ticker (e.g. "OUST_US_EQ")
 */
function scrollToPosition(ticker) {
  const row = document.querySelector(`tr[data-ticker="${ticker}"]`);
  if (!row) return;

  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.add('highlight-row');
  setTimeout(() => row.classList.remove('highlight-row'), 1500);
}


/**
 * Search positions by ticker or company name and show dropdown results
 *
 * @param {string} query - Search text
 */
function handleSearch(query) {
  const dropdown = elements.searchResults;

  if (!query || query.length < 1) {
    dropdown.classList.add('hidden');
    return;
  }

  const q = query.toLowerCase();
  const matches = state.positions.filter(pos => {
    const ticker = (pos.shortTicker || pos.ticker || '').toLowerCase();
    const name = (pos.companyName || '').toLowerCase();
    return ticker.includes(q) || name.includes(q);
  }).slice(0, 8); // Limit to 8 results

  if (matches.length === 0) {
    dropdown.classList.add('hidden');
    return;
  }

  let html = '';
  for (const pos of matches) {
    html += `
      <div class="search-result-item" data-scroll-to="${pos.ticker}">
        <div class="search-result-ticker">${pos.shortTicker || pos.ticker}</div>
        <div class="search-result-name">${pos.companyName || ''}</div>
      </div>
    `;
  }

  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');

  // Add click handlers
  dropdown.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', () => {
      scrollToPosition(el.dataset.scrollTo);
      elements.searchInput.value = '';
      dropdown.classList.add('hidden');
    });
  });
}


/**
 * Update the "last update" timestamp display
 *
 * @param {string} timestamp - ISO timestamp string
 * @param {boolean} fromCache - Whether this data is from cache
 */
function updateLastUpdateTime(timestamp, fromCache = false) {
  state.lastUpdate = timestamp;
  const cacheIndicator = fromCache ? ' (cached)' : '';
  elements.lastUpdate.textContent = `Last update: ${formatTime(timestamp)}${cacheIndicator}`;
}


/**
 * Show an error message to the user
 *
 * @param {string} message - Error message to display
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorBanner.classList.remove('hidden');
}


/**
 * Hide the error banner
 */
function hideError() {
  elements.errorBanner.classList.add('hidden');
}


// =============================================================================
// IPC EVENT HANDLERS
// =============================================================================

/**
 * Handle positions update from main process
 *
 * This is called whenever new data is fetched from Trading 212.
 *
 * @param {Object} data - Contains positions, cash, alerts, downtrends, lastUpdate
 */
function handlePositionsUpdate(data) {
  console.log('[Renderer] Received positions update:', data);

  // Update state
  state.positions = data.positions || [];
  state.cash = data.cash;
  state.alerts = data.alerts || [];
  state.downtrends = data.downtrends || [];
  state.uptrends = data.uptrends || [];
  state.fxRates = data.fxRates || null;

  // Update UI
  renderSummary(data);
  renderPositions();
  renderAlerts(state.alerts);
  renderDowntrends(state.downtrends);
  renderUptrends(state.uptrends);
  updateLastUpdateTime(data.lastUpdate, data.fromCache);

  // Clear any previous errors
  hideError();
}


/**
 * Handle error from main process
 *
 * @param {Object} error - Contains message and timestamp
 */
function handleError(error) {
  console.error('[Renderer] Error:', error.message);
  showError(error.message);
}


// =============================================================================
// UI EVENT HANDLERS
// =============================================================================

/**
 * Handle refresh button click
 */
function onRefreshClick() {
  console.log('[Renderer] Manual refresh requested');

  // Disable button temporarily to prevent spam
  elements.refreshBtn.disabled = true;
  elements.refreshBtn.textContent = 'Refreshing...';

  // Request refresh from main process
  window.api.requestRefresh();

  // Re-enable button after a longer delay to prevent rate limiting
  // Trading 212 API has rate limits - don't spam refresh!
  setTimeout(() => {
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = '↻ Refresh';
  }, 5000); // 5 seconds cooldown (was 2)
}


// =============================================================================
// INITIALIZATION
// =============================================================================

/**
 * Set up event listeners and IPC handlers
 */
function initialize() {
  console.log('[Renderer] Initializing...');

  // Set up IPC listeners (receive data from main process)
  window.api.onPositionsUpdate(handlePositionsUpdate);
  window.api.onError(handleError);

  // Set up UI event listeners
  elements.refreshBtn.addEventListener('click', onRefreshClick);
  elements.sortSelect.addEventListener('change', onSortChange);
  elements.errorDismiss.addEventListener('click', hideError);

  // Panel toggle buttons for alerts and downtrends
  elements.alertsBtn.addEventListener('click', () => {
    togglePanel(elements.alertsPanel, elements.alertsBtn);
  });
  elements.downtrendsBtn.addEventListener('click', () => {
    togglePanel(elements.downtrendsPanel, elements.downtrendsBtn);
  });
  elements.uptrendsBtn.addEventListener('click', () => {
    togglePanel(elements.uptrendsPanel, elements.uptrendsBtn);
  });

  // Close buttons inside panels
  document.querySelectorAll('.popup-panel-close').forEach(btn => {
    btn.addEventListener('click', () => closeAllPanels());
  });

  // Search input - live search as user types
  elements.searchInput.addEventListener('input', (e) => {
    handleSearch(e.target.value.trim());
  });

  // Close search dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
      elements.searchResults.classList.add('hidden');
    }
  });

  // Keyboard navigation for search: Escape to close
  elements.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      elements.searchInput.value = '';
      elements.searchResults.classList.add('hidden');
      elements.searchInput.blur();
    }
  });

  // Request initial data (main process will use cache if available)
  window.api.requestPositions();

  console.log('[Renderer] Initialized and ready');
}


// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
