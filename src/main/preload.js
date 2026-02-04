/**
 * preload.js
 * ==========
 * Electron Preload Script - Secure Bridge Between Main and Renderer
 *
 * SECURITY CONTEXT:
 * This script runs in a special context that has access to both:
 * - Node.js APIs (via require)
 * - The renderer's window object
 *
 * We use contextBridge to safely expose specific functions to the renderer,
 * without giving it full Node.js access. This is a security best practice.
 *
 * The renderer (UI) can only call the functions we explicitly expose here.
 * It cannot require Node modules or access the filesystem directly.
 *
 * HOW IT WORKS:
 * 1. Main process sends data via: mainWindow.webContents.send(channel, data)
 * 2. Preload exposes: window.api.onPositionsUpdate(callback)
 * 3. Renderer listens via: window.api.onPositionsUpdate((data) => { ... })
 */

const { contextBridge, ipcRenderer } = require('electron');

// IPC channel names - must match main.js
// (inlined here to avoid require path issues in preload context)
const IPC_CHANNELS = {
  REQUEST_POSITIONS: 'request-positions',
  REQUEST_ACCOUNT_SUMMARY: 'request-account-summary',
  REQUEST_REFRESH: 'request-refresh',
  POSITIONS_UPDATE: 'positions-update',
  ACCOUNT_SUMMARY_UPDATE: 'account-summary-update',
  ERROR: 'error',
  ALERT_TRIGGERED: 'alert-triggered'
};


// =============================================================================
// EXPOSED API
// =============================================================================
//
// This object will be available in the renderer as `window.api`
// Only these specific functions can be called from the UI.

contextBridge.exposeInMainWorld('api', {

  // ---------------------------------------------------------------------------
  // REQUESTS: Renderer → Main
  // These functions send messages TO the main process
  // ---------------------------------------------------------------------------

  /**
   * Request a manual data refresh
   *
   * Usage in renderer:
   *   window.api.requestRefresh();
   */
  requestRefresh: () => {
    ipcRenderer.send(IPC_CHANNELS.REQUEST_REFRESH);
  },

  /**
   * Request positions data
   *
   * Usage in renderer:
   *   window.api.requestPositions();
   */
  requestPositions: () => {
    ipcRenderer.send(IPC_CHANNELS.REQUEST_POSITIONS);
  },

  /**
   * Request account summary
   *
   * Usage in renderer:
   *   window.api.requestAccountSummary();
   */
  requestAccountSummary: () => {
    ipcRenderer.send(IPC_CHANNELS.REQUEST_ACCOUNT_SUMMARY);
  },


  // ---------------------------------------------------------------------------
  // LISTENERS: Main → Renderer
  // These functions register callbacks for data FROM the main process
  // ---------------------------------------------------------------------------

  /**
   * Listen for positions updates
   *
   * Usage in renderer:
   *   window.api.onPositionsUpdate((data) => {
   *     console.log('Received positions:', data.positions);
   *   });
   *
   * @param {Function} callback - Called with { positions, cash, alerts, lastUpdate }
   */
  onPositionsUpdate: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.POSITIONS_UPDATE, (event, data) => {
      callback(data);
    });
  },

  /**
   * Listen for account summary updates
   *
   * @param {Function} callback - Called with account summary object
   */
  onAccountSummaryUpdate: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ACCOUNT_SUMMARY_UPDATE, (event, data) => {
      callback(data);
    });
  },

  /**
   * Listen for errors
   *
   * @param {Function} callback - Called with { message, timestamp }
   */
  onError: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ERROR, (event, data) => {
      callback(data);
    });
  },

  /**
   * Listen for alert notifications
   *
   * @param {Function} callback - Called with array of triggered alerts
   */
  onAlert: (callback) => {
    ipcRenderer.on(IPC_CHANNELS.ALERT_TRIGGERED, (event, alerts) => {
      callback(alerts);
    });
  },


  // ---------------------------------------------------------------------------
  // UTILITY
  // ---------------------------------------------------------------------------

  /**
   * Remove all listeners for a specific channel
   *
   * Call this when cleaning up to prevent memory leaks.
   *
   * @param {string} channel - The channel name to remove listeners from
   */
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});


// Log that preload script has run (helpful for debugging)
console.log('[Preload] API bridge initialized');
