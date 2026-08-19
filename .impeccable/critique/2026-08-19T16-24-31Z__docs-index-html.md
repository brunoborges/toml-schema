---
target: the website toml-schema.org
total_score: 26
max_score: 36
na_heuristics: 9
p0_count: 0
p1_count: 2
timestamp: 2026-08-19T16-24-31Z
slug: docs-index-html
---
Method: dual-agent (A: design-review · B: detector-evidence)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Static links have clear hover/focus states, but the long page gives no location cue. |
| 2 | Match System / Real World | 4 | Copy and examples speak fluent TOML and use real project artifacts. |
| 3 | User Control and Freedom | 2 | Non-sticky navigation and an undiscoverable horizontally scrolling mobile menu make long-page movement cumbersome. |
| 4 | Consistency and Standards | 3 | Components are cohesive, but duplicate specification CTAs and equal-weight navigation blur hierarchy. |
| 5 | Error Prevention | 3 | Few risky actions exist; links and labels are generally explicit. |
| 6 | Recognition Rather Than Recall | 2 | Seven tour panels lack progress or a local index, forcing users to retain context across a long scroll. |
| 7 | Flexibility and Efficiency | 2 | Return visitors get no persistent shortcut to the editor, specification, or implementations. |
| 8 | Aesthetic and Minimalist Design | 2 | Calm styling is undermined by competing CTAs and broken code-panel containment. |
| 9 | Error Recovery | n/a | This static persuasion surface exposes no recoverable error state. |
| 10 | Help and Documentation | 3 | Specification, implementation, and feedback paths are visible and concrete. |
| **Total** | | **26/36** | **Good (72%)** |

## Design Specificity Verdict

**Specific content, strategically generic sequence.** The page is unmistakably about TOML Schema: the hero example, SemVer language, `.tosd` references, implementation evidence, and paired schema/TOML samples are real and credible. The composition does not capitalize on that specificity. Its strongest differentiator, the visual editor, appears after a conventional three-card value proposition and proof band, while the hero prioritizes reading the specification.

The deterministic scan returned **13 anti-pattern findings**. They were concentrated around the eyebrow treatment, seven hairline-border/wide-shadow card treatments, four long-line warnings, and global single-font/cream-palette signals. The line-length and global palette/font warnings are mostly false positives for this technical site; the repeated shadowed-card treatment supports the broader finding that the visual language is competent but category-familiar.

Browser injection succeeded through direct evaluation after the HTTPS page rejected the localhost script tag. The browser reported 13 findings and produced desktop overlay and mobile evidence. No reliable persistent user-visible overlay tab remains; the evidence was captured during the assessment.

## Overall Impression

The homepage earns technical trust quickly, but it does not convert that trust into one obvious next action. The biggest opportunity is to make the editor the first-viewport proof object and restructure the rest of the page around a single adoption path.

## What's Working

1. **The value proposition is immediate.** “Validate TOML without leaving TOML” is short, differentiated, and legible to the target audience.
2. **Proof is real rather than promotional.** The checked-in schema example, validation result, and Java/Go/Rust implementations create credible developer evidence without invented claims.
3. **The visual system is restrained and accessible by default.** Focus outlines, semantic structure, dark-mode tokens, meaningful image alt text, and consistent component patterns form a solid base.

## Priority Issues

### [P1] Code examples break their containers

**Why it matters:** At 390px, long schema examples bleed beyond rounded tour cards and the viewport without a clear horizontal-scroll cue. On desktop, `height: calc(100% - 24px)` combines with overflow behavior to create clipped examples and nested vertical scrolling. A documentation page about structured correctness looks visibly broken.

**Fix:** Remove the fixed height from `.tour-step pre`, explicitly allow vertical growth, constrain every grid child with `min-width: 0`, and preserve horizontal scrolling inside the card. Add a subtle edge fade only when horizontal overflow exists.

**Suggested command:** `/impeccable adapt`

### [P1] The page has no decisive conversion path

**Why it matters:** Seven equal-weight navigation choices, two hero actions, and several later CTAs ask visitors to choose among specification, evidence, editor, implementations, and GitHub before the page establishes a primary journey.

**Fix:** Make “Explore the TOML Schema Editor” the primary action, retain the specification as the secondary action, reduce top-level navigation to the highest-value destinations, and demote later repeated CTAs to contextual text links.

**Suggested command:** `/impeccable distill`

### [P2] The editor arrives after generic category language

**Why it matters:** “Native / Practical / Toolable” could describe many developer tools. Visitors encounter these conventional cards before seeing the editor screenshot that only this project can own.

**Fix:** Move a condensed editor proof object into or immediately below the hero, then use the three benefits as annotations tied to visible editor behavior rather than standalone adjective cards.

**Suggested command:** `/impeccable bolder`

### [P2] The seven-step tour creates competence fatigue

**Why it matters:** Repeated two-column code panels have little change in rhythm, no progress cue, and require users to remember earlier concepts. The page’s emotional arc peaks before its longest section, then ends on implementation inventory.

**Fix:** Add a compact tour index, group examples into fundamentals/structure/constraints, and end with a focused next step rather than another card row.

**Suggested command:** `/impeccable layout`

### [P2] Mobile navigation hides overflow

**Why it matters:** The horizontally scrolling menu clips its final item with no fade, chevron, or partial-item cue. Users may never discover all destinations.

**Fix:** Replace the seven-item strip with a compact menu or add a clear scroll affordance and visible current-location state.

**Suggested command:** `/impeccable adapt`

## Persona Red Flags

**Alex (Impatient Power User):** Alex wants the implementation or editor immediately. The non-sticky seven-item navigation and repeated specification CTA add scanning cost, while the editor is buried below multiple sections.

**Jordan (First-Timer):** Jordan understands the headline but faces nine first-viewport choices across navigation and hero actions. Terms such as `itemtype`, `oneof`, and `dependentrequired` become dense before the page provides a simple “start here” path.

**Sam (Accessibility-Dependent User):** Semantic headings, focus styles, and alt text are strong. The mobile menu’s visually hidden overflow and code examples that escape their containers become serious problems at zoom or narrow widths, where spatial relationships are already harder to track.

## Minor Observations

- The proof band is strong evidence but its entire content is one large link, making reading and activation visually indistinguishable.
- The editor screenshot is too small on the homepage to function as the memorable proof object described in the surface brief.
- The page ends on implementation cards rather than a confident adoption or contribution CTA.
- The automated eyebrow, single-font, and cream-palette warnings are intentional enough to ignore unless a broader redesign is requested.

## Questions to Consider

- If the editor is the product’s clearest differentiator, why is the specification still the hero’s primary action?
- What could be removed from the seven-item navigation without blocking a serious evaluator?
- Could the tour teach through one progressively built schema instead of seven visually identical panels?
