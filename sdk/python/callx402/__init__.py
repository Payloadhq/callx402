"""callx402 Python SDK — the universal action layer for x402 infrastructure.

Thin wrapper: dispatches to the bundled node CLI (``bin/callx402.js --json``)
in a subprocess and returns the parsed SPEC §4 result envelope as a dict.

Money-safety: budget refusals and settlement-UNKNOWN surface exactly as the
core reports them; this SDK never auto-retries.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess

__version__ = "0.1.0"

_NODE_MIN_HINT = "Node.js >= 18"

# kwargs name -> CLI flag, for the documented public parameters.
_FLAG_MAP = {
    "max_budget": "--max-budget",
    "deadline": "--deadline",
    "speed": "--speed",
    "risk": "--risk",
    "networks": "--networks",
    "assets": "--assets",
    "providers": "--providers",
    "approval_threshold": "--approval-threshold",
    "idempotency_key": "--idempotency-key",
    "timeout_ms": "--timeout",
    "dry_run": "--dry-run",
}


class Callx402Error(Exception):
    """Raised when the callx402 CLI exits non-zero or cannot be run.

    Attributes:
        envelope: the parsed result envelope dict when the CLI produced one
            (e.g. ``{"ok": False, "error": {...}}`` for budget refusals,
            disabled subsystems, settlement UNKNOWN), else None.
        exit_code: the CLI process exit code, or None when the process never ran.
    """

    def __init__(self, message, envelope=None, exit_code=None):
        super().__init__(message)
        self.envelope = envelope
        self.exit_code = exit_code


def _project_root_from_package():
    # <project>/sdk/python/callx402/__init__.py -> <project>
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.normpath(os.path.join(here, "..", "..", ".."))


def _v2_root_default():
    """Absolute path of the sibling v2.0.0 tree, when this SDK runs from a
    checkout where the vendor copy's relative ../../x402-paid-api-starter-kit
    resolution would miss. Returns None when not found (the caller can set
    CALLX402_V2_ROOT explicitly)."""
    project_root = _project_root_from_package()
    cand = os.path.join(
        os.path.dirname(project_root), "x402-paid-api-starter-kit", "v2.0.0"
    )
    return cand if os.path.isdir(cand) else None


def _find_cli():
    """Locate the bundled bin/callx402.js.

    Prefers the vendored copy shipped inside wheels/sdists, then falls back
    to the source-tree sibling (editable installs / dev checkouts).
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, "vendor", "bin", "callx402.js"),
        os.path.join(_project_root_from_package(), "bin", "callx402.js"),
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise Callx402Error(
        "callx402: bundled CLI not found (looked in vendor/bin and the "
        "source tree). The Python SDK must be installed from the callx402 "
        "project directory."
    )


def _find_node():
    node = shutil.which("node")
    if not node:
        raise RuntimeError(
            "callx402 requires Node.js (>= 18) to run the bundled CLI, but no "
            "`node` binary was found on PATH. Install Node.js from "
            "https://nodejs.org/ (or via your package manager), then retry."
        )
    return node


def _kebab(name):
    return "--" + name.replace("_", "-")


def _append_flag(argv, flag, value):
    if value is None:
        return
    if isinstance(value, bool):
        if value:
            argv.append(flag)
        return
    if isinstance(value, (list, tuple)):
        argv.append(flag)
        argv.append(",".join(str(v) for v in value))
        return
    argv.append(flag)
    argv.append(str(value))


def _build_argv(action=None, intent=None, extra=None, **kwargs):
    """Build [node, cli, --json, <command...>] per the SPEC §7 CLI contract."""
    node = _find_node()
    cli = _find_cli()
    argv = [node, cli, "--json"]

    if action:
        argv.append(action)
        positional = (extra or {}).pop("positional", None)
        if positional:
            argv.extend(positional if isinstance(positional, (list, tuple)) else [positional])
    elif intent:
        argv.append(intent)
    else:
        raise TypeError(
            "callx402: either `intent` (non-empty string) or `action` must be provided"
        )

    for key, value in kwargs.items():
        if value is None:
            continue
        flag = _FLAG_MAP.get(key, _kebab(key))
        _append_flag(argv, flag, value)
    if extra:
        for key, value in extra.items():
            if value is None or key == "positional":
                continue
            _append_flag(argv, _kebab(key), value)
    return argv


def _run(argv, timeout_ms=None):
    timeout = (timeout_ms / 1000.0) if timeout_ms else 120.0
    env = dict(os.environ)
    # The vendored CLI resolves its v2.0.0 tree relative to its own location,
    # which misses outside a source checkout. Point it at the real tree when
    # we can find it; an explicit CALLX402_V2_ROOT always wins.
    v2_default = _v2_root_default()
    if v2_default and "CALLX402_V2_ROOT" not in env:
        env["CALLX402_V2_ROOT"] = v2_default
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as exc:
        raise Callx402Error(
            f"callx402: CLI timed out after {timeout:.1f}s (no auto-retry performed)"
        ) from exc
    except OSError as exc:
        raise Callx402Error(f"callx402: failed to launch node subprocess: {exc}") from exc

    stdout = (proc.stdout or "").strip()
    envelope = None
    if stdout:
        try:
            envelope = json.loads(stdout)
        except json.JSONDecodeError:
            envelope = None

    if proc.returncode != 0:
        detail = ""
        if isinstance(envelope, dict):
            err = envelope.get("error") or {}
            detail = err.get("message") or envelope.get("disposition") or ""
        raise Callx402Error(
            f"callx402: CLI exited with code {proc.returncode}"
            + (f": {detail}" if detail else "")
            + (f" (stderr: {proc.stderr.strip()[:500]})" if proc.stderr and not detail else ""),
            envelope=envelope,
            exit_code=proc.returncode,
        )

    if not isinstance(envelope, dict):
        raise Callx402Error(
            "callx402: CLI exited 0 but did not emit a JSON envelope on stdout"
            + (f" (stderr: {proc.stderr.strip()[:500]})" if proc.stderr else ""),
            exit_code=0,
        )
    return envelope


