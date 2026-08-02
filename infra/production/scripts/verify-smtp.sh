#!/usr/bin/env bash
set -Eeuo pipefail

script_path="$(readlink -f -- "${BASH_SOURCE[0]}")"
case "${OPENBMB_OPERATION_LOCK_HELD:-false}" in
  false)
    exec flock --exclusive --wait 0 --conflict-exit-code 75 \
      /run/lock/openbmb-operation.lock \
      env OPENBMB_OPERATION_LOCK_HELD=true bash "$script_path" "$@"
    ;;
  true) ;;
  *) printf 'OPENBMB_OPERATION_LOCK_HELD must be true or false\n' >&2; exit 1 ;;
esac

script_dir="$(CDPATH= cd -- "$(dirname -- "$script_path")" && pwd -P)"
production_dir="$(CDPATH= cd -- "$script_dir/.." && pwd -P)"
project_root="$(CDPATH= cd -- "$production_dir/../.." && pwd -P)"
api_env="${OPENBMB_API_ENV_FILE:-/etc/openbmb/api.env}"
release_id="$(basename -- "$project_root")"

[[ "$#" -eq 0 ]] || {
  printf 'usage: %s\n' "${0##*/}" >&2
  exit 2
}
[[ -f "$api_env" ]] || {
  printf 'SMTP verification environment is missing: %s\n' "$api_env" >&2
  exit 1
}
[[ "$release_id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] || {
  printf 'release directory must use a safe immutable identifier.\n' >&2
  exit 1
}
if [[ -n "${OPENBMB_RELEASE:-}" && "$OPENBMB_RELEASE" != "$release_id" ]]; then
  printf 'OPENBMB_RELEASE must match the release containing this helper.\n' >&2
  exit 1
fi
if grep -Eq \
  '^[[:space:]]*SMTP_PASSWORD=.*(CHANGE_ME|REPLACE_WITH)' "$api_env"; then
  printf 'QQ SMTP authorization code is still a placeholder.\n' >&2
  exit 1
fi

export OPENBMB_API_ENV_FILE="$api_env"
export OPENBMB_RELEASE="$release_id"
export OPENBMB_APPLICATION_RELEASE="$release_id"
export OPENBMB_INFRASTRUCTURE_RELEASE="$release_id"

bash "$script_dir/verify-release-images.sh"
printf 'Authenticating the target API image with QQ SMTP; no message will be sent.\n'
# Compose supplies the exact production service environment, including the raw
# api.env file. The authorization code therefore enters the short-lived target
# image only as an environment variable: it is never expanded into argv or logs.
bash "$script_dir/compose.sh" run \
  --rm \
  --no-deps \
  --pull never \
  --no-TTY \
  --entrypoint node \
  api - <<'NODE'
'use strict';

(async () => {
  let adapter;
  try {
    const { ConfigService } = require('@nestjs/config');
    const {
      createMailDeliveryConfig,
    } = require('./dist/infrastructure/mail/mail.config.js');
    const {
      SmtpMailDeliveryAdapter,
    } = require('./dist/infrastructure/mail/adapters/smtp-mail-delivery.adapter.js');

    const config = createMailDeliveryConfig(new ConfigService(process.env));
    const smtp = config.smtp;
    if (
      config.environment !== 'production' ||
      config.mode !== 'smtp' ||
      !smtp ||
      smtp.host !== 'smtp.qq.com' ||
      smtp.port !== 465 ||
      smtp.secure !== true ||
      smtp.requireTls !== false
    ) {
      throw new Error('unexpected production SMTP configuration');
    }

    adapter = new SmtpMailDeliveryAdapter(config);
    await adapter.onModuleInit();
    process.stdout.write(
      'QQ SMTP authentication succeeded; no message was sent.\n',
    );
  } catch {
    process.stderr.write(
      'QQ SMTP authentication failed; no message was sent.\n',
    );
    process.exitCode = 1;
  } finally {
    adapter?.onModuleDestroy();
  }
})();
NODE
