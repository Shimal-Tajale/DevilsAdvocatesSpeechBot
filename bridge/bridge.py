"""
bridge.py: connects the FastAPI server to the Arduino Mega over USB.

The Mega has no WiFi, so this script runs on the laptop the robot is plugged
into. It listens to the server's event bus (WS /events) and turns each event
into one short text line on the serial port. It also reads lines coming back
from the Mega and forwards them to the server.

    server  --(WebSocket, JSON)-->  bridge.py  --(USB serial, text)-->  Mega
    server  <--(WebSocket, JSON)--  bridge.py  <--(USB serial, text)--  Mega

-----------------------------------------------------------------------------
FOR ABHIJAY: what robot.ino will receive and must send
-----------------------------------------------------------------------------
Serial settings: 9600 baud. Every message is ONE line ending in '\n'.
Read with Serial.readStringUntil('\n'), then check the first two characters.

  Laptop -> Arduino (you read these):
    S:idle         state: LED off / dim, head centered
    S:listening    state: LED blue, head faces the speaker
    S:thinking     state: LED yellow, head tilts
    S:speaking     state: LED green
    A:posture      alert: red LED + head shake + short beep
    A:hands        (same reaction for every alert; the word after A: says why,
    A:eye_contact   so you can vary it if there's time)
    A:too_fast
    A:too_quiet
    A:filler       (tier 1 add-on: also bump a filler counter on the LCD)
    L:<text>       show <text> on the LCD. Already cut to 16 chars max.
                   e.g. "L:Score: 68/100" or "L:Stand tall!"
    H:1 / H:0      raise / lower the arm servo (if you have a second servo)

  Arduino -> Laptop (you send these):
    P:1            someone stepped up (PIR / ultrasonic triggered).
                   Send it once per arrival, not every loop:
                   Serial.println("P:1");

  Anything you Serial.println() that isn't "P:1" is just printed in the
  bridge's console, so debug prints are fine and won't break anything.

Testing without the laptop: open the Arduino IDE Serial Monitor at 9600 baud,
line ending "Newline", and type the lines above (e.g. S:thinking).
CLOSE the Serial Monitor before running this bridge. Only one program can
use the COM port at a time.
-----------------------------------------------------------------------------

Run (from the repo root, with the server already running):
    python bridge/bridge.py              # uses SERIAL_PORT from .env (e.g. COM3)
    python bridge/bridge.py --dry-run    # no Arduino: prints the serial lines,
                                         # and typing P:1 + Enter fakes the sensor

Find the port: Arduino IDE > Tools > Port, or Device Manager > Ports (COM & LPT).
"""

import argparse
import asyncio
import json
import os
import sys
import time

from dotenv import load_dotenv
from websockets.asyncio.client import connect

# =============================================================================
# Settings
# =============================================================================

BAUD = 9600      # must match Serial.begin(9600) in robot.ino
LCD_WIDTH = 16   # the 16x2 LCD fits 16 characters per row

# The server sends events as JSON, e.g. {"type": "state", "value": "thinking"}.
# This table says which letter goes in front of each one on the serial line:
#   {"type": "state", "value": "thinking"}  ->  "S:thinking"
# Event types not listed here (feedback, metrics, user_present) are for the
# website only, so the robot never sees them.
PREFIXES = {"state": "S", "alert": "A", "lcd": "L"}

# The arm is the one exception: "raise"/"lower" become 1/0, so H:1 or H:0.
HAND = {"raise": "1", "lower": "0"}


# =============================================================================
# Translating events: server JSON -> one serial line
# =============================================================================

def to_serial_line(event: dict) -> str | None:
    """Turn one server event into the serial line the Arduino expects.

    Returns None for events the robot doesn't care about; those are skipped.
    Examples:
        {"type": "state", "value": "thinking"}  ->  "S:thinking"
        {"type": "alert", "value": "posture"}   ->  "A:posture"
        {"type": "lcd",   "value": "Score: 68"} ->  "L:Score: 68"
        {"type": "hand",  "value": "raise"}     ->  "H:1"
        {"type": "feedback", ...}               ->  None (website only)
    """
    kind, value = event.get("type"), event.get("value")

    # Arm servo: special case, because the value becomes a number.
    if kind == "hand" and value in HAND:
        return f"H:{HAND[value]}"

    # Not something the robot reacts to: skip it.
    if kind not in PREFIXES or value is None:
        return None

    text = str(value)
    # Cut LCD text here so the Arduino never has to deal with long strings.
    if kind == "lcd":
        text = text[:LCD_WIDTH]
    return f"{PREFIXES[kind]}:{text}"


