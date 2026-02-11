# migflare

One-command CLI and npm module to configure Migadu DNS records in Cloudflare.

## Why

Manually adding Migadu DNS records in Cloudflare is repetitive and error-prone, especially when onboarding multiple domains. `migflare` turns that checklist into one command.

## Features

- One command per domain
- Idempotent create/update behavior (safe to re-run).
- `--dry-run` preview mode.
- Auto zone lookup (or explicit `--zone-id`).
- Optional record groups via flags.
- Optional Migadu API sync (`MIGADU_USER` + `MIGADU_API_TOKEN`) for account-specific DNS records including verification TXT.
- Manual verification override via `--verification-value` (no Migadu API required).

## Requirements

- Node.js `>=18`
- Cloudflare account with DNS-managed zones
- Cloudflare API token with `Zone:DNS:Edit` and `Zone:Zone:Read`
- Optional: Migadu API credentials to sync per-domain DNS template and verification record

## Install

Global CLI:

```bash
npm i -g migflare
```

Run once with npx:

```bash
npx migflare example.com --dry-run
```

Library usage:

```bash
npm i migflare
```

## Authentication

Cloudflare (required for non-dry-run): set `CLOUDFLARE_API_TOKEN`.

```bash
export CLOUDFLARE_API_TOKEN="your_token_here"
```

Fallback behavior (non-dry-run):

1. `--token`
2. `CLOUDFLARE_API_TOKEN`
3. `wrangler auth token`
4. automatic `wrangler login` if still missing

Migadu (optional, enables API-based record sync + verification TXT):

```bash
export MIGADU_USER="you@example.com"
export MIGADU_API_TOKEN="your_migadu_api_token"
```

Migadu API auth uses HTTP Basic auth with your account email as username and API token as password.

Manual verification override (optional):

```bash
export MIGADU_VERIFICATION_VALUE="hosted-email-verify=your_value"
# optional, default is root/@
export MIGADU_VERIFICATION_NAME="@"
```

## Quickstart

```bash
# 1) preview
migflare example.com --dry-run

# 2) apply
migflare example.com
```

Local run without global install:

```bash
node ./bin/migflare.js example.com
```

Expected summary output:

```text
Domain: example.com
Mode: apply
Zone: example.com
Created: X
Updated: Y
Skipped: Z
```

## Records Created

By default, `migflare` creates the following (TTL = Auto):

| Group | Type | Name | Value | Extra |
|---|---|---|---|---|
| Core | MX | `@` | `aspmx1.migadu.com` | priority `10` |
| Core | MX | `@` | `aspmx2.migadu.com` | priority `20` |
| Core | TXT | `@` | `v=spf1 include:spf.migadu.com -all` | |
| DKIM/ARC | CNAME | `key1._domainkey` | `key1.<domain>._domainkey.migadu.com` | |
| DKIM/ARC | CNAME | `key2._domainkey` | `key2.<domain>._domainkey.migadu.com` | |
| DKIM/ARC | CNAME | `key3._domainkey` | `key3.<domain>._domainkey.migadu.com` | |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=quarantine;` | |
| Autoconfig | CNAME | `autoconfig` | `autoconfig.migadu.com` | |
| Autoconfig | SRV | `_autodiscover._tcp` | `autodiscover.migadu.com` | port `443`, priority `0`, weight `1` |
| Autoconfig | SRV | `_submissions._tcp` | `smtp.migadu.com` | port `465`, priority `0`, weight `1` |
| Autoconfig | SRV | `_imaps._tcp` | `imap.migadu.com` | port `993`, priority `0`, weight `1` |
| Autoconfig | SRV | `_pop3s._tcp` | `pop.migadu.com` | port `995`, priority `0`, weight `1` |

Optional records:

| Group | Type | Name | Value | Extra |
|---|---|---|---|---|
| Subdomain | MX | `*` | `aspmx1.migadu.com` | priority `10` |
| Subdomain | MX | `*` | `aspmx2.migadu.com` | priority `20` |
| Verification (via Migadu API) | TXT | from Migadu API | account-specific value | included when Migadu credentials are set |

When Migadu API sync is enabled, `@` TXT records for SPF and verification are both managed and must coexist.

## CLI

```bash
migflare <domain> [options]
```

Options:

- `--zone-id <id>`: explicit Cloudflare zone ID.
- `--token <token>`: explicit API token.
- `--migadu-user <email>`: Migadu login email.
- `--migadu-token <token>`: Migadu API token.
- `--verification-value <value>`: manual verification TXT value (e.g. `hosted-email-verify=...`).
- `--verification-name <name>`: manual verification TXT host/name (default: `@`).
- `--dry-run`: show changes without writing.
- `--no-core`: skip apex MX + SPF.
- `--no-dmarc`: skip DMARC TXT.
- `--no-verification`: skip Migadu verification TXT (when using Migadu API).
- `--subdomain-addressing`: include wildcard MX for subdomain-address mail flow.
- `--no-subdomain-addressing`: disable wildcard MX (default).
- `--no-autoconfig`: skip autoconfig/autodiscovery records.
- `-h, --help`: help output.

Examples:

```bash
migflare example.com --dry-run
migflare example.com --zone-id <zone_id>
migflare example.com --no-dmarc
migflare example.com --subdomain-addressing
MIGADU_USER=you@example.com MIGADU_API_TOKEN=... migflare example.com
migflare example.com --verification-value hosted-email-verify=93kvairy
```

## Module Usage

```js
import { configureMigaduDns } from "migflare";

const result = await configureMigaduDns({
  domain: "example.com",
  token: process.env.CLOUDFLARE_API_TOKEN,
  migaduUser: process.env.MIGADU_USER,
  migaduToken: process.env.MIGADU_API_TOKEN,
  verificationValue: process.env.MIGADU_VERIFICATION_VALUE,
  verificationName: process.env.MIGADU_VERIFICATION_NAME || "@",
  dryRun: true,
});

console.log(result);
```

## Troubleshooting

- `403 ... GET /zones?...`: token missing `Zone:Zone:Read`, wrong account, or pass `--zone-id`.
- `403 ... /dns_records ...`: token missing `Zone:DNS:Edit` for that zone.
- `No Cloudflare zone found`: zone is not in the authenticated account, or domain/zone mismatch.
- Auth source confusion: pass `--token` explicitly to isolate.
- `401/403 ... /v1/domains/.../records`: invalid Migadu credentials (`MIGADU_USER` or `MIGADU_API_TOKEN`).
- `404 ... /v1/domains/.../records`: domain is not present in the Migadu account used by the API token.
- SPF disappears after adding verification TXT: upgrade to `>=1.1.0` so `migflare` updates SPF and verification as separate TXT records.

## Security Notes

- Prefer scoped API tokens over Global API Key.
- Grant minimum permissions needed.
- Rotate token if it is ever exposed in terminal history or logs.

## Contributing

```bash
npm run check
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```
