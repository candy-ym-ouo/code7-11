#!/bin/sh
set -eu
MINIO_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"
until mc alias set local http://minio:9000 "$MINIO_USER" "$MINIO_PASSWORD"; do sleep 1; done
mc mb --ignore-existing local/${MINIO_QUARANTINE_BUCKET:-map-quarantine}
mc mb --ignore-existing local/${MINIO_PUBLIC_BUCKET:-map-public}
mc anonymous set none local/${MINIO_QUARANTINE_BUCKET:-map-quarantine}
mc anonymous set download local/${MINIO_PUBLIC_BUCKET:-map-public}
mc cors set local/${MINIO_QUARANTINE_BUCKET:-map-quarantine} /init/cors.xml || echo "warning: MinIO did not accept bucket CORS; configure CORS at the reverse proxy if browser uploads are blocked"
mc cors set local/${MINIO_PUBLIC_BUCKET:-map-public} /init/cors.xml || echo "warning: MinIO did not accept bucket CORS; configure CORS at the reverse proxy if browser uploads are blocked"
echo "MinIO buckets initialized"
