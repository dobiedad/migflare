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

## Requirements

- Node.js `>=18`
- Cloudflare account with DNS-managed zones
- Cloudflare API token with `Zone:DNS:Edit` and `Zone:Zone:Read`

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

Recommended: set `CLOUDFLARE_API_TOKEN`.

```bash
export CLOUDFLARE_API_TOKEN="your_token_here"
```

Fallback behavior (non-dry-run):

1. `--token`
2. `CLOUDFLARE_API_TOKEN`
3. `wrangler auth token`
4. automatic `wrangler login` if still missing

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

By default, `migflare` creates all of the following (TTL = Auto):

| Group | Type | Name | Value | Extra |
|---|---|---|---|---|
| Core | MX | `@` | `aspmx1.migadu.com` | priority `10` |
| Core | MX | `@` | `aspmx2.migadu.com` | priority `20` |
| Core | TXT | `@` | `v=spf1 include:spf.migadu.com -all` | |
| DKIM/ARC | CNAME | `key1._domainkey` | `key1.<domain>._domainkey.migadu.com` | |
| DKIM/ARC | CNAME | `key2._domainkey` | `key2.<domain>._domainkey.migadu.com` | |
| DKIM/ARC | CNAME | `key3._domainkey` | `key3.<domain>._domainkey.migadu.com` | |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=quarantine;` | |
| Subdomain | MX | `*` | `aspmx1.migadu.com` | priority `10` |
| Subdomain | MX | `*` | `aspmx2.migadu.com` | priority `20` |
| Autoconfig | CNAME | `autoconfig` | `autoconfig.migadu.com` | |
| Autoconfig | SRV | `_autodiscover._tcp` | `autodiscover.migadu.com` | port `443`, priority `0`, weight `1` |
| Autoconfig | SRV | `_submissions._tcp` | `smtp.migadu.com` | port `465`, priority `0`, weight `1` |
| Autoconfig | SRV | `_imaps._tcp` | `imap.migadu.com` | port `993`, priority `0`, weight `1` |
| Autoconfig | SRV | `_pop3s._tcp` | `pop.migadu.com` | port `995`, priority `0`, weight `1` |

## CLI

```bash
migflare <domain> [options]
```

Options:

- `--zone-id <id>`: explicit Cloudflare zone ID.
- `--token <token>`: explicit API token.
- `--dry-run`: show changes without writing.
- `--no-core`: skip apex MX + SPF.
- `--no-dmarc`: skip DMARC TXT.
- `--no-subdomain-addressing`: skip wildcard MX.
- `--no-autoconfig`: skip autoconfig/autodiscovery records.
- `-h, --help`: help output.

Examples:

```bash
migflare example.com --dry-run
migflare example.com --zone-id <zone_id>
migflare example.com --no-dmarc
```

## Module Usage

```js
import { configureMigaduDns } from "migflare";

const result = await configureMigaduDns({
  domain: "example.com",
  token: process.env.CLOUDFLARE_API_TOKEN,
  dryRun: true,
});

console.log(result);
```

## Troubleshooting

- `403 ... GET /zones?...`: token missing `Zone:Zone:Read`, wrong account, or pass `--zone-id`.
- `403 ... /dns_records ...`: token missing `Zone:DNS:Edit` for that zone.
- `No Cloudflare zone found`: zone is not in the authenticated account, or domain/zone mismatch.
- Auth source confusion: pass `--token` explicitly to isolate.

## Security Notes

- Prefer scoped API tokens over Global API Key.
- Grant minimum permissions needed.
- Rotate token if it is ever exposed in terminal history or logs.

## Contributing

```bash
npm run check
npm_config_cache=/tmp/npm-cache npm pack --dry-run
```
