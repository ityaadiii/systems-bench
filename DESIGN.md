# DESIGN.md — The Ledger, as built for the case-study surface

Documented from the shipped page, not written ahead of it.

## Where this world comes from
Inherited, not invented. The Ledger is Aditi's existing personal-brand system (`portfolio-story/portfolio-v2/app/globals.css`). This surface extends it; it does not replace it. Her second system, Headwords, is for tools and trackers and is what the bench's own generated report wears. The two must stay visually distinguishable: a tool that reports and an argument that persuades should not look alike.

## Tokens
```
--bg    #f1f0eb   bone paper          --tx   #101013   ink
--bg2   #eae8e1   recessed paper      --dim  #55555c   secondary
--panel #fafaf7   chart ground        --hair #d8d6cf   1px divisions
--well  #e9e7de   filled cell         --rule #101013   2px structural rules
--acc   #1f3fff   Klein blue          --bad  #a3232f   budget line, over-budget verdict
--ease  cubic-bezier(0.22,1,0.36,1)
```
Ground is bone under a 44px graph rule at 3.2% and an SVG turbulence grain at 3.5%, painted into the body background so scrolling never re-composites a layer.

Colour strategy is **Restrained**: neutrals plus one accent. Klein blue is not decoration — it is spent only on live measurement (the dial, the curve, the holds verdict, the strike that kills the wrong question) and on the four defects the real models exposed. Red appears twice: the error budget rule, and a verdict that misses it.

## Type
- **Display** — Archivo 900, uppercase, tracking −0.04em, line-height 0.92. Embedded as base64 woff2 (latin subset, ~14KB) so it survives any host. Capped at 6rem.
- **Story** — Fraunces italic 400. One aside per band, never a paragraph. Carries the sentence a reader should repeat.
- **Figures** — system mono with `tabular-nums`. Used for measurement only, never as a costume for "technical".
- **Body** — system stack. Measure held to 68ch.

## Composition
Full-bleed 2px ink rules divide bands. **No cards anywhere**: content is framed by rules, and cells butt directly against them, which is what a ledger does. The design detector reads this as cramped padding on the wrappers; the padding lives on the cells (14–19px, verified in the browser), and the wrapper-to-frame contact is the world working as intended.

One reversed band, ink ground, for the eight defects. It is the page's only structural inversion and it lands where the argument turns on itself.

## The signature interaction
A threshold dial over real measured data. Four figures and a marker move together; the verdict re-decides between holds and over-budget. Everything is computed in-page from the same risk-coverage curve the bench produced, with the eval-set size and error count derived from the curve itself so a numerator and denominator can never come from different sets.

Degrades honestly: a `<noscript>` block states the answer the dial settles on.

## Motion
Exactly one authored moment: the risk-coverage curve draws itself once per column, 1.1s on the shared ease, from an already-visible default. An earlier second moment (the hero strike animating in) was removed rather than kept — two moments is scattered effects, not a grammar. Everything is disabled under `prefers-reduced-motion`.

## Browser surfaces
Selection is Klein blue on bone, and inverts inside the reversed band. Caret is Klein blue. Focus ring is 2.5px Klein blue at 3px offset. Scrollbar is themed thin in `--dim` on `--bg2`. The scrolling results table carries its own gradient shadow affordance and is a labelled, focusable region.

## Verified in the browser
Contrast: every pair 3.56:1 or better, body pairs 5.7:1 and above, against a 4.5:1 floor. No horizontal overflow at 375px or 1182px. The wide table scrolls inside its own container.

## Refused
No eyebrows above headings. No cards. No shadows on content. No gradient text. No section numbers except on the defect list, where the count is the point. No icon set: this page has no icons, because it had nothing an icon would have said better.
