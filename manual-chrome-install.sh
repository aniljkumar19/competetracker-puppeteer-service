#!/bin/bash
set -e

echo "Manual Chrome Installation for Render"
echo "==================================="

# Update package lists
apt-get update

# Install dependencies
apt-get install -y wget gnupg ca-certificates

# Add Google Chrome repository
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

# Update package lists with new repository
apt-get update

# Install Google Chrome
apt-get install -y google-chrome-stable

# Verify installation
google-chrome --version

# Install Node dependencies
npm install

echo "Chrome installation completed!"
