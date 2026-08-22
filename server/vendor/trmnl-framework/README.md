# Vendored TRMNL Framework assets

The ePaper design system used to render display images. Upstream:
<https://github.com/usetrmnl/trmnl-framework> (MIT, see `LICENSE`).

| | |
|---|---|
| Version | 3.2.0 (see `VERSION`) |
| Upstream commit | `83755968c9d6d1787928f160a58e4c056e17a2f6` (2026-08-11) |

## What is here, and what is not

Upstream is ~652 MB, almost all of which is 44 archived CSS releases and 1,908
pattern images. We take only the current release:

- `css/plugins.min.css` — the framework bundle, **byte-identical to upstream**
- `js/plugins.min.js` — the `terminalize()` runtime
- `fonts/` — only the 23 files the bundle's `@font-face` rules actually reference

Deliberately excluded: the Rails docs site and gem (the Ruby is *only* the
documentation server and release pipeline — nothing in the render path needs it),
archived versions, and the pattern images. Add pattern families under `images/`
if a component ever needs them.

## Do not edit these files

They are upstream bytes so the next version bump is a straight copy. Two
consequences worth knowing:

**Fonts resolve from an absolute path.** The bundle references
`url("/fonts/…")`, so the render environment provides `/fonts` as a symlink to
this directory (see `server/Dockerfile`). That keeps the CSS unmodified and means
the same absolute path also works if we ever serve the assets over HTTP instead
of `file://`.

**The framework is not device-agnostic.** A rendered document must carry a
`.trmnl` ancestor — 80,184 rules in the bundle are scoped under it, so without it
the framework is inert — and `.screen` must name its device profile and depth,
e.g. `class="screen screen--v2 screen--4bit"`. The profile sets `--screen-w/h`,
`--pixel-ratio`, `--color-depth` and the gap scale. Note `.trmnl .screen` applies
`transform: scale(var(--pixel-ratio))` itself, so screenshot at the device pixel
size with `deviceScaleFactor: 1`.

## Updating

Copy the three trees from a fresh checkout of the tag, refresh `VERSION` and the
commit above, then re-run the display render checks — the framework's own rules
change between releases.
