#!/bin/bash
#
# ClaudeGrid systemd service uninstaller
#

set -e

SERVICE_NAME="claudegrid"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[+]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[-]${NC} $1"
}

# Check for root
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run as root (use sudo)"
    exit 1
fi

# Check if service exists
if [[ ! -f "$SERVICE_FILE" ]]; then
    print_warning "Service file not found at $SERVICE_FILE"
    print_warning "ClaudeGrid service may not be installed"
    exit 0
fi

print_status "Uninstalling ClaudeGrid systemd service..."

# Stop service
print_status "Stopping service..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true

# Disable service
print_status "Disabling service..."
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

# Remove service file
print_status "Removing service file..."
rm -f "$SERVICE_FILE"

# Reload systemd
print_status "Reloading systemd daemon..."
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

print_status "ClaudeGrid service uninstalled successfully!"
echo
echo "Note: The application files have not been removed."
echo "You can still run ClaudeGrid manually with: npm start"
