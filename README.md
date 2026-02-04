# Trading 212 Portfolio Viewer

A **read-only** desktop application for viewing your Trading 212 Stocks & Shares ISA portfolio.

## Quick Install (Linux)

Download and run the latest AppImage:

```bash
curl -L https://github.com/bradymd/trading212/releases/latest/download/Trading212-Viewer.AppImage -o Trading212-Viewer.AppImage
chmod +x Trading212-Viewer.AppImage
./Trading212-Viewer.AppImage
```

## Setup

### 1. Get your API credentials from Trading 212

- Open the Trading 212 app on your phone
- Go to **Settings** > **API (Beta)**
- Tap **Generate API Key**
- Enable permissions: **Account data**, **Portfolio** (read-only permissions only)
- Copy the **API Key** and **API Secret**

### 2. Create your credentials file

The AppImage looks for credentials at `~/.config/trading212-viewer/.env`

```bash
mkdir -p ~/.config/trading212-viewer
nano ~/.config/trading212-viewer/.env
```

Add your credentials:

```
TRADING212_API_KEY=your_api_key_here
TRADING212_API_SECRET=your_api_secret_here
TRADING212_ENVIRONMENT=live
```

Secure the file:

```bash
chmod 600 ~/.config/trading212-viewer/.env
```

### 3. Run the app

```bash
./Trading212-Viewer.AppImage
```

The app will auto-update when new versions are released (asks permission first).

---

## Features

- **Portfolio Overview**: See all your positions at a glance
- **Daily Gainers/Losers**: Positions sorted by daily performance
- **Account Summary**: Total value, cash, invested amount, profit/loss
- **Company Names**: Hover over ticker symbols to see full company names
- **Desktop Alerts**: Notifications when stocks move significantly
- **Downtrend Detection**: Warnings for stocks declining over multiple days
- **Local History**: Tracks daily snapshots for trend analysis
- **Auto-Updates**: Notifies you when new versions are available

---

## Security

This application is **intentionally read-only**:

- View positions and account balance
- View dividends and transaction history
- **Cannot** place orders or trade
- **Cannot** transfer money
- **Cannot** modify your account

The code does not include any trading endpoints. Even if credentials were compromised, this application cannot be used to trade.

### Security Tips

1. **Separate Key**: Generate a dedicated API key just for this app
2. **IP Restriction**: In Trading 212 app, restrict your API key to your home IP address
3. **File Permissions**: The `chmod 600` command above restricts access to your user only

---

## Configuration (Optional)

Create `~/.config/trading212-viewer/config.json` to customize behaviour:

```json
{
  "polling": {
    "intervalMs": 3600000
  },
  "alerts": {
    "dailyLossThreshold": -5,
    "dailyGainThreshold": 10
  }
}
```

| Setting | Description | Default |
|---------|-------------|---------|
| `polling.intervalMs` | How often to refresh data (milliseconds) | `3600000` (1 hour) |
| `alerts.dailyLossThreshold` | Alert when a stock drops this % in a day | `-5` |
| `alerts.dailyGainThreshold` | Alert when a stock gains this % in a day | `10` |

---

## Troubleshooting

### "TRADING212_API_KEY environment variable not set"

Create the `.env` file at `~/.config/trading212-viewer/.env` with your credentials (see Setup above).

### "Connection failed" / API errors

- Check your API key and secret are correct
- Ensure your Trading 212 account has API access enabled
- If using IP restriction, check you're connecting from the allowed IP
- The API only works with Invest and Stocks & Shares ISA accounts (not CFD)

### No daily change data showing

Daily change calculation requires yesterday's data. The app tracks history from first run, so daily changes appear after running for more than a day.

### Rate limit errors (429)

Trading 212 API has rate limits. The app caches data to minimise API calls. If you see rate limit errors, wait a few minutes before refreshing.

---

## For Developers

If you want to modify the code or run from source:

```bash
git clone https://github.com/bradymd/trading212.git
cd trading212
npm install

# Create .env in project root (for development)
cp .env.example .env
nano .env  # Add your credentials

# Run in development mode
npm run dev

# Or run normally
npm start

# Build AppImage
npm run build
```

When running from source, the app looks for `.env` in the project root (not `~/.config`).

---

## License

MIT - Use freely, but this is not financial software. No warranties provided.

---

## Credits

Built with:
- [Electron](https://www.electronjs.org/) - Desktop app framework
- [Trading 212 API](https://docs.trading212.com/api) - Data source
- [electron-store](https://github.com/sindresorhus/electron-store) - Local storage
- [electron-updater](https://www.electron.build/auto-update) - Auto-updates
