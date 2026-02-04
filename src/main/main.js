/**
 * main.js
 * =======
 * Electron Main Process - Entry Point
 *
 * This is the "backend" of the Electron app. It runs in Node.js and handles:
 * - Creating the application window
 * - Loading configuration
 * - Making API calls to Trading 212
 * - Storing data locally
 * - Managing alerts
 * - Communicating with the renderer (UI) process via IPC
 *
 * ARCHITECTURE OVERVIEW:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Main Process (this file)                                       │
 * │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
 * │  │ Trading212  │  │  DataStore  │  │   Alerts    │             │
 * │  │   Client    │  │  (storage)  │  │  Manager    │             │
 * │  └─────────────┘  └─────────────┘  └─────────────┘             │
 * │         │                │                │                     │
 * │         └────────────────┼────────────────┘                     │
 * │                          │                                      │
 * │                     IPC Bridge                                  │
 * └──────────────────────────┼──────────────────────────────────────┘
 *                            │
 * ┌──────────────────────────┼──────────────────────────────────────┐
 * │  Renderer Process        │                                      │
 * │  (Browser Window)        ▼                                      │
 * │  ┌─────────────────────────────────────────────────────────┐   │
 * │  │  UI: HTML + CSS + JavaScript                            │   │
 * │  │  - Displays positions table                             │   │
 * │  │  - Shows account summary                                │   │
 * │  │  - Handles user interactions                            │   │
 * │  └─────────────────────────────────────────────────────────┘   │
 * └─────────────────────────────────────────────────────────────────┘
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Load environment variables from .env file
// This must be done before accessing process.env
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Our modules
const { Trading212Client } = require('./api/trading212');
const { DataStore } = require('./store/dataStore');
const { AlertManager } = require('./alerts/alerts');
const { IPC_CHANNELS, DEFAULTS } = require('../shared/constants');


// =============================================================================
// GLOBAL STATE
// =============================================================================

// The main application window
let mainWindow = null;

// Our service instances (initialized after config is loaded)
let apiClient = null;
let dataStore = null;
let alertManager = null;

// Polling interval reference (so we can stop it if needed)
let pollingInterval = null;

// Application configuration
let config = null;

// Cached instruments metadata (ticker -> name mapping)
// Fetched once and reused - contains thousands of instruments
let instrumentsMap = null;


// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Load configuration from environment variables and config file
 *
 * API credentials come from environment variables (for security):
 * - TRADING212_API_KEY
 * - TRADING212_API_SECRET
 * - TRADING212_ENVIRONMENT (optional, defaults to 'live')
 *
 * Other settings come from config/config.json (optional):
 * - polling.intervalMs
 * - alerts.dailyLossThreshold
 * - alerts.dailyGainThreshold
 *
 * @returns {Object} Configuration object
 * @throws {Error} If required environment variables are missing
 */
function loadConfig() {
  // Load API credentials from environment variables
  const apiKey = process.env.TRADING212_API_KEY;
  const apiSecret = process.env.TRADING212_API_SECRET;
  const environment = process.env.TRADING212_ENVIRONMENT || 'live';

  // Validate required environment variables
  if (!apiKey) {
    throw new Error(
      'TRADING212_API_KEY environment variable not set!\n\n' +
      'Please create a .env file by:\n' +
      '1. Copy .env.example to .env\n' +
      '2. Fill in your Trading 212 API key and secret\n\n' +
      'Or set the environment variables directly.'
    );
  }
  if (!apiSecret) {
    throw new Error(
      'TRADING212_API_SECRET environment variable not set!\n\n' +
      'Please create a .env file by:\n' +
      '1. Copy .env.example to .env\n' +
      '2. Fill in your Trading 212 API key and secret\n\n' +
      'Or set the environment variables directly.'
    );
  }

  // Start with default config
  const config = {
    api: {
      key: apiKey,
      secret: apiSecret,
      environment: environment
    },
    polling: {
      intervalMs: 3600000  // Default: 1 hour
    },
    alerts: {
      dailyLossThreshold: -5,
      dailyGainThreshold: 10
    }
  };

  // Optionally load additional settings from config file
  const configPath = path.join(__dirname, '../../config/config.json');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(configContent);

      // Merge file config (but don't override API credentials from env vars)
      if (fileConfig.polling?.intervalMs) {
        config.polling.intervalMs = fileConfig.polling.intervalMs;
      }
      if (fileConfig.alerts?.dailyLossThreshold !== undefined) {
        config.alerts.dailyLossThreshold = fileConfig.alerts.dailyLossThreshold;
      }
      if (fileConfig.alerts?.dailyGainThreshold !== undefined) {
        config.alerts.dailyGainThreshold = fileConfig.alerts.dailyGainThreshold;
      }

      console.log('[Main] Loaded additional settings from config.json');
    } catch (error) {
      console.warn('[Main] Could not load config.json, using defaults:', error.message);
    }
  }

  return config;
}


// =============================================================================
// WINDOW MANAGEMENT
// =============================================================================

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: DEFAULTS.WINDOW_WIDTH,
    height: DEFAULTS.WINDOW_HEIGHT,
    title: 'Trading 212 Portfolio Viewer',

    // Security settings for the renderer
    webPreferences: {
      // Enable IPC communication with renderer
      preload: path.join(__dirname, 'preload.js'),

      // Security: Disable node integration in renderer
      // (renderer uses contextBridge for safe IPC)
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Load the UI
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}


// =============================================================================
// DATA FETCHING AND PROCESSING
// =============================================================================

