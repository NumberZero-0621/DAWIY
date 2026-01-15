#!/bin/bash

echo "Starting DAWIY Development Environment..."

# Install root dependencies if concurrently is missing
if [ ! -f "node_modules/.bin/concurrently" ]; then
    echo "Installing root dependencies..."
    sudo npm install
fi

# Install public dependencies if missing
if [ ! -d "public/node_modules" ]; then
    echo "Installing public dependencies..."
    cd public
    sudo npm install
    cd ..
fi

# Install bank dependencies if missing
if [ ! -d "bank/node_modules" ]; then
    echo "Installing bank dependencies..."
    cd bank
    sudo npm install
    cd ..
fi

# Run the integrated dev command
npm run dev
