# callx402 Python client

callx402: the universal action layer for x402 infrastructure.
Diagnose, rescue, route, resolve and execute, through one Python interface.

Zero Python dependencies. The package ships the callx402 node CLI inside
`callx402/vendor/`, so the wheel and sdist are fully self contained.
(Requires Node.js 18 or newer on your machine to run the bundled CLI.)

## Install

PyPI is not live yet. Until it is, install direct from GitHub:

```bash
pip install "git+https://github.com/Payloadhq/callx402.git#subdirectory=sdk/python"
```

Requires Python 3.9 or newer. To upgrade later:

```bash
pip install --upgrade "git+https://github.com/Payloadhq/callx402.git#subdirectory=sdk/python"
```

## Quick start

```python
import callx402

try:
    result = callx402.callx402(
        intent="pay 5 USDC to 0xYourAddressHere",
        max_budget="10",
        networks="base",
        assets="USDC",
        approval_threshold="5",
        dry_run=True,      # preview the plan; set False to act
    )
except callx402.Callx402Error as e:
    print("transport failure:", e)
    print("envelope:", e.envelope)
else:
    print("envelope:", result)
```

Budget refusals, disabled subsystems and settlement UNKNOWN come back as
result envelopes (`{"ok": False, ...}`), not exceptions. Only transport or
usage failures raise `Callx402Error`.

## Entry points

`callx402()` takes an intent plus keyword budgets and policy flags, and
returns the SPEC result envelope as a dict. Named actions are also
available directly:

- `diagnose`, `rescue`, `route`, `resolve`, `execute`
- `doctor`, `monitor`, `preflight`, `inspect`
- `status()` for the subsystem status report

A `callx402` command line entry point is installed as well:
`callx402 --help`.

## Money safety

This client never auto retries. Refusals surface exactly as the core
reports them, and you set a hard `max_budget` on every dispatch.

MIT License. See https://github.com/Payloadhq/callx402
