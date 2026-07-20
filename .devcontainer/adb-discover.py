#!/usr/bin/env python3
"""Discover this container's Android phone adb (wireless-debug) endpoint and connect.

Why not `adb mdns`: Android advertises its wireless-debug endpoint
(`_adb-tls-connect._tcp`) over mDNS, but mDNS is multicast (224.0.0.251) and does
NOT traverse the Docker/WSL2 bridge this devcontainer lives on (172.22.0.0/16,
NAT'd to the phone's LAN via the gateway). `adb mdns services` therefore returns
nothing here, and a unicast :5353 probe to the phone gets no reply. Unicast TCP,
however, routes fine through the gateway -- which is why `adb connect host:port`
and a plain port scan both work. So we emulate discovery by scanning.

Strategy (fast path first, each tier only runs if the prior found nothing):
  0. Try `adb mdns services` anyway -- costs nothing and future-proofs the day
     multicast forwarding exists (mirrored WSL networking, host avahi, etc.).
  1. Try known endpoints directly (CLI arg, then the saved last-good endpoint,
     then ADB_CONNECT from .env) via `adb connect host:port`.
  2. For each known host whose saved port is stale, tiered port scan:
       last-good port window -> common band -> full ephemeral range.
  3. If no known host answers at all, sweep the last-good /24 for the last-good
     port to find a moved phone, then port-scan that host.

The wireless-debug PORT rotates every time the toggle is flipped; the phone's IP
is comparatively stable (DHCP lease). On success we `adb connect` and persist
"host:port" to ~/.android/adb-endpoint (a rebuild-surviving named volume), so the
next session's tier 1 is instant.

Usage:
  adb-discover.py [host[:port]] [--full] [--sweep] [--quiet]
    host[:port]   extra candidate to try first (e.g. 192.168.2.148 or ...:43193)
    --full        widen the port scan to the entire ephemeral range up front
    --sweep       force the /24 host sweep even if a known host is reachable
    --quiet       only print the final "host:port" (for scripting)
Prints the connected endpoint on stdout; exits non-zero if nothing was found.
"""
import argparse
import asyncio
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ADB = os.environ.get("ADB") or "adb"
STATE = Path.home() / ".android" / "adb-endpoint"

# Android wireless-debug lands in the Linux ephemeral range. We scan tiered:
COMMON_LO, COMMON_HI = 30000, 46000        # where observed ports have landed
FULL_LO, FULL_HI = 32768, 60999            # default /proc ip_local_port_range
WINDOW = 400                               # +/- around a stale last-good port
CONCURRENCY = 256                          # higher overwhelms adbd -> false misses
TIMEOUT = 1.2


def log(msg: str) -> None:
    if not QUIET:
        print(msg, file=sys.stderr)


def run_adb(*args: str, timeout: float = 10.0) -> str:
    try:
        out = subprocess.run(
            [ADB, *args], capture_output=True, text=True, timeout=timeout
        )
        return (out.stdout or "") + (out.stderr or "")
    except Exception as exc:  # adb missing / hung
        return f"__error__ {exc}"


def connected_endpoints() -> set:
    """host:port targets that adb currently reports as `device` (not offline)."""
    out = run_adb("devices")
    found = set()
    for line in out.splitlines():
        m = re.match(r"^(\d+\.\d+\.\d+\.\d+:\d+)\s+device\b", line.strip())
        if m:
            found.add(m.group(1))
    return found


def try_connect(endpoint: str, settle: float = 4.0) -> bool:
    """Connect and poll until adb reports the endpoint as `device`.

    `adb connect` returns before the TLS handshake completes, so the endpoint is
    briefly `offline`/`connecting`. Without this poll a just-found port reads as a
    failure and the caller wastes time scanning on."""
    out = run_adb("connect", endpoint)
    if "failed to connect" in out.lower() or "cannot connect" in out.lower():
        return False
    waited = 0.0
    step = 0.4
    while waited < settle:
        if endpoint in connected_endpoints():
            return True
        time.sleep(step)
        waited += step
    return endpoint in connected_endpoints()


def load_candidates(cli_host):
    """Ordered, de-duplicated candidate endpoints; entries may be host or host:port."""
    cands = []
    seen = set()

    def add(v):
        v = (v or "").strip()
        if v and v not in seen:
            seen.add(v)
            cands.append(v)

    if cli_host:
        add(cli_host)
    if STATE.exists():
        for line in STATE.read_text().splitlines():
            add(line)
    add(os.environ.get("ADB_CONNECT", ""))
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            m = re.match(r"^\s*ADB_CONNECT\s*=\s*(.+?)\s*(#.*)?$", line)
            if m:
                val = m.group(1).strip().strip('"').strip("'")
                for tok in re.split(r"[,\s]+", val):
                    add(tok)
    return cands


def split_hostport(entry: str):
    if ":" in entry:
        h, p = entry.rsplit(":", 1)
        return h, (int(p) if p.isdigit() else None)
    return entry, None


async def _probe(host, port, sem):
    async with sem:
        try:
            fut = asyncio.open_connection(host, port)
            _, w = await asyncio.wait_for(fut, TIMEOUT)
            w.close()
            try:
                await w.wait_closed()
            except Exception:
                pass
            return port
        except Exception:
            return None


