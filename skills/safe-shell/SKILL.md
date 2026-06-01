---
name: safe-shell
description: Run shell commands through the terminal node safely. Use before any task that shells out (file edits, git, installs, scripts) so a command can't do irreversible damage.
---

# Safe shell usage

Goal: get the task done without an irreversible mistake.

## Before running
- Read what the command targets. If it deletes, overwrites, force-pushes, or
  empties something, stop and confirm intent first.
- Prefer a dry-run / `--dry-run` / `git status` / `ls` to inspect before you act.
- Quote paths; never run a destructive command with an unset/empty variable
  (`rm -rf "$X/"` when `$X` is empty wipes `/`).

## Running
- One logical step per command so a failure is localizable.
- Capture output; check the exit code before chaining the next step.
- For long or networked commands, expect they can hang; bound them with a timeout.

## After
- Verify the effect you intended actually happened (re-read state), don't assume success from a 0 exit alone.

## Never
- Pipe a remote script straight into a shell (`curl … | bash`) on a whim.
- Mass-delete or force-push without an explicit, reviewed reason.
