#!/usr/bin/env python3
"""Render callx402 visual-library terminal PNGs with PIL.
Every output pixel below the prompt line comes from a real CLI run captured
in docs/visuals/raw/*.out. Prompt lines reproduce the exact command run.
"""
import textwrap
from PIL import Image, ImageDraw, ImageFont

BASE = "/home/hatch/workspace/products/callx402"
OUT = f"{BASE}/docs/visuals"
RAW = f"{OUT}/raw"

BG = (24, 26, 32)          # #181A20
TXT = (201, 209, 217)      # light gray
CMD = (240, 243, 246)      # bright white
PROMPT = (126, 231, 135)   # green $
ENV = (139, 148, 158)      # gray env prefix
GREEN = (126, 231, 135)
RED = (248, 81, 73)
AMBER = (210, 153, 34)
CAPTION = (110, 118, 129)
RULE = (48, 54, 61)

FONT = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 18)
SMALL = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", 13)
PAD = 28
MAX_W = 1040  # image width incl padding

def wrap(text, font, width):
    out = []
    for para in text.split("\n"):
        if para == "":
            out.append("")
            continue
        line = ""
        for word in para.split(" "):
            trial = (line + " " + word).strip()
            if font.getlength(trial) <= width:
                line = trial
            else:
                if line:
                    out.append(line)
                # hard-break an overlong token
                while font.getlength(word) > width:
                    cut = len(word)
                    while cut > 1 and font.getlength(word[:cut]) > width:
                        cut -= 1
                    out.append(word[:cut])
                    word = word[cut:]
                line = word
        out.append(line)
    return out

def colorize(line):
    s = line.lstrip()
    if s.startswith("FAILED") or s.startswith("error ["):
        return RED
    if s.startswith("ok ["):
        return GREEN
    if s.startswith("settlement: UNKNOWN"):
        return AMBER
    return TXT

def render(name, env_prefix, cmd, body_lines, caption):
    """One logical prompt line: '$ ' + env_prefix + cmd, wrapped once."""
    inner = MAX_W - 2 * PAD
    full = (env_prefix or "") + cmd
    wrapped = wrap(full, FONT, inner - FONT.getlength("$ "))
    items = []  # (text, kind, is_first)
    # kind: 'env' | 'cmd' | 'out'
    for w in wrapped:
        items.append((w, 'prompt', len(items) == 0))
    for ln in body_lines:
        for w in (wrap(ln, FONT, inner) or [""]):
            items.append((w, 'out', False))
    line_h = FONT.getbbox("Ag")[3] + 8
    cap_h = SMALL.getbbox("Ag")[3] + 26
    H = PAD + len(items) * line_h + cap_h + PAD
    img = Image.new("RGB", (MAX_W, H), BG)
    d = ImageDraw.Draw(img)
    y = PAD
    env_len = len(env_prefix or "")
    for idx, (text, kind, is_first) in enumerate(items):
        x = PAD
        if kind == 'prompt':
            if is_first:
                d.text((x, y), "$ ", font=FONT, fill=PROMPT)
                x += FONT.getlength("$ ")
            if is_first and env_len and len(text) >= env_len:
                # env prefix always fits entirely in the first wrapped chunk
                d.text((x, y), text[:env_len], font=FONT, fill=ENV)
                x += FONT.getlength(text[:env_len])
                d.text((x, y), text[env_len:], font=FONT, fill=CMD)
            else:
                d.text((x, y), text, font=FONT, fill=CMD)
        else:
            d.text((x, y), text, font=FONT, fill=colorize(text))
        y += line_h
    d.line([(PAD, y + 8), (MAX_W - PAD, y + 8)], fill=RULE, width=1)
    d.text((PAD, y + 16), caption, font=SMALL, fill=CAPTION)
    img.save(f"{OUT}/{name}")
    print(f"wrote {name}  {MAX_W}x{H}")

def read_raw(fname):
    with open(f"{RAW}/{fname}", encoding="utf-8") as f:
        return f.read().rstrip("\n").split("\n")

EV_DIAG = '{"operationId":"op_visual_001","settlement":{"state":"failed","error":"insufficient_funds","transaction":null}}'
EV_RES = '{"operationId":"op_visual_002","txHash":"0x9f2ac41be7d03c5f81a1d6b2e4f7a0d19c3e8b5a607d4f1a2c93e8d70f6a1b"}'

# 01 — verified --help text (from the txt file; identical to live --help)
help_lines = open(f"{BASE}/docs/cli-help-verified-2026-10-06.txt", encoding="utf-8").read().rstrip("\n").split("\n")
render("01-action-map.png", None, "callx402 --help", help_lines,
       "callx402 --help  ·  rendered from docs/cli-help-verified-2026-10-06.txt (byte-identical to live output)")

# 02 — diagnose, failed settle evidence, doctor enabled
render("02-diagnose.png", "PAYLOAD_MCP_DOCTOR=1 ",
       "node bin/callx402.js diagnose --evidence '" + EV_DIAG + "'",
       read_raw("02-diagnose.out"),
       "live run 2026-10-06  ·  exit 0  ·  doctor subsystem enabled via PAYLOAD_MCP_DOCTOR=1")

# 03 — resolve, txHash evidence, settlement enabled
render("03-resolve.png", "PAYLOAD_SETTLEMENT_RESOLVER=1 ",
       "node bin/callx402.js resolve --evidence '" + EV_RES + "'",
       read_raw("03-resolve.out"),
       "live run 2026-10-06  ·  exit 5 (settlement unknown: never auto-retry, never repay)")

# 04 — route
render("04-route.png", "PAYLOAD_MCP_ROUTES=1 ",
       'node bin/callx402.js route --goal "cheap reliable x402 settlement"',
       read_raw("04-route.out"),
       "live run 2026-10-06  ·  exit 0  ·  router enabled; no candidates in local capability graph")

# 05 — preflight
render("05-preflight.png", "PAYLOAD_MCP_PREFLIGHT=1 ",
       "node bin/callx402.js preflight",
       read_raw("05-preflight.out"),
       "live run 2026-10-06  ·  exit 0  ·  preflight subsystem enabled via PAYLOAD_MCP_PREFLIGHT=1")

# 06 — inspect (JSON envelope)
render("06-inspect.png", "PAYLOAD_MCP_FABRIC=1 ",
       "node bin/callx402.js inspect --json",
       read_raw("06-inspect.out"),
       "live run 2026-10-06  ·  exit 0  ·  local capability graph is empty (0 nodes, 0 tools)")

# 07 — status
render("07-status.png", None, "node bin/callx402.js status",
       read_raw("07-status.out"),
       "live run 2026-10-06  ·  exit 0  ·  default environment: all subsystems disabled (fail-closed)")
