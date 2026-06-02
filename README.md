# Up Actual Sync

Automatically sync bank transactions from [Up](https://up.com.au) to your self-hosted [Actual Budget](https://actualbudget.org/) instance.

Ships as a single Docker image. Pull, configure, schedule, done.

## How It Works

1. Fetches transactions (pending and settled) from your Up accounts via personal access token
2. Maps them to your Actual Budget accounts
3. Imports using Actual's `importTransactions()` with deduplication
4. Safe to run repeatedly — duplicate transactions are never created

## Quick Start

### 1. Get an Up Personal Access Token

1. Go to [api.up.com.au](https://api.up.com.au/)
2. Generate a personal access token
3. Copy it (shown once)

### 2. Find Your Account IDs

```bash
# List your Up accounts
docker run --rm \
  -e UP_API_KEY=up:yeah:... \
  ghcr.io/ericmackrodt/up-actual-sync:latest \
  --list-up-accounts

# List your Actual Budget accounts
docker run --rm \
  -e ACTUAL_SERVER_URL=http://localhost:5006 \
  -e ACTUAL_PASSWORD=your-password \
  -e ACTUAL_BUDGET_ID=your-budget-sync-id \
  -v actual-sync-data:/app/data \
  ghcr.io/ericmackrodt/up-actual-sync:latest \
  --list-actual-accounts
```

### 3. Create a `.env` File

```bash
UP_API_KEY=up:yeah:your_personal_access_token_here
ACTUAL_SERVER_URL=http://localhost:5006
ACTUAL_PASSWORD=your-password
ACTUAL_BUDGET_ID=1cfdbb80-6274-49bf-b0c2-737235a4c81f
ACCOUNT_MAPPING=up-account-uuid:actual-account-uuid,up-account-uuid-2:actual-account-uuid-2

# If your budget has end-to-end encryption enabled:
# ACTUAL_ENCRYPTION_PASSWORD=your-encryption-password
```

### 4. Run

```bash
# Preview first (no changes written)
docker run --rm --env-file .env \
  -v actual-sync-data:/app/data \
  ghcr.io/ericmackrodt/up-actual-sync:latest --dry-run

# Run for real
docker run --rm --env-file .env \
  -v actual-sync-data:/app/data \
  ghcr.io/ericmackrodt/up-actual-sync:latest
```

### 5. Schedule

```bash
# Cron: sync every 6 hours
0 */6 * * * docker run --rm --env-file /home/user/.up-sync.env -v actual-sync-data:/app/data ghcr.io/ericmackrodt/up-actual-sync:latest >> /var/log/up-sync.log 2>&1
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `UP_API_KEY` | Yes | — | Your Up personal access token (`up:yeah:...`) |
| `ACTUAL_SERVER_URL` | Yes | — | URL of your Actual Budget server |
| `ACTUAL_PASSWORD` | Yes | — | Actual Budget server password |
| `ACTUAL_BUDGET_ID` | Yes | — | Budget sync ID (Settings > Advanced in Actual) |
| `ACCOUNT_MAPPING` | Yes | — | Account mapping (see below) |
| `ACTUAL_ENCRYPTION_PASSWORD` | No | — | E2E encryption password if enabled |
| `ACTUAL_DATA_DIR` | No | `./data` | Local cache directory for Actual's SQLite DB |
| `SYNC_DAYS` | No | `30` | Number of days of history to sync |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |
| `DRY_RUN` | No | `false` | Set to `true` to preview without importing |

### Encrypted Databases

If your Actual Budget has end-to-end encryption enabled, set `ACTUAL_ENCRYPTION_PASSWORD` in addition to `ACTUAL_PASSWORD`. This is the encryption passphrase you chose when enabling E2E encryption in Actual, not your server login password.

### Account Mapping

Maps Up account IDs to Actual Budget account IDs, comma-separated:

```
ACCOUNT_MAPPING=<up_account_id>:<actual_id>,<up_account_id>:<actual_id>
```

**Finding IDs:**
- **Up**: Run `--list-up-accounts` to see your account UUIDs
- **Actual**: Run `--list-actual-accounts` or copy the UUID from the account URL in Actual's web UI

### CLI Flags

| Flag | Description |
|------|-------------|
| `--list-up-accounts` | List Up accounts and their IDs |
| `--list-actual-accounts` | List Actual Budget accounts and their IDs |
| `--dry-run` | Preview what would be imported without writing |
| `--days <n>` | Override number of days to sync |
| `--help` | Show help message |

## Docker

### Docker Run

```bash
docker run --rm \
  --env-file .env \
  -v actual-sync-data:/app/data \
  ghcr.io/ericmackrodt/up-actual-sync:latest
```

The `/app/data` volume caches the Actual Budget SQLite database locally. Mount a persistent volume so it doesn't re-download the full budget every run.

### Docker Compose

See [`docker-compose.example.yml`](docker-compose.example.yml) for a ready-to-use setup that includes both this tool and an Actual Budget server.

### Kubernetes CronJob

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: up-actual-sync
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: sync
              image: ghcr.io/ericmackrodt/up-actual-sync:latest
              envFrom:
                - secretRef:
                    name: up-actual-sync-secrets
              volumeMounts:
                - name: data
                  mountPath: /app/data
          volumes:
            - name: data
              persistentVolumeClaim:
                claimName: up-actual-sync-data
```

## How Deduplication Works

Each transaction is imported with an `imported_id` of `up:<transaction_id>`. Actual Budget's `importTransactions()` uses this to detect duplicates:

1. If a transaction with the same `imported_id` exists, it updates instead of creating a duplicate
2. If no `imported_id` match, Actual falls back to fuzzy matching on amount + date + payee

This means you can safely run the sync as often as you want.

## API Version Matching

Actual Budget updates frequently and the sync protocol can break between client/server versions. This tool automatically:

1. Checks your Actual server's version via `/info`
2. If it differs from the bundled `@actual-app/api`, downloads the matching version from npm
3. Caches it in the data directory for subsequent runs (~5 second cold start, instant after)

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Sync completed successfully |
| 1 | Sync completed with errors (some transactions failed) |
| 2 | Configuration error (missing env vars, invalid mapping) |
| 3 | Connection error (cannot reach Up or Actual) |
| 4 | Actual server version is newer than the bundled API and no matching version could be downloaded (upgrade this container) |

## Security

- **API token**: Your Up token is only sent over HTTPS. Never bake it into Docker images.
- **Local data**: The tool caches your Actual budget in `ACTUAL_DATA_DIR`. Encrypt the Docker volume on shared infrastructure.
- **Secrets**: Use `--env-file` or orchestrator secrets (Kubernetes Secrets, Docker Secrets). Avoid `-e` flags which may persist in shell history.
- **Self-signed certs**: Set `NODE_EXTRA_CA_CERTS=/path/to/cert.pem` for Actual servers with self-signed certificates.

## Development

```bash
# Install dependencies
pnpm install

# Run locally
pnpm dev -- --dry-run

# Type check
pnpm lint

# Run tests
pnpm test

# Build
pnpm build
```

## License

MIT
