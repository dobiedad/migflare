const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const MIGADU_API_BASE = "https://api.migadu.com/v1";

const MANAGED_COMMENT = "Managed by migflare";

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeDnsValue(value) {
  return String(value || "").trim().toLowerCase().replace(/\.+$/, "");
}

function normalizeTxtValue(value) {
  const cleaned = String(value || "").trim().replace(/^"+|"+$/g, "");
  return normalizeDnsValue(cleaned);
}

function cleanText(value) {
  return String(value || "").trim();
}

function absoluteName(host, domain) {
  const cleanHost = normalizeDomain(host);
  const cleanDomain = normalizeDomain(domain);

  if (!cleanHost || cleanHost === "@") {
    return cleanDomain;
  }

  if (cleanHost.endsWith(`.${cleanDomain}`)) {
    return cleanHost;
  }

  return `${cleanHost}.${cleanDomain}`;
}

function toBasicAuthHeader(user, token) {
  const raw = `${cleanText(user)}:${cleanText(token)}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

function buildAutoconfigRecords(domain) {
  const cleanDomain = normalizeDomain(domain);

  return [
    {
      type: "CNAME",
      name: absoluteName("autoconfig", cleanDomain),
      content: "autoconfig.migadu.com",
      ttl: 1,
      proxied: false,
      comment: MANAGED_COMMENT,
    },
    {
      type: "SRV",
      name: absoluteName("_autodiscover._tcp", cleanDomain),
      ttl: 1,
      data: {
        port: 443,
        priority: 0,
        target: "autodiscover.migadu.com",
        weight: 1,
      },
      comment: MANAGED_COMMENT,
    },
    {
      type: "SRV",
      name: absoluteName("_submissions._tcp", cleanDomain),
      ttl: 1,
      data: {
        port: 465,
        priority: 0,
        target: "smtp.migadu.com",
        weight: 1,
      },
      comment: MANAGED_COMMENT,
    },
    {
      type: "SRV",
      name: absoluteName("_imaps._tcp", cleanDomain),
      ttl: 1,
      data: {
        port: 993,
        priority: 0,
        target: "imap.migadu.com",
        weight: 1,
      },
      comment: MANAGED_COMMENT,
    },
    {
      type: "SRV",
      name: absoluteName("_pop3s._tcp", cleanDomain),
      ttl: 1,
      data: {
        port: 995,
        priority: 0,
        target: "pop.migadu.com",
        weight: 1,
      },
      comment: MANAGED_COMMENT,
    },
  ];
}

function buildDefaultMigaduRecords(domain, options = {}) {
  const cleanDomain = normalizeDomain(domain);
  const {
    includeCore = true,
    includeDmarc = true,
    includeSubdomainAddressing = false,
    includeAutoconfig = true,
  } = options;

  const records = [];

  if (includeCore) {
    records.push(
      {
        type: "MX",
        name: absoluteName("@", cleanDomain),
        content: "aspmx1.migadu.com",
        priority: 10,
        ttl: 1,
        comment: MANAGED_COMMENT,
      },
      {
        type: "MX",
        name: absoluteName("@", cleanDomain),
        content: "aspmx2.migadu.com",
        priority: 20,
        ttl: 1,
        comment: MANAGED_COMMENT,
      },
      {
        type: "TXT",
        name: absoluteName("@", cleanDomain),
        content: "v=spf1 include:spf.migadu.com -all",
        ttl: 1,
        comment: MANAGED_COMMENT,
      }
    );
  }

  records.push(
    {
      type: "CNAME",
      name: absoluteName("key1._domainkey", cleanDomain),
      content: `key1.${cleanDomain}._domainkey.migadu.com`,
      ttl: 1,
      proxied: false,
      comment: MANAGED_COMMENT,
    },
    {
      type: "CNAME",
      name: absoluteName("key2._domainkey", cleanDomain),
      content: `key2.${cleanDomain}._domainkey.migadu.com`,
      ttl: 1,
      proxied: false,
      comment: MANAGED_COMMENT,
    },
    {
      type: "CNAME",
      name: absoluteName("key3._domainkey", cleanDomain),
      content: `key3.${cleanDomain}._domainkey.migadu.com`,
      ttl: 1,
      proxied: false,
      comment: MANAGED_COMMENT,
    }
  );

  if (includeDmarc) {
    records.push({
      type: "TXT",
      name: absoluteName("_dmarc", cleanDomain),
      content: "v=DMARC1; p=quarantine;",
      ttl: 1,
      comment: MANAGED_COMMENT,
    });
  }

  if (includeSubdomainAddressing) {
    records.push(
      {
        type: "MX",
        name: absoluteName("*", cleanDomain),
        content: "aspmx1.migadu.com",
        priority: 10,
        ttl: 1,
        comment: MANAGED_COMMENT,
      },
      {
        type: "MX",
        name: absoluteName("*", cleanDomain),
        content: "aspmx2.migadu.com",
        priority: 20,
        ttl: 1,
        comment: MANAGED_COMMENT,
      }
    );
  }

  if (includeAutoconfig) {
    records.push(...buildAutoconfigRecords(cleanDomain));
  }

  return records;
}

function toRecordName(name, domain) {
  const cleanName = cleanText(name);
  return absoluteName(cleanName || "@", domain);
}

function parsePriority(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeVerificationValue(value) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return "";
  }

  return cleaned.includes("=") ? cleaned : `hosted-email-verify=${cleaned}`;
}

function isVerificationTxtRecord(record) {
  return String(record?.type || "").trim().toUpperCase() === "TXT" && normalizeTxtValue(record?.content).startsWith("hosted-email-verify=");
}

function buildMigaduApiRecords(domain, migaduDomain, options = {}) {
  const cleanDomain = normalizeDomain(domain);
  const {
    includeCore = true,
    includeDmarc = true,
    includeSubdomainAddressing = false,
    includeAutoconfig = true,
    includeVerification = true,
  } = options;

  const records = [];
  const mxRecords = Array.isArray(migaduDomain?.mx_records)
    ? migaduDomain.mx_records
        .map((entry) => ({
          name: toRecordName(entry?.name, cleanDomain),
          content: normalizeDnsValue(entry?.value ?? entry?.content),
          priority: parsePriority(entry?.priority),
        }))
        .filter((entry) => entry.content)
    : [];

  if (includeCore) {
    for (const mx of mxRecords) {
      records.push({
        type: "MX",
        name: mx.name,
        content: mx.content,
        priority: mx.priority,
        ttl: 1,
        comment: MANAGED_COMMENT,
      });
    }

    const spfType = String(migaduDomain?.spf?.type || "").trim().toUpperCase();
    const spfContent = cleanText(
      migaduDomain?.spf?.value ?? migaduDomain?.spf?.content ?? (typeof migaduDomain?.spf === "string" ? migaduDomain.spf : "")
    );
    if ((!spfType || spfType === "TXT") && spfContent) {
      records.push({
        type: "TXT",
        name: toRecordName(migaduDomain?.spf?.name, cleanDomain),
        content: spfContent,
        ttl: 1,
        comment: MANAGED_COMMENT,
      });
    }
  }

  const dkimRecords = Array.isArray(migaduDomain?.dkim) ? migaduDomain.dkim : [];
  for (const dkim of dkimRecords) {
    const type = String(dkim?.type || "").trim().toUpperCase();
    const content = normalizeDnsValue(dkim?.value ?? dkim?.content);
    if (type !== "CNAME" || !content) {
      continue;
    }

    records.push({
      type: "CNAME",
      name: toRecordName(dkim?.name, cleanDomain),
      content,
      ttl: 1,
      proxied: false,
      comment: MANAGED_COMMENT,
    });
  }

  if (includeDmarc && migaduDomain?.dmarc) {
    const dmarcType = String(migaduDomain.dmarc.type || "").trim().toUpperCase();
    const dmarcContent = cleanText(migaduDomain.dmarc.value ?? migaduDomain.dmarc.content);
    if (dmarcType === "TXT" && dmarcContent) {
      records.push({
        type: "TXT",
        name: toRecordName(migaduDomain.dmarc.name, cleanDomain),
        content: dmarcContent,
        ttl: 1,
        comment: MANAGED_COMMENT,
      });
    }
  }

  if (includeVerification && migaduDomain?.dns_verification) {
    const verificationType = String(migaduDomain.dns_verification.type || "").trim().toUpperCase();
    const verificationContent = normalizeVerificationValue(
      migaduDomain.dns_verification.value ?? migaduDomain.dns_verification.content
    );
    if (verificationType === "TXT" && verificationContent) {
      records.push({
        type: "TXT",
        name: toRecordName(migaduDomain.dns_verification.name, cleanDomain),
        content: verificationContent,
        ttl: 1,
        comment: MANAGED_COMMENT,
      });
    }
  }

  if (includeSubdomainAddressing) {
    for (const mx of mxRecords) {
      records.push({
        type: "MX",
        name: absoluteName("*", cleanDomain),
        content: mx.content,
        priority: mx.priority,
        ttl: 1,
        comment: MANAGED_COMMENT,
      });
    }
  }

  if (includeAutoconfig) {
    records.push(...buildAutoconfigRecords(cleanDomain));
  }

  return records;
}

function buildMigaduRecords(domain, options = {}) {
  const cleanDomain = normalizeDomain(domain);
  const {
    includeCore = true,
    includeDmarc = true,
    includeSubdomainAddressing = false,
    includeAutoconfig = true,
    includeVerification = true,
    migaduDomain = null,
    verificationValue = "",
    verificationName = "@",
  } = options;

  const records = migaduDomain
    ? buildMigaduApiRecords(cleanDomain, migaduDomain, {
      includeCore,
      includeDmarc,
      includeSubdomainAddressing,
      includeAutoconfig,
      includeVerification,
    })
    : buildDefaultMigaduRecords(cleanDomain, {
      includeCore,
      includeDmarc,
      includeSubdomainAddressing,
      includeAutoconfig,
    });

  if (includeVerification) {
    const manualVerification = normalizeVerificationValue(verificationValue);
    if (manualVerification) {
      const name = toRecordName(verificationName, cleanDomain);
      const manualRecord = {
        type: "TXT",
        name,
        content: manualVerification,
        ttl: 1,
        comment: MANAGED_COMMENT,
      };

      const existingIndex = records.findIndex(
        (record) => isVerificationTxtRecord(record) && normalizeDnsValue(record.name) === normalizeDnsValue(name)
      );

      if (existingIndex >= 0) {
        records[existingIndex] = manualRecord;
      } else {
        records.push(manualRecord);
      }
    }
  }

  return records;
}

function recordFingerprint(record) {
  const type = normalizeDomain(record.type);
  const name = normalizeDnsValue(record.name);

  if (type === "mx") {
    return `${type}|${name}|${Number(record.priority || 0)}|${normalizeDnsValue(record.content)}`;
  }

  if (type === "srv") {
    const data = record.data || {};
    return `${type}|${name}|${Number(data.priority || 0)}|${Number(data.weight || 0)}|${Number(data.port || 0)}|${normalizeDnsValue(data.target)}`;
  }

  if (type === "txt") {
    return `${type}|${name}|${normalizeTxtValue(record.content)}`;
  }

  return `${type}|${name}|${normalizeDnsValue(record.content)}`;
}

function classifyTxtRecord(record) {
  const name = normalizeDnsValue(record?.name);
  const content = normalizeTxtValue(record?.content);

  if (name === "_dmarc" || name.startsWith("_dmarc.") || content.startsWith("v=dmarc1")) {
    return "dmarc";
  }

  if (content.startsWith("v=spf1")) {
    return "spf";
  }

  if (content.startsWith("hosted-email-verify=")) {
    return "verification";
  }

  return "generic";
}

function toCloudflarePayload(record) {
  const payload = {
    type: record.type,
    name: record.name,
    ttl: record.ttl ?? 1,
    comment: record.comment,
  };

  if (record.type === "SRV") {
    payload.data = {
      port: Number(record.data.port),
      priority: Number(record.data.priority),
      target: record.data.target,
      weight: Number(record.data.weight),
    };
    return payload;
  }

  payload.content = record.content;

  if (record.type === "MX") {
    payload.priority = Number(record.priority);
  }

  if (record.type === "CNAME") {
    payload.proxied = Boolean(record.proxied);
  }

  return payload;
}

async function cfRequest(token, method, path, body) {
  const response = await fetch(`${CF_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let json;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok || !json?.success) {
    const details = json?.errors?.map((entry) => entry.message).filter(Boolean).join("; ");
    const endpoint = `${method} ${path}`;
    let message = details
      ? `${details} (status ${response.status}, ${endpoint})`
      : `Cloudflare API request failed (status ${response.status}, ${endpoint})`;

    if (response.status === 403 && path.startsWith("/zones?")) {
      message += " - Missing `Zone:Zone:Read` permission or wrong account. You can also pass `--zone-id`.";
    } else if (response.status === 403 && path.includes("/dns_records")) {
      message += " - Missing `Zone:DNS:Edit` permission on this zone.";
    }

    throw new Error(message);
  }

  return json.result;
}