async def scan_ports(host, ports):
    sem = asyncio.Semaphore(CONCURRENCY)
    results = await asyncio.gather(*(_probe(host, p, sem) for p in ports))
    return sorted(p for p in results if p)


async def scan_host_tiered(host, hint_port, full):
    """Return the first open adb port on `host`, scanning cheapest tier first."""
    tiers = []
    if hint_port:
        lo = max(1, hint_port - WINDOW)
        tiers.append(("last-good window", range(lo, hint_port + WINDOW + 1)))
    if not full:
        tiers.append(("common band", range(COMMON_LO, COMMON_HI + 1)))
    tiers.append(("full ephemeral range", range(FULL_LO, FULL_HI + 1)))

    scanned = set()
    for label, rng in tiers:
        ports = [p for p in rng if p not in scanned]
        scanned.update(ports)
        if not ports:
            continue
        log(f"  scanning {host} [{label}] ({len(ports)} ports)...")
        found = await scan_ports(host, ports)
        # Filter to ports adb will actually accept a TLS-connect handshake on.
        for port in found:
            ep = f"{host}:{port}"
            if try_connect(ep):
                return ep
        if found:
            log(f"  open ports {found} did not accept adb; continuing")
    return None


async def sweep_subnet(ref_ip, port):
    """Find a moved phone: try `port` across the /24 of ref_ip."""
    base = ".".join(ref_ip.split(".")[:3])
    hosts = [f"{base}.{i}" for i in range(1, 255)]
    log(f"  sweeping {base}.0/24 for port {port}...")
    sem = asyncio.Semaphore(CONCURRENCY)

    async def one(h):
        async with sem:
            try:
                fut = asyncio.open_connection(h, port)
                _, w = await asyncio.wait_for(fut, TIMEOUT)
                w.close()
                return h
            except Exception:
                return None

    res = await asyncio.gather(*(one(h) for h in hosts))
    return [h for h in res if h]


def save_state(endpoint):
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        # Keep last-good first, plus a short history for future hints.
        history = []
        if STATE.exists():
            history = [l.strip() for l in STATE.read_text().splitlines() if l.strip()]
        ordered = [endpoint] + [h for h in history if h != endpoint]
        STATE.write_text("\n".join(ordered[:5]) + "\n")
    except Exception as exc:
        log(f"  (could not save state: {exc})")


async def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("host", nargs="?", help="host or host:port to try first")
    ap.add_argument("--full", action="store_true", help="scan full ephemeral range")
    ap.add_argument("--sweep", action="store_true", help="force /24 host sweep")
    ap.add_argument("--quiet", action="store_true", help="print only host:port")
    args = ap.parse_args()

    global QUIET
    QUIET = args.quiet

    # Tier 0: native mDNS (free; works only if multicast is ever forwarded here).
    out = run_adb("mdns", "services")
    for line in out.splitlines():
        m = re.search(r"(\d+\.\d+\.\d+\.\d+):(\d+).*_adb-tls-connect", line)
        if m:
            ep = f"{m.group(1)}:{m.group(2)}"
            log(f"mDNS advertised {ep}")
            if try_connect(ep):
                save_state(ep)
                print(ep)
                return 0

    candidates = load_candidates(args.host)
    if not candidates:
        log("No candidate endpoints (no arg, no saved state, no ADB_CONNECT).")
        log("Provide the phone's IP once: adb-discover.py 192.168.x.y")
        return 2
    log(f"Candidates: {', '.join(candidates)}")

    # Tier 1: try fully-specified known endpoints directly.
    for entry in candidates:
        host, port = split_hostport(entry)
        if port and not args.sweep:
            log(f"Trying known endpoint {host}:{port}...")
            if try_connect(f"{host}:{port}"):
                log(f"Connected (endpoint unchanged): {host}:{port}")
                save_state(f"{host}:{port}")
                print(f"{host}:{port}")
                return 0

    # Tier 2: port-scan each known host (port rotated since last time).
    if not args.sweep:
        for entry in candidates:
            host, hint = split_hostport(entry)
            ep = await scan_host_tiered(host, hint, args.full)
            if ep:
                log(f"Connected (port rotated): {ep}")
                save_state(ep)
                print(ep)
                return 0

    # Tier 3: the phone's IP moved -- sweep the /24 of the newest known host.
    ref = split_hostport(candidates[0])[0]
    hint_port = next((p for _, p in map(split_hostport, candidates) if p), None)
    if hint_port:
        hosts = await sweep_subnet(ref, hint_port)
        for host in hosts:
            if try_connect(f"{host}:{hint_port}"):
                log(f"Connected (IP moved): {host}:{hint_port}")
                save_state(f"{host}:{hint_port}")
                print(f"{host}:{hint_port}")
                return 0
    # Last resort: full port scan of each host we know, IP possibly moved.
    for entry in candidates:
        host, hint = split_hostport(entry)
        ep = await scan_host_tiered(host, hint, full=True)
        if ep:
            log(f"Connected: {ep}")
            save_state(ep)
            print(ep)
            return 0

    log("Could not locate the phone's adb endpoint.")
    log("Check: wireless debugging ON, phone on the LAN, container can route to it.")
    return 1


if __name__ == "__main__":
    QUIET = False
    sys.exit(asyncio.run(main()))
