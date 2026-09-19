# UI QA CHECKLIST: Anti-Slop Verification

This checklist is used to review every screen before it is marked as "Design Complete". Any "Yes" to the rejection criteria means the screen must be redesigned.

## 🚫 Rejection Criteria ("AI-Slop" Detection)
- [ ] **Generic Gradients?**: Does it use purple/blue/pink "AI-style" gradients? $\rightarrow$ **REJECT**.
- [ ] **Glassmorphism?**: Does it rely on semi-transparent blurred backgrounds? $\rightarrow$ **REJECT**.
- [ ] **Soft Shadows?**: Does it use large, fuzzy drop shadows instead of borders? $\rightarrow$ **REJECT**.
- [ ] **Generic Icons?**: Does it use default Lucide/Heroicons without any styling or consistency? $\rightarrow$ **REJECT**.
- [ ] **Abstract Mush?**: Does the hero section use an abstract 3D "blob" or "sphere" from Midjourney? $\rightarrow$ **REJECT**.
- [ ] **Default Shadcn?**: Does it look like a default, untouched Shadcn UI template? $\rightarrow$ **REJECT**.

## ✅ Acceptance Criteria ("Institutional Precision")
- [ ] **Contrast**: Pure black `#0A0A0A` background with high-contrast white text.
- [ ] **Typography**: Editorial Serif used for headlines; Geometric Sans for UI.
- [ ] **Borders**: 1px `#262626` borders used for surface definition.
- [ ] **Spacing**: Generous, consistent white space (no cramped elements).
- [ ] **Precision**: Monospace fonts used for all numeric/ID values.
- [ ] **Motion**: Transitions are linear and fast (100ms); no "bouncing" animations.

## Final Sign-off
- [ ] **Desktop QA**: Verified on Chrome/Safari 1440px.
- [ ] **Mobile QA**: Verified on iOS/Android (Responsive).
- [ ] **a11y QA**: Contrast ratio passed; keyboard nav functional.
