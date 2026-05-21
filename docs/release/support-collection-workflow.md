# Support Collection Workflow

Use this workflow when a release candidate or installed desktop build fails in a way that needs engineering follow-up.

## When To Use It

- workspace session will not restore or appears corrupted
- saved connections fail to restore or reconnect
- pipeline runs fail or produce unexpected output
- AI task resume/approval flow appears stuck or inconsistent
- support needs a reproducible snapshot before asking a user to clear local data

## What To Collect First

1. App version from the running build.
2. Exact user-facing error text or toast copy.
3. Whether the issue happened after restart, reconnection, approval, or pipeline execution.
4. One screenshot of the visible failure state.
5. A fresh `Support Bundle` export from `Safety & Local Data`.

## Support Bundle Path

Open `Safety & Local Data`, then use:

- `Support Bundle`
  - exports app health, local-data stats, query concurrency, workspace-session presence, and recent security-audit records
- `Export JSON`
  - exports only the currently filtered audit view

Prefer `Support Bundle` first. Use `Export JSON` only when narrowing to audit-policy decisions.

## Failure-Specific Notes

### Corrupted or unreadable workspace session

- export `Support Bundle` before clearing anything
- capture whether restored tabs show `snapshot` or `offline` badges
- note whether interrupted AI work was restored as resumable context

### Connection restore failure

- capture which saved connection failed
- note whether reconnect works manually
- include whether native persistence fallback warning appeared

### Pipeline run failure

- capture pipeline name, source connection, target connection, and target table
- export `Support Bundle`
- if present, open the latest pipeline run error from the Pipelines panel and capture it

## After Collection

Only clear local data after the bundle and screenshots have been captured.

If the issue blocks certification or packaging, attach the bundle to the release ticket together with:

- validation report
- packaging-machine manifest
- screenshots of the failure
