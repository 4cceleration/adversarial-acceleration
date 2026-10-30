#!/bin/zsh
cd "$(dirname "$0")" || exit 1
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
open http://127.0.0.1:4317
npm start
