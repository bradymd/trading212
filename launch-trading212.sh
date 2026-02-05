#!/bin/sh
# Launcher script for Trading212 Viewer on systems that don't support sandboxing

# Set environment variable to disable Electron sandbox
export ELECTRON_DISABLE_SANDBOX=1

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run the AppImage from dist folder
exec "$SCRIPT_DIR/dist/Trading212-Viewer.AppImage" "$@"
