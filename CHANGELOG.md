# Changelog

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
