#!/usr/bin/env python3
"""Generate a short-lived Phlip supporter promo code (HMAC-signed, hard to guess).

Requires the same secret as the Android build (phlip-android/promo.properties).

Usage:
  python tools/gen_promo_code.py
  python tools/gen_promo_code.py --note "alice Play refund"

Codes look like:  A1B2-C3D4-E5F6-G7H8-J9K0-MNPQ
Each code embeds an issued-at timestamp and is redeemable for 10 minutes only.
After redeem on a device it cannot be reused there.
Issue each code to only one person and keep the issued log private.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import os
import secrets
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROMO_PROPS = ROOT / "phlip-android" / "promo.properties"
ISSUED_LOG = ROOT / "phlip-android" / "promo-codes-issued.log"
VERSION_LABEL = b"phlip.promo.v2"
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
VALIDITY_MINUTES = 10


def load_secret() -> str:
    env = os.environ.get("PHLIP_PROMO_SECRET", "").strip()
    if env:
        return env
    if not PROMO_PROPS.is_file():
        print(
            f"Missing {PROMO_PROPS}. Copy promo.properties.template and set promoCodeSecret.",
            file=sys.stderr,
        )
        sys.exit(1)
    secret = ""
    for line in PROMO_PROPS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("promoCodeSecret="):
            secret = line.split("=", 1)[1].strip()
            break
    if not secret or secret.startswith("REPLACE_"):
        print("Set a real promoCodeSecret in promo.properties first.", file=sys.stderr)
        sys.exit(1)
    return secret


def encode_crockford(data: bytes) -> str:
    out = []
    buffer = 0
    bits_left = 0
    for byte in data:
        buffer = (buffer << 8) | byte
        bits_left += 8
        while bits_left >= 5:
            bits_left -= 5
            idx = (buffer >> bits_left) & 0x1F
            out.append(ALPHABET[idx])
    if bits_left > 0:
        idx = (buffer << (5 - bits_left)) & 0x1F
        out.append(ALPHABET[idx])
    return "".join(out)


def generate(secret: str, issued_at_sec: int | None = None) -> str:
    issued = int(time.time()) if issued_at_sec is None else int(issued_at_sec)
    ts = struct.pack(">I", issued & 0xFFFFFFFF)
    nonce = secrets.token_bytes(7)
    mac = hmac.new(
        secret.encode("utf-8"),
        VERSION_LABEL + ts + nonce,
        hashlib.sha256,
    ).digest()[:4]
    body = ts + nonce + mac
    raw = encode_crockford(body)
    if len(raw) != 24:
        raise RuntimeError(f"unexpected code length {len(raw)}")
    return "-".join(raw[i : i + 4] for i in range(0, 24, 4))


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a Phlip supporter promo code")
    parser.add_argument("--note", default="", help="Who/why (appended to private issued log)")
    parser.add_argument("-n", type=int, default=1, help="How many codes to generate")
    args = parser.parse_args()
    secret = load_secret()
    for _ in range(max(1, args.n)):
        issued = int(time.time())
        code = generate(secret, issued_at_sec=issued)
        expires = datetime.fromtimestamp(issued + VALIDITY_MINUTES * 60, tz=timezone.utc)
        print(code)
        print(
            f"  expires {expires.strftime('%Y-%m-%d %H:%M:%S')} UTC "
            f"({VALIDITY_MINUTES} min)",
            file=sys.stderr,
        )
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        line = f"{stamp}\t{code}\texpires={expires.strftime('%Y-%m-%dT%H:%M:%SZ')}"
        if args.note:
            line += f"\t{args.note}"
        with ISSUED_LOG.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
    print(f"(logged to {ISSUED_LOG.name} — keep this file private)", file=sys.stderr)


if __name__ == "__main__":
    main()
