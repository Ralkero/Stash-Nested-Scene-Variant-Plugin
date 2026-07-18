# Changelog

## 0.5.22

- Reworked the main README into a complete feature guide with public-safe live screenshots of discovery, review, player navigation, and nested browse filtering.
- Replaced the looping discovery spinner and indeterminate bar with a determinate percentage, phase labels, completed-step indicators, and elapsed time.
- Split interactive discovery into three measured read-only stages: direct duplicate evidence, paged library descriptor loading, and evidence-only family reconciliation.
- Avoided nested GraphQL work inside synchronous plugin operations so the review UI remains responsive and reports page-level progress while loading the library.
- Loaded the shared discovery engine into the browser UI so multi-megabyte evidence is reconciled locally instead of crossing Stash's slow embedded `Map` boundary.
- Added backend progress reporting throughout the monolithic Settings task so Stash's job progress now advances as completed work is measured.
- Kept candidate matching, review drafts, approvals, and applied relationship behavior unchanged.

## 0.5.21

- Fixed `Make Set Primary` dropping the former primary scene from the family.
- Promotion now performs an ordered swap: the chosen child becomes primary and the former primary occupies that child's previous slot.
- Preserved every sibling, child label, sort position, and set relationship while transferring the optional hidden tag to the demoted primary.
- Added a regression test covering a three-child family with a middle child promoted.

## 0.5.20

- Replaced post-pagination CSS hiding with Stash's native `custom_fields.variant_role != variant` scene filter.
- Kept nested variants hidden by default while restoring truthful result totals, full configured page sizes, and correct pagination.
- Updated the ellipsis-menu toggle to add or remove the native URL criterion without tags or scene metadata mutations.
- Preserved existing search, sort, display, page-size, and unrelated custom-field criteria when toggling visibility.

## 0.5.19

- Restored hidden-by-default child variant cards on the Scenes browsing page.
- Restored the persistent `Show nested variants` / `Hide nested variants` control in the Scenes toolbar ellipsis menu.
- Retained the primary-card variant dropdown and documented that client-side hiding can reduce the visible count below Stash's configured page size.

## 0.5.18

- Removed client-side hiding of child variant cards after Stash paginates scene results.
- Restored accurate Scenes-page item counts: a 40-item page now remains 40 visible cards even when it contains linked variants.
- Removed the `Show nested variants` toolbar injection and its browser preference. Use an optional Stash-native saved filter when server-side variant filtering is desired.

## 0.5.17

- Added consistent mouse-hover and keyboard-focus tooltips for Scene Variant controls in the player manager, candidate review, family search, scene search, browse controls, resize handles, and drag-enabled family cards.
- Centralized action descriptions so dynamically rebuilt candidate controls retain explanatory tooltips.

## 0.5.16

- Sorted scene-player variant families numerically by default, keeping the primary first and using stored sort indexes and natural title order as fallbacks.
- Added a full-width bottom chevron that collapses or expands the scene-player variant manager, with every newly loaded scene open by default.

## 0.5.15

- Prevented player-page variant thumbnails and previews from overflowing their grid column and covering scene titles.

## 0.5.14

- Rebuilt the scene-player variant list as structured rows with Stash screenshots and lazy generated hover previews.
- Added per-variant queue-selection controls plus `Add Selected` and `Add All Variants` actions.
- Integrated with Session Scene Queue through its public add-many API, preserving queue order and ignoring duplicates.
- Excluded the currently playing scene from queue actions while keeping it visible as family context.
- Added live queue feedback for successful additions, already-queued scenes, and missing queue-plugin integration.

## 0.5.13

- Made draft family membership authoritative: every scene present in a family is automatically included in Preview and Apply.
- Replaced functional per-scene Include checkboxes with read-only `Included` indicators.
- Removed per-row removal buttons so mistaken membership is corrected consistently through `Select Scenes` and `Remove Scenes From Families`.
- Added a browser-draft migration that preserves family edits and approvals, normalizes every existing member to included, and invalidates stale dry-run authorization.

## 0.5.12

- Replaced each family-level approval checkbox with a clickable status badge that changes from `Review`, `Suggested`, or `Ignored` to `Approved`.
- Added an Approved result filter while keeping approval separate from temporary scene-editing selection.
- Added direct family drag merging from any noninteractive area of a result section.
- Added compatible and incompatible drop-target feedback and a compact floating family preview.
- Added smooth continuous result-list scrolling while a dragged family is held near the top or bottom edge.
- Routed drag merges through the existing identity guard, preference preservation, localStorage persistence, and dry-run invalidation path.

