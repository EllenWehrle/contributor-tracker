import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, rename, writeFile } from "node:fs/promises";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataRoot = join(root, "data");
const repository = process.env.GITHUB_REPOSITORY || "MicrosoftDocs/power-platform-pr";
const generatedMarker = `Generated from exact GitHub-linked commit activity in ${repository}.`;
const identityFields = ["person_id", "full_name", "ms_alias", "github_alias", "additional_aliases", "identity_status", "ms_alias_status", "github_alias_status", "contributor_status", "last_contribution_date", "contribution_url", "metadata_roles", "article_count", "evidence_urls", "last_verified_date", "notes"];
const expertFields = ["expertise_id", "person_id", "canonical_topic", "metadata_role", "article_url", "metadata_date", "verification_status", "last_verified_date", "notes"];
const placeholders = new Set((process.env.PLACEHOLDER_ALIASES || "").split("|").map((alias) => alias.trim().toLowerCase()).filter(Boolean));

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

function serializeCsv(fields, records) {
  return `${[fields, ...records.map((record) => fields.map((field) => record[field] ?? ""))].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

async function saveCsv(file, fields, records) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, serializeCsv(fields, records), "utf8");
  await rename(temporary, file);
}

function split(value) {
  return String(value || "").split("|").map((item) => item.trim()).filter(Boolean);
}

function stableId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 12)}`;
}

function latestArticle(current, candidate) {
  const currentDate = current?.metadata_last_changed_date || current?.metadata_date || "";
  const candidateDate = candidate.metadata_last_changed_date || candidate.metadata_date || "";
  return !current || candidateDate > currentDate ? candidate : current;
}

const cutoff = new Date();
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
const since = cutoff.toISOString();
const jq = ".[] | select(.author.login != null) | [.author.login, .sha, .commit.author.date, .commit.author.name, .html_url] | @tsv";
const output = execFileSync("gh", ["api", "--paginate", "-X", "GET", `repos/${repository}/commits`, "-f", `since=${since}`, "-f", "per_page=100", "--jq", jq], {
  encoding: "utf8",
  maxBuffer: 100 * 1024 * 1024,
  stdio: ["ignore", "pipe", "inherit"],
});

const recent = new Map();
for (const line of output.trim().split("\n").filter(Boolean)) {
  const [login, sha, date, name, url] = line.replace(/\r$/, "").split("\t");
  const key = login.toLowerCase();
  if (!recent.has(key) || date > recent.get(key).date) recent.set(key, { login, sha, date, name, url });
}

const articles = parseCsv(await readFile(join(dataRoot, "articles.csv"), "utf8"));
const matches = new Map();
for (const article of articles) {
  const aliases = [
    ...(article.author ? [[article.author, "author"]] : []),
    ...split(article.contributors).map((alias) => [alias, "contributor"]),
  ];
  for (const [alias, role] of aliases) {
    const key = alias.toLowerCase();
    if (placeholders.has(key) || !recent.has(key)) continue;
    if (!matches.has(key)) matches.set(key, { activity: recent.get(key), roles: new Set(), articles: new Map(), msAliases: new Set() });
    const match = matches.get(key);
    match.roles.add(role);
    match.articles.set(article.article_id, article);
    const topicRole = `${article.canonical_topic}\u0000${role}`;
    match[topicRole] = latestArticle(match[topicRole], article);
    if (role === "author" && article.ms_author) match.msAliases.add(article.ms_author);
  }
}

const identityFile = join(dataRoot, "identity-registry.csv");
const existingIdentities = parseCsv(await readFile(identityFile, "utf8"));
const manualIdentities = existingIdentities.filter((identity) => !identity.notes.includes(generatedMarker));
const manualByGitHub = new Map(manualIdentities.filter((identity) => identity.github_alias).map((identity) => [identity.github_alias.toLowerCase(), identity]));
const generatedIdentities = [];
const personIds = new Map();

for (const [key, match] of [...matches].sort(([left], [right]) => left.localeCompare(right))) {
  const existing = manualByGitHub.get(key);
  const personId = existing?.person_id || stableId("person", match.activity.login);
  personIds.set(key, personId);
  const msAlias = match.msAliases.size === 1 ? [...match.msAliases][0] : "";
  const generated = {
    person_id: personId,
    full_name: match.activity.name || match.activity.login,
    ms_alias: msAlias,
    github_alias: match.activity.login,
    additional_aliases: "",
    identity_status: msAlias ? "probable" : "unresolved",
    ms_alias_status: "not_verified",
    github_alias_status: "current",
    contributor_status: "active",
    last_contribution_date: match.activity.date.slice(0, 10),
    contribution_url: match.activity.url,
    metadata_roles: [...match.roles].sort().join("|"),
    article_count: String(match.articles.size),
    evidence_urls: `https://github.com/${match.activity.login}|${match.activity.url}`,
    last_verified_date: new Date().toISOString().slice(0, 10),
    notes: `${generatedMarker} Active means at least one GitHub-linked commit in the past year and an exact alias match in published admin article metadata; it does not establish current employment.`,
  };
  if (existing) Object.assign(existing, {
    github_alias: generated.github_alias,
    github_alias_status: generated.github_alias_status,
    contributor_status: generated.contributor_status,
    last_contribution_date: generated.last_contribution_date,
    contribution_url: generated.contribution_url,
    metadata_roles: generated.metadata_roles,
    article_count: generated.article_count,
    evidence_urls: [...new Set([...split(existing.evidence_urls), ...split(generated.evidence_urls)])].join("|"),
    last_verified_date: generated.last_verified_date,
  });
  else generatedIdentities.push(generated);
}

const expertFile = join(dataRoot, "topic-experts.csv");
const existingExperts = parseCsv(await readFile(expertFile, "utf8"));
const manualExperts = existingExperts.filter((expert) => !expert.notes.includes(generatedMarker));
const generatedExperts = [];
const twoYearCutoff = new Date();
twoYearCutoff.setUTCFullYear(twoYearCutoff.getUTCFullYear() - 2);

for (const [key, match] of matches) {
  for (const property of Object.keys(match).filter((item) => item.includes("\u0000"))) {
    const [topic, role] = property.split("\u0000");
    const article = match[property];
    const metadataDate = article.metadata_last_changed_date || article.metadata_date;
    if (!metadataDate) continue;
    const metadataIsRecent = new Date(`${metadataDate}T00:00:00Z`) >= twoYearCutoff;
    generatedExperts.push({
      expertise_id: stableId("expert", `${key}|${topic}|${role}`),
      person_id: personIds.get(key),
      canonical_topic: topic,
      metadata_role: role,
      article_url: article.article_url || article.source_url,
      metadata_date: metadataDate,
      verification_status: metadataIsRecent ? "verified" : "candidate",
      last_verified_date: new Date().toISOString().slice(0, 10),
      notes: `${generatedMarker} Topic relationship is based on exact article metadata; stale metadata remains a candidate relationship.`,
    });
  }
}

await saveCsv(identityFile, identityFields, [...manualIdentities, ...generatedIdentities]);
await saveCsv(expertFile, expertFields, [...manualExperts, ...generatedExperts]);
console.log(`Synced ${matches.size} active metadata contributors and ${generatedExperts.length} topic relationships from commits since ${since.slice(0, 10)}.`);
