#!/bin/bash
set -e

echo "Starting Puppeteer microservice build..."

# Update package lists
apt-get update

# Install Chrome dependencies
echo "Installing Chrome dependencies..."
apt-get install -y wget gnupg ca-certificates

# Add Google Chrome repository
echo "Adding Chrome repository..."
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list

# Update package lists again
apt-get update

# Install Google Chrome
echo "Installing Google Chrome..."
apt-get install -y google-chrome-stable

# Verify Chrome installation
echo "Verifying Chrome installation..."
google-chrome --version

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install

echo "Build completed successfully!"
