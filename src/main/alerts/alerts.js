/**
 * alerts.js
 * =========
 * Alert system for portfolio monitoring.
 *
 * This module handles:
 * - Checking positions against alert thresholds
 * - Triggering desktop notifications
 * - Tracking which alerts have already been shown (to avoid spam)
 *
 * Alert Types:
 * - Daily loss alerts: Stock dropped more than X% today
 * - Daily gain alerts: Stock gained more than X% today
 * - Downtrend alerts: Stock has been falling for multiple days
 */

const { Notification } = require('electron');

/**
 * AlertManager
 *
 * Monitors positions and triggers alerts when thresholds are crossed.
 */
class AlertManager {

  /**
   * Create a new AlertManager
   *
   * @param {Object} config - Alert configuration
   * @param {number} config.dailyLossThreshold - % loss to trigger alert (negative, e.g., -5)
   * @param {number} config.dailyGainThreshold - % gain to trigger alert (positive, e.g., 10)
   */
  constructor(config = {}) {
    // Alert thresholds (can be null to disable)
    this.dailyLossThreshold = config.dailyLossThreshold ?? -5;
    this.dailyGainThreshold = config.dailyGainThreshold ?? 10;

    // Track which alerts we've already shown today (to avoid repeating)
    // Key format: "ticker:alertType:date"
    this.shownAlerts = new Set();

    // Callback function for when alerts are triggered
    // (used to notify the renderer process)
    this.onAlertCallback = null;
  }


  // ===========================================================================
  // CONFIGURATION
  // ===========================================================================

  /**
   * Update alert thresholds
   *
   * @param {Object} config - New threshold values
   */
  updateThresholds(config) {
    if (config.dailyLossThreshold !== undefined) {
      this.dailyLossThreshold = config.dailyLossThreshold;
    }
    if (config.dailyGainThreshold !== undefined) {
      this.dailyGainThreshold = config.dailyGainThreshold;
    }
  }


  /**
   * Set callback for alert events
   *
   * @param {Function} callback - Function to call when alert triggers
   */
  setAlertCallback(callback) {
    this.onAlertCallback = callback;
  }


  // ===========================================================================
  // ALERT CHECKING
  // ===========================================================================

  /**
   * Check positions for alert conditions
   *
   * Examines each position and triggers alerts if thresholds are crossed.
   *
   * @param {Array} positionsWithChanges - Positions with dailyChangePercent calculated
   * @returns {Array} Array of triggered alerts
   */
  checkAlerts(positionsWithChanges) {
    const today = new Date().toISOString().split('T')[0];
    const triggeredAlerts = [];

    for (const position of positionsWithChanges) {
      // Skip if we don't have daily change data
      if (!position.hasYesterdayData) {
        continue;
      }

      const { shortTicker, ticker, dailyChangePercent, currentPrice } = position;

      // Check for daily loss alert
      if (this.dailyLossThreshold !== null &&
          dailyChangePercent <= this.dailyLossThreshold) {

        const alertKey = `${ticker}:loss:${today}`;

        if (!this.shownAlerts.has(alertKey)) {
          const alert = {
            type: 'daily_loss',
            ticker,
            shortTicker,
            changePercent: dailyChangePercent,
            currentPrice,
            threshold: this.dailyLossThreshold,
            message: `${shortTicker} is down ${dailyChangePercent.toFixed(2)}% today`,
            timestamp: new Date().toISOString()
          };

          triggeredAlerts.push(alert);
          this.shownAlerts.add(alertKey);

          // Show desktop notification
          this._showNotification(
            `📉 ${shortTicker} Down`,
            `${shortTicker} has dropped ${Math.abs(dailyChangePercent).toFixed(2)}% today`
          );
        }
      }

      // Check for daily gain alert
      if (this.dailyGainThreshold !== null &&
          dailyChangePercent >= this.dailyGainThreshold) {

        const alertKey = `${ticker}:gain:${today}`;

        if (!this.shownAlerts.has(alertKey)) {
          const alert = {
            type: 'daily_gain',
            ticker,
            shortTicker,
            changePercent: dailyChangePercent,
            currentPrice,
            threshold: this.dailyGainThreshold,
            message: `${shortTicker} is up ${dailyChangePercent.toFixed(2)}% today`,
            timestamp: new Date().toISOString()
          };

          triggeredAlerts.push(alert);
          this.shownAlerts.add(alertKey);

          // Show desktop notification
          this._showNotification(
            `📈 ${shortTicker} Up`,
            `${shortTicker} has gained ${dailyChangePercent.toFixed(2)}% today`
          );
        }
      }
    }

    // Notify via callback if set
    if (triggeredAlerts.length > 0 && this.onAlertCallback) {
      this.onAlertCallback(triggeredAlerts);
    }

    return triggeredAlerts;
  }


  /**
   * Check for downtrend alerts
   *
   * @param {Array} downtrends - Downtrend data from DataStore.detectDowntrends()
   * @returns {Array} Array of triggered downtrend alerts
   */
  checkDowntrendAlerts(downtrends) {
    const today = new Date().toISOString().split('T')[0];
    const triggeredAlerts = [];

    for (const trend of downtrends) {
      const alertKey = `${trend.ticker}:downtrend:${today}`;

      if (!this.shownAlerts.has(alertKey)) {
        const alert = {
          type: 'downtrend',
          ticker: trend.ticker,
          shortTicker: trend.shortTicker,
          changePercent: trend.changePercent,
          days: trend.days,
          message: `${trend.shortTicker} has dropped ${Math.abs(trend.changePercent).toFixed(2)}% over ${trend.days} days`,
          timestamp: new Date().toISOString()
        };

        triggeredAlerts.push(alert);
        this.shownAlerts.add(alertKey);

        // Show desktop notification
        this._showNotification(
          `⚠️ ${trend.shortTicker} Downtrend`,
          `Down ${Math.abs(trend.changePercent).toFixed(2)}% over ${trend.days} days`
        );
      }
    }

    // Notify via callback if set
    if (triggeredAlerts.length > 0 && this.onAlertCallback) {
      this.onAlertCallback(triggeredAlerts);
    }

    return triggeredAlerts;
  }


  // ===========================================================================
  // ALERT MANAGEMENT
  // ===========================================================================

  /**
   * Clear alert history for today
   *
   * Use this to reset alerts and allow them to trigger again.
   */
  clearTodayAlerts() {
    const today = new Date().toISOString().split('T')[0];

    for (const key of this.shownAlerts) {
      if (key.includes(today)) {
        this.shownAlerts.delete(key);
      }
    }
  }


  /**
   * Clear all alert history
   */
  clearAllAlerts() {
    this.shownAlerts.clear();
  }


  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Show a desktop notification
   *
   * @param {string} title - Notification title
   * @param {string} body - Notification body text
   * @private
   */
  _showNotification(title, body) {
    // Check if notifications are supported (they might not be in all environments)
    if (Notification.isSupported()) {
      const notification = new Notification({
        title,
        body,
        silent: false // Make sound
      });

      notification.show();
    }
  }
}


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { AlertManager };
