/**
 * dataStore.js
 * ============
 * Local data storage for portfolio history and settings.
 *
 * This module handles:
 * - Storing daily snapshots of portfolio positions
 * - Tracking historical data for trend detection
 * - Persisting user preferences
 *
 * We use electron-store which saves data as JSON files in the app's
 * user data directory. This data persists between app restarts.
 *
 * Data is stored locally on your machine - nothing is sent anywhere.
 */

const Store = require('electron-store');

/**
 * DataStore
 *
 * Manages local storage of portfolio snapshots and calculates
 * daily changes for gain/loss tracking.
 */
class DataStore {

  constructor() {
    // Initialize electron-store with a schema for type safety
    // Data is saved to: ~/.config/trading212-viewer/config.json (on Linux)
    this.store = new Store({
      name: 'portfolio-data',

      // Default values if nothing is stored yet
      defaults: {
        // Historical snapshots keyed by date (YYYY-MM-DD)
        snapshots: {},

        // Last known positions (for comparison)
        lastPositions: [],

        // Last known cash balance (for startup cache)
        lastCash: null,

        // When we last fetched data
        lastFetchTime: null,

        // Cached instruments metadata (ticker -> {name, currencyCode, isin})
        // This rarely changes and contains thousands of entries
        instruments: null,
        instrumentsCacheTime: null,

        // User preferences
        preferences: {
          sortBy: 'totalReturnPercent', // Default sort column
          sortDirection: 'asc'           // Losers at top by default
        }
      }
    });
  }


  // ===========================================================================
  // SNAPSHOT MANAGEMENT
  // ===========================================================================

  /**
   * Save a snapshot of current positions
   *
   * Stores the positions with today's date as the key.
   * This builds up historical data for trend analysis.
   *
   * @param {Array} positions - Array of position objects from the API
   */
  saveSnapshot(positions) {
    const today = this._getTodayKey();
    const snapshots = this.store.get('snapshots');

    // Store the snapshot with timestamp
    snapshots[today] = {
      positions: positions,
      timestamp: new Date().toISOString()
    };

    // Keep only last 90 days of data to prevent unbounded growth
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffKey = this._dateToKey(cutoffDate);

    // Remove old snapshots
    for (const dateKey of Object.keys(snapshots)) {
      if (dateKey < cutoffKey) {
        delete snapshots[dateKey];
      }
    }

    this.store.set('snapshots', snapshots);
    this.store.set('lastPositions', positions);
    this.store.set('lastFetchTime', new Date().toISOString());
  }


  /**
   * Get yesterday's snapshot (for daily comparison)
   *
   * @returns {Object|null} Yesterday's snapshot or null if not available
   */
  getYesterdaySnapshot() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = this._dateToKey(yesterday);

