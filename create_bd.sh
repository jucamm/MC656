#!/usr/bin/env bash
set -euo pipefail

container=mc656-postgres
volume=mc656-postgres-data
label=br.unicamp.mc656.local-db
port=${POSTGRES_PORT:-5432}
database_url="postgresql://postgres:postgres@127.0.0.1:${port}/mc656"

if [[ ! $port =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
  printf 'POSTGRES_PORT deve ser um número entre 1 e 65535.\n' >&2
  exit 1
fi

if ! command -v docker >/dev/null; then
  printf 'Instale o Docker para criar o banco local.\n' >&2
  exit 1
fi

if ! docker info >/dev/null; then
  printf 'Inicie o Docker e verifique se seu usuário tem acesso ao daemon.\n' >&2
  exit 1
fi

if existing_label=$(docker container inspect --format "{{ index .Config.Labels \"$label\" }}" "$container" 2>/dev/null); then
  if [[ $existing_label != "$port" ]]; then
    printf 'Já existe um contêiner %s com outra configuração. Verifique com docker inspect %s.\n' "$container" "$container" >&2
    exit 1
  fi
  docker start "$container" >/dev/null
else
  docker run -d --name "$container" \
    --label "$label=$port" \
    --publish "127.0.0.1:$port:5432" \
    --mount "type=volume,source=$volume,target=/var/lib/postgresql/data" \
    --env POSTGRES_DB=mc656 \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_PASSWORD=postgres \
    postgres:16 >/dev/null
fi

printf 'Aguardando o PostgreSQL em 127.0.0.1:%s...\n' "$port"
for ((attempt = 1; attempt <= 60; attempt++)); do
  if docker exec --env PGPASSWORD=postgres --env PGCONNECT_TIMEOUT=2 "$container" \
    psql --no-password --host=127.0.0.1 --username=postgres --dbname=mc656 \
    --command='SELECT 1' >/dev/null 2>&1; then
    printf 'Banco pronto. Configure esta linha em back/.env:\nDATABASE_URL=%s\n' "$database_url"
    exit 0
  fi
  sleep 1
done

printf 'O PostgreSQL não ficou pronto. Consulte docker logs %s.\n' "$container" >&2
exit 1
