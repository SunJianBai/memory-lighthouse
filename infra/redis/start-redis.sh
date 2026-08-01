#!/bin/sh
set -eu

require_base64url_secret() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"

  if [ "${#variable_value}" -lt 32 ]; then
    echo "$variable_name must contain at least 32 base64url characters" >&2
    exit 64
  fi

  case "$variable_value" in
    *[!A-Za-z0-9_-]*)
      echo "$variable_name contains a character outside the base64url alphabet" >&2
      exit 64
      ;;
  esac
}

require_base64url_secret REDIS_APP_PASSWORD
umask 077
{
  printf '%s\n' 'user default off'
  printf '%s\n' "user openbmb-api on >${REDIS_APP_PASSWORD} ~openbmb:* &openbmb:* +@all -FLUSHALL -FLUSHDB -CONFIG -DEBUG -SHUTDOWN -MODULE -ACL -SAVE -BGSAVE -BGREWRITEAOF -REPLICAOF -SLAVEOF"
} > /tmp/users.acl

chown -R redis:redis /data /tmp/users.acl
exec /usr/bin/setpriv \
  --reuid=redis \
  --regid=redis \
  --init-groups \
  redis-server /etc/redis/openbmb.conf --aclfile /tmp/users.acl
