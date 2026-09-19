# PR CHECKLIST: PERMA

## 🛠️ Implementation
- [ ] Code follows `CODING-STANDARDS.md`.
- [ ] All new functions have doc comments.
- [ ] No `unwrap()` or `expect()` used in program logic.
- [ ] Rounding favors the protocol.

## 🧪 Testing
- [ ] Unit tests updated and passing.
- [ ] Integration tests cover the new behavior.
- [ ] Edge cases (rounding, overflow, empty accounts) tested.
- [ ] Invariants verified.

## 📝 Documentation
- [ ] `docs/` updated to reflect changes.
- [ ] `docs/CHANGELOG.md` entry added.
- [ ] `docs/02-mvp-components/` specs updated.
- [ ] `INSTRUCTIONS.md` updated (if applicable).

## 🛡️ Security
- [ ] PDA seeds verified.
- [ ] Account ownership checks implemented.
- [ ] Slippage guards added to all CPI calls.
- [ ] Solvency checked on risk-increasing actions.
