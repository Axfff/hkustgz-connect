#!/usr/bin/env bash
set -euo pipefail

[ "$#" -gt 0 ] || { echo 'usage: check-release.sh PATH...' >&2; exit 2; }

if rg -a -n \
  '(/Users/|BEGIN [A-Z ]*PRIVATE KEY|(^|[^0-9])10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)|(^|[^0-9])172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$)|(^|[^0-9])192\.168\.[0-9]{1,3}\.[0-9]{1,3}([^0-9]|$))' \
  "$@"
then
  echo 'release audit failed: RFC 1918, private-key, or local machine material found' >&2
  exit 1
fi

echo 'release audit passed'
