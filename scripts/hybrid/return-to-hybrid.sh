#!/usr/bin/env bash
# Runs only from the root-owned, attested full release after deploy-release succeeds.
set -Eeuo pipefail
umask 077
[[ $EUID -eq 0 && $# -eq 1 && "$1" =~ ^[0-9a-f]{40}$ ]] || exit 64
source_sha="$1"
release_id="git-${source_sha:0:12}"
release="/opt/openbmb/releases/$release_id"
[[ "$(readlink -f -- /opt/openbmb/current-app)" == "$release" ]] || exit 65
[[ -d "$release" && ! -L "$release" && "$(stat -c %u -- "$release")" == 0 ]] || exit 65
[[ "$(cat "$release/.openbmb-release-sha")" == "$source_sha" ]] || exit 65
[[ -z "$(find "$release" -xdev \( ! -user root -o -perm /0022 -o -type l \) -print -quit)" ]] || exit 65
runtime_mode=/usr/local/sbin/openbmb-runtime-mode
[[ "$("$runtime_mode" status)" == $'mode=docker\nupstream=127.0.0.1:13100\npending=no' ]] || exit 65
retained="$(readlink -f -- /opt/openbmb/current-api)"
[[ "$(dirname -- "$retained")" == /opt/openbmb/hybrid/api-releases ]] || exit 65
expected_current_api="$(basename -- "$retained")"
[[ "$expected_current_api" =~ ^git-[0-9a-f]{12}$ && -d "$retained" && ! -L "$retained" ]] || exit 65

# Do not use switch hybrid with an artifact from the previous schema/security anchor.
bash "$release/infra/production/hybrid/bootstrap/install-hybrid-control-plane.sh" --domain sun227454.online
export_root="$(mktemp -d /var/lib/openbmb/hybrid-upgrade.XXXXXX)"
bash "$release/infra/production/hybrid/api/export-current-container.sh" \
  --container openbmb-api --output-dir "$export_root" --expected-source-sha "$source_sha"
artifact="$export_root/openbmb-native-api-$release_id.tar.gz"
/usr/local/sbin/openbmb-rebootstrap-from-docker \
  --domain sun227454.online --expected-current-app "$release_id" \
  --expected-current-api "$expected_current_api" \
  --api-artifact "$artifact" --api-sha256 "$artifact.sha256" \
  --caddyfile /var/lib/openbmb/hybrid-runtime/configs/hybrid/Caddyfile
OPENBMB_DOMAIN=sun227454.online /usr/local/sbin/openbmb-hybrid-health --local
OPENBMB_DOMAIN=sun227454.online /usr/local/sbin/openbmb-hybrid-health --public
verified_sha="$(bash "$release/scripts/hybrid/remote-promotion-guard.sh" baseline api)"
[[ "$verified_sha" == "$source_sha" ]] || exit 65
printf 'Hybrid upgrade verified for %s; export evidence retained at %s.\n' "$source_sha" "$export_root"
