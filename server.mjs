import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, "public");
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

const stores = {
  articles: {
    file: "articles.csv",
    id: "article_id",
    fields: ["article_id", "title", "article_url", "source_path", "source_url", "canonical_topic", "author", "ms_author", "contributors", "ms_contributors", "metadata_date", "metadata_last_changed_date", "contributor_validation", "audit_status", "gap_reasons", "status", "last_reviewed_date", "notes"],
    required: ["title", "canonical_topic"],
  },
  identities: {
    file: "identity-registry.csv",
    id: "person_id",
    fields: ["person_id", "full_name", "ms_alias", "github_alias", "additional_aliases", "identity_status", "ms_alias_status", "github_alias_status", "contributor_status", "last_contribution_date", "contribution_url", "metadata_roles", "article_count", "evidence_urls", "last_verified_date", "notes"],
    required: ["full_name", "identity_status"],
  },
  experts: {
    file: "topic-experts.csv",
    id: "expertise_id",
    fields: ["expertise_id", "person_id", "canonical_topic", "metadata_role", "article_url", "metadata_date", "verification_status", "last_verified_date", "notes"],
    required: ["person_id", "canonical_topic", "metadata_role", "article_url", "metadata_date", "verification_status"],
  },
  taxonomy: {
    file: "expertise-taxonomy.csv",
    id: "mapping_id",
    fields: ["mapping_id", "canonical_topic", "mapping_type", "mapped_value", "parent_mapping_id", "evidence_url", "verification_status", "last_verified_date", "notes"],
    required: ["canonical_topic", "mapping_type", "mapped_value", "verification_status"],
  },
  reviews: {
    file: "review-history.csv",
    id: "event_id",
    fields: ["event_id", "event_date", "article_url", "canonical_topic", "person_id", "requested_role", "outcome", "redirect_person_id", "evidence_url", "recorded_by", "notes"],
    required: ["event_date", "canonical_topic", "person_id", "requested_role", "outcome"],
    appendOnly: true,
  },
};

let writeQueue = Promise.resolve();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serializeCsv(fields, records) {
  const lines = [fields.map(csvCell).join(",")];
  for (const record of records) {
    lines.push(fields.map((field) => csvCell(record[field])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function readStore(name) {
  const store = stores[name];
  return parseCsv(await readFile(join(root, "data", store.file), "utf8"));
}

async function saveStore(name, records) {
  const store = stores[name];
  const target = join(root, "data", store.file);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, serializeCsv(store.fields, records), "utf8");
  await rename(temporary, target);
}

function cleanRecord(store, body) {
  return Object.fromEntries(store.fields.map((field) => [field, String(body[field] ?? "").trim()]));
}

function validateRecord(store, record) {
  const missing = store.required.filter((field) => !record[field]);
  if (missing.length) throw new Error(`Missing required fields: ${missing.join(", ")}`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/snapshot") {
    const entries = await Promise.all(Object.keys(stores).map(async (name) => [name, await readStore(name)]));
    sendJson(response, 200, Object.fromEntries(entries));
    return true;
  }

  const match = url.pathname.match(/^\/api\/(articles|identities|experts|taxonomy|reviews)(?:\/([^/]+))?$/);
  if (!match) return false;
  const [, name, encodedId] = match;
  const store = stores[name];

  if (request.method === "GET") {
    sendJson(response, 200, await readStore(name));
    return true;
  }

  if (request.method === "POST" && !encodedId) {
    const body = await readJson(request);
    const record = cleanRecord(store, body);
    record[store.id] ||= `${name.slice(0, -1)}-${randomUUID()}`;
    validateRecord(store, record);
    await (writeQueue = writeQueue.then(async () => {
      const records = await readStore(name);
      if (records.some((item) => item[store.id] === record[store.id])) throw new Error(`${store.id} already exists`);
      records.push(record);
      await saveStore(name, records);
    }));
    sendJson(response, 201, record);
    return true;
  }

  if (request.method === "PUT" && encodedId && !store.appendOnly) {
    const id = decodeURIComponent(encodedId);
    const body = await readJson(request);
    let savedRecord;
    await (writeQueue = writeQueue.then(async () => {
      const records = await readStore(name);
      const index = records.findIndex((item) => item[store.id] === id);
      if (index < 0) throw new Error("Record not found");
      savedRecord = cleanRecord(store, { ...records[index], ...body, [store.id]: id });
      validateRecord(store, savedRecord);
      records[index] = savedRecord;
      await saveStore(name, records);
    }));
    sendJson(response, 200, savedRecord);
    return true;
  }

  sendJson(response, store.appendOnly ? 405 : 404, { error: store.appendOnly ? "Review history is append-only" : "Not found" });
  return true;
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function handleStatic(response, url) {
  const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicRoot, safePath);
  if (!filePath.startsWith(publicRoot)) throw new Error("Invalid path");
  const content = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
  response.end(content);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/") && await handleApi(request, response, url)) return;
    await handleStatic(response, url);
  } catch (error) {
    const status = error?.code === "ENOENT" ? 404 : error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: status === 500 ? "Local server error" : error.message });
    if (status === 500) console.error(error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Contributor Tracker dashboard: http://localhost:${port}`);
});