## 0.5.11

- Preserved explicit `V1`, `V2`, and later version identifiers as hard discovery-family boundaries.
- Added complete filename character signatures so multi-character scenes cannot be grouped from an incomplete tag subset.
- Removed plain numeric suffixes as evidence for expanding beyond scenes returned by Stash's strict duplicate checker.
- Added read-only descriptor-family discovery across the library for exact artist, character, version, duration, and dimension matches using `Std`, `Bonus`, `Alt`, `Nude`, `Loop`, `Vertical`, `Phone`, and related signals.
- Recognized `NMA`, `No Male Audio`, `Cam`, and `Camera` as variant evidence, and normalized alternate-angle language.
- Removed descriptor sequence numbers such as `Alt 5` and `Rev 2` from family stems so stacked descriptors remain in the same family.
- Treated `Phone` renders as explicit orientation variants alongside `Vertical` and `Portrait`.
- Allowed a constrained pHash distance of 12 only inside those exact descriptor families; broader Stash duplicate discovery remains at the configured strict distance.
- Added split-repair review candidates for existing sets that mix explicit versions.
- Batch reconciliation can now replace a primary's child list when applying an approved split, leaving excluded versions unlinked rather than carrying them into the repaired set.

## 0.5.10

- Added conservative duplicate-supported neighborhood expansion for wardrobe, camera, numbered, and vertical renders that strict pHash matching fragments.
- Neighborhood expansion requires an exact canonical artist, exact character set, and exact normalized family stem around a scene already returned by Stash's duplicate checker.
- Split expanded neighborhoods by duration and compatible dimensions, including explicit portrait/vertical rotations, without raising the global duplicate distance.
- Added `Vertical` and `Portrait` filename signals and kept expanded matches in review status.
- Added review support for replacing a partial family's current primary with a stronger unnumbered, `Std`, or other canonical parent candidate.
- Batch apply now reconciles a reviewed family as one set, allowing an old primary and its children to move safely under the newly approved primary.

## 0.5.9

- Removed already-complete variant sets and unsupported singleton scenes from candidate discovery results.
- Added actionable discovery result types: new families contain at least two unassigned scenes, while lone unassigned matches are shown only when they can be proposed for a specific existing family.
- Existing-family suggestions now hydrate and display the current primary and all linked children, rather than showing an isolated candidate without context.
- Apply approvals for existing-family suggestions include only the proposed additions; already-linked family members are shown for reference and are not relinked.
- Added explicit Existing family and Proposed additions sections to the review UI.
- Manual family creation now requires both a primary and at least one variant, and draft editing no longer preserves one-scene families.
- Discovery summaries now report how many already-linked families and unsupported singleton suggestions were omitted.

## 0.5.8

- Fixed the variant list disappearing after navigating from a primary scene to one of its child scenes.
- Removed generic page and body mount fallbacks that could strand the panel outside Stash's scene-details layout while a child page was still rendering.
- The panel now waits for the real scene-details container and verifies both its scene ID and parent container before considering itself mounted.
- Added a lightweight route and layout watchdog so parent, child, and child-to-child navigation retain the variant list even if Stash replaces the scene DOM without emitting its usual location event.

## 0.5.7

- Fixed scene-player variant panels disappearing when Stash completes or replaces the React scene layout after plugin startup.
- Replaced parallel one-request-per-child loading with a single batched GraphQL query, preventing one transient SQLite lock from suppressing the entire panel.
- Added brief retries for scene read queries when Stash reports database lock contention.
- Kept the scene panel visible with an actionable warning if related scenes still cannot be loaded.
- Applied the same batched loading path to variant menus on scene browse cards.

## 0.5.6

- Replaced the unexplained disabled live-apply button with an active `Preview Required` state when approvals exist but no current dry run has been queued.
- Clicking `Preview Required` now offers to queue the required dry run while preserving the complete browser review draft.
- After the preview is queued successfully, the same control changes to `Create Variant Sets`.
- Added preview readiness to the review summary and a distinct amber prerequisite treatment.

## 0.5.5

- Separated Apply approval from temporary editing selection with distinct green and cyan controls.
- Suggested families now default to approved with all proposed children included; review and ignored families remain unapproved.
- Added an Approval menu for approving all suggested families, approving or unapproving visible families, and clearing approvals.
- Editing checkboxes stay hidden until `Select Scenes` mode is enabled.
- Manual edits unapprove only the affected family, while explicit approval decisions persist when the exact family reappears after discovery.
- Expanded the review summary with approved, needs-review, and editing-selection counts.

