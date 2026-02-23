#!/bin/bash
# SignalForge Real Pager Decoder Pipeline
# rtl_fm → multimon-ng → POST to SignalForge API

FREQ="${PAGER_FREQ:-153.350M}"
SAMPLE_RATE="22050"
GAIN="${PAGER_GAIN:-49.6}"
DEVICE="${PAGER_DEVICE:-0}"
API_URL="http://localhost:3401/api/pager/messages"
LOGFILE="$HOME/operations/signalforge/pager-decoder.log"
RTL_FM="/opt/homebrew/bin/rtl_fm"
MULTIMON="/opt/homebrew/bin/multimon-ng"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOGFILE"; }

log "Starting pager decoder on ${FREQ}"

# Kill rtl_tcp if running (we need exclusive dongle access)
if pgrep -x rtl_tcp > /dev/null; then
    log "Killing rtl_tcp to free SDR dongle..."
    kill $(pgrep rtl_tcp)
    sleep 2
fi

post_message() {
    local proto="$1" addr="$2" func="$3" content="$4" baud="$5"
    local escaped_content
    escaped_content=$(echo "$content" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g')
    curl -s -m2 -X POST "$API_URL" \
        -H "Content-Type: application/json" \
        -d "{\"protocol\":\"${proto}\",\"capcode\":${addr},\"address\":${addr},\"function\":${func},\"content\":\"${escaped_content}\",\"baudRate\":${baud}}" \
        > /dev/null 2>&1 &
    log "${proto}${baud} Addr:${addr} Func:${func} \"${content:0:80}\""
}

# Parse multimon-ng output
parse_output() {
    while IFS= read -r line; do
        # POCSAG Alpha
        if [[ "$line" =~ ^POCSAG([0-9]+):\ Address:\ +([0-9]+)\ +Function:\ ([0-9]+)\ +Alpha:\ +(.*)$ ]]; then
            post_message "POCSAG" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" "${BASH_REMATCH[1]}"
        # POCSAG Numeric
        elif [[ "$line" =~ ^POCSAG([0-9]+):\ Address:\ +([0-9]+)\ +Function:\ ([0-9]+)\ +Numeric:\ +(.*)$ ]]; then
            post_message "POCSAG" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}" "${BASH_REMATCH[1]}"
        # POCSAG Tone-only
        elif [[ "$line" =~ ^POCSAG([0-9]+):\ Address:\ +([0-9]+)\ +Function:\ ([0-9]+)$ ]]; then
            post_message "POCSAG" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "" "${BASH_REMATCH[1]}"
        # FLEX
        elif [[ "$line" =~ ^FLEX ]]; then
            # FLEX format varies - capture address and message
            local addr msg
            addr=$(echo "$line" | grep -oP '\[\K[0-9]+' | head -1)
            msg=$(echo "$line" | sed 's/^FLEX[^|]*|//' | sed 's/^[^A-Za-z]*//')
            [ -n "$addr" ] && post_message "FLEX" "$addr" "0" "$msg" "1600"
        fi
    done
}

log "Starting pipeline: rtl_fm ${FREQ} → multimon-ng → SignalForge API"

# Main pipeline
"$RTL_FM" -f "$FREQ" -s "$SAMPLE_RATE" -g "$GAIN" -d "$DEVICE" -p 0 -l 0 - 2>>"$LOGFILE" | \
    "$MULTIMON" -a POCSAG512 -a POCSAG1200 -a POCSAG2400 -a FLEX -t raw /dev/stdin 2>/dev/null | \
    parse_output

log "Pipeline exited"
