const state = {
  view: "overview",
  query: "",
  topic: "all",
  data: { articles: [], identities: [], experts: [], taxonomy: [], reviews: [] },
};

const viewMeta = {
  overview: ["Research overview", "+ Add article", "articles"],
  articles: ["Article registry", "+ Add article", "articles"],
  identities: ["Identity registry", "+ Add person", "identities"],
  experts: ["Topic experts", "+ Link expert", "experts"],
  taxonomy: ["Expertise taxonomy", "+ Add mapping", "taxonomy"],
  reviews: ["Review history", "+ Record outcome", "reviews"],
};

const fieldSets = {
  articles: [
    ["title", "Article title", "text", true, "wide"],
    ["article_url", "Article URL", "url", false, "wide"],
    ["canonical_topic", "Content topic", "topic", true],
    ["status", "Status", ["draft", "active", "needs_review", "archived"], false],
    ["last_reviewed_date", "Last reviewed", "date", false],
    ["notes", "Notes", "textarea", false, "wide"],
  ],
  identities: [
    ["full_name", "Full name", "text", true],
    ["ms_alias", "Microsoft alias", "text", false],
    ["github_alias", "GitHub alias", "text", false],
    ["identity_status", "Identity status", ["verified", "probable", "unresolved"], true],
    ["ms_alias_status", "Microsoft alias status", ["current", "not_verified", "not_current"], true],
    ["github_alias_status", "GitHub alias status", ["current", "not_verified", "not_current"], true],
    ["additional_aliases", "Additional aliases", "text", false, "wide", "Separate with |"],
    ["evidence_urls", "Identity evidence links", "text", false, "wide", "Separate with |"],
    ["last_verified_date", "Last verified", "date", false],
    ["notes", "Notes", "textarea", false, "wide"],
  ],
  experts: [
    ["person_id", "Known person", "person", true],
    ["canonical_topic", "Content topic", "topic", true],
    ["metadata_role", "Metadata role", ["author", "contributor"], true],
    ["article_url", "Article or metadata evidence URL", "url", true, "wide"],
    ["metadata_date", "Metadata date", "date", true],
    ["verification_status", "Relationship status", ["verified", "candidate", "retired"], true],
    ["last_verified_date", "Last verified", "date", false],
    ["notes", "Notes", "textarea", false, "wide"],
  ],
  taxonomy: [
    ["canonical_topic", "Content topic", "topic", true],
    ["mapping_type", "Mapping type", ["article_topic", "product_name", "product_alias", "ui_label", "service", "repository", "source_component", "work_item_area", "release_name", "environment", "documentation_path"], true],
    ["mapped_value", "Mapped value", "text", true, "wide"],
    ["parent_mapping_id", "Parent mapping ID", "text", false],
    ["verification_status", "Verification", ["verified", "candidate", "retired"], true],
    ["evidence_url", "Evidence link", "text", false, "wide"],
    ["last_verified_date", "Last verified", "date", false],
    ["notes", "Notes", "textarea", false, "wide"],
  ],
  reviews: [
    ["event_date", "Event date", "date", true],
    ["outcome", "Outcome", ["requested", "accepted", "declined", "redirected", "validated", "no_response", "cancelled"], true],
    ["article_url", "Article URL", "url", false, "wide"],
    ["canonical_topic", "Content topic", "topic", true],
    ["person_id", "Requested reviewer", "person", true],
    ["requested_role", "Requested role", ["product reviewer", "content reviewer", "technical validator", "security reviewer", "release validator"], true],
    ["redirect_person_id", "Redirected to", "person", false],
    ["evidence_url", "Request or response link", "text", false, "wide"],
    ["recorded_by", "Recorded by", "text", false],
    ["notes", "Minimal routing notes", "textarea", false, "wide"],
  ],
};