/**
 * Fetch latest data from Trading 212 and update the UI
 *
 * This is the main data refresh function. It:
 * 1. Fetches current positions from the API
 * 2. Calculates daily changes (compared to yesterday)
 * 3. Saves a snapshot for historical tracking
 * 4. Checks for alerts
 * 5. Sends data to the renderer for display
 */
async function refreshData() {
  try {
    console.log('[Main] Refreshing data from Trading 212...');

    // Fetch current positions and cash
    const positions = await apiClient.getPositions();
    const cash = await apiClient.getCashBalance();

    // Fetch instruments metadata if not cached (for company names)
    // Only fetch once - this contains thousands of instruments
    if (!instrumentsMap) {
      console.log('[Main] Fetching instruments metadata...');
      try {
        const instruments = await apiClient.getInstruments();
        instrumentsMap = new Map();
        for (const inst of instruments) {
          instrumentsMap.set(inst.ticker, {
            name: inst.name,
            currencyCode: inst.currencyCode,
            isin: inst.isin
          });
        }
        console.log(`[Main] Loaded metadata for ${instruments.length} instruments`);
      } catch (err) {
        console.warn('[Main] Could not fetch instruments metadata:', err.message);
        instrumentsMap = new Map(); // Empty map to prevent retrying
      }
    }

    // Add company names to positions
    const positionsWithNames = positions.map(pos => {
      const meta = instrumentsMap.get(pos.ticker);
      return {
        ...pos,
        companyName: meta?.name || null,
        instrumentCurrency: meta?.currencyCode || null
      };
    });

    // Calculate daily changes (adds dailyChangePercent to each position)
    const positionsWithChanges = dataStore.calculateDailyChanges(positionsWithNames);

    // Save snapshot for historical tracking
    dataStore.saveSnapshot(positions);

    // Check for alerts
    const alerts = alertManager.checkAlerts(positionsWithChanges);

    // Also check for multi-day downtrends
    const downtrends = dataStore.detectDowntrends(5, -10);
    alertManager.checkDowntrendAlerts(downtrends);

    // Send data to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.POSITIONS_UPDATE, {
        positions: positionsWithChanges,
        cash,
        alerts,
        downtrends,
        lastUpdate: new Date().toISOString()
      });
    }

    console.log(`[Main] Data refreshed. ${positions.length} positions loaded.`);

  } catch (error) {
    console.error('[Main] Error refreshing data:', error.message);

    // Send error to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.ERROR, {
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
}


/**
 * Start the polling interval to refresh data periodically
 */
function startPolling() {
  const intervalMs = config.polling?.intervalMs || DEFAULTS.POLLING_INTERVAL_MS;

  console.log(`[Main] Starting data polling every ${intervalMs / 1000} seconds`);

  // Clear any existing interval
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  // Set up new interval
  pollingInterval = setInterval(refreshData, intervalMs);
}


/**
 * Stop the polling interval
 */
function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[Main] Polling stopped');
  }
}


// =============================================================================
// IPC HANDLERS
// =============================================================================
//
// These handle messages from the renderer process (UI).
// The renderer sends requests, and we respond with data.

/**
 * Set up IPC message handlers
 */
function setupIpcHandlers() {

  // Handle request to refresh data immediately
  ipcMain.on(IPC_CHANNELS.REQUEST_REFRESH, async () => {
    console.log('[Main] Manual refresh requested');
    await refreshData();
  });

  // Handle request for initial data load
  ipcMain.on(IPC_CHANNELS.REQUEST_POSITIONS, async () => {
    console.log('[Main] Positions requested');
    await refreshData();
  });

  // Handle request for account summary
  ipcMain.on(IPC_CHANNELS.REQUEST_ACCOUNT_SUMMARY, async () => {
    try {
      const summary = await apiClient.getFullSummary();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ACCOUNT_SUMMARY_UPDATE, summary);
      }
    } catch (error) {
      console.error('[Main] Error fetching account summary:', error.message);
    }
  });
}


// =============================================================================
// APPLICATION LIFECYCLE
// =============================================================================

/**
 * Initialize the application
 *
 * Called when Electron has finished starting up.
 */
async function initialize() {
  console.log('[Main] Trading 212 Portfolio Viewer starting...');

  try {
    // Load configuration
    config = loadConfig();
    console.log('[Main] Configuration loaded');

    // Initialize services
    apiClient = new Trading212Client(
      config.api.key,
      config.api.secret,
      config.api.environment || 'live'
    );

    dataStore = new DataStore();

    alertManager = new AlertManager({
      dailyLossThreshold: config.alerts?.dailyLossThreshold ?? DEFAULTS.DAILY_LOSS_ALERT_THRESHOLD,
      dailyGainThreshold: config.alerts?.dailyGainThreshold ?? DEFAULTS.DAILY_GAIN_ALERT_THRESHOLD
    });

    // Test API connection
    console.log('[Main] Testing API connection...');
    await apiClient.testConnection();
    console.log('[Main] API connection successful');

    // Set up IPC handlers
    setupIpcHandlers();

    // Create the window
    createWindow();

    // Do initial data fetch
    await refreshData();

    // Start polling for updates
    startPolling();

  } catch (error) {
    console.error('[Main] Initialization failed:', error.message);

    // Show error dialog
    const { dialog } = require('electron');
    dialog.showErrorBox('Startup Error', error.message);

    app.quit();
  }
}


// =============================================================================
// ELECTRON APP EVENTS
// =============================================================================

// Called when Electron has finished initialization
app.whenReady().then(initialize);

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  stopPolling();

  // On macOS, apps typically stay open until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// On macOS, re-create window when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Clean up before quitting
app.on('before-quit', () => {
  stopPolling();
});