async function migaduRequest(user, token, method, path) {
  const response = await fetch(`${MIGADU_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: toBasicAuthHeader(user, token),
      Accept: "application/json",
    },
  });

  let json;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (!response.ok) {
    const details =
      cleanText(json?.detail) ||
      cleanText(json?.message) ||
      (Array.isArray(json?.errors) ? json.errors.map((entry) => cleanText(entry)).filter(Boolean).join("; ") : "");
    const endpoint = `${method} ${path}`;
    let message = details
      ? `${details} (status ${response.status}, ${endpoint})`
      : `Migadu API request failed (status ${response.status}, ${endpoint})`;

    if (response.status === 401 || response.status === 403) {
      message += " - Check MIGADU_USER and MIGADU_API_TOKEN.";
    } else if (response.status === 404 && path.startsWith("/domains/")) {
      message += " - Domain not found in this Migadu account.";
    }

    throw new Error(message);
  }

  if (!json || typeof json !== "object") {
    throw new Error(`Migadu API returned an unexpected response for ${method} ${path}`);
  }

  return json;
}

async function fetchMigaduDomainTemplate(domain, migaduUser, migaduToken) {
  const cleanDomain = normalizeDomain(domain);
  const user = cleanText(migaduUser);
  const token = cleanText(migaduToken);

  if (!user && !token) {
    return null;
  }

  if (!user || !token) {
    throw new Error("Both MIGADU_USER and MIGADU_API_TOKEN are required to fetch records from Migadu API.");
  }

  return migaduRequest(user, token, "GET", `/domains/${encodeURIComponent(cleanDomain)}/records`);
}

async function lookupZoneId(token, domain) {
  const labels = normalizeDomain(domain).split(".");

  for (let i = 0; i < labels.length - 1; i += 1) {
    const candidate = labels.slice(i).join(".");
    const result = await cfRequest(
      token,
      "GET",
      `/zones?name=${encodeURIComponent(candidate)}&status=active&match=all&per_page=1`
    );

    if (Array.isArray(result) && result.length > 0 && normalizeDomain(result[0].name) === candidate) {
      return { id: result[0].id, name: result[0].name };
    }
  }

  throw new Error(`No Cloudflare zone found for ${domain}`);
}

async function listExistingRecords(token, zoneId, type, name) {
  return cfRequest(
    token,
    "GET",
    `/zones/${zoneId}/dns_records?type=${encodeURIComponent(type)}&name=${encodeURIComponent(name)}&per_page=100`
  );
}

function chooseRecordToUpdate(existing, desired) {
  if (!Array.isArray(existing) || existing.length === 0) {
    return null;
  }

  if (desired.type === "MX") {
    return existing.find((item) => Number(item.priority) === Number(desired.priority)) || null;
  }

  if (desired.type === "TXT") {
    const desiredClass = classifyTxtRecord(desired);
    if (desiredClass === "generic") {
      return null;
    }

    return existing.find((item) => classifyTxtRecord(item) === desiredClass) || null;
  }

  return existing[0] || null;
}

export async function configureMigaduDns({
  domain,
  token = process.env.CLOUDFLARE_API_TOKEN,
  zoneId,
  dryRun = false,
  includeCore = true,
  includeDmarc = true,
  includeSubdomainAddressing = false,
  includeAutoconfig = true,
  includeVerification = true,
  verificationValue = process.env.MIGADU_VERIFICATION_VALUE,
  verificationName = process.env.MIGADU_VERIFICATION_NAME || "@",
  migaduUser = process.env.MIGADU_USER,
  migaduToken = process.env.MIGADU_API_TOKEN,
  logger = console,
} = {}) {
  const cleanDomain = normalizeDomain(domain);

  if (!cleanDomain) {
    throw new Error("A domain is required");
  }

  const migaduDomain = await fetchMigaduDomainTemplate(cleanDomain, migaduUser, migaduToken);
  if (migaduDomain) {
    logger?.info?.(`Loaded records from Migadu API for ${cleanDomain}`);
  }

  const desiredRecords = buildMigaduRecords(cleanDomain, {
    includeCore,
    includeAutoconfig,
    includeDmarc,
    includeSubdomainAddressing,
    includeVerification,
    verificationValue,
    verificationName,
    migaduDomain,
  });

  if (!token && dryRun) {
    return {
      domain: cleanDomain,
      mode: "plan-only",
      desiredRecords,
      created: [],
      updated: [],
      skipped: [],
      zone: null,
    };
  }

  if (!token) {
    throw new Error("Missing Cloudflare API token. Set CLOUDFLARE_API_TOKEN.");
  }

  const zone = zoneId ? { id: zoneId, name: null } : await lookupZoneId(token, cleanDomain);
  const created = [];
  const updated = [];
  const skipped = [];

  for (const desired of desiredRecords) {
    const existing = await listExistingRecords(token, zone.id, desired.type, desired.name);

    const desiredPrint = recordFingerprint(desired);
    const exact = existing.find((item) => recordFingerprint(item) === desiredPrint);

    if (exact) {
      skipped.push({ record: desired, reason: "already-exists", id: exact.id });
      logger?.info?.(`SKIP   ${desired.type} ${desired.name}`);
      continue;
    }

    const payload = toCloudflarePayload(desired);
    const target = chooseRecordToUpdate(existing, desired);

    if (target) {
      if (dryRun) {
        updated.push({ record: desired, id: target.id, dryRun: true });
        logger?.info?.(`UPDATE ${desired.type} ${desired.name} (dry-run)`);
      } else {
        await cfRequest(token, "PATCH", `/zones/${zone.id}/dns_records/${target.id}`, payload);
        updated.push({ record: desired, id: target.id, dryRun: false });
        logger?.info?.(`UPDATE ${desired.type} ${desired.name}`);
      }
      continue;
    }

    if (dryRun) {
      created.push({ record: desired, dryRun: true });
      logger?.info?.(`CREATE ${desired.type} ${desired.name} (dry-run)`);
    } else {
      await cfRequest(token, "POST", `/zones/${zone.id}/dns_records`, payload);
      created.push({ record: desired, dryRun: false });
      logger?.info?.(`CREATE ${desired.type} ${desired.name}`);
    }
  }

  return {
    domain: cleanDomain,
    mode: dryRun ? "dry-run" : "apply",
    desiredRecords,
    created,
    updated,
    skipped,
    zone,
  };
}

export { buildMigaduRecords };