const view = document.querySelector("#view");
const title = document.querySelector("#view-title");
const addButton = document.querySelector("#add-button");
const searchInput = document.querySelector("#global-search");
const notice = document.querySelector("#notice");
const dialog = document.querySelector("#record-dialog");
const form = document.querySelector("#record-form");
const formFields = document.querySelector("#form-fields");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function canonicalTopics() {
  return state.data.taxonomy
    .filter((item) => item.mapping_type === "article_topic" && item.verification_status !== "retired")
    .map((item) => item.canonical_topic)
    .filter((topic, index, values) => values.indexOf(topic) === index);
}

function filtered(records) {
  const query = state.query.toLowerCase();
  return records.filter((record) => {
    const matchesText = !query || Object.values(record).some((value) => String(value).toLowerCase().includes(query));
    const matchesTopic = state.topic === "all" || record.canonical_topic === state.topic;
    return matchesText && matchesTopic;
  });
}

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.className = `notice show${error ? " error" : ""}`;
  window.setTimeout(() => { notice.className = "notice"; }, 3600);
}

async function copyText(value, source) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }

  source.focus();
  source.select();
  source.setSelectionRange(0, value.length);
  return document.execCommand("copy");
}

function linkList(value) {
  if (!value) return '<span class="secondary">No evidence linked</span>';
  return `<div class="evidence-links">${String(value).split("|").filter(Boolean).map((url, index) => {
    const safe = escapeHtml(url.trim());
    if (/^https?:\/\//i.test(url.trim())) return `<a href="${safe}" target="_blank" rel="noreferrer">Evidence ${index + 1} ↗</a>`;
    return `<span class="secondary" title="Workspace-relative evidence">${safe}</span>`;
  }).join("")}</div>`;
}

function metadataFreshness(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return { label: "unknown", className: "unresolved" };
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 2);
  const date = new Date(`${value}T00:00:00Z`);
  return date >= cutoff ? { label: "within 2 years", className: "verified" } : { label: "older than 2 years", className: "retired" };
}

function topicOptions(selected = "all", includeAll = true) {
  const all = includeAll ? '<option value="all">All content topics</option>' : '<option value="">Select a topic</option>';
  return all + canonicalTopics().map((topic) => `<option value="${escapeHtml(topic)}" ${topic === selected ? "selected" : ""}>${escapeHtml(topic)}</option>`).join("");
}

function topicFilter() {
  return `<select class="filter-select" id="topic-filter" aria-label="Filter by content topic">${topicOptions(state.topic)}</select>`;
}

function empty(message, action) {
  return `<div class="empty"><strong>${escapeHtml(message)}</strong><span>${escapeHtml(action)}</span></div>`;
}

function renderOverview() {
  const validated = state.data.reviews.filter((review) => review.outcome === "validated").length;
  const activeContributors = state.data.identities.filter((identity) => identity.contributor_status === "active").length;
  const topics = canonicalTopics();
  const topicRows = topics.map((topic, index) => {
    const articleCount = state.data.articles.filter((article) => article.canonical_topic === topic).length;
    const expertCount = state.data.experts.filter((expert) => expert.canonical_topic === topic && expert.verification_status !== "retired").length;
    return `<div class="topic-row"><span class="topic-index">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(topic)}</span><span class="count-badge" title="Articles · topic experts">${articleCount} · ${expertCount}</span></div>`;
  }).join("");

  view.innerHTML = `
    <div class="metrics">
      <div class="metric" style="--accent: var(--coral)"><span>Articles</span><strong>${state.data.articles.length}</strong></div>
      <div class="metric" style="--accent: var(--green)"><span>Known people</span><strong>${state.data.identities.length}</strong></div>
      <div class="metric" style="--accent: var(--blue)"><span>Validated reviews</span><strong>${validated}</strong></div>
      <div class="metric" style="--accent: var(--gold)"><span>Active contributors</span><strong>${activeContributors}</strong></div>
    </div>
    <div class="workspace-grid">
      <section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Copilot Chat</p><h2>Research workbench</h2></div><span class="tag">Contributor Tracker</span></div>
        <div class="panel-body">
          <div class="prompt-controls">
            <div class="field"><label for="prompt-topic">Content topic</label><select id="prompt-topic">${topicOptions("", false)}</select></div>
            <div class="field"><label for="prompt-article">Article</label><select id="prompt-article"><option value="">Topic-level research</option>${state.data.articles.map((article) => `<option value="${escapeHtml(article.article_id)}">${escapeHtml(article.title)}</option>`).join("")}</select></div>
            <div class="field wide"><label for="prompt-focus">Research focus</label><select id="prompt-focus"><option value="reviewers">Find likely product and content reviewers</option><option value="contributors">Find recent implementers and contributors</option><option value="discussion">Find recent discussions and operational context</option><option value="validate">Validate an existing reviewer list</option></select></div>
          </div>
          <textarea id="prompt-output" class="prompt-output" aria-label="Generated Contributor Tracker prompt" readonly></textarea>
          <div class="prompt-actions"><button class="secondary-button" id="refresh-prompt">Refresh</button><button class="primary-button" id="copy-prompt">Copy for Copilot Chat</button></div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Coverage</p><h2>Content topics</h2></div><span class="tag">${topics.length} canonical</span></div>
        <div class="panel-body topic-list">${topicRows}</div>
      </section>
    </div>`;
  updatePrompt();
}

