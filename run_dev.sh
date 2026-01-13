#!/bin/bash

# Get the absolute path of the current directory
BASE_DIR=$(pwd)

echo "Starting 'public' application..."
osascript -e "tell application \"Terminal\" to do script \"cd '$BASE_DIR/public' && npm start\""

echo "Starting 'bank' application..."
osascript -e "tell application \"Terminal\" to do script \"cd '$BASE_DIR/bank' && npm start\""

echo "Both applications have been launched in separate terminal windows."