def _validate_common(intent, action, max_budget, approval_threshold, timeout_ms,
                     speed, risk, networks, assets, providers, dry_run):
    if action is not None:
        if not isinstance(action, str) or not action.strip():
            raise TypeError("callx402: `action` must be a non-empty string")
    else:
        if not isinstance(intent, str) or not intent.strip():
            raise TypeError("callx402: `intent` must be a non-empty string")
    for name, value in (("max_budget", max_budget), ("approval_threshold", approval_threshold)):
        if value is not None and (not isinstance(value, (int, float)) or value < 0):
            raise TypeError(f"callx402: `{name}` must be a non-negative number")
    if timeout_ms is not None and (not isinstance(timeout_ms, int) or timeout_ms <= 0):
        raise TypeError("callx402: `timeout_ms` must be a positive integer (milliseconds)")
    if speed is not None and speed not in ("fast", "balanced", "cheap"):
        raise TypeError("callx402: `speed` must be one of 'fast', 'balanced', 'cheap'")
    if risk is not None and risk not in ("low", "medium", "high"):
        raise TypeError("callx402: `risk` must be one of 'low', 'medium', 'high'")
    for name, value in (("networks", networks), ("assets", assets), ("providers", providers)):
        if value is not None and (
            not isinstance(value, (list, tuple))
            or any(not isinstance(v, str) or not v for v in value)
        ):
            raise TypeError(f"callx402: `{name}` must be a list of non-empty strings")
    if not isinstance(dry_run, bool):
        raise TypeError("callx402: `dry_run` must be a boolean")


def callx402(intent=None, max_budget=None, deadline=None, speed=None, risk=None,
             networks=None, assets=None, providers=None, approval_threshold=None,
             idempotency_key=None, timeout_ms=None, dry_run=False, action=None,
             **kwargs) -> dict:
    """Dispatch an intent or a named action through the callx402 CLI.

    Returns the SPEC §4 result envelope as a dict. A successful dispatch with
    ``ok: False`` (budget refusal, disabled subsystem, settlement UNKNOWN,
    ...) is returned, not raised — only transport/usage failures raise
    :class:`Callx402Error`.
    """
    _validate_common(intent, action, max_budget, approval_threshold, timeout_ms,
                     speed, risk, networks, assets, providers, dry_run)
    argv = _build_argv(
        action=action,
        intent=intent,
        extra=kwargs,
        max_budget=max_budget,
        deadline=deadline,
        speed=speed,
        risk=risk,
        networks=networks,
        assets=assets,
        providers=providers,
        approval_threshold=approval_threshold,
        idempotency_key=idempotency_key,
        timeout_ms=timeout_ms,
        dry_run=dry_run,
    )
    return _run(argv, timeout_ms=timeout_ms)


# Convenience sub-action helpers: callx402.diagnose({...}) etc.
def _make_action(name):
    def runner(args=None, **kwargs):
        timeout_ms = kwargs.pop("timeout_ms", None)
        extra = dict(kwargs)
        positional = None
        if isinstance(args, dict):
            extra.update(args)
        elif args is not None:
            positional = args if isinstance(args, (list, tuple)) else [args]
        if positional:
            extra["positional"] = positional
        argv = _build_argv(action=name, extra=extra, timeout_ms=timeout_ms)
        return _run(argv, timeout_ms=timeout_ms)
    runner.__name__ = name
    runner.__doc__ = f"Run the `{name}` action via the callx402 CLI; returns the envelope dict."
    return runner


diagnose = _make_action("diagnose")
rescue = _make_action("rescue")
route = _make_action("route")
resolve = _make_action("resolve")
doctor = _make_action("doctor")
execute = _make_action("execute")
monitor = _make_action("monitor")
preflight = _make_action("preflight")
inspect = _make_action("inspect")


def status(**kwargs):
    """Return the subsystem status report (mirrors `callx402 status --json`)."""
    timeout_ms = kwargs.pop("timeout_ms", None)
    argv = _build_argv(action="status", extra=kwargs, timeout_ms=timeout_ms)
    return _run(argv, timeout_ms=timeout_ms)


__all__ = [
    "callx402",
    "Callx402Error",
    "diagnose",
    "rescue",
    "route",
    "resolve",
    "doctor",
    "execute",
    "monitor",
    "preflight",
    "inspect",
    "status",
    "__version__",
]
