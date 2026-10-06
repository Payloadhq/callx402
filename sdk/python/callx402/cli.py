"""callx402 Python CLI — argparse front end mirroring the node CLI surface.

Delegates to the same subprocess path as callx402/__init__.py (node +
bundled bin/callx402.js --json). Prints the JSON envelope on stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:
    from . import _build_argv, _run, Callx402Error, __version__
except ImportError:  # allow running this file directly as a script
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from callx402 import _build_argv, _run, Callx402Error, __version__  # noqa: E402


def _add_common(p):
    p.add_argument("--json", action="store_true",
                   help="print the result envelope as JSON (default for this CLI)")
    p.add_argument("--timeout", type=int, default=None, metavar="MS",
                   help="subprocess timeout in milliseconds")
    p.add_argument("--max-budget", type=float, default=None, metavar="USD")
    p.add_argument("--deadline", default=None)
    p.add_argument("--speed", choices=["fast", "balanced", "cheap"], default=None)
    p.add_argument("--risk", choices=["low", "medium", "high"], default=None)
    p.add_argument("--networks", default=None,
                   help="comma-separated networks, e.g. base,ethereum")
    p.add_argument("--assets", default=None, help="comma-separated assets, e.g. USDC,ETH")
    p.add_argument("--providers", default=None, help="comma-separated providers")
    p.add_argument("--approval-threshold", type=float, default=None, metavar="USD")
    p.add_argument("--idempotency-key", default=None)
    p.add_argument("--dry-run", action="store_true")
    return p


def _add_target_options(p):
    p.add_argument("--target", action="append", default=None,
                   help="diagnose target (repeatable)")


_COMMANDS = {
    "status", "doctor", "preflight", "monitor", "diagnose", "rescue",
    "route", "resolve", "execute", "inspect", "config",
}


def build_parser():
    parser = argparse.ArgumentParser(
        prog="callx402",
        description="callx402: the universal action layer for x402 infrastructure",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("intent", nargs="?", default=None,
                        help='natural-language intent, e.g. callx402 "diagnose my x402 setup"')
    # Global options also accepted before the subcommand (mirrors node CLI).
    parser.add_argument("--json", action="store_true",
                        help="print the result envelope as JSON")
    parser.add_argument("--timeout", type=int, default=None, metavar="MS",
                        help="subprocess timeout in milliseconds")

    sub = parser.add_subparsers(dest="command")

    _add_common(sub.add_parser("status", help="subsystem status report"))
    _add_common(sub.add_parser("doctor", help="run MCP doctor diagnostics"))
    _add_common(sub.add_parser("preflight", help="run preflight checks"))
    p = _add_common(sub.add_parser("monitor", help="monitor incidents"))
    p.add_argument("--watch", action="store_true", help="watch continuously")
    p.add_argument("--once", action="store_true", help="single monitor pass")

    p = _add_common(sub.add_parser("diagnose", help="diagnose an x402 issue"))
    _add_target_options(p)

    p = _add_common(sub.add_parser("rescue", help="rescue dispatch for an incident"))
    p.add_argument("--incident", required=True, help="incident id")

    p = _add_common(sub.add_parser("route", help="route to the best tool/path"))
    p.add_argument("--goal", required=True, help="routing goal text")

    p = _add_common(sub.add_parser("resolve", help="resolve settlement evidence"))
    p.add_argument("--evidence", required=True, help="evidence JSON or @file")

    p = _add_common(sub.add_parser("execute", help="execute an intent"))
    p.add_argument("--intent", required=True, help="intent text to execute")

    p = _add_common(sub.add_parser("inspect", help="inspect capability graph / valuator"))
    p.add_argument("--query", default=None, help="inspect query text")

    p = sub.add_parser("config", help="view or change config")
    cfg_sub = p.add_subparsers(dest="config_cmd")
    cfg_sub.add_parser("list", help="list config keys")
    g = cfg_sub.add_parser("get", help="get a config key")
    g.add_argument("key")
    s = cfg_sub.add_parser("set", help="set a config key")
    s.add_argument("key")
    s.add_argument("value")

    return parser


def build_intent_parser():
    """Parser for intent mode: `callx402 "natural language" [options]`."""
    parser = argparse.ArgumentParser(
        prog="callx402",
        description="callx402: the universal action layer for x402 infrastructure",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("intent", help='natural-language intent, e.g. callx402 "diagnose my x402 setup"')
    return _add_common(parser)


def _argv_from_ns(ns, intent_mode=False):
    args = vars(ns)
    command = args.pop("command", None)
    intent = args.pop("intent", None)
    as_json = args.pop("json", False)
    timeout = args.pop("timeout", None)

    extra = {}
    positional = None
    if command == "config":
        cfg_cmd = args.pop("config_cmd", None)
        if not cfg_cmd:
            raise Callx402Error("callx402 config: expected one of list|get|set")
        positional = [cfg_cmd]
        if args.get("key") is not None:
            positional.append(args.pop("key"))
        if args.get("value") is not None:
            positional.append(args.pop("value"))
    elif command == "monitor":
        if args.pop("watch", False):
            extra["watch"] = True
        if args.pop("once", False):
            extra["once"] = True
    elif command == "diagnose":
        targets = args.pop("target", None)
        if targets:
            extra["target"] = targets
    # drop Nones and False booleans; keep True flags
    for key, value in list(args.items()):
        if value is None or value is False:
            args.pop(key)

    dry_run = args.pop("dry_run", None)
    if dry_run:
        args["dry_run"] = True

    extra.update(args)
    if positional:
        extra["positional"] = positional

    argv = _build_argv(action=command, intent=None if command else intent,
                       extra=extra, timeout_ms=timeout)
    return argv, timeout, (as_json or True)


def main(argv=None):
    raw = list(sys.argv[1:] if argv is None else argv)
    # Intent mode: the first non-option token is not a known subcommand.
    # (argparse subparsers would otherwise swallow it as an invalid choice.)
    first = next((a for a in raw if a != "--" and not a.startswith("-")), None)
    if first is not None and first not in _COMMANDS:
        parser = build_intent_parser()
        intent_mode = True
    else:
        parser = build_parser()
        intent_mode = False
    ns = parser.parse_args(raw)
    try:
        cli_argv, timeout, _as_json = _argv_from_ns(ns, intent_mode=intent_mode)
        envelope = _run(cli_argv, timeout_ms=timeout)
    except TypeError as exc:
        # usage/validation error (mirrors node CLI exit 2)
        print(f"callx402: {exc}", file=sys.stderr)
        parser.print_usage(sys.stderr)
        return 2
    except Callx402Error as exc:
        if exc.envelope is not None:
            print(json.dumps(exc.envelope, indent=2))
        else:
            print(f"error: {exc}", file=sys.stderr)
        # Mirror the node CLI's non-zero exit semantics; keep the envelope's
        # own detail (budget refusal / settlement UNKNOWN) intact for callers.
        return 1 if exc.exit_code in (None, 0) else exc.exit_code
    print(json.dumps(envelope, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
