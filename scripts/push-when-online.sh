#!/usr/bin/env bash
# Push one branch as soon as the network allows, and stop the moment it lands.
#
# WHY THIS EXISTS. The connection came back on 2026-09-09 and immediately began
# flapping: curl saw 200, the very next `git push` died with
# "RPC failed; curl 55 Send failure: Connection was reset", and three curls a
# minute later could not open a TCP socket at all. Ten commits existed only on
# this machine at the time.
#
# A push is non-destructive and idempotent — retrying costs nothing and the
# alternative is a human watching a terminal. `--force` is never passed; if the
# branch has genuinely diverged this must fail and be looked at.
#
#   ./scripts/push-when-online.sh <branch> [attempts] [sleep-seconds]
#
# Exit 0 = the remote now has the local tip. Exit 1 = it does not.
set -uo pipefail

BRANCH="${1:?usage: push-when-online.sh <branch> [attempts] [sleep-seconds]}"
ATTEMPTS="${2:-40}"
SLEEP_S="${3:-30}"

# READ FRESH EVERY ATTEMPT, never captured once.
#
# This used to be a single `LOCAL_TIP="$(git rev-parse HEAD)"` before the loop,
# and that made the script unable to recognise its own success: `git push`
# pushes whatever HEAD is NOW, but the confirmation compared the remote against
# the SHA from when the script started. Commit anything while it is waiting —
# which is the whole point of running it in the background during a long
# outage — and the remote would land the real tip while the check kept saying
# "not yet", forever, and then reported the wrong SHA on giving up.
#
# Measured 2026-09-11: 400 attempts over five hours with twelve commits made
# during the wait, every one of them invisible to the comparison.
local_tip() { git rev-parse HEAD; }

echo "local tip : $(local_tip)"
echo "branch    : $BRANCH"
echo "plan      : up to $ATTEMPTS attempts, ${SLEEP_S}s apart"
echo

for i in $(seq 1 "$ATTEMPTS"); do
  # A bigger send buffer makes the large first push far less likely to be reset
  # mid-stream. Passed with -c so nothing is written to the repo's config.
  if git -c http.postBuffer=104857600 push origin "$BRANCH" 2>&1 | sed "s/^/  attempt $i | /"; then
    # `git push` can exit 0 on "Everything up-to-date" even when a previous
    # attempt failed, so success is confirmed against the REMOTE, never against
    # the exit code.
    REMOTE_TIP="$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}')"
    if [ "$REMOTE_TIP" = "$(local_tip)" ]; then
      echo
      echo "LANDED on attempt $i — remote $BRANCH is now $REMOTE_TIP"
      exit 0
    fi
    echo "  attempt $i | push reported success but remote is '${REMOTE_TIP:-unreachable}' — not done"
  fi
  echo "  attempt $i | not yet; sleeping ${SLEEP_S}s"
  sleep "$SLEEP_S"
done

echo
echo "GAVE UP after $ATTEMPTS attempts. The commits are still safe locally at $(local_tip)."
exit 1
