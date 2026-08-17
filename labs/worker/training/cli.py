"""Argument handling shared by the four lab entrypoints.

Deliberately not argparse. Every command in this starter is printed verbatim on a
session page, and a hand-rolled `--flag value` reader keeps the entrypoints short
enough that a student reads the whole file while waiting for their worker to
start. There is no requirement here argparse would earn its import for.
"""

from __future__ import annotations

import asyncio
import getpass
import sys
from datetime import datetime, timezone
from typing import Awaitable, Callable, Mapping

from training.config import MissingSetting

Command = Callable[[list[str], str], Awaitable[int]]


def flag_value(argv: list[str], name: str) -> str | None:
    if name in argv:
        index = argv.index(name)
        if index + 1 < len(argv):
            return argv[index + 1]
    return None


def flag_present(argv: list[str], name: str) -> bool:
    return name in argv


def positionals(argv: list[str]) -> list[str]:
    """Everything after the command that is not a flag or a flag's value."""
    out: list[str] = []
    skip = False
    for index, token in enumerate(argv[1:]):
        if skip:
            skip = False
            continue
        if token.startswith("-"):
            following = argv[index + 2] if index + 2 < len(argv) else None
            if following is not None and not following.startswith("-"):
                skip = True
            continue
        out.append(token)
    return out


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%H%M%S")


def run(script: str, commands: Mapping[str, Command], default: str) -> int:
    """Entrypoint boilerplate: pick a command, run it, explain a missing setting."""

    async def main() -> int:
        argv = sys.argv[1:]
        command = argv[0] if argv and not argv[0].startswith("-") else default
        suffix = getpass.getuser().lower()

        handler = commands.get(command)
        if handler is None:
            print(
                f"Unknown command '{command}'. Use {', '.join(commands)}.",
                file=sys.stderr,
            )
            return 1

        try:
            return await handler(argv, suffix)
        except MissingSetting as missing:
            # Missing configuration is the most common way to land here, and a
            # traceback tells a student nothing useful about it.
            print(
                f"""
  {missing} is not set.

  Pick one:

  1. Against your Cloud namespace — copy .env.example to .env and paste in
     the "Connection details" block shown at the top of any session page:

       cp .env.example .env && $EDITOR .env

  2. Against a local dev server — no Cloud, no credentials:

       temporal server start-dev        # in another terminal
       uv run {script} {command} --local
""",
                file=sys.stderr,
            )
            return 1

    return asyncio.run(main())
