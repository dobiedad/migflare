#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { configureMigaduDns } from "../src/index.js";

function usage() {
  console.log(`Usage:
  migflare <domain> [options]

Options:
  --zone-id <id>                 Cloudflare zone ID (skip zone lookup)
  --token <token>                Cloudflare API token (default: CLOUDFLARE_API_TOKEN)
  --migadu-user <email>          Migadu login email (default: MIGADU_USER)
  --migadu-token <token>         Migadu API token (default: MIGADU_API_TOKEN)
  --verification-value <value>   Manual Migadu verification TXT value
  --verification-name <name>     Verification TXT name/host (default: @)
  --dry-run                      Show what would change without writing
  --no-core                      Skip core apex MX + SPF records
  --no-dmarc                     Skip DMARC TXT record
  --no-verification              Skip Migadu verification TXT record
  --subdomain-addressing         Include wildcard MX records for subdomain addressing
  --no-subdomain-addressing      Do not include wildcard MX records (default)
  --no-autoconfig                Skip autoconfig/autodiscovery SRV + CNAME records
  -h, --help                     Show this help
`);
}

function parseArgs(argv) {
  const options = {
    includeCore: true,
    includeDmarc: true,
    includeVerification: true,
    includeSubdomainAddressing: false,
    includeAutoconfig: true,
    dryRun: false,
  };
  let domain;

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--no-core") {
      options.includeCore = false;
      continue;
    }

    if (arg === "--no-dmarc") {
      options.includeDmarc = false;
      continue;
    }

    if (arg === "--no-verification") {
      options.includeVerification = false;
      continue;
    }

    if (arg === "--subdomain-addressing") {
      options.includeSubdomainAddressing = true;
      continue;
    }

    if (arg === "--no-subdomain-addressing") {
      options.includeSubdomainAddressing = false;
      continue;
    }

    if (arg === "--no-autoconfig") {
      options.includeAutoconfig = false;
      continue;
    }

    if (arg === "--zone-id") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --zone-id");
      }
      options.zoneId = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--token") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --token");
      }
      options.token = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--migadu-user") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --migadu-user");
      }
      options.migaduUser = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--migadu-token") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --migadu-token");
      }
      options.migaduToken = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--verification-value") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --verification-value");
      }
      options.verificationValue = argv[i + 1];
      i += 1;
      continue;
    }

    if (arg === "--verification-name") {
      if (!argv[i + 1] || argv[i + 1].startsWith("-")) {
        throw new Error("Missing value for --verification-name");
      }
      options.verificationName = argv[i + 1];
      i += 1;
      continue;
    }

    if (!arg.startsWith("-") && !domain) {
      domain = arg;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { domain, options };
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function looksLikeToken(value) {
  const token = String(value || "").trim();
  return token.length >= 20 && !/\s/.test(token) && /^[\x21-\x7E]+$/.test(token);
}

function cleanCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/^bearer\s+/i, "")
    .replace(/^["'`]+|["'`,;]+$/g, "");
}

function extractToken(rawOutput) {
  const text = stripAnsi(rawOutput).trim();
  if (!text) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const direct = cleanCandidate(line);
    if (looksLikeToken(direct)) {
      return direct;
    }

    const matches = line.match(/[!-~]{20,}/g) || [];
    for (let j = matches.length - 1; j >= 0; j -= 1) {
      const candidate = cleanCandidate(matches[j]);
      if (looksLikeToken(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function getWranglerToken() {
  const commands = [
    ["wrangler", ["auth", "token"]],
    ["npx", ["-y", "wrangler", "auth", "token"]],
  ];

  for (const [cmd, args] of commands) {
    try {
      const output = execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, NO_COLOR: "1" },
      });

      const token = extractToken(output);
      if (token) {
        return token;
      }
    } catch {
      // Try next command.
    }
  }

  return null;
}

function runWranglerLogin() {
  const commands = [
    ["wrangler", ["login"]],
    ["npx", ["-y", "wrangler", "login"]],
  ];

  for (const [cmd, args] of commands) {
    try {
      execFileSync(cmd, args, {
        stdio: "inherit",
      });
      return true;
    } catch {
      // Try next command.
    }
  }

  return false;
}

function summarize(result) {
  const zoneLabel = result.zone?.name || result.zone?.id || "(not resolved)";
  console.log(`\nDomain: ${result.domain}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Zone: ${zoneLabel}`);
  console.log(`Created: ${result.created.length}`);
  console.log(`Updated: ${result.updated.length}`);
  console.log(`Skipped: ${result.skipped.length}`);
}

async function main() {
  const { domain, options } = parseArgs(process.argv);

  if (options.help || !domain) {
    usage();
    process.exit(options.help ? 0 : 1);
  }

  let resolvedToken = cleanCandidate(options.token || process.env.CLOUDFLARE_API_TOKEN);

  if (!resolvedToken && !options.dryRun) {
    resolvedToken = getWranglerToken();
  }

  if (!resolvedToken && !options.dryRun) {
    console.log("\nNo Cloudflare token found. Starting Wrangler login...");
    const loginRan = runWranglerLogin();
    if (!loginRan) {
      throw new Error("Could not run Wrangler login. Install Wrangler with `npm i -g wrangler`.");
    }
    resolvedToken = getWranglerToken();
  }

  if (!resolvedToken && !options.dryRun) {
    throw new Error("No token available after Wrangler login. Run `npx wrangler login` and try again.");
  }

  if (resolvedToken && !looksLikeToken(resolvedToken)) {
    throw new Error("Resolved token is invalid. Pass --token explicitly or set CLOUDFLARE_API_TOKEN.");
  }

  const resolvedMigaduUser = cleanCandidate(options.migaduUser || process.env.MIGADU_USER);
  const resolvedMigaduToken = cleanCandidate(options.migaduToken || process.env.MIGADU_API_TOKEN);
  const resolvedVerificationValue = cleanCandidate(options.verificationValue || process.env.MIGADU_VERIFICATION_VALUE);
  const resolvedVerificationName = cleanCandidate(options.verificationName || process.env.MIGADU_VERIFICATION_NAME || "@");
  if ((resolvedMigaduUser && !resolvedMigaduToken) || (!resolvedMigaduUser && resolvedMigaduToken)) {
    throw new Error("Set both MIGADU_USER and MIGADU_API_TOKEN, or pass both --migadu-user and --migadu-token.");
  }

  const result = await configureMigaduDns({
    domain,
    token: resolvedToken,
    zoneId: options.zoneId,
    dryRun: options.dryRun,
    includeCore: options.includeCore,
    includeDmarc: options.includeDmarc,
    includeVerification: options.includeVerification,
    includeSubdomainAddressing: options.includeSubdomainAddressing,
    includeAutoconfig: options.includeAutoconfig,
    verificationValue: resolvedVerificationValue,
    verificationName: resolvedVerificationName,
    migaduUser: resolvedMigaduUser,
    migaduToken: resolvedMigaduToken,
  });

  summarize(result);
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exit(1);
});
