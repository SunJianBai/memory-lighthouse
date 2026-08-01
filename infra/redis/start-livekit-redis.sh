#!/bin/sh
set -eu

if [ "${#REDIS_LIVEKIT_PASSWORD}" -lt 32 ]; then
  echo "REDIS_LIVEKIT_PASSWORD must contain at least 32 base64url characters" >&2
  exit 64
fi

case "$REDIS_LIVEKIT_PASSWORD" in
  *[!A-Za-z0-9_-]*)
    echo "REDIS_LIVEKIT_PASSWORD contains a character outside the base64url alphabet" >&2
    exit 64
    ;;
esac

umask 077
{
  printf '%s\n' 'user default off'
  # LiveKit needs broad Redis data/pubsub commands, so it receives an isolated
  # Redis instance instead of wildcard access to application rate-limit keys.
  printf '%s\n' "user livekit on >${REDIS_LIVEKIT_PASSWORD} ~* &* +@all -FLUSHALL -FLUSHDB -CONFIG -DEBUG -SHUTDOWN -MODULE -ACL -SAVE -BGSAVE -BGREWRITEAOF -REPLICAOF -SLAVEOF"
} > /tmp/users.acl

chown -R redis:redis /data /tmp/users.acl
exec /usr/bin/setpriv \
  --reuid=redis \
  --regid=redis \
  --init-groups \
  redis-server /etc/redis/openbmb.conf --aclfile /tmp/users.acl
