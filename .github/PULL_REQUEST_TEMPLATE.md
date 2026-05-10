## Summary

Describe the change in 2-5 bullets. Focus on user-visible behavior, integration impact, and risk.

- 

## Branch Type

Select one and delete the others:

- [ ] `feature/<topic>`
- [ ] `integration/<topic>`
- [ ] `hotfix/<topic>`

Branch name:

- ``

## Integration Context

If this PR merges or imports work from another branch/repo, describe the source and the intended ownership boundary.

- Source branch/repo:
- Why this change belongs now:
- Conflict-prone files reviewed:

## Validation Run

List every command actually run for this PR. If a command was not applicable, say why.

```text
npm exec tsc -- --noEmit
npm run build
cargo check
```

Validation notes:

- 

## Desktop / Runtime Checks

Required when the change touches Tauri, DB flows, the SQL editor, dashboards, AI/agent flows, or integration seams.

- [ ] Not applicable
- [ ] Desktop app launched successfully
- [ ] Database connection path checked
- [ ] SQL editor rendered correctly
- [ ] Dashboard / Graph Builder flow checked
- [ ] AI / agent flow checked

Runtime notes:

- 

## Regression Risk

Call out the most likely regression areas and how they were checked.

- 

## Checklist

- [ ] Scope is intentional and limited
- [ ] No unrelated files were modified
- [ ] Integration playbook was followed for large branch intake work
- [ ] Validation commands and outcomes are recorded above
- [ ] Desktop/runtime checks are recorded above when relevant
