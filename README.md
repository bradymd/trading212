# Trading 212 Portfolio Viewer

A **read-only** desktop application for viewing your Trading 212 Stocks & Shares ISA portfolio.

## Features

- **Portfolio Overview**: See all your positions at a glance
- **Daily Gainers/Losers**: Positions sorted by daily performance
- **Account Summary**: Total value, cash, invested amount, profit/loss
- **Desktop Alerts**: Notifications when stocks move significantly
- **Downtrend Detection**: Warnings for stocks declining over multiple days
- **Local History**: Tracks daily snapshots for trend analysis

## Security

This application is **intentionally read-only**:

- ✅ View positions and account balance
- ✅ View dividends and transaction history
- ❌ **Cannot** place orders or trade
- ❌ **Cannot** transfer money
- ❌ **Cannot** modify your account

The code does not include any trading endpoints. Even if credentials were compromised, this application cannot be used to trade.

### Additional Security Tips

1. **Environment Variables**: API credentials are stored in `.env` file (git-ignored)
2. **IP Restriction**: In Trading 212 app, restrict your API key to your home IP address
3. **Separate Key**: Generate a dedicated API key just for this app
4. **File Permissions**: Run `chmod 600 .env` to restrict access

---

## Installation

### Prerequisites

- Node.js 18 or later (`node --version` to check)
- npm (`npm --version` to check)
- A Trading 212 Invest or Stocks & Shares ISA account

### Setup Steps

1. **Clone the repository**:

   ```bash
   git clone https://github.com/YOUR_USERNAME/trading212-viewer.git
   cd trading212-viewer
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Get your API credentials** from Trading 212:

   - Open the Trading 212 app on your phone
   - Go to **Settings** → **API (Beta)**
   - Tap **Generate API Key**
   - Enable permissions: **Account data**, **Portfolio**, etc. (read-only permissions)
   - Copy the **API Key** and **API Secret**

4. **Create your `.env` file**:

   ```bash
   cp .env.example .env
   ```

5. **Edit `.env`** with your credentials:

   ```bash
   nano .env
   ```

   ```
   TRADING212_API_KEY=your_api_key_here
   TRADING212_API_SECRET=your_api_secret_here
   TRADING212_ENVIRONMENT=live
   ```

6. **Secure the file**:

   ```bash
   chmod 600 .env
   ```

7. **Run the application**:

   ```bash
   npm start
   ```

---

## Configuration

Edit `config/config.json` to customize the app:

```json
{
  "api": {
    "key": "your-api-key",
    "secret": "your-api-secret",
    "environment": "live"
  },
  "polling": {
    "intervalMs": 60000
  },
  "alerts": {
    "dailyLossThreshold": -5,
    "dailyGainThreshold": 10
  }
}
```

### Options

| Setting | Description | Default |
|---------|-------------|---------|
| `api.environment` | `"live"` for real account, `"demo"` for paper trading | `"live"` |
| `polling.intervalMs` | How often to refresh data (milliseconds) | `60000` (1 minute) |
| `alerts.dailyLossThreshold` | Alert when a stock drops this % in a day | `-5` |
| `alerts.dailyGainThreshold` | Alert when a stock gains this % in a day | `10` |

Set alert thresholds to `null` to disable that alert type.

---

## Project Structure

```
trading212-viewer/
├── README.md                 # This file
├── package.json              # Node.js dependencies and scripts
├── config/
│   ├── config.example.json   # Template config (copy to config.json)
│   └── config.json           # Your config (git-ignored, contains secrets)
├── src/
│   ├── main/                 # Electron main process (Node.js)
│   │   ├── main.js           # Application entry point
│   │   ├── preload.js        # Secure bridge between main and renderer
│   │   ├── api/
│   │   │   └── trading212.js # Trading 212 API client (READ-ONLY)
│   │   ├── store/
│   │   │   └── dataStore.js  # Local data storage for history
│   │   └── alerts/
│   │       └── alerts.js     # Alert detection and notifications
│   ├── renderer/             # Electron renderer process (browser window)
│   │   ├── index.html        # UI structure
│   │   ├── renderer.js       # UI logic
│   │   └── styles.css        # Styling
│   └── shared/
│       └── constants.js      # Shared constants (API URLs, IPC channels)
└── .gitignore
```

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Main Process (Node.js)                                             │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │  trading212.js  │   │   dataStore.js  │   │    alerts.js    │   │
│  │  API Client     │   │   Local Storage │   │  Alert Manager  │   │
│  │  (READ-ONLY)    │   │   (History)     │   │  (Notifications)│   │
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘   │
│           │                     │                     │             │
│           └─────────────────────┴─────────────────────┘             │
│                                 │                                   │
│                            main.js                                  │
│                         (orchestrates)                              │
│                                 │                                   │
│                            preload.js                               │
│                        (secure IPC bridge)                          │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │ IPC
┌─────────────────────────────────┼───────────────────────────────────┐
│  Renderer Process (Browser)     │                                   │
│                                 ▼                                   │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  index.html + renderer.js + styles.css                       │  │
│  │  - Displays positions table                                  │  │
│  │  - Shows account summary                                     │  │
│  │  - Handles sorting and user interactions                     │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Development

### Running in Development Mode

```bash
npm run dev
```

This opens DevTools automatically for debugging.

### Key Files to Understand

1. **`src/main/main.js`** - Entry point, sets up the app
2. **`src/main/api/trading212.js`** - All API calls (read-only)
3. **`src/renderer/renderer.js`** - UI logic and rendering
4. **`src/shared/constants.js`** - API endpoints and settings

### Adding Features

1. **New API endpoint**: Add to `trading212.js` (GET requests only!)
2. **New UI section**: Add HTML to `index.html`, logic to `renderer.js`
3. **New IPC channel**: Add to `constants.js`, handle in `main.js` and `preload.js`

---

## Troubleshooting

### "Configuration file not found"

Create `config/config.json` by copying the example:

```bash
cp config/config.example.json config/config.json
```

### "API key not configured"

Edit `config/config.json` and replace the placeholder values with your real API credentials.

### "Connection test failed" / API errors

- Check your API key and secret are correct
- Ensure your Trading 212 account has API access enabled
- If using IP restriction, check you're on the allowed IP
- The API only works with Invest and Stocks & Shares ISA accounts (not CFD)

### No daily change data showing

Daily change calculation requires yesterday's data. The app will start tracking history from the first run, so daily changes will appear after running for more than a day.

### Positions not loading

- Check the console for errors (View → Toggle Developer Tools)
- Verify your API credentials
- Trading 212 API has rate limits - wait a moment and refresh

---

## License

MIT - Use freely, but this is not financial software. No warranties provided.

---

## Credits

Built with:
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [Trading 212 API](https://docs.trading212.com/api) - Data source
- [electron-store](https://github.com/sindresorhus/electron-store) - Local storage
