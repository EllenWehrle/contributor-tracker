# Review Routing Process

Contributor Tracker uses small, auditable CSV stores to improve routing without creating a people score.

## Workflow

1. Analyze the article and select or create its canonical topic.
2. Expand the query using verified taxonomy mappings.
3. Gather direct evidence from source, reviews, work items, releases, incidents, and recent discussions available to the requester.
4. Resolve identities only through explicit evidence. Never join identities from display-name similarity.
5. Consult Topic expert relationships and prior routing events after establishing current topical evidence.
6. Suggest an unordered set of complementary reviewers and explain the evidence and gaps.
7. Append each request and later outcome to review history.

## Boundaries

- CODEOWNERS indicate repository or content-maintenance responsibility, not product expertise by themselves.
- A recent contribution does not establish employment, ownership, authority, availability, or quality.
- A validation event records that a requested validation occurred; it is not a quality judgment.
- Do not calculate acceptance rates, response scores, rankings, or comparative people metrics.
- Store only professional identity and routing data needed for the workflow.
- Preserve evidence URLs, sensitivity labels, and source permissions.
