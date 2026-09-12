#!/bin/sh
set -eu
# Render mounts persistent disks as root. Prepare only this application's fixed
# mount, then drop privileges before running Node or any audio processing.
if [ "$(id -u)" = "0" ]; then
  if [ "${DATA_DIR:-/var/data}" != "/var/data" ]; then
    echo "Container DATA_DIR must be /var/data." >&2
    exit 1
  fi
  if [ -L /var/data ]; then
    echo "The persistent data mount must not be a symlink." >&2
    exit 1
  fi
  install -d -m 700 -o node -g node /var/data
  for state_file in /var/data/notefish.json /var/data/notefish.json.tmp; do
    if [ -L "$state_file" ]; then
      echo "The state file must not be a symlink." >&2
      exit 1
    fi
    if [ -e "$state_file" ]; then
      chown node:node "$state_file"
      chmod 600 "$state_file"
    fi
  done
  exec gosu node "$@"
fi
exec "$@"