    const snapshots = this.store.get('snapshots');
    return snapshots[key] || null;
  }


  /**
   * Get snapshot for a specific date
   *
   * @param {Date} date - The date to look up
   * @returns {Object|null} The snapshot or null if not available
   */
  getSnapshotForDate(date) {
    const key = this._dateToKey(date);
    const snapshots = this.store.get('snapshots');
    return snapshots[key] || null;
  }


  /**
   * Get all stored snapshots
   *
   * @returns {Object} All snapshots keyed by date
   */
  getAllSnapshots() {
    return this.store.get('snapshots');
  }


  /**
   * Get today's snapshot (for cache checking)
   *
   * @returns {Object|null} Today's snapshot or null if not available
   */
  getTodaySnapshot() {
    const today = this._getTodayKey();
    const snapshots = this.store.get('snapshots');
    return snapshots[today] || null;
  }


  /**
   * Check if we have fresh data (fetched recently)
   *
   * @param {number} maxAgeMinutes - Maximum age in minutes (default: 30)
   * @returns {boolean} True if we have fresh data
   */
  hasFreshData(maxAgeMinutes = 30) {
    const lastFetchTime = this.store.get('lastFetchTime');
    if (!lastFetchTime) {
      return false;
    }

    const lastFetch = new Date(lastFetchTime);
    const now = new Date();
    const ageMinutes = (now - lastFetch) / (1000 * 60);

    return ageMinutes < maxAgeMinutes;
  }


  /**
   * Get cached positions (from today's snapshot)
   *
   * @returns {Array|null} Cached positions or null if not available
   */
  getCachedPositions() {
    const todaySnapshot = this.getTodaySnapshot();
    return todaySnapshot ? todaySnapshot.positions : null;
  }


  // ===========================================================================
  // DAILY CHANGE CALCULATION
  // ===========================================================================

  /**
   * Calculate daily changes for each position
   *
   * Compares current positions against yesterday's snapshot to determine
   * what has gone up and what has gone down.
   *
   * @param {Array} currentPositions - Current positions from the API
   * @returns {Array} Positions with added daily change data
   */
  calculateDailyChanges(currentPositions) {
    const yesterday = this.getYesterdaySnapshot();

    // Build a lookup map of yesterday's positions by ticker
    const yesterdayMap = new Map();
    if (yesterday && yesterday.positions) {
      for (const pos of yesterday.positions) {
        yesterdayMap.set(pos.ticker, pos);
      }
    }

    // Enhance each current position with daily change data
    return currentPositions.map(position => {
      const yesterdayPosition = yesterdayMap.get(position.ticker);

      let dailyChange = 0;
      let dailyChangePercent = 0;
      let hasYesterdayData = false;

      if (yesterdayPosition) {
        hasYesterdayData = true;
        // Calculate change from yesterday's closing price to current price
        const yesterdayValue = yesterdayPosition.currentPrice;
        const currentValue = position.currentPrice;

        dailyChange = currentValue - yesterdayValue;
        dailyChangePercent = yesterdayValue > 0
          ? ((currentValue - yesterdayValue) / yesterdayValue) * 100
          : 0;
      }

      return {
        ...position,
        dailyChange,
        dailyChangePercent,
        hasYesterdayData,

        // Also include human-readable name from ticker
        // Trading 212 tickers are like "AAPL_US_EQ" - we extract "AAPL"
        shortTicker: this._extractShortTicker(position.ticker)
      };
    });
  }


  // ===========================================================================
  // TREND DETECTION
  // ===========================================================================

  /**
   * Detect stocks that have been trending down over multiple days
   *
   * Looks at the last N days of data to find consistent losers.
   *
   * @param {number} days - Number of days to analyze (default: 5)
   * @param {number} threshold - Minimum total loss % to flag (default: -10)
   * @returns {Array} Array of trending down stocks with details
   */
  detectDowntrends(days = 5, threshold = -10) {
    const snapshots = this.store.get('snapshots');
    const snapshotDates = Object.keys(snapshots).sort().slice(-days);

    if (snapshotDates.length < 2) {
      return []; // Not enough data
    }

    const firstSnapshot = snapshots[snapshotDates[0]];
    const lastSnapshot = snapshots[snapshotDates[snapshotDates.length - 1]];

    if (!firstSnapshot || !lastSnapshot) {
      return [];
    }

    // Build lookup for first day's positions
    const firstDayMap = new Map();
    for (const pos of firstSnapshot.positions) {
      firstDayMap.set(pos.ticker, pos);
    }

    // Compare to find downtrends
    const downtrends = [];

    for (const currentPos of lastSnapshot.positions) {
      const startPos = firstDayMap.get(currentPos.ticker);

      if (startPos) {
        const startPrice = startPos.currentPrice;
        const endPrice = currentPos.currentPrice;
        const changePercent = ((endPrice - startPrice) / startPrice) * 100;

        if (changePercent <= threshold) {
          downtrends.push({
            ticker: currentPos.ticker,
            shortTicker: this._extractShortTicker(currentPos.ticker),
            startPrice,
            endPrice,
            changePercent,
            days: snapshotDates.length
          });
        }
      }
    }

    // Sort by worst performers first
    return downtrends.sort((a, b) => a.changePercent - b.changePercent);
  }


  // ===========================================================================
  // INSTRUMENTS CACHE
  // ===========================================================================

  /**
   * Save instruments metadata to disk cache
   *
   * Instruments data rarely changes and contains thousands of entries.
   * Caching it avoids an API call on every app startup.
   *
   * @param {Object} instrumentsMap - Map-like object of ticker -> metadata
   */
  saveInstruments(instrumentsMap) {
    // Convert Map to plain object for JSON storage
    const instrumentsObj = {};
    for (const [ticker, meta] of instrumentsMap) {
      instrumentsObj[ticker] = meta;
    }

    this.store.set('instruments', instrumentsObj);
    this.store.set('instrumentsCacheTime', new Date().toISOString());
    console.log(`[DataStore] Cached ${Object.keys(instrumentsObj).length} instruments to disk`);
  }


  /**
   * Get cached instruments from disk
   *
   * @returns {Map|null} Map of ticker -> metadata, or null if not cached
   */
  getCachedInstruments() {
    const instrumentsObj = this.store.get('instruments');
    if (!instrumentsObj) {
      return null;
    }

    // Convert back to Map
    const map = new Map();
    for (const [ticker, meta] of Object.entries(instrumentsObj)) {
      map.set(ticker, meta);
    }
    return map;
  }


  /**
   * Check if instruments cache is valid (less than 24 hours old)
   *
   * @returns {boolean} True if cache exists and is fresh
   */
  isInstrumentsCacheValid() {
    const cacheTime = this.store.get('instrumentsCacheTime');
    if (!cacheTime) {
      return false;
    }

    const cacheDate = new Date(cacheTime);
    const now = new Date();
    const hoursSinceCache = (now - cacheDate) / (1000 * 60 * 60);

    // Cache is valid for 24 hours
    return hoursSinceCache < 24;
  }


  // ===========================================================================
  // USER PREFERENCES
  // ===========================================================================

  /**
   * Save user preference
   *
   * @param {string} key - Preference name
   * @param {any} value - Preference value
   */
  setPreference(key, value) {
    const prefs = this.store.get('preferences');
    prefs[key] = value;
    this.store.set('preferences', prefs);
  }


  /**
   * Get user preference
   *
   * @param {string} key - Preference name
   * @returns {any} Preference value or undefined
   */
  getPreference(key) {
    const prefs = this.store.get('preferences');
    return prefs[key];
  }


  /**
   * Get all preferences
   *
   * @returns {Object} All user preferences
   */
  getAllPreferences() {
    return this.store.get('preferences');
  }


  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Get today's date as a storage key (YYYY-MM-DD format)
   * @private
   */
  _getTodayKey() {
    return this._dateToKey(new Date());
  }


  /**
   * Convert a Date object to a storage key
   * @private
   */
  _dateToKey(date) {
    return date.toISOString().split('T')[0];
  }


  /**
   * Extract short ticker symbol from Trading 212's format
   *
   * Trading 212 uses format like "AAPL_US_EQ" or "TSLA_US_EQ"
   * This extracts just "AAPL" or "TSLA"
   *
   * @param {string} fullTicker - Full ticker like "AAPL_US_EQ"
   * @returns {string} Short ticker like "AAPL"
   * @private
   */
  _extractShortTicker(fullTicker) {
    if (!fullTicker) return '';
    // Split by underscore and take the first part
    return fullTicker.split('_')[0];
  }
}


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { DataStore };
