# DOC GOVERNANCE: Living Documentation

## The "Truth" Principle
The code is the final truth, but the documentation must be the **primary map**. 

**Rule**: If a behavior-changing PR is merged, the corresponding documentation MUST be updated in the same PR. If code and docs disagree, the PR is considered incomplete.

## Document Hierarchy
1. **PRD.md**: The master requirements (the "What").
2. **Component Specs**: The technical implementation (the "How").
3. **README/API**: The usage guide (the "Use").

## Update Process
1. **Identify Impact**: When changing a function or account, identify which `docs/02-mvp-components/` file is affected.
2. **Update Spec**: Revise the "Public Interface" or "Algorithms" section of the component spec.
3. **Update API**: If the instruction signature changes, update `docs/03-api-interfaces/INSTRUCTIONS.md`.
4. **Verify**: Ensure the updated doc still aligns with the `MVP-SCOPE.md`.

## Documentation Maintenance
- **Broken Link Check**: A `docs-check.sh` script is run in CI to find broken internal links.
- **Review Cycle**: Every major release candidate requires a "Doc Review" as part of the PR checklist.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
