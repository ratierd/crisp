#!/bin/sh
set -e
# Volumes attached before the image went non-root hold root-owned files
# (SQLITE_READONLY on boot otherwise). When started as root: heal the data
# dir's ownership, then drop privileges for the actual server process.
if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun /data
  exec su-exec bun "$@"
fi
exec "$@"