# =============================================================================
# The serial port (or a fake one for testing)
# =============================================================================

class DryRunPort:
    """A pretend Arduino, used with --dry-run when no board is plugged in.

    It has the same two methods the real serial port has (write and readline),
    so the rest of the code can't tell the difference:
      - write():    prints the line instead of sending it over USB
      - readline(): reads what you type in the terminal, so typing P:1 + Enter
                    acts like the presence sensor firing
    """

    def write(self, data: bytes) -> None:
        print(f"  -> arduino  {data.decode().strip()}")

    def readline(self) -> bytes:
        return sys.stdin.readline().encode()


def open_port(dry_run: bool):
    """Open the USB serial connection to the Mega (or the fake one)."""
    if dry_run:
        return DryRunPort()

    import serial  # pyserial; only needed when a real board is connected

    port = os.getenv("SERIAL_PORT", "COM3")
    # timeout=0.1 means readline() gives up after 0.1 s if the Mega hasn't
    # sent anything, instead of waiting forever. That keeps the bridge responsive.
    conn = serial.Serial(port, BAUD, timeout=0.1)

    # Opening the port resets the Mega (same as pressing its reset button),
    # so wait for it to boot and reach setup() before sending anything.
    time.sleep(2)
    print(f"serial: connected to {port} at {BAUD} baud")
    return conn


# =============================================================================
# The two jobs the bridge does at the same time
# =============================================================================
# "async" functions can wait for something (a message from the server, a line
# from the Mega) without freezing the rest of the program. That lets the two
# jobs below run side by side, each waiting on its own end.

async def server_to_robot(ws, port) -> None:
    """Job 1: every event from the server -> a serial line to the Mega."""
    # This loop runs once per message the server sends, and waits in between.
    async for message in ws:
        line = to_serial_line(json.loads(message))
        if line:
            port.write((line + "\n").encode())  # "\n" ends the line for readStringUntil


async def robot_to_server(ws, port) -> None:
    """Job 2: every line from the Mega -> handled here (P:1 goes to the server)."""
    while True:
        # readline() blocks while it waits, so run it in a background thread;
        # otherwise Job 1 would freeze until the Mega said something.
        raw = await asyncio.to_thread(port.readline)
        line = raw.decode(errors="replace").strip()
        if not line:
            continue  # nothing arrived within the timeout; try again

        if line == "P:1":
            # Someone stepped up. Tell the server, which tells the website to
            # open the session screen.
            await ws.send(json.dumps({"type": "user_present", "value": None}))
            print("arduino: P:1 -> user_present")
        else:
            # Anything else is a debug print from robot.ino; just show it.
            print(f"arduino: {line}")


# =============================================================================
# Main loop: connect, run both jobs, reconnect if the server goes away
# =============================================================================

async def main(dry_run: bool) -> None:
    port = open_port(dry_run)
    url = os.getenv("EVENTS_URL", "ws://localhost:8000/events")

    # "async for ws in connect(url)" connects to the server, and if the
    # connection drops (e.g. someone restarts the server) it waits a moment
    # and connects again by itself. So the bridge can be left running all demo.
    async for ws in connect(url):
        print(f"server: connected to {url}")

        # Start both jobs side by side.
        tasks = [asyncio.create_task(server_to_robot(ws, port)),
                 asyncio.create_task(robot_to_server(ws, port))]

        # Wait until either job stops; that only happens when the connection
        # to the server is lost. Then stop the other job too and loop around
        # to reconnect.
        _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        print("server: disconnected, retrying...")


if __name__ == "__main__":
    # Command-line options: just --dry-run for now.
    parser = argparse.ArgumentParser(description="Server <-> Arduino bridge")
    parser.add_argument("--dry-run", action="store_true",
                        help="no Arduino: print serial lines, type P:1 to fake the sensor")
    args = parser.parse_args()

    # Load SERIAL_PORT (and EVENTS_URL, if set) from the .env in the repo root.
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

    try:
        asyncio.run(main(args.dry_run))
    except KeyboardInterrupt:
        pass  # Ctrl+C: exit quietly instead of printing an error
