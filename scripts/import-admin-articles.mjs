import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { readFile, rename, writeFile } from "node:fs/promises";

const dashboardRoot = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1))), "..");
const repositoryRoot = resolve(process.argv[2] || process.env.ADMIN_REPO_PATH || join(homedir(), "Downloads", "GitHub repos", "power-platform-pr"));
const adminRoot = join(repositoryRoot, "power-platform", "admin");
const tocPath = join(adminRoot, "TOC.yml");
const articleFields = ["article_id", "title", "article_url", "source_path", "source_url", "canonical_topic", "author", "ms_author", "contributors", "ms_contributors", "metadata_date", "metadata_last_changed_date", "contributor_validation", "audit_status", "gap_reasons", "status", "last_reviewed_date", "notes"];
const placeholderAliases = new Set((process.env.PLACEHOLDER_ALIASES || "").split("|").map((alias) => alias.trim().toLowerCase()).filter(Boolean));

if (!existsSync(tocPath)) throw new Error(`Admin TOC not found: ${tocPath}`);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (character !== "\r") field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(rows[0].map((header, index) => [header, values[index] ?? ""])),
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(records) {
  return `${[articleFields, ...records.map((record) => articleFields.map((field) => record[field] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function cleanYamlValue(value) {
  return String(value ?? "").trim().replace(/^['"]|['"]$/g, "").trim();
}

function parseFrontmatter(text) {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { values: {}, relevantLines: new Set(), endLine: 1 };
  const values = {};
  const relevantLines = new Set();
  const tracked = new Set(["author", "ms.author", "contributors", "ms.contributors"]);
  let currentKey = "";
  let endLine = 1;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") { endLine = index + 1; break; }
    const keyMatch = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const raw = keyMatch[2].trim();
      values[currentKey] = raw.startsWith("[") && raw.endsWith("]")
        ? raw.slice(1, -1).split(",").map(cleanYamlValue).filter(Boolean)
        : cleanYamlValue(raw);
      if (tracked.has(currentKey)) relevantLines.add(index + 1);
      continue;
    }
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(values[currentKey])) values[currentKey] = values[currentKey] ? [values[currentKey]] : [];
      values[currentKey].push(cleanYamlValue(listMatch[1]));
      if (tracked.has(currentKey)) relevantLines.add(index + 1);
    } else if (line.trim()) currentKey = "";
  }
  return { values, relevantLines, endLine };
}

function listValue(value) {
  return (Array.isArray(value) ? value : value ? [value] : []).map(cleanYamlValue).filter(Boolean);
}

function normalizeDate(value) {
  const text = cleanYamlValue(value);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : "";
}

function metadataChangedDate(sourcePath, relevantLines, endLine) {
  if (!relevantLines.size) return "";
  try {
    const output = execFileSync("git", ["blame", "--line-porcelain", "-L", `1,${endLine}`, "--", sourcePath], { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    let finalLine = 0;
    let timestamp = 0;
    let newest = 0;
    for (const line of output.split("\n")) {
      const header = line.match(/^[0-9a-f^]{40}\s+\d+\s+(\d+)/);
      if (header) { finalLine = Number(header[1]); timestamp = 0; continue; }
      const time = line.match(/^author-time\s+(\d+)$/);
      if (time) { timestamp = Number(time[1]); continue; }
      if (line.startsWith("\t") && relevantLines.has(finalLine)) newest = Math.max(newest, timestamp);
    }
    return newest ? new Date(newest * 1000).toISOString().slice(0, 10) : "";
  } catch {
    return "";
  }
}

function canonicalTopic(sourcePath, title) {
  const text = `${sourcePath} ${title}`.toLowerCase();
  if (/security|govern|data-loss|dlp|tenant-isolation|lockbox|compliance|privacy|audit/.test(text)) return "Security and governance";
  if (/copilot|agent|work-iq|generative-ai/.test(text)) return "Copilot, agents, and AI";
  if (/environment|region|geo|tenant/.test(text)) return "Environments";
  if (/monitor|analy|insight|telemetry|health|usage/.test(text)) return "Monitoring and analytics";
  if (/licen|capacity|billing|cost|subscription/.test(text)) return "Licensing, capacity, and costs";
  if (/deploy|solution|pipeline|lifecycle|alm|application-management/.test(text)) return "Deployment and lifecycle management";
  if (/automat|connector|powershell|command-line|cli|api|extensib/.test(text)) return "Automation and extensibility";
  if (/dataverse|dynamics-365|database/.test(text)) return "Administration";
  if (/resource|data|storage|backup|restore/.test(text)) return "Resources and data";
  return "Overview and getting started";
}

function identityIndex(identities) {
  const index = new Map();
  for (const identity of identities) {
    for (const [kind, values] of [["github", [identity.github_alias, ...(identity.additional_aliases || "").split("|")]], ["microsoft", [identity.ms_alias]]]) {
      for (const alias of values.filter(Boolean)) index.set(`${kind}:${alias.trim().toLowerCase()}`, identity);
    }
  }
  return index;
}

function validateAlias(alias, kind, identities) {
  const normalized = alias.toLowerCase();
  if (placeholderAliases.has(normalized)) return "placeholder";
  const identity = identities.get(`${kind}:${normalized}`);
  if (!identity) return "not verified";
  const current = kind === "github" ? identity.github_alias_status === "current" : identity.ms_alias_status === "current";
  return identity.identity_status === "verified" && current ? "verified current" : "identity matched, current status not verified";
}

function publishedArticlePaths(tocText) {
  const paths = new Set();
  for (const match of tocText.matchAll(/\bhref:\s*['"]?([^'"\s]+\.md(?:[?#][^'"\s]*)?)/gi)) {
    const target = resolve(adminRoot, match[1].split(/[?#]/)[0]);
    if ((target === adminRoot || target.startsWith(`${adminRoot}${sep}`)) && existsSync(target)) paths.add(target);
  }
  return [...paths].sort();
}

const articleFile = join(dashboardRoot, "data", "articles.csv");
const identityFile = join(dashboardRoot, "data", "identity-registry.csv");
const existingArticles = parseCsv(await readFile(articleFile, "utf8"));
const existingByPath = new Map(existingArticles.filter((article) => article.source_path).map((article) => [article.source_path, article]));
const identities = identityIndex(parseCsv(await readFile(identityFile, "utf8")));
const paths = publishedArticlePaths(await readFile(tocPath, "utf8"));
const cutoff = new Date();
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
const records = [];

for (const path of paths) {
  const sourcePath = relative(repositoryRoot, path).split(sep).join("/");
  const { values, relevantLines, endLine } = parseFrontmatter(await readFile(path, "utf8"));
  const title = cleanYamlValue(values.title) || sourcePath.split("/").at(-1).replace(/\.md$/i, "");
  const author = cleanYamlValue(values.author);
  const msAuthor = cleanYamlValue(values["ms.author"]);
  const contributors = listValue(values.contributors);
  const msContributors = listValue(values["ms.contributors"]);
  const aliases = [
    ...(author ? [["author", author, "github"]] : []),
    ...(msAuthor ? [["ms.author", msAuthor, "microsoft"]] : []),
    ...contributors.map((alias) => ["contributor", alias, "github"]),
    ...msContributors.map((alias) => ["ms.contributor", alias, "microsoft"]),
  ];
  const validation = aliases.map(([role, alias, kind]) => `${role}:${alias}=${validateAlias(alias, kind, identities)}`);
  const nonPlaceholder = validation.filter((item) => !item.endsWith("=placeholder"));
  const placeholder = validation.some((item) => item.endsWith("=placeholder"));
  const metadataDate = normalizeDate(values["ms.date"]);
  const changedDate = metadataChangedDate(sourcePath, relevantLines, endLine) || metadataDate;
  const changed = changedDate ? new Date(`${changedDate}T00:00:00Z`) : null;
  const gaps = [];
  if (placeholder) gaps.push("Known CODEOWNER placeholder in author or contributor metadata");
  if (!nonPlaceholder.length) gaps.push("No non-placeholder author or contributor metadata");
  if (!changed || Number.isNaN(changed.valueOf())) gaps.push("Author and contributor metadata update date could not be established");
  else if (changed < cutoff) gaps.push("Author and contributor metadata not updated in the past year");
  const allValidated = nonPlaceholder.length > 0 && nonPlaceholder.every((item) => item.endsWith("=verified current"));
  const previous = existingByPath.get(sourcePath) || {};
  const learnPath = sourcePath.replace(/^power-platform\//, "").replace(/\.md$/i, "");
  records.push({
    article_id: previous.article_id || `article-${createHash("sha256").update(sourcePath).digest("hex").slice(0, 12)}`,
    title,
    article_url: `https://learn.microsoft.com/power-platform/${learnPath.replace(/^admin\//, "admin/")}`,
    source_path: sourcePath,
    source_url: `https://github.com/MicrosoftDocs/power-platform-pr/blob/main/${sourcePath}`,
    canonical_topic: previous.canonical_topic || canonicalTopic(sourcePath, title),
    author,
    ms_author: msAuthor,
    contributors: contributors.join("|"),
    ms_contributors: msContributors.join("|"),
    metadata_date: metadataDate,
    metadata_last_changed_date: changedDate,
    contributor_validation: validation.join("|"),
    audit_status: gaps.length ? "gap" : allValidated ? "identity_validated" : "metadata_validated",
    gap_reasons: gaps.join("|"),
    status: previous.status || "active",
    last_reviewed_date: previous.last_reviewed_date || "",
    notes: previous.notes || "",
  });
}

const temporary = `${articleFile}.${randomUUID()}.tmp`;
await writeFile(temporary, serializeCsv(records), "utf8");
await rename(temporary, articleFile);
const gaps = records.filter((article) => article.audit_status === "gap").length;
const placeholders = records.filter((article) => article.gap_reasons.includes("placeholder")).length;
const stale = records.filter((article) => article.gap_reasons.includes("past year")).length;
console.log(`Imported ${records.length} published admin articles (${gaps} with gaps; ${placeholders} placeholder; ${stale} stale).`);
