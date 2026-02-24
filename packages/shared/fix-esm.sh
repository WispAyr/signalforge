#!/bin/bash
# Fix ESM bare specifiers in compiled JS — adds .js extensions
cd "$(dirname "$0")/dist"
for f in *.js; do
  sed -i '' "s|from '\./\([^'.]*\)'|from './\1.js'|g" "$f" 2>/dev/null
done
echo "✅ Fixed ESM extensions in shared/dist"