function renderArticles() {
  const records = filtered(state.data.articles);
  view.innerHTML = `<div class="section-tools">${topicFilter()}<span class="secondary">${records.length} article${records.length === 1 ? "" : "s"}</span></div>
    <div class="table-wrap">${records.length ? `<table><thead><tr><th>Article</th><th>Content topic</th><th>Status</th><th>Last reviewed</th><th></th></tr></thead><tbody>${records.map((article) => `<tr><td class="primary-cell"><strong>${escapeHtml(article.title)}</strong>${article.article_url ? `<a class="secondary" href="${escapeHtml(article.article_url)}" target="_blank" rel="noreferrer">Open article ↗</a>` : '<span class="secondary">URL not recorded</span>'}</td><td>${escapeHtml(article.canonical_topic)}</td><td><span class="tag">${escapeHtml(article.status || "active")}</span></td><td>${escapeHtml(article.last_reviewed_date || "Not recorded")}</td><td><button class="text-button edit-record" data-type="articles" data-id="${escapeHtml(article.article_id)}">Edit</button></td></tr>`).join("")}</tbody></table>` : empty("No articles match", "Add an article or change the filters.")}</div>`;
}

function renderIdentities() {
  const records = filtered(state.data.identities).slice().sort((left, right) =>
    (right.last_contribution_date || "").localeCompare(left.last_contribution_date || "") || left.full_name.localeCompare(right.full_name),
  );
  const activeCount = records.filter((person) => person.contributor_status === "active").length;
  view.innerHTML = `<div class="section-tools"><span class="secondary">Recent GitHub contribution and current employment are separate claims.</span><span class="secondary">${activeCount} active · ${records.length} people</span></div>
    <div class="table-wrap">${records.length ? `<table><thead><tr><th>Person</th><th>Contribution evidence</th><th>Metadata coverage</th><th>Identity</th><th></th></tr></thead><tbody>${records.map((person) => `<tr><td class="primary-cell"><strong>${escapeHtml(person.full_name)}</strong><a class="secondary" href="https://github.com/${encodeURIComponent(person.github_alias)}" target="_blank" rel="noreferrer">@${escapeHtml(person.github_alias || "Unknown")} ↗</a>${person.ms_alias ? `<span class="secondary">Microsoft alias: ${escapeHtml(person.ms_alias)} (${escapeHtml((person.ms_alias_status || "not_verified").replaceAll("_", " "))})</span>` : '<span class="secondary">Microsoft alias not established</span>'}</td><td class="primary-cell"><span class="tag ${escapeHtml(person.contributor_status || "unresolved")}">${escapeHtml(person.contributor_status || "not established")}</span><span class="secondary">Latest linked commit: ${escapeHtml(person.last_contribution_date || "Not recorded")}</span>${person.contribution_url ? `<a href="${escapeHtml(person.contribution_url)}" target="_blank" rel="noreferrer">Open commit ↗</a>` : ""}</td><td class="primary-cell"><span>${escapeHtml((person.metadata_roles || "No role").replaceAll("|", " · "))}</span><span class="secondary">${escapeHtml(person.article_count || "0")} published admin article${person.article_count === "1" ? "" : "s"}</span></td><td class="primary-cell"><span class="tag ${escapeHtml(person.identity_status)}">${escapeHtml(person.identity_status)}</span><span class="secondary">GitHub alias: ${escapeHtml((person.github_alias_status || "not_verified").replaceAll("_", " "))}</span></td><td><button class="text-button edit-record" data-type="identities" data-id="${escapeHtml(person.person_id)}">Edit</button></td></tr>`).join("")}</tbody></table>` : empty("No identities recorded", "Run the active-contributor sync or add a person manually.")}</div>`;
}

