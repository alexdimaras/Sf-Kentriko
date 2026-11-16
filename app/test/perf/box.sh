#!/bin/bash
# Runs a command with the limits of Render's free plan: 0.1 CPU and 512 MB (Linux cgroups, needs root).
#   bash box.sh node server.js          CPU=0.1 MEM=512 by default:  CPU=0.25 MEM=256 bash box.sh …
# The numbers that matter on a small cloud machine (time, freezes, out-of-memory) only show up under these limits.
set -e
CPU="${CPU:-0.1}"; MEM="${MEM:-512}"; NAME="sfk-box-$$"
QUOTA=$(awk "BEGIN { printf \"%d\", $CPU * 100000 }")
if [ -d /sys/fs/cgroup/cpu ]; then            # cgroup v1
  mkdir -p /sys/fs/cgroup/cpu/$NAME /sys/fs/cgroup/memory/$NAME
  echo 100000 > /sys/fs/cgroup/cpu/$NAME/cpu.cfs_period_us
  echo $QUOTA > /sys/fs/cgroup/cpu/$NAME/cpu.cfs_quota_us
  echo $((MEM * 1024 * 1024)) > /sys/fs/cgroup/memory/$NAME/memory.limit_in_bytes
  echo $((MEM * 1024 * 1024)) > /sys/fs/cgroup/memory/$NAME/memory.memsw.limit_in_bytes 2>/dev/null || true
  echo $$ > /sys/fs/cgroup/cpu/$NAME/cgroup.procs
  echo $$ > /sys/fs/cgroup/memory/$NAME/cgroup.procs
else                                           # cgroup v2
  mkdir -p /sys/fs/cgroup/$NAME
  echo "$QUOTA 100000" > /sys/fs/cgroup/$NAME/cpu.max
  echo "${MEM}M" > /sys/fs/cgroup/$NAME/memory.max
  echo $$ > /sys/fs/cgroup/$NAME/cgroup.procs
fi
exec "$@"
