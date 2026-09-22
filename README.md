# Contributor Tracker

Contributor Tracker is a permission-aware GitHub Copilot agent and local dashboard for finding evidence-backed documentation contributors, reviewers, and Topic experts. It preserves uncertainty and explicitly avoids ranking, scoring, or evaluating people.

This public repository contains no real contributor records. Its CSV stores contain headers and a small topic taxonomy only.

## What it does

- Starts research with article author and contributor metadata.
- Links recent GitHub activity only through exact, GitHub-authenticated commit identities.
- Keeps identity verification, recent contribution, and employment as separate claims.
- Records dated Topic expert relationships as `verified`, `candidate`, or `retired`.
- Generates a reusable Copilot Chat research prompt.
- Maintains an append-only review-routing history.
- Shows evidence links and gaps without producing leaderboards.

## Requirements

- Node.js 20 or later
- Git
- GitHub CLI (`gh`) for contributor synchronization
- VS Code with GitHub Copilot Chat for the custom agent

## Run the dashboard

```powershell
npm start
```

Open `http://localhost:4173`. No package installation is required because the app uses Node.js built-ins and plain browser JavaScript.

Validate JavaScript syntax with:

```powershell
npm run check
```

## Use the Copilot agent

The repository-scoped agent is in [.github/agents/contributor-tracker.agent.md](.github/agents/contributor-tracker.agent.md). Open this repository in VS Code, open Copilot Chat, select **Contributor Tracker** from the agent picker, and ask a research question.

The agent can use only tools and sources available to the current user. Missing permissions must be reported as gaps, not bypassed.

## Populate public article evidence

The included importer targets the public `MicrosoftDocs/power-platform-pr` repository. Clone that repository, then pass its path:

```powershell
$env:ADMIN_REPO_PATH = "C:\path\to\power-platform-pr"
npm run import:admin
```

If the repository uses known placeholder aliases in article metadata, configure them as a pipe-delimited list before importing or syncing:

```powershell
$env:PLACEHOLDER_ALIASES = "example-owner|example-codeowner"
```

The importer reads published admin articles from the table of contents, audits metadata freshness, and writes `data/articles.csv`.

## Synchronize active contributors

Authenticate the GitHub CLI, then run:

```powershell
gh auth login
npm run sync:contributors
```

Set `GITHUB_REPOSITORY=owner/repository` to use another public repository. A person is marked active only when an article metadata alias exactly matches a non-null GitHub commit `author.login` from the preceding year. Display names and email guesses are not used.

This rule establishes recent repository activity only. It does not establish employment, authority, expertise quality, availability, or ownership.

## Data model

The local CSV stores are intentionally inspectable:

- `articles.csv`: article metadata, audit state, and freshness gaps
- `identity-registry.csv`: source-specific aliases and identity evidence
- `topic-experts.csv`: dated topic relationships and evidence
- `expertise-taxonomy.csv`: evidence-backed topic search vocabulary
- `review-history.csv`: append-only routing events

Do not commit populated stores containing personal or organization-sensitive data to a public fork. Preserve source permissions and collect only the professional identity and routing facts needed for the workflow.

## Evidence boundaries

Contributor Tracker returns a small unordered set with qualitative confidence. CODEOWNERS indicate repository or content-maintenance responsibility, not product expertise by themselves. Old metadata remains uncertain, unavailable systems remain explicit gaps, and ambiguous identities stay separate.

> Results are discovery signals, not performance or ownership scores. Verify linked evidence before routing a documentation request.

## Innovation Studio

This project was prepared as a source repository for an Innovation Studio submission. The runnable artifact is the local dashboard, and the reusable AI behavior is the repository-scoped GitHub Copilot custom agent.
