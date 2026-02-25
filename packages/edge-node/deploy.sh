#!/bin/bash
# ============================================================================
# SignalForge Edge Node — Deploy to Raspberry Pi
# Usage: ./deploy.sh <pi-ip> [user] [server-url]
# Example: ./deploy.sh 192.168.195.238 pi ws://192.168.195.33:3401/ws
# ============================================================================
set -e

PI_HOST="${1:?Usage: $0 <pi-ip> [user] [server-url]}"
PI_USER="${2:-pi}"
SERVER_URL="${3:-ws://192.168.195.33:3401/ws}"
DEPLOY_DIR="/home/${PI_USER}/signalforge-edge"

echo "📡 SignalForge Edge Node Deployment"
echo "   Target: ${PI_USER}@${PI_HOST}"
echo "   Server: ${SERVER_URL}"
echo "   Dir:    ${DEPLOY_DIR}"
echo ""

# Build locally first
echo "🔨 Building..."
npm run build

# Create remote directory
echo "📂 Creating remote directory..."
ssh "${PI_USER}@${PI_HOST}" "mkdir -p ${DEPLOY_DIR}"

# Copy files
echo "📦 Copying files..."
rsync -avz --delete \
  --exclude node_modules \
  --exclude .turbo \
  --exclude src \
  --exclude tsconfig.json \
  ./ "${PI_USER}@${PI_HOST}:${DEPLOY_DIR}/"

# Install deps and start
echo "🔧 Installing dependencies..."
ssh "${PI_USER}@${PI_HOST}" "cd ${DEPLOY_DIR} && npm install --production"

# Setup PM2
echo "🚀 Starting with PM2..."
ssh "${PI_USER}@${PI_HOST}" bash -s <<EOF
  cd ${DEPLOY_DIR}
  
  # Install PM2 if not present
  which pm2 >/dev/null 2>&1 || sudo npm install -g pm2
  
  # Set environment
  export SIGNALFORGE_SERVER="${SERVER_URL}"
  export NODE_NAME="\$(hostname)"
  
  # Stop existing instance
  pm2 delete signalforge-edge 2>/dev/null || true
  
  # Start
  pm2 start ecosystem.config.cjs
  
  # Save and setup startup
  pm2 save
  pm2 startup 2>/dev/null || true
  
  echo ""
  echo "✅ Edge node deployed and running!"
  pm2 status signalforge-edge
EOF

echo ""
echo "✅ Deployment complete!"
echo "   Logs: ssh ${PI_USER}@${PI_HOST} 'pm2 logs signalforge-edge'"
