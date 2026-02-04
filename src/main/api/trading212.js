/**
 * trading212.js
 * =============
 * Trading 212 API Client - READ ONLY
 *
 * SECURITY NOTE:
 * This client intentionally ONLY implements read operations.
 * There are NO methods for placing orders, buying, or selling.
 * This is a deliberate security choice - even if credentials are compromised,
 * this code cannot be used to trade.
 *
 * API Documentation: https://docs.trading212.com/api
 *
 * Authentication:
 * Trading 212 uses HTTP Basic Authentication.
 * - Username: Your API Key
 * - Password: Your API Secret
 * - These are Base64 encoded and sent in the Authorization header
 */

const { API_BASE_URLS, API_ENDPOINTS } = require('../../shared/constants');

/**
 * Trading212Client
 *
 * A read-only client for the Trading 212 API.
 * Handles authentication and provides methods to fetch portfolio data.
 */
class Trading212Client {

  /**
   * Create a new Trading 212 API client
   *
   * @param {string} apiKey - Your Trading 212 API key
   * @param {string} apiSecret - Your Trading 212 API secret
   * @param {string} environment - Either 'demo' or 'live'
   */
  constructor(apiKey, apiSecret, environment = 'live') {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.environment = environment;

    // Select the correct base URL based on environment
    this.baseUrl = API_BASE_URLS[environment];

    if (!this.baseUrl) {
      throw new Error(`Invalid environment: ${environment}. Use 'demo' or 'live'.`);
    }

    // Pre-compute the authorization header (doesn't change per request)
    // Format: "Basic base64(apiKey:apiSecret)"
    const credentials = `${apiKey}:${apiSecret}`;
    const base64Credentials = Buffer.from(credentials).toString('base64');
    this.authHeader = `Basic ${base64Credentials}`;
  }


  // ===========================================================================
  // PRIVATE HELPER METHODS
  // ===========================================================================

  /**
   * Make an authenticated GET request to the Trading 212 API
   *
   * @param {string} endpoint - The API endpoint (e.g., '/equity/portfolio')
   * @returns {Promise<Object>} - The JSON response from the API
   * @throws {Error} - If the request fails or returns an error status
   *
   * @private
   */
  async _get(endpoint) {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json'
        }
      });

      // Check for HTTP errors
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
          `API request failed: ${response.status} ${response.statusText}\n` +
          `Endpoint: ${endpoint}\n` +
          `Response: ${errorBody}`
        );
      }

      // Parse and return JSON response
      return await response.json();

    } catch (error) {
      // Re-throw with more context
      if (error.message.includes('API request failed')) {
        throw error; // Already formatted
      }
      throw new Error(`Network error calling ${endpoint}: ${error.message}`);
    }
  }


  // ===========================================================================
  // PUBLIC API METHODS - ALL READ-ONLY
  // ===========================================================================

  /**
   * Get all open positions (your current holdings)
   *
   * Returns an array of positions, each containing:
   * - ticker: Stock symbol (e.g., "AAPL_US_EQ")
   * - quantity: Number of shares owned
   * - averagePrice: Your average purchase price
   * - currentPrice: Current market price
   * - ppl: Profit/Loss in currency
   * - fxPpl: Profit/Loss from currency exchange (if applicable)
   *
   * @returns {Promise<Array>} Array of position objects
   */
  async getPositions() {
    return await this._get(API_ENDPOINTS.POSITIONS);
  }


  /**
   * Get account cash balance
   *
   * Returns information about your cash:
   * - free: Cash available to invest
   * - total: Total cash in account
   * - ppl: Profit/loss from positions
   * - result: Overall result
   *
   * @returns {Promise<Object>} Cash balance information
   */
  async getCashBalance() {
    return await this._get(API_ENDPOINTS.ACCOUNT_CASH);
  }


  /**
   * Get account information
   *
   * Returns account metadata:
   * - id: Account ID
   * - currencyCode: Account currency (e.g., "GBP")
   *
   * @returns {Promise<Object>} Account information
   */
  async getAccountInfo() {
    return await this._get(API_ENDPOINTS.ACCOUNT_INFO);
  }


  /**
   * Get dividend history
   *
   * Returns array of dividend payments received.
   * Each dividend contains:
   * - ticker: Stock that paid the dividend
   * - amount: Dividend amount received
   * - paidOn: Date the dividend was paid
   *
   * @param {number} limit - Maximum number of records to return (default: 50)
   * @returns {Promise<Array>} Array of dividend records
   */
  async getDividends(limit = 50) {
    return await this._get(`${API_ENDPOINTS.DIVIDENDS}?limit=${limit}`);
  }


  /**
   * Get all available instruments with metadata
   *
   * Returns array of instruments, each containing:
   * - ticker: The Trading 212 ticker (e.g., "AAPL_US_EQ")
   * - name: Full company name (e.g., "Apple Inc")
   * - currencyCode: Currency the instrument trades in
   * - isin: International Securities Identification Number
   *
   * Note: This returns ALL instruments (thousands), so we cache this data.
   *
   * @returns {Promise<Array>} Array of instrument metadata
   */
  async getInstruments() {
    return await this._get(API_ENDPOINTS.INSTRUMENTS);
  }


  /**
   * Get a combined summary of account and positions
   *
   * This is a convenience method that fetches multiple endpoints
   * and combines them into a single summary object.
   *
   * @returns {Promise<Object>} Combined account summary
   */
  async getFullSummary() {
    // Fetch all data in parallel for speed
    const [positions, cash, accountInfo] = await Promise.all([
      this.getPositions(),
      this.getCashBalance(),
      this.getAccountInfo()
    ]);

    // Calculate totals from positions
    const totalInvested = positions.reduce((sum, pos) => {
      return sum + (pos.quantity * pos.averagePrice);
    }, 0);

    const totalCurrentValue = positions.reduce((sum, pos) => {
      return sum + (pos.quantity * pos.currentPrice);
    }, 0);

    const totalProfitLoss = positions.reduce((sum, pos) => {
      return sum + (pos.ppl || 0);
    }, 0);

    return {
      // Account info
      accountId: accountInfo.id,
      currency: accountInfo.currencyCode,

      // Cash
      cashFree: cash.free,
      cashTotal: cash.total,

      // Portfolio totals
      totalInvested,
      totalCurrentValue,
      totalProfitLoss,
      totalProfitLossPercent: totalInvested > 0
        ? ((totalCurrentValue - totalInvested) / totalInvested) * 100
        : 0,

      // Raw position data
      positions,
      positionCount: positions.length,

      // Timestamp
      fetchedAt: new Date().toISOString()
    };
  }


  /**
   * Test the API connection
   *
   * Makes a simple request to verify credentials are working.
   * Useful for validating configuration before starting the app.
   *
   * @returns {Promise<boolean>} True if connection successful
   * @throws {Error} If connection fails
   */
  async testConnection() {
    try {
      await this.getAccountInfo();
      return true;
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }
}


// =============================================================================
// EXPORTS
// =============================================================================

module.exports = { Trading212Client };
