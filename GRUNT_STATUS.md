# Grunt status — Amazing Adventure

> **Standing owner priority (from round 56 on): graphics realism.**
> Make Amazing Adventure look substantially better and more convincing: rich
> lighting, stronger materials, better geometry, a cohesive environment — while
> keeping the game playable and performing on desktop and mobile. Use headless
> Blender (`/worker/state/grunt-blender`) for meshes and bakes and the free
> Kaggle GPU (`/worker/state/grunt-kaggle`) for texture work; free-licensed
> third-party assets are allowed with attribution in `CREDITS.md`. Pick the
> highest-impact work each round rather than using every tool every time.
> No paid resources, accounts or consent changes are authorized.

## Current task

**Round 101 generator corrected, asset regenerating.** A self-review (two read-only
agents + a sign trace) found three real bugs in
art/kaggle/roof_shingle_textures.py before release:
- B2 normal Y-sign inverted for the bottom-up PNG read by Three.js (would read
  every butt edge/grain ridge as a valley). Fix: negate the Y gradient, matching
  plaza v2. Confirmed by a sign trace (green 0.4922 < 0.5 for a +row ramp).
- B1 seam assertions measured the pinned-float arrays (always 0, vacuous);
  the check now runs on the 8-bit quantized arrays write_png emits.
- B3 dead course-geometry block (course_counts/course_offsets/N_SHINGLES/
  COURSE_PITCH/downsample/upsample) and a dishonest "courses: 8" report entry
  removed (tile is one banded course; the running bond comes from instance
  layout). Also dropped dead is_crown, the vestigial base=1.0, and fixed the
  duplicated grain comment and docstring.
Committed code + integration stand and pass: unit 1452/1452, desktop 357/357,
mobile 184/184. The SHIPPED normal is the inverted one from job v45; the fix
is committed in the generator but the asset must be regenerated and re-verified
before release. Kaggle job v46 RUNNING; then download, WebP-convert, re-verify
seams, commit, rebuild dist, re-run browser suites, then prepare the release at
the corrected HEAD.

Trusted release: channel is configured. Verification ids queued (plan
`release`): tests 846ac85d-95f9-43f3-b90c-aacadae655b6, browser
df7dfd5d-20fd-47b3-8a81-af7f98b2f80b, mobile
6f4e134d-3521-475c-af63-be1cf53f103b. Review agents running.

## Next steps
1. Kaggle job v46 finishes -> download normal PNG, WebP-convert, re-verify seams, commit, rebuild dist, re-run browser suites.
2. Poll the three release verification ids, then `grunt-release prepare` at the corrected HEAD and record the review.
3. Round 102 candidate (survey agent): border-wall coping/pilasters — pure code, reuses the stone family, no new asset. Flat-colour backlog is nearly exhausted; remaining realism gap is geometry/silhouette.
