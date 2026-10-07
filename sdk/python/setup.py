"""Build helper: sync the sibling node CLI (bin/) and core/ trees into
callx402/vendor/ before building, so wheels/sdists are self-contained.

Editable installs don't run this step, but the runtime resolves the
source-tree siblings in that case (see callx402/__init__.py).
"""

import os
import shutil

from setuptools import setup
from setuptools.command.build_py import build_py
from setuptools.command.sdist import sdist

ROOT = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.normpath(os.path.join(ROOT, "..", ".."))
VENDOR = os.path.join(ROOT, "callx402", "vendor")


def sync_vendor():
    # When building from an extracted sdist or an isolated env where the
    # sibling bin/ and core/ trees are not present, keep the already-vendored
    # copy (shipped inside the sdist) instead of wiping it.
    sources = {name: os.path.join(PROJECT_ROOT, name) for name in ("bin", "core")}
    if not any(os.path.isdir(src) for src in sources.values()):
        return
    os.makedirs(VENDOR, exist_ok=True)
    for name, src in sources.items():
        dst = os.path.join(VENDOR, name)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__"))
    # bin/callx402.js reads ../package.json for its version string.
    pkg_src = os.path.join(PROJECT_ROOT, "package.json")
    if os.path.isfile(pkg_src):
        shutil.copy2(pkg_src, os.path.join(VENDOR, "package.json"))


class BuildPyWithVendor(build_py):
    def run(self):
        sync_vendor()
        super().run()


class SDistWithVendor(sdist):
    def run(self):
        sync_vendor()
        super().run()


setup(
    cmdclass={
        "build_py": BuildPyWithVendor,
        "sdist": SDistWithVendor,
    }
)
