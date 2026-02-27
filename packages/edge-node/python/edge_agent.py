#!/usr/bin/env python3
"""
SignalForge Edge Agent (Python) — Lightweight bridge for signal-edge-1.

Subscribes to local MQTT (mesh-mapper MMIP events) and forwards them
to SignalForge hub via WebSocket. Also receives commands from hub and
publishes them to local MQTT for mesh-mapper to act on.

Designed for Raspberry Pi with no Node.js requirement.
"""

import json
import os
import platform
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone

try:
    import websocket
except ImportError:
    print("Installing websocket-client...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websocket-client"])
    import websocket

try:
    import paho.mqtt.client as mqtt
except ImportError:
    print("Installing paho-mqtt...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "paho-mqtt"])
    import paho.mqtt.client as mqtt

# ============================================================================
# Configuration
# ============================================================================
SERVER_URL = os.environ.get("SIGNALFORGE_SERVER", "ws://192.168.195.33:3401/ws")
NODE_NAME = os.environ.get("NODE_NAME", "Signal Edge 1")
NODE_ID = os.environ.get("NODE_ID", "signal-edge-1")
MQTT_BROKER = os.environ.get("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPICS = [
    ("mmip/signal-edge-1/#", 0),
    ("mesh-mapper/#", 0),
]
HEARTBEAT_INTERVAL = 30
TELEMETRY_INTERVAL = 60
RECONNECT_BASE = 2
RECONNECT_MAX = 60

# Location — Ayr default (overridden by GPS if available)
DEFAULT_LAT = float(os.environ.get("LATITUDE", "55.4580"))
DEFAULT_LON = float(os.environ.get("LONGITUDE", "-4.6290"))
DEFAULT_ALT = float(os.environ.get("ALTITUDE", "50"))


# ============================================================================
# System Info
# ============================================================================
def get_system_info():
    """Collect system telemetry."""
    info = {
        "platform": platform.system().lower(),
        "arch": platform.machine(),
        "cpuModel": "unknown",
        "cpuCores": os.cpu_count() or 1,
        "memoryTotal": 0,
        "memoryFree": 0,
        "uptime": 0,
        "loadAvg": list(os.getloadavg()) if hasattr(os, "getloadavg") else [0, 0, 0],
    }

    # CPU model
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Model") or line.startswith("model name"):
                    info["cpuModel"] = line.split(":")[1].strip()
                    break
    except Exception:
        pass

    # Memory
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    info["memoryTotal"] = int(line.split()[1]) * 1024
                elif line.startswith("MemAvailable"):
                    info["memoryFree"] = int(line.split()[1]) * 1024
    except Exception:
        pass

    # Uptime
    try:
        with open("/proc/uptime") as f:
            info["uptime"] = float(f.read().split()[0])
    except Exception:
        pass

    # Temperature
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            info["temperature"] = int(f.read().strip()) / 1000
    except Exception:
        pass

    return info


def get_network_info():
    """Get network interface info."""
    interfaces = []
    hostname = socket.gethostname()

    try:
        output = subprocess.check_output(
            ["ip", "-j", "addr"], encoding="utf-8", timeout=5
        )
        for iface in json.loads(output):
            name = iface.get("ifname", "")
            for addr_info in iface.get("addr_info", []):
                if addr_info.get("family") == "inet" and not addr_info.get("local", "").startswith("127."):
                    itype = "zerotier" if name.startswith("zt") else "wifi" if name.startswith("wl") else "ethernet" if name.startswith("eth") else "other"
                    interfaces.append({
                        "name": name,
                        "ip": addr_info["local"],
                        "mac": iface.get("address", ""),
                        "type": itype,
                    })
    except Exception:
        pass

    return {"interfaces": interfaces, "hostname": hostname}


def get_local_ip():
    """Get preferred local IP (ZeroTier preferred)."""
    try:
        output = subprocess.check_output(
            ["ip", "-j", "addr"], encoding="utf-8", timeout=5
        )
        for iface in json.loads(output):
            name = iface.get("ifname", "")
            if name.startswith("zt"):
                for addr_info in iface.get("addr_info", []):
                    if addr_info.get("family") == "inet":
                        return addr_info["local"]
    except Exception:
        pass
    return "0.0.0.0"


def detect_capabilities():
    """Detect available hardware and services."""
    caps = {
        "sdr": False,
        "gps": False,
        "hailo": False,
        "bluetooth": False,
        "mqtt": True,  # We're bridging MQTT
        "drone_detection": True,  # mesh-mapper handles this
    }

    # SDR
    try:
        subprocess.check_output(["rtl_test", "-t"], stderr=subprocess.STDOUT, timeout=5)
        caps["sdr"] = True
    except Exception:
        pass

    # GPS
    try:
        if os.path.exists("/dev/ttyACM2"):
            caps["gps"] = True
    except Exception:
        pass

    # Hailo
    try:
        subprocess.check_output(
            ["hailortcli", "fw-control", "identify"],
            stderr=subprocess.STDOUT, timeout=5,
        )
        caps["hailo"] = True
    except Exception:
        pass

    # Bluetooth (Sniffle)
    if os.path.exists("/dev/ttyUSB1"):
        caps["bluetooth"] = True

    return caps


# ============================================================================
# Edge Agent
# ============================================================================
class EdgeAgent:
    def __init__(self):
        self.ws = None
        self.mqtt_client = None
        self.connected = False
        self.reconnect_delay = RECONNECT_BASE
        self.shutdown_event = threading.Event()
        self.capabilities = detect_capabilities()
        self.location = {
            "latitude": DEFAULT_LAT,
            "longitude": DEFAULT_LON,
            "altitude": DEFAULT_ALT,
            "source": "manual",
        }

    # ── MQTT ──────────────────────────────────────────────────────────────
    def start_mqtt(self):
        """Connect to local MQTT and subscribe to mesh-mapper topics."""
        self.mqtt_client = mqtt.Client(client_id=f"signalforge-edge-{NODE_ID}")
        self.mqtt_client.on_connect = self._on_mqtt_connect
        self.mqtt_client.on_message = self._on_mqtt_message

        try:
            self.mqtt_client.connect(MQTT_BROKER, MQTT_PORT, 60)
            self.mqtt_client.loop_start()
            print(f"📡 MQTT connected to {MQTT_BROKER}:{MQTT_PORT}")
        except Exception as e:
            print(f"⚠️ MQTT connection failed: {e}")

    def _on_mqtt_connect(self, client, userdata, flags, rc, properties=None):
        print(f"📡 MQTT subscribed to {len(MQTT_TOPICS)} topics")
        client.subscribe(MQTT_TOPICS)

    def _on_mqtt_message(self, client, userdata, msg):
        """Forward MQTT messages to SignalForge hub."""
        if not self.connected or not self.ws:
            return

        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            # Wrap in SignalForge event format
            event = {
                "type": "edge_detection",
                "nodeId": NODE_ID,
                "timestamp": time.time() * 1000,
                "mqttTopic": msg.topic,
                "payload": payload,
            }

            # Classify based on topic
            if "drone" in msg.topic:
                event["detectionType"] = "drone"
            elif "aircraft" in msg.topic or "adsb" in msg.topic:
                event["detectionType"] = "aircraft"
            elif "vessel" in msg.topic or "ais" in msg.topic:
                event["detectionType"] = "vessel"
            elif "ble" in msg.topic or "bluetooth" in msg.topic:
                event["detectionType"] = "bluetooth"
            elif "lightning" in msg.topic:
                event["detectionType"] = "lightning"
            elif "aprs" in msg.topic:
                event["detectionType"] = "aprs"
            elif "alert" in msg.topic:
                event["detectionType"] = "alert"
            elif "status" in msg.topic:
                event["detectionType"] = "status"
            else:
                event["detectionType"] = "unknown"

            self.ws.send(json.dumps(event))
        except Exception as e:
            print(f"⚠️ Failed to forward MQTT message: {e}")

    # ── WebSocket ─────────────────────────────────────────────────────────
    def connect_ws(self):
        """Connect to SignalForge hub."""
        url = f"{SERVER_URL}?edge=true&nodeId={NODE_ID}"
        print(f"🔗 Connecting to {url}...")

        self.ws = websocket.WebSocketApp(
            url,
            on_open=self._on_ws_open,
            on_message=self._on_ws_message,
            on_close=self._on_ws_close,
            on_error=self._on_ws_error,
        )

        # Run in thread so we don't block
        ws_thread = threading.Thread(
            target=self.ws.run_forever,
            kwargs={"ping_interval": 30, "ping_timeout": 10},
            daemon=True,
        )
        ws_thread.start()

    def _on_ws_open(self, ws):
        print("✅ Connected to SignalForge hub")
        self.connected = True
        self.reconnect_delay = RECONNECT_BASE
        self._register()
        self._start_heartbeat()
        self._start_telemetry()

    def _on_ws_message(self, ws, message):
        try:
            msg = json.loads(message)
            self._handle_command(msg)
        except Exception as e:
            print(f"⚠️ Failed to handle message: {e}")

    def _on_ws_close(self, ws, close_status_code, close_msg):
        print(f"❌ Disconnected (code: {close_status_code})")
        self.connected = False
        self._schedule_reconnect()

    def _on_ws_error(self, ws, error):
        print(f"⚠️ WebSocket error: {error}")

    def _register(self):
        """Register with SignalForge hub."""
        cap_list = ["telemetry", "mqtt-bridge", "drone-detection"]
        if self.capabilities["sdr"]:
            cap_list.extend(["sdr", "spectrum"])
        if self.capabilities["gps"]:
            cap_list.append("gps")
        if self.capabilities["hailo"]:
            cap_list.extend(["hailo", "yolo"])
        if self.capabilities["bluetooth"]:
            cap_list.append("bluetooth-sniffer")

        info = {
            "name": NODE_NAME,
            "hostname": socket.gethostname(),
            "ip": get_local_ip(),
            "system": get_system_info(),
            "network": get_network_info(),
            "sdrDevices": [],
            "capabilities": cap_list,
            "hasGPS": self.capabilities["gps"],
            "hasHailo": self.capabilities["hailo"],
            "location": self.location,
            "services": {
                "meshMapper": True,
                "mosquitto": True,
                "sniffle": self.capabilities["bluetooth"],
            },
            "version": "1.0.0",
        }

        self._send({"type": "edge_register", "info": info})
        print(f"📡 Registered as: {NODE_NAME} ({NODE_ID})")
        print(f"   Capabilities: {', '.join(cap_list)}")

    def _start_heartbeat(self):
        def heartbeat_loop():
            while not self.shutdown_event.is_set() and self.connected:
                self._send({
                    "type": "edge_heartbeat",
                    "heartbeat": {
                        "nodeId": NODE_ID,
                        "timestamp": time.time() * 1000,
                        "system": get_system_info(),
                        "sdrDevices": [],
                        "location": self.location,
                    },
                })
                self.shutdown_event.wait(HEARTBEAT_INTERVAL)

        threading.Thread(target=heartbeat_loop, daemon=True).start()

    def _start_telemetry(self):
        def telemetry_loop():
            while not self.shutdown_event.is_set() and self.connected:
                self._send({
                    "type": "edge_telemetry",
                    "telemetry": {
                        "nodeId": NODE_ID,
                        "timestamp": time.time() * 1000,
                        "system": get_system_info(),
                        "network": get_network_info(),
                        "gps": self.location,
                        "capabilities": self.capabilities,
                    },
                })
                self.shutdown_event.wait(TELEMETRY_INTERVAL)

        threading.Thread(target=telemetry_loop, daemon=True).start()

    def _handle_command(self, msg):
        """Handle commands from SignalForge hub."""
        if msg.get("type") != "edge_command":
            return

        cmd = msg.get("command", {})
        cmd_type = cmd.get("type", "")
        cmd_id = cmd.get("id", "")
        params = cmd.get("params", {})

        print(f"📥 Command [{cmd_id}]: {cmd_type} {params}")

        result = None
        success = True

        try:
            if cmd_type == "get_status":
                result = {
                    "system": get_system_info(),
                    "network": get_network_info(),
                    "gps": self.location,
                    "capabilities": self.capabilities,
                }

            elif cmd_type == "mqtt_publish":
                # Publish a message to local MQTT
                topic = params.get("topic", "")
                payload = params.get("payload", {})
                if self.mqtt_client and topic:
                    self.mqtt_client.publish(topic, json.dumps(payload))
                    result = {"published": True, "topic": topic}
                else:
                    success = False
                    result = {"error": "No MQTT client or missing topic"}

            elif cmd_type == "restart_mesh_mapper":
                subprocess.run(["sudo", "systemctl", "restart", "drone-mapper"], timeout=10)
                result = {"restarted": True}

            elif cmd_type == "get_mesh_mapper_status":
                output = subprocess.check_output(
                    ["systemctl", "is-active", "drone-mapper"],
                    encoding="utf-8", timeout=5,
                ).strip()
                result = {"status": output}

            elif cmd_type == "reboot":
                print("🔄 Reboot requested!")
                result = {"rebooting": True}
                self._send({
                    "type": "edge_command_result",
                    "commandId": cmd_id,
                    "success": True,
                    "result": result,
                })
                time.sleep(2)
                subprocess.run(["sudo", "reboot"])
                return

            elif cmd_type == "update_location":
                self.location = {
                    "latitude": params.get("latitude", self.location["latitude"]),
                    "longitude": params.get("longitude", self.location["longitude"]),
                    "altitude": params.get("altitude", self.location["altitude"]),
                    "source": "remote",
                }
                result = {"location": self.location}

            elif cmd_type == "set_ble_config":
                # Update BLE config and restart mesh-mapper
                config_path = os.path.expanduser("~/mesh-mapper/ble_config.json")
                with open(config_path, "r") as f:
                    config = json.load(f)
                config.update(params)
                with open(config_path, "w") as f:
                    json.dump(config, f, indent=4)
                result = {"config_updated": True}

            else:
                success = False
                result = {"error": f"Unknown command: {cmd_type}"}

        except Exception as e:
            success = False
            result = {"error": str(e)}

        self._send({
            "type": "edge_command_result",
            "commandId": cmd_id,
            "success": success,
            "result": result,
        })

    def _send(self, data):
        if self.ws and self.connected:
            try:
                self.ws.send(json.dumps(data))
            except Exception:
                pass

    def _schedule_reconnect(self):
        if self.shutdown_event.is_set():
            return
        print(f"🔄 Reconnecting in {self.reconnect_delay}s...")
        time.sleep(self.reconnect_delay)
        self.reconnect_delay = min(self.reconnect_delay * 2, RECONNECT_MAX)
        if not self.shutdown_event.is_set():
            self.connect_ws()

    # ── Main ──────────────────────────────────────────────────────────────
    def run(self):
        print(f"""
  📡 ╔═══════════════════════════════════════╗
  📡 ║  SignalForge Edge Agent (Python)      ║
  📡 ╠═══════════════════════════════════════╣
  📡 ║  Node:   {NODE_NAME:<28s}║
  📡 ║  ID:     {NODE_ID:<28s}║
  📡 ║  Hub:    {SERVER_URL:<28s}║
  📡 ║  MQTT:   {MQTT_BROKER}:{MQTT_PORT:<22}║
  📡 ╚═══════════════════════════════════════╝
        """)

        print("🔍 Capabilities:")
        for k, v in self.capabilities.items():
            print(f"   {k}: {'✅' if v else '❌'}")

        self.start_mqtt()
        self.connect_ws()

        try:
            while not self.shutdown_event.is_set():
                self.shutdown_event.wait(1)
        except KeyboardInterrupt:
            print("\n🛑 Shutting down...")
            self.shutdown_event.set()
            if self.mqtt_client:
                self.mqtt_client.loop_stop()
            if self.ws:
                self.ws.close()


if __name__ == "__main__":
    agent = EdgeAgent()
    agent.run()
