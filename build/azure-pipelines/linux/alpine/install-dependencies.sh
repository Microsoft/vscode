#!/usr/bin/env bash
set -e

echo "Installing remote dependencies"
(cd remote && rm -rf node_modules && yarn)