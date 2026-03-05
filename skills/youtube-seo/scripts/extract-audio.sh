#!/bin/bash
# Extract audio from video for transcription
# Usage: extract-audio.sh input.mp4 [output.mp3]

set -e

INPUT="$1"
OUTPUT="${2:-${INPUT%.*}.mp3}"

if [ -z "$INPUT" ]; then
    echo "Usage: extract-audio.sh input.mp4 [output.mp3]"
    exit 1
fi

if [ ! -f "$INPUT" ]; then
    echo "Error: File not found: $INPUT"
    exit 1
fi

echo "🎵 Extracting audio from: $INPUT"
echo "📁 Output: $OUTPUT"

ffmpeg -i "$INPUT" -vn -acodec libmp3lame -q:a 2 "$OUTPUT" -y 2>/dev/null

echo "✅ Done: $OUTPUT"