## 0.5.4

- Added dedicated scene-selection checkboxes for editing candidate-family drafts.
- New discovery results and migrated review drafts now start unapproved and unchecked.
- Added a contextual Actions menu for merging families, moving scenes, creating a family from selected scenes, and removing selected scenes or families.
- Added a searchable merge-family chooser that filters immediately while typing.
- Kept family approval and child inclusion separate from temporary editing selection.

## 0.5.3

- Made Stash duplicate-checker membership mandatory for automatic candidate discovery; filenames can bridge duplicate-supported scenes but cannot originate a family on their own.
- Tightened the default pHash distance from `8` to `4` and duration tolerance from `10` seconds to `2` seconds.
- Added direct duration, aspect-ratio, and pHash compatibility checks when partitioning duplicate clusters.
- Recalculated filename cohesion across the final merged family and split unrelated title outliers from strong matching subgroups.
- Added media evidence to candidate results and the review UI.

## 0.5.2

- Increased visual separation between candidate-family sections with a high-contrast amber outline and restrained shadow.
- Kept the existing review layout, dimensions, spacing, and controls unchanged.

## 0.5.1

- Audited the current library's canonical-version vocabulary: 62 `Std` files, one `Default`, three `Regular`, four `Vanilla`, one `Original`, and contextual `Full Version`/`Full Anim`/`Full Audio` examples.
- Added strong parent preference for `Std`, `Standard`, and `Default`, including cases where the standard scene has lower resolution than a visual variant.
- Added supporting preference for `Regular`, `Normal`, and `Vanilla`, plus contextual completeness signals such as `Full Version`, `Full Animation`, `Full Audio`, `Complete`, and `Uncut`.
- Added weak future-compatible signals for `Original`, `Base`, and `Main`.
- Avoided false positives from ordinary titles such as `Full Nelson`, `Full Service`, `Final Fantasy`, and `Master Chief`.
- Added `POV`, `Bonus`, `Nude`, and `Old Version` downgrade evidence so supporting parent words do not override clear variant descriptors.
- Displayed detected parent signals in the review UI and included them in manual-family primary selection.
- Added an explicit discovery-policy revision so existing browser drafts refresh once after scoring changes while UI-only releases can preserve them.

## 0.5.0

- Added canonical artist and character identity evidence to every discovered scene and family.
- Hard-split duplicate and filename clusters when reliable Stash Group metadata identifies different artists.
- Hard-split one artist's clusters when reliable character Tags or standardized filename fields identify different character sets.
- Preferred canonical Stash Group/Tag names and aliases over raw filename spelling so legitimate aliases remain together.
- Routed families with unresolved artist or character identity to review instead of auto-suggesting them.
- Blocked manual merge/add operations that would combine different known artists or characters, with an explanatory warning.
- Displayed canonical artist and character evidence directly in each review family.
- Triggered one read-only discovery refresh when upgrading an older 0.4.x browser draft so unsafe mixed-family candidates are replaced while compatible approvals are retained by family ID.

## 0.4.2

- Increased the candidate review dialog's viewport-aware default size so thumbnail rows and editing controls fit without right-side clipping.
- Added persisted drag resizing from all four edges and all four corners, with bounds constrained to the visible browser viewport.
- Made the candidate list independently scrollable while keeping review controls and action buttons accessible.
- Allowed family headers, member rows, and action areas to wrap safely at narrower user-selected sizes.

## 0.4.1

- Added Stash-generated screenshots to primary, child, and manual scene-search results in the candidate review UI.
- Added lazy hover and keyboard-focus playback using each scene's existing `paths.preview` asset, matching the native scene-card preview behavior without generating new media.
- Preserved static screenshot and animated WebP fallbacks when a generated preview video is unavailable.
- Included scene dimensions, duration, sprite, and VTT references in the read-only discovery payload for future review enhancements.
- Preserved existing browser review approvals across the upgrade and refresh their media metadata through a read-only discovery pass.

## 0.4.0