function renderExperts() {
  const records = filtered(state.data.experts);
  view.innerHTML = `<div class="section-tools">${topicFilter()}<span class="secondary">${records.length} topic relationship${records.length === 1 ? "" : "s"}</span></div>
    <div class="table-wrap">${records.length ? `<table><thead><tr><th>Person</th><th>Content topic</th><th>Metadata role</th><th>Metadata freshness</th><th>Alias status</th><th>Evidence</th><th></th></tr></thead><tbody>${records.map((expert) => { const person = state.data.identities.find((identity) => identity.person_id === expert.person_id); const freshness = metadataFreshness(expert.metadata_date); return `<tr><td class="primary-cell"><strong>${escapeHtml(identityName(expert.person_id))}</strong><span class="secondary">${escapeHtml(expert.person_id)}</span></td><td>${escapeHtml(expert.canonical_topic)}</td><td><span class="tag">${escapeHtml(expert.metadata_role)}</span></td><td class="primary-cell"><span>${escapeHtml(expert.metadata_date)}</span><span class="tag ${freshness.className}">${freshness.label}</span></td><td class="primary-cell"><span>Microsoft: ${escapeHtml((person?.ms_alias_status || "not_verified").replaceAll("_", " "))}</span><span>GitHub: ${escapeHtml((person?.github_alias_status || "not_verified").replaceAll("_", " "))}</span></td><td>${linkList(expert.article_url)}</td><td><button class="text-button edit-record" data-type="experts" data-id="${escapeHtml(expert.expertise_id)}">Edit</button></td></tr>`; }).join("")}</tbody></table>` : empty("No topic experts recorded", "Add a verified identity, then link that person to metadata-backed topic evidence.")}</div>`;
}

function renderTaxonomy() {
  const records = filtered(state.data.taxonomy);
  view.innerHTML = `<div class="section-tools">${topicFilter()}<span class="secondary">${records.length} mappings</span></div>
    <div class="table-wrap">${records.length ? `<table><thead><tr><th>Mapped value</th><th>Content topic</th><th>Type</th><th>Verification</th><th>Evidence</th><th></th></tr></thead><tbody>${records.map((mapping) => `<tr><td class="primary-cell"><strong>${escapeHtml(mapping.mapped_value)}</strong><span class="secondary">${escapeHtml(mapping.mapping_id)}</span></td><td>${escapeHtml(mapping.canonical_topic)}</td><td>${escapeHtml(mapping.mapping_type.replaceAll("_", " "))}</td><td><span class="tag ${escapeHtml(mapping.verification_status)}">${escapeHtml(mapping.verification_status)}</span></td><td>${linkList(mapping.evidence_url)}</td><td><button class="text-button edit-record" data-type="taxonomy" data-id="${escapeHtml(mapping.mapping_id)}">Edit</button></td></tr>`).join("")}</tbody></table>` : empty("No taxonomy mappings match", "Add evidence-backed vocabulary or change the filters.")}</div>`;
}

