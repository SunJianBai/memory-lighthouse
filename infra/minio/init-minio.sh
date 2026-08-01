#!/bin/sh
set -eu

case "${MINIO_BUCKET:-}" in
  ''|*[!a-z0-9.-]*)
    echo "MINIO_BUCKET must be a non-empty lowercase S3 bucket name" >&2
    exit 64
    ;;
esac

case "${MINIO_APP_ACCESS_KEY:-}" in
  ''|*[!A-Za-z0-9_-]*)
    echo "MINIO_APP_ACCESS_KEY must use base64url characters" >&2
    exit 64
    ;;
esac

if [ "${#MINIO_APP_SECRET_KEY}" -lt 32 ]; then
  echo "MINIO_APP_SECRET_KEY must contain at least 32 characters" >&2
  exit 64
fi

case "$MINIO_APP_SECRET_KEY" in
  *[!A-Za-z0-9_-]*)
    echo "MINIO_APP_SECRET_KEY contains a character outside the base64url alphabet" >&2
    exit 64
    ;;
esac

mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc ready local
mc mb --ignore-existing "local/$MINIO_BUCKET"
mc version enable "local/$MINIO_BUCKET"
mc anonymous set none "local/$MINIO_BUCKET"

cat > /tmp/openbmb-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": ["arn:aws:s3:::$MINIO_BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["arn:aws:s3:::$MINIO_BUCKET/*"]
    }
  ]
}
EOF

# `policy create` deliberately overwrites an existing policy so tightened
# permissions are applied on every deployment instead of only on first boot.
mc admin policy create local openbmb-app /tmp/openbmb-policy.json

if ! mc admin user info local "$MINIO_APP_ACCESS_KEY" >/dev/null 2>&1; then
  mc admin user add local "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
fi

mc admin user enable local "$MINIO_APP_ACCESS_KEY"
mc admin policy attach local openbmb-app --user "$MINIO_APP_ACCESS_KEY"

mc alias set app http://minio:9000 "$MINIO_APP_ACCESS_KEY" "$MINIO_APP_SECRET_KEY"
if ! mc ls "app/$MINIO_BUCKET" >/dev/null 2>&1; then
  echo "The existing MinIO application identity does not match MINIO_APP_SECRET_KEY; rotate it deliberately instead of silently replacing it" >&2
  exit 65
fi

echo "MinIO bucket and least-privilege application identity are ready"
