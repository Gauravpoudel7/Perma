# UPDATE TRIGGERS: Documentation Maintenance

To ensure the documentation remains a living asset, the following triggers mandate an immediate update to the `docs/` folder.

## 1. Protocol Changes (High Priority)
Any PR that modifies the following must update the related docs:
- **Instruction Signature** $\rightarrow$ Update `INSTRUCTIONS.md` and `CLIENT-SDK.md`.
- **Account Layout/PDA Seeds** $\rightarrow$ Update `ONCHAIN-ARCHITECTURE.md` and the relevant Component Spec.
- **Math/Economic Logic** $\rightarrow$ Update `FIXTURES-AND-VECTORS.md` and the relevant Component Spec.
- **Risk Params** $\rightarrow$ Update `S-S-S` (Security Baseline) and `THREAT-MODEL.md`.

## 2. Scope Shifts
- **Feature Addition**: If a "Stretch Goal" is implemented or a new feature is added $\rightarrow$ Update `MVP-SCOPE.md`.
- **Constraint Change**: If the allowlisted pool changes $\rightarrow$ Update `MVP-SCOPE.md` and `RUNBOOK-DEVNET.md`.

## 3. Tooling Updates
- **Dependency Change**: Update `TECH-STACK.md`.
- **Local Setup Change**: Update `LOCAL-DEV.md`.

## 4. Audit/Bug Findings
- **Bug Fix**: Update `CHANGELOG.md` and the "Failure Modes" section of the affected Component Spec.
- **Audit Finding**: Create an ADR for the fix and update the `SECURITY-BASELINE.md`.

---

**🚩 STATUS:** Prototype. Not audited. Single pool. Not production mainnet risk capital.
