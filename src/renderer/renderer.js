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

  // Downtrend warnings
  downtrends: [],

  // Sorting preference
  sortBy: 'dailyChangePercent',
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

  // Alerts
  alertsContainer: document.getElementById('alerts-container'),
  alertCount: document.getElementById('alert-count'),
  downtrendsContainer: document.getElementById('downtrends-container'),
  downtrendsList: document.getElementById('downtrends-list'),

  // Header
  lastUpdate: document.getElementById('last-update'),
  refreshBtn: document.getElementById('refresh-btn'),

  // Error handling
  errorBanner: document.getElementById('error-banner'),
  errorMessage: document.getElementById('error-message'),
  errorDismiss: document.getElementById('error-dismiss')
};


// =============================================================================
// FORMATTING UTILITIES
// =============================================================================

/**
 * Check if a ticker is a UK stock (priced in pence, not pounds)
 *
 * UK stocks on Trading 212 have tickers ending in 'l_EQ' (London Stock Exchange)
 * Their prices are in GBX (pence) not GBP (pounds), so we need to divide by 100
 *
 * @param {string} ticker - The full ticker symbol (e.g., "BPl_EQ", "GOOGL_US_EQ")
 * @returns {boolean} True if this is a UK stock priced in pence
 */
function isUkStock(ticker) {
  if (!ticker) return false;
  // UK stocks end with 'l_EQ' (lowercase L for London)
  // But NOT US stocks like GOOGL_US_EQ (uppercase L is part of ticker name)
  return ticker.endsWith('l_EQ');
}


/**
 * Convert price from pence to pounds if needed
 *
 * @param {number} price - The price value
 * @param {string} ticker - The ticker to check if it's a UK stock
 * @returns {number} Price in pounds (converted if UK stock)
 */
function normalizePriceToGbp(price, ticker) {
  if (isUkStock(ticker)) {
    return price / 100; // Convert pence to pounds
  }
  return price;
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

      case 'ppl':
        // Normalize P/L for UK stocks when sorting
        aValue = normalizePriceToGbp(a.ppl, a.ticker) || 0;
        bValue = normalizePriceToGbp(b.ppl, b.ticker) || 0;
        break;

      case 'currentValue':
        // Normalize prices for UK stocks when sorting by value
        aValue = (a.quantity * normalizePriceToGbp(a.currentPrice, a.ticker)) || 0;
        bValue = (b.quantity * normalizePriceToGbp(b.currentPrice, b.ticker)) || 0;
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

  // Build table HTML
  // (Using innerHTML for simplicity; for large lists, consider virtual scrolling)
  let html = '';

  if (positions.length === 0) {
    html = `
      <tr class="loading-row">
        <td colspan="7">No positions found. Check your API configuration.</td>
      </tr>
    `;
  } else {
    for (const pos of positions) {
      // Normalize prices from pence to pounds for UK stocks
      const avgPrice = normalizePriceToGbp(pos.averagePrice, pos.ticker);
      const curPrice = normalizePriceToGbp(pos.currentPrice, pos.ticker);
      const currentValue = pos.quantity * curPrice;

      // P/L also needs normalization for UK stocks (API returns pence)
      const ppl = normalizePriceToGbp(pos.ppl, pos.ticker);

      const dailyChangeClass = getChangeClass(pos.dailyChangePercent);
      const pplClass = getChangeClass(ppl);

      // Format daily change display
      let dailyChangeDisplay = '--';
      if (pos.hasYesterdayData) {
        // Daily change also needs normalization for UK stocks
        const normalizedDailyChange = normalizePriceToGbp(pos.dailyChange, pos.ticker);
        const changeAmount = normalizedDailyChange * pos.quantity;
        dailyChangeDisplay = `
          <span class="${dailyChangeClass}">${formatCurrency(changeAmount)}</span>
          <br>
          <small class="${dailyChangeClass}">${formatPercent(pos.dailyChangePercent)}</small>
        `;
      }

      // Show company name on hover (title attribute)
      const tickerDisplay = pos.shortTicker || pos.ticker;
      const hoverTitle = pos.companyName || pos.ticker;

      html += `
        <tr>
          <td class="ticker-cell" title="${hoverTitle}">${tickerDisplay}</td>
          <td>${pos.quantity.toFixed(4)}</td>
          <td class="number">${formatCurrency(avgPrice)}</td>
          <td class="number">${formatCurrency(curPrice)}</td>
          <td class="number">${formatCurrency(currentValue)}</td>
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

  let html = '';

  for (const alert of alerts) {
    const icon = alert.type === 'daily_loss' ? '📉' : '📈';
    const time = formatTime(alert.timestamp);

    html += `
      <div class="alert-item">
        <span class="alert-icon">${icon}</span>
        <div class="alert-content">
          <div class="alert-title ${alert.type === 'daily_loss' ? 'loss' : 'gain'}">
            ${alert.shortTicker}
          </div>
          <div class="alert-message">${alert.message}</div>
        </div>
        <span class="alert-time">${time}</span>
      </div>
    `;
  }

  elements.alertsContainer.innerHTML = html;
}


/**
 * Render downtrend warnings
 *
 * @param {Array} downtrends - Array of downtrend objects
 */
function renderDowntrends(downtrends) {
  if (!downtrends || downtrends.length === 0) {
    elements.downtrendsContainer.classList.add('hidden');
    return;
  }

  elements.downtrendsContainer.classList.remove('hidden');

  let html = '';

  for (const trend of downtrends) {
    html += `
      <li>
        <strong class="loss">${trend.shortTicker}</strong>:
        Down ${Math.abs(trend.changePercent).toFixed(2)}% over ${trend.days} days
        (${formatCurrency(trend.startPrice)} → ${formatCurrency(trend.endPrice)})
      </li>
    `;
  }

  elements.downtrendsList.innerHTML = html;
}


/**
 * Update the "last update" timestamp display
 *
 * @param {string} timestamp - ISO timestamp string
 */
function updateLastUpdateTime(timestamp) {
  state.lastUpdate = timestamp;
  elements.lastUpdate.textContent = `Last update: ${formatTime(timestamp)}`;
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

  // Update UI
  renderSummary(data);
  renderPositions();
  renderAlerts(state.alerts);
  renderDowntrends(state.downtrends);
  updateLastUpdateTime(data.lastUpdate);

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

  // Re-enable button after a short delay
  setTimeout(() => {
    elements.refreshBtn.disabled = false;
    elements.refreshBtn.textContent = '↻ Refresh';
  }, 2000);
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

  // Request initial data
  window.api.requestPositions();

  console.log('[Renderer] Initialized and ready');
}


// Run initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
