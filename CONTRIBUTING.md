# Contributing to PERMA

Welcome! We are building a professional-grade volatility primitive. To maintain the "Institutional Precision" bar, we ask all contributors to follow these guidelines.

## 🛠️ Development Workflow
1. **Branching**: Create a feature branch from `main` (e.g., `feat/premium-calc`).
2. **Implementation**: Follow the `docs/05-engineering/CODING-STANDARDS.md`.
3. **Testing**: Every PR must include a test case in `tests/` or a new Anchor integration test.
4. **Documentation**: If you change the code, you MUST update the corresponding file in `docs/`.

## 📝 Pull Request Requirements
All PRs must use the `.github/pull_request_template.md` and include:
- A clear description of the change.
- A link to the `MVP-SCOPE.md` section it fulfills.
- Proof of testing (logs or screenshots).
- A confirmation that the `CHANGELOG.md` has been updated.

## 📐 Design Standards
If you are contributing to the UI:
- Refer to `docs/04-ui-ux/BRAND-SYSTEM.md`.
- Pass the `docs/04-ui-ux/UI-QA-CHECKLIST.md` anti-slop review.
- No generic purple glassmorphism.

## ⚖️ Code of Conduct
Be precise, be professional, and prioritize correctness over speed.
