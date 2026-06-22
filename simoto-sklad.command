#!/bin/bash
# Self-fix: ensure executable bit for future double-click launches
[ -x "$0" ] || chmod +x "$0" 2>/dev/null

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR" || exit 1

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo "==============================================="
echo "   SiMOTO-Sklad Launcher"
echo "==============================================="
echo ""

if ! command -v node &>/dev/null; then
    echo -e "${RED}[X] Node.js not found!${NC}"
    echo "Install from https://nodejs.org"
    read -rp "Press Enter to exit..."
    exit 1
fi
echo -e "${GREEN}[OK] Node.js found${NC}"

if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}[!] Installing dependencies...${NC}"
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[X] npm install failed!${NC}"
        read -rp "Press Enter to exit..."
        exit 1
    fi
    echo -e "${GREEN}[OK] Dependencies installed${NC}"
else
    echo -e "${GREEN}[OK] Dependencies ready${NC}"
fi

if [ ! -f ".env" ]; then
    echo "GH_TOKEN=" > .env
    echo -e "${GREEN}[OK] Created .env${NC}"
fi

mkdir -p logs

curver=$(node -p "require('./package.json').version")
echo -e "${CYAN}[i] Current version: $curver${NC}"

echo ""
echo -e "${CYAN}[i] Checking for updates...${NC}"
node scripts/check-update.js "$curver" > /tmp/ver_check.txt 2>&1

if [ -f /tmp/ver_check.txt ] && grep -q "New version available" /tmp/ver_check.txt; then
    new_tag=$(grep "TAG_NAME" /tmp/ver_check.txt | cut -d= -f2)
    echo ""
    echo -e "${GREEN}[i] Update recommended${NC}"
    read -rp "Update to $new_tag? [Y/n]: " update_choice

    if [ "$update_choice" != "n" ] && [ "$update_choice" != "N" ] && [ "$update_choice" != "no" ] && [ "$update_choice" != "NO" ]; then
        rm -f /tmp/ver_check.txt
        echo ""
        echo -e "${CYAN}[i] Updating to version $new_tag...${NC}"
        node scripts/update.js "$new_tag"
        if [ $? -ne 0 ]; then
            echo -e "${RED}[X] Update failed!${NC}"
            read -rp "Press Enter to exit..."
            exit 1
        fi
        echo -e "${GREEN}[OK] Updated! Restarting...${NC}"
        exec "$0"
    else
        echo -e "${CYAN}[i] Update skipped. Starting current version...${NC}"
    fi
else
    [ -f /tmp/ver_check.txt ] && rm -f /tmp/ver_check.txt
    echo -e "${CYAN}[i] No updates available.${NC}"
fi

if [ ! -f "cert/key.pem" ]; then
    echo -e "${CYAN}[i] Generating HTTPS certificate for camera...${NC}"
    mkdir -p cert
    openssl req -x509 -newkey rsa:2048 -keyout cert/key.pem -out cert/cert.pem -days 3650 -nodes -subj "/CN=localhost" 2>/dev/null
    if [ $? -eq 0 ] && [ -f "cert/key.pem" ] && [ -f "cert/cert.pem" ]; then
        echo -e "${GREEN}[OK] HTTPS certificate generated${NC}"
    else
        echo -e "${YELLOW}[!] SSL cert generation failed — install openssl or mkcert${NC}"
    fi
fi

local_ip=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
if [ -n "$local_ip" ]; then
    echo -e "${CYAN}[i] HTTPS for camera: https://$local_ip:3443${NC}"
fi

echo ""
echo -e "${CYAN}[i] Starting server...${NC}"
open http://localhost:3000
node server.js

echo ""
echo -e "${YELLOW}[OK] Server stopped${NC}"
read -rp "Press Enter to exit..."
