#!/bin/bash
# One-time, idempotent download for Vibechemy's optional on-device dictation model.
set -euo pipefail

MODEL_DIR="$HOME/.vibechemy/models/parakeet-tdt-0.6b-v3"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2"
SHA256="5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf"

if [ -f "$MODEL_DIR/encoder.int8.onnx" ] && [ -f "$MODEL_DIR/decoder.int8.onnx" ] \
   && [ -f "$MODEL_DIR/joiner.int8.onnx" ] && [ -f "$MODEL_DIR/tokens.txt" ]; then
  echo "Parakeet model already installed at $MODEL_DIR"
  exit 0
fi

DOWNLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT
echo "Downloading the Parakeet dictation model (about 600 MB installed)..."
curl -L --fail --progress-bar -o "$DOWNLOAD_DIR/model.tar.bz2" "$URL"

echo "Verifying checksum..."
echo "$SHA256  $DOWNLOAD_DIR/model.tar.bz2" | shasum -a 256 -c -

mkdir -p "$MODEL_DIR"
echo "Extracting..."
tar -xjf "$DOWNLOAD_DIR/model.tar.bz2" -C "$MODEL_DIR" --strip-components=1
echo "Installed at $MODEL_DIR"
ls -lh "$MODEL_DIR"
