#!/bin/bash
#
# ClaudeGrid systemd service installer
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(dirname "$SCRIPT_DIR")"
SERVICE_NAME="claudegrid"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Defaults
PORT="${CLAUDEGRID_PORT:-3333}"
USER="${CLAUDEGRID_USER:-$(whoami)}"
GROUP="${CLAUDEGRID_GROUP:-$(id -gn)}"

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

usage() {
    cat <<EOF
Usage: $0 [OPTIONS]

Install ClaudeGrid as a systemd service.

Options:
    -p, --port PORT     Set the server port (default: 3333)
    -u, --user USER     Set the service user (default: current user)
    -g, --group GROUP   Set the service group (default: current group)
    -h, --help          Show this help message

Environment variables:
    CLAUDEGRID_PORT     Server port (same as --port)
    CLAUDEGRID_USER     Service user (same as --user)
    CLAUDEGRID_GROUP    Service group (same as --group)

Examples:
    sudo $0
    sudo $0 --port 8080
    sudo $0 --user claudegrid --group claudegrid
EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -u|--user)
            USER="$2"
            shift 2
            ;;
        -g|--group)
            GROUP="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Check for root
if [[ $EUID -ne 0 ]]; then
    print_error "This script must be run as root (use sudo)"
    exit 1
fi

# Check if systemd is available
if ! command -v systemctl &> /dev/null; then
    print_error "systemd is not available on this system"
    exit 1
fi

# Find Node.js
NODE_PATH=$(which node 2>/dev/null || true)
if [[ -z "$NODE_PATH" ]]; then
    print_error "Node.js not found. Please install Node.js first."
    exit 1
fi

print_status "Installing ClaudeGrid systemd service..."
echo "  Install directory: $INSTALL_DIR"
echo "  Port: $PORT"
echo "  User: $USER"
echo "  Group: $GROUP"
echo "  Node.js: $NODE_PATH"
echo

# Check if service already exists
if [[ -f "$SERVICE_FILE" ]]; then
    print_warning "Service file already exists, stopping existing service..."
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
fi

# Verify user exists
if ! id "$USER" &>/dev/null; then
    print_error "User '$USER' does not exist"
    exit 1
fi

# Verify group exists
if ! getent group "$GROUP" &>/dev/null; then
    print_error "Group '$GROUP' does not exist"
    exit 1
fi

# Generate service file from template
print_status "Generating service file..."
sed -e "s|%INSTALL_DIR%|$INSTALL_DIR|g" \
    -e "s|%NODE_PATH%|$NODE_PATH|g" \
    -e "s|%PORT%|$PORT|g" \
    -e "s|%USER%|$USER|g" \
    -e "s|%GROUP%|$GROUP|g" \
    "$SCRIPT_DIR/claudegrid.service" > "$SERVICE_FILE"

# Set permissions
chmod 644 "$SERVICE_FILE"

# Reload systemd
print_status "Reloading systemd daemon..."
systemctl daemon-reload

# Enable service
print_status "Enabling service..."
systemctl enable "$SERVICE_NAME"

# Start service
print_status "Starting service..."
systemctl start "$SERVICE_NAME"

# Check status
sleep 1
if systemctl is-active --quiet "$SERVICE_NAME"; then
    print_status "ClaudeGrid service installed and running!"
    echo
    echo "Service commands:"
    echo "  sudo systemctl status $SERVICE_NAME   # Check status"
    echo "  sudo systemctl stop $SERVICE_NAME     # Stop service"
    echo "  sudo systemctl start $SERVICE_NAME    # Start service"
    echo "  sudo systemctl restart $SERVICE_NAME  # Restart service"
    echo "  sudo journalctl -u $SERVICE_NAME -f   # View logs"
    echo
    echo "ClaudeGrid is running at: http://localhost:$PORT"
else
    print_error "Service failed to start. Check logs with:"
    echo "  sudo journalctl -u $SERVICE_NAME -e"
    exit 1
fi