- Grouped terminally numbered files such as `Scene`, `Scene 2`, through `Scene 9` into one filename-backed family when an original exists or at least three numbered siblings provide strong sequence evidence.
- Merged overlapping Stash duplicate clusters transitively with filename families so one scene set is not presented as several partial candidates.
- Made the unnumbered original the deterministic primary when present; all-numbered sets prefer the lowest variant number before metadata and quality tie breakers.
- Added browser-draft controls to merge candidate families, add or remove scenes, create a manual family, delete an incorrect draft family, and override the primary.
- Invalidated dry-run authorization after every review edit so changed batches must be previewed again before live apply.
- Added a nine-scene Megaera/Makima regression fixture matching the split-cluster behavior observed in Stash.

## 0.3.1

- Changed the Stash Tasks-page discovery action into an interactive candidate-review launch instead of an invisible queued read-only job.
- Added a live discovery state with an activity indicator, elapsed time, disabled conflicting actions, and a clear failure state.
- Added candidate counts, status filtering, title/scene-ID search, confidence meters, descriptive primary titles, and direct scene links.
- Persisted the latest discovery count and duration with the browser-local review draft.

## 0.3.0

- Fixed synchronous discovery returning `null` by wrapping embedded JavaScript results in the `PluginOutput.Output` envelope required by Stash v0.31.1.
- Renamed the plugin and all exposed task/action labels around explicit variant sets, child scenes, and candidate families.
- Added a distinct `VS` identity to the scene panel and review dialog, with separate visual treatments for discovery, preview, live creation, and destructive actions.
- Synchronized manifest, backend, UI, and persisted-review versions.

## 0.2.1

- Raised V2 variant discovery defaults so only `0.94+` confidence families are auto-suggested, with `0.82-0.939` routed to review.
- Improved proposed-primary selection to prefer unnumbered canonical files, lower numbered variants when every file is numbered, stronger quality/full-version signals, and non-censored/non-clothed variants.
- Added regression tests for numbered sets, censored/raw pairs, and mid-confidence review classification.

## 0.2.0

- Added Nested Scene Variants V2 assisted discovery using Stash duplicate clusters plus filename and metadata heuristics.
- Added read-only `Discover variant candidates` and dry-run-first `Apply variant batch` task modes.
- Added a browser review surface with localStorage draft persistence, parent override, child inclusion, labels, dry-run queueing, and gated live apply.
- Added manifest settings for discovery distance, duration tolerance, scan limit, heuristic toggles, and confidence thresholds.
- Expanded mock GraphQL tests for duplicate-cluster ingestion, fallback discovery, scoring, batch preview, and confirmed live apply.

## 0.1.11

- Removed the scene-create post hook from the manifest because it can stall Stash scan jobs during new scene imports.
- Kept manual bulk auto-tagging available for post-scan dry runs and explicit apply workflows.

## 0.1.10

- Rendered scene-card variant dropdowns as fixed floating menus attached to `document.body` so card/grid overflow no longer clips them.
- Kept the trigger in the metadata counter row while positioning the dropdown under the trigger.

## 0.1.9

- Fixed scene-card variant dropdown placement so it targets the existing metadata counter row beside Tags and Groups instead of the upper card details area.
- Made the nested-variant show/hide menu injection respond to icon-only toolbar ellipsis menus and newly opened dropdowns.
- Added a fallback metadata row only when Stash card markup does not expose an existing counter row.

## 0.1.8

- Confined the scene-page `Variants` panel to exact scene-player routes so it is removed when returning to browsing pages.
- Replaced the thumbnail-corner `N variants` badge with a footer dropdown beside the normal Tags and Groups indicators.
- Added a chain-link style variant dropdown trigger that lists linked variants and navigates to the selected scene.
- Hide nested child variant cards on the scene browsing page by default.
- Added a best-effort `Show nested variants` toggle to the Scenes toolbar ellipsis menu.
- Updated tests and documentation for the new browsing behavior.

## 0.1.7

- Fixed live Stash task argument parsing for v0.31.1 `input.Args` casing.
- Verified real link/unlink behavior through Stash plugin tasks.

## 0.1.6

- Hardened the embedded JS entrypoint for Stash-like runtimes that expose CommonJS-style globals.

## 0.1.5

- Improved embedded task dispatch and final evaluated task output for Stash.

## 0.1.4

- Documented live Stash smoke verification and schema assumptions.

## 0.1.3

- Defaulted UI variant actions to dry-run through a visible toggle.

## 0.1.2

- Fixed the UI task runner to use the Stash manifest plugin ID.

## 0.1.1

- Renamed the manifest to avoid generic `plugin.yml` ID collisions.

## 0.1.0

- Initial V1 implementation with auto-tagging, variant custom fields, UI panel, mock tests, and rollback/validation tasks.
