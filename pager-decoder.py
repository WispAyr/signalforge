#!/usr/bin/env python3
"""SignalForge Real Pager Decoder Pipeline
rtl_fm → multimon-ng → HTTP POST to SignalForge API
Uses pty to force unbuffered multimon-ng output.
"""
import subprocess, os, pty, select, re, json, signal, sys, time
from urllib.request import Request, urlopen

API_URL = "http://localhost:3401/api/pager/messages"
FREQ = os.environ.get("PAGER_FREQ", "153.350M")
GAIN = os.environ.get("PAGER_GAIN", "49.6")
DEVICE = os.environ.get("PAGER_DEVICE", "0")
RTL_FM = "/opt/homebrew/bin/rtl_fm"
MULTIMON = "/opt/homebrew/bin/multimon-ng"
LOGFILE = os.path.expanduser("~/operations/signalforge/pager-decoder.log")

# Regex patterns for multimon-ng output
POCSAG_ALPHA = re.compile(r'^POCSAG(\d+): Address:\s+(\d+)\s+Function:\s+(\d)\s+Alpha:\s+(.*)')
POCSAG_NUMERIC = re.compile(r'^POCSAG(\d+): Address:\s+(\d+)\s+Function:\s+(\d)\s+Numeric:\s+(.*)')
POCSAG_TONE = re.compile(r'^POCSAG(\d+): Address:\s+(\d+)\s+Function:\s+(\d)\s*$')
FLEX_RE = re.compile(r'^FLEX.*\[(\d+)\]\s*(.*)')

msg_count = 0

def log(msg):
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOGFILE, 'a') as f:
        f.write(line + '\n')

def post_message(proto, addr, func, content, baud):
    global msg_count
    msg_count += 1
    data = json.dumps({
        "protocol": proto, "capcode": int(addr), "address": int(addr),
        "function": int(func), "content": content, "baudRate": int(baud)
    }).encode()
    try:
        req = Request(API_URL, data=data, headers={"Content-Type": "application/json"}, method="POST")
        urlopen(req, timeout=2)
        log(f"#{msg_count} {proto}{baud} Addr:{addr} Func:{func} \"{content[:80]}\"")
    except Exception as e:
        log(f"POST error: {e}")

def parse_line(line):
    line = line.strip()
    if not line:
        return
    m = POCSAG_ALPHA.match(line)
    if m:
        post_message("POCSAG", m.group(2), m.group(3), m.group(4), m.group(1))
        return
    m = POCSAG_NUMERIC.match(line)
    if m:
        post_message("POCSAG", m.group(2), m.group(3), m.group(4), m.group(1))
        return
    m = POCSAG_TONE.match(line)
    if m:
        post_message("POCSAG", m.group(2), m.group(3), "", m.group(1))
        return
    m = FLEX_RE.match(line)
    if m:
        post_message("FLEX", m.group(1), "0", m.group(2), "1600")
        return

def main():
    # Kill rtl_tcp if running
    os.system("pkill rtl_tcp 2>/dev/null")
    time.sleep(1)
    
    log(f"Starting pager decoder: {FREQ} gain={GAIN}")
    
    # Start rtl_fm
    rtl_fm = subprocess.Popen(
        [RTL_FM, "-f", FREQ, "-s", "22050", "-g", GAIN, "-d", DEVICE, "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    
    # Start multimon-ng with pty for unbuffered output
    master_fd, slave_fd = pty.openpty()
    multimon = subprocess.Popen(
        [MULTIMON, "-a", "POCSAG512", "-a", "POCSAG1200", "-a", "POCSAG2400", "-a", "FLEX", "-t", "raw", "/dev/stdin"],
        stdin=rtl_fm.stdout, stdout=slave_fd, stderr=slave_fd
    )
    os.close(slave_fd)
    
    log("Pipeline running")
    
    def cleanup(sig=None, frame=None):
        log("Shutting down...")
        multimon.terminate()
        rtl_fm.terminate()
        sys.exit(0)
    
    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)
    
    buf = ""
    while True:
        try:
            r, _, _ = select.select([master_fd], [], [], 1.0)
            if master_fd in r:
                data = os.read(master_fd, 4096).decode('utf-8', errors='replace')
                buf += data
                while '\n' in buf:
                    line, buf = buf.split('\n', 1)
                    parse_line(line)
        except OSError:
            break
    
    cleanup()

if __name__ == "__main__":
    main()
