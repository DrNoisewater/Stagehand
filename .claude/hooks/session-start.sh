#!/bin/bash
# Session start: make sure work begins from the latest Stagehand on GitHub.
# (4.1: a session once started from a copy several versions old and rebuilt a
# feature that already existed.) Brings the checkout up to date when that's
# safe, and otherwise says plainly what's out of date. What this prints is read
# by Claude at the start of the session. Needs no installs: the tests use none.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

main=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
main=${main:-main}

fetched=0
for wait in 0 2 4 8; do
  sleep "$wait"
  if timeout 60 git fetch --quiet --tags origin "$main" 2>/dev/null; then
    fetched=1
    break
  fi
done

version() { git show "$1:package.json" 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -1; }
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
latest=$(version "origin/$main")

if [ "$fetched" != 1 ]; then
  echo "WARNING: couldn't reach GitHub to check for a newer Stagehand. This copy is version $(version HEAD) (branch $branch); the last known $main is $latest. Fetch origin/$main before building anything."
  exit 0
fi

behind=$(git rev-list --count "HEAD..origin/$main" 2>/dev/null || echo 0)
if [ "$behind" = 0 ]; then
  echo "Stagehand is up to date: version $(version HEAD), branch $branch, includes the latest origin/$main."
  exit 0
fi

clean=1
[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ] && clean=0
was=$(version HEAD)

# Safe to bring forward: no changes of our own in the way and no commits of our own on top.
if [ "$clean" = 1 ] && git merge-base --is-ancestor HEAD "origin/$main" 2>/dev/null; then
  if git merge --ff-only --quiet "origin/$main" 2>/dev/null; then
    echo "Stagehand was $behind commits behind GitHub (version $was). Brought branch $branch forward to the latest origin/$main: version $(version HEAD). Work from this."
    exit 0
  fi
fi

echo "WARNING: this checkout is OUT OF DATE: $behind commits behind origin/$main (this copy: version $was; GitHub: version $latest), and it couldn't be brought forward by itself (local changes or commits of its own on branch $branch). Before any work: look at what's new (git log HEAD..origin/$main), then rebase or merge onto origin/$main. Never build on this old copy: features may already exist on GitHub."
exit 0