function identityName(id) {
  const person = state.data.identities.find((identity) => identity.person_id === id);
  return person ? person.full_name : id || "Unknown";
}

function renderReviews() {
  const records = filtered(state.data.reviews).slice().reverse();
  view.innerHTML = `<div class="section-tools">${topicFilter()}<span class="secondary">Append-only event history · ${records.length} events</span></div>
    <div class="table-wrap">${records.length ? `<table><thead><tr><th>Date</th><th>Reviewer</th><th>Content topic</th><th>Role</th><th>Outcome</th><th>Evidence</th></tr></thead><tbody>${records.map((review) => `<tr><td>${escapeHtml(review.event_date)}</td><td class="primary-cell"><strong>${escapeHtml(identityName(review.person_id))}</strong>${review.redirect_person_id ? `<span class="secondary">Redirected to ${escapeHtml(identityName(review.redirect_person_id))}</span>` : ""}</td><td>${escapeHtml(review.canonical_topic)}</td><td>${escapeHtml(review.requested_role)}</td><td><span class="tag ${escapeHtml(review.outcome)}">${escapeHtml(review.outcome.replaceAll("_", " "))}</span></td><td>${linkList(review.evidence_url)}</td></tr>`).join("")}</tbody></table>` : empty("No review events recorded", "Record requests and outcomes as they happen.")}</div>`;
}

function render() {
  const [heading, buttonLabel] = viewMeta[state.view];
  title.textContent = heading;
  addButton.textContent = buttonLabel;
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
  ({ overview: renderOverview, articles: renderArticles, identities: renderIdentities, experts: renderExperts, taxonomy: renderTaxonomy, reviews: renderReviews })[state.view]();
  document.querySelector("#topic-filter")?.addEventListener("change", (event) => { state.topic = event.target.value; render(); });
}

function updatePrompt() {
  const topicSelect = document.querySelector("#prompt-topic");
  const articleSelect = document.querySelector("#prompt-article");
  const focusSelect = document.querySelector("#prompt-focus");
  const output = document.querySelector("#prompt-output");
  if (!output) return;
  const article = state.data.articles.find((item) => item.article_id === articleSelect?.value);
  const topic = article?.canonical_topic || topicSelect?.value || canonicalTopics()[0] || "documentation";
  const target = article ? `the Microsoft Learn article "${article.title}" (${article.article_url || "URL not recorded"})` : `Microsoft Learn content in the "${topic}" content topic`;
  const focus = {
    reviewers: "Find a small, unordered set of likely product reviewers and the appropriate Learn content contact.",
    contributors: "Find people with recent direct implementation, review, work-item, release, incident, or discussion evidence.",
    discussion: "Find recent relevant discussions and operational evidence, then identify participants who may provide context.",
    validate: "Validate the existing reviewer candidates against current topic evidence and prior routing history.",
  }[focusSelect?.value || "reviewers"];
  output.value = `${focus} Research ${target}. Treat "${topic}" as a content subject, not template metadata. Expand the search using verified expertise-taxonomy mappings across product aliases, services, repositories, work-item areas, source components, release names, and documentation paths. For each person, provide available work aliases, dated evidence links, qualitative confidence, and relevant prior routing outcomes. Treat CODEOWNERS as repository or content-maintenance contacts, not product experts without independent product evidence. State source and permission gaps; do not score or rank people.`;
}

