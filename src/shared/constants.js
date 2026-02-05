/**
 * constants.js
 * ============
 * Shared constants used throughout the application.
 *
 * This file contains:
 * - API endpoint URLs for Trading 212
 * - IPC (Inter-Process Communication) channel names for Electron
 * - Application-wide settings
 */

// =============================================================================
// TRADING 212 API ENDPOINTS
// =============================================================================
//
// Trading 212 provides two environments:
// - DEMO: For testing with paper money (no risk)
// - LIVE: For real money accounts
//
// IMPORTANT: This application is READ-ONLY. We only use GET endpoints.
// No trading/order endpoints are included intentionally for security.

const API_BASE_URLS = {
  demo: 'https://demo.trading212.com/api/v0',
  live: 'https://live.trading212.com/api/v0'
};

// API endpoints we use (all READ-ONLY operations)
const API_ENDPOINTS = {
  // Account information
  ACCOUNT_CASH: '/equity/account/cash',       // Get cash balance
  ACCOUNT_INFO: '/equity/account/info',       // Get account metadata

  // Portfolio data
  POSITIONS: '/equity/portfolio',              // Get all open positions

  // Instrument metadata
  INSTRUMENTS: '/equity/metadata/instruments', // Get all instruments with names

  // Historical data
  DIVIDENDS: '/equity/history/dividends',      // Get dividend history
  ORDERS: '/equity/history/orders',            // Get order history
  TRANSACTIONS: '/equity/history/transactions' // Get transaction history
};


// =============================================================================
// ELECTRON IPC CHANNELS
// =============================================================================
//
// Electron apps have two processes:
// - Main process: Runs Node.js, handles API calls, system access
// - Renderer process: Runs the UI (HTML/CSS/JS in a browser window)
//
// They communicate via IPC (Inter-Process Communication) channels.
// These channel names must match between main and renderer.

const IPC_CHANNELS = {
  // Requests FROM renderer TO main
  REQUEST_POSITIONS: 'request-positions',
  REQUEST_ACCOUNT_SUMMARY: 'request-account-summary',
  REQUEST_REFRESH: 'request-refresh',

  // Responses FROM main TO renderer
  POSITIONS_UPDATE: 'positions-update',
  ACCOUNT_SUMMARY_UPDATE: 'account-summary-update',
  ERROR: 'error',

  // Alerts
  ALERT_TRIGGERED: 'alert-triggered'
};


// =============================================================================
// APPLICATION DEFAULTS
// =============================================================================

const DEFAULTS = {
  // How often to poll the API (in milliseconds)
  // 3600000ms = 1 hour (conservative to avoid rate limits)
  // Trading 212 has strict rate limits - don't poll too frequently
  POLLING_INTERVAL_MS: 3600000,

  // Default alert thresholds (percentage)
  DAILY_LOSS_ALERT_THRESHOLD: -5,   // Alert if a stock drops 5% in a day
  DAILY_GAIN_ALERT_THRESHOLD: 10,   // Alert if a stock gains 10% in a day

  // Window dimensions
  WINDOW_WIDTH: 1200,
  WINDOW_HEIGHT: 800
};


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  API_BASE_URLS,
  API_ENDPOINTS,
  IPC_CHANNELS,
  DEFAULTS
};
