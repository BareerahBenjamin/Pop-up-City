#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
python3 -c 'import sys; sys.exit("Python 3.9 or newer is required" if sys.version_info < (3, 9) else 0)'
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python flash.py --verify