function selectOptions(type, selected = "") {
  if (type === "topic") return topicOptions(selected, false);
  if (type === "person") return `<option value="">Select a person</option>${state.data.identities.map((person) => `<option value="${escapeHtml(person.person_id)}" ${person.person_id === selected ? "selected" : ""}>${escapeHtml(person.full_name)} · ${escapeHtml(person.ms_alias)}</option>`).join("")}`;
  return type.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? "selected" : ""}>${escapeHtml(option.replaceAll("_", " "))}</option>`).join("");
}

function openDialog(type, record = null) {
  form.dataset.type = type;
  form.dataset.id = record?.[({ articles: "article_id", identities: "person_id", experts: "expertise_id", taxonomy: "mapping_id" })[type]] || "";
  document.querySelector("#dialog-eyebrow").textContent = record ? "Update record" : type === "reviews" ? "Append event" : "New record";
  document.querySelector("#dialog-title").textContent = `${record ? "Edit" : type === "reviews" ? "Record" : "Add"} ${{ articles: "article", identities: "person", experts: "topic expert", taxonomy: "mapping", reviews: "review outcome" }[type]}`;
  formFields.innerHTML = fieldSets[type].map(([name, label, inputType, required, width, placeholder]) => {
    const value = record?.[name] ?? (inputType === "date" ? new Date().toISOString().slice(0, 10) : "");
    const attributes = `${required ? "required" : ""} ${placeholder ? `placeholder="${escapeHtml(placeholder)}"` : ""}`;
    let control;
    if (Array.isArray(inputType) || inputType === "topic" || inputType === "person") control = `<select id="field-${name}" name="${name}" ${attributes}>${selectOptions(inputType, value)}</select>`;
    else if (inputType === "textarea") control = `<textarea id="field-${name}" name="${name}" ${attributes}>${escapeHtml(value)}</textarea>`;
    else control = `<input id="field-${name}" name="${name}" type="${inputType}" value="${escapeHtml(value)}" ${attributes} />`;
    return `<div class="field ${width || ""}"><label for="field-${name}">${escapeHtml(label)}${required ? " *" : ""}</label>${control}</div>`;
  }).join("");
  dialog.showModal();
}

async function saveRecord(event) {
  event.preventDefault();
  const type = form.dataset.type;
  const id = form.dataset.id;
  const body = Object.fromEntries(new FormData(form).entries());
  const response = await fetch(`/api/${type}${id ? `/${encodeURIComponent(id)}` : ""}`, {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not save record");
  dialog.close();
  await loadData();
  showNotice(type === "reviews" ? "Review event appended." : "Record saved.");
}

async function loadData() {
  const response = await fetch("/api/snapshot", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load local data");
  state.data = await response.json();
  render();
}

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => {
  state.view = item.dataset.view;
  state.topic = "all";
  render();
}));

searchInput.addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
addButton.addEventListener("click", () => openDialog(viewMeta[state.view][2]));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => dialog.close()));
form.addEventListener("submit", (event) => saveRecord(event).catch((error) => showNotice(error.message, true)));

document.addEventListener("click", async (event) => {
  const edit = event.target.closest(".edit-record");
  if (edit) {
    const idField = { articles: "article_id", identities: "person_id", experts: "expertise_id", taxonomy: "mapping_id" }[edit.dataset.type];
    openDialog(edit.dataset.type, state.data[edit.dataset.type].find((record) => record[idField] === edit.dataset.id));
  }
  if (event.target.closest("#refresh-prompt")) updatePrompt();
  if (event.target.closest("#copy-prompt")) {
    const output = document.querySelector("#prompt-output");
    try {
      if (!await copyText(output.value, output)) throw new Error("The browser rejected the copy request.");
      showNotice("Prompt copied. Paste it into Contributor Tracker in Copilot Chat.");
    } catch {
      output.focus();
      output.select();
      showNotice("Copy was blocked. The full prompt is selected; press Ctrl+C to copy it.", true);
    }
  }
});

document.addEventListener("change", (event) => {
  if (["prompt-topic", "prompt-article", "prompt-focus"].includes(event.target.id)) updatePrompt();
});

loadData().catch((error) => {
  view.innerHTML = empty("Dashboard unavailable", "Start the local server with npm start.");
  showNotice(error.message, true);
});
