# Rollback

The plugin never deletes scenes or files. Rollback means removing plugin-owned variant metadata and optionally removing the helper tag from scenes.

## Stop Using The Plugin

1. In Stash, disable or remove the plugin folder.
2. Reload plugins.
3. The UI panel and task entries should disappear.

Existing scene metadata remains in Stash until you remove it.

## Roll Back Variant Relationships

Use the `Rollback variant data` task.

By default, rollback uses `variantScanLimit=0`, which means it pages through all scenes returned by Stash instead of using the smaller bulk auto-tag discovery limit. Set a positive `variantScanLimit` only if you intentionally want a bounded rollback.

Start with:

```text
dryRun=true
```

Review the log, then run:

```text
dryRun=false
```

The task removes only these custom field keys:

```text
variant_role
variant_set_id
variant_children
variant_parent_id
variant_label
variant_sort_index
```

If `removeHiddenTagWhenUnlinked` is enabled, it also removes the configured helper tag from affected scenes.

It does not remove:

- Studio
- Groups
- character Tags
- title
- details
- files
- unrelated custom fields

## Unlink One Variant

Use the `Variant Sets: Detach child scene` task with:

```text
childSceneId=<child id>
dryRun=true
```

Then rerun with `dryRun=false`.

Unlinking removes the child from the parent's `variant_children`, removes the child variant fields, and optionally removes the helper tag.

## Recover From A Bad Link

If the wrong child was linked:

1. Run `Variant Sets: Detach child scene` for that child.
2. Confirm the child no longer has `variant_role=variant`.
3. Confirm the parent no longer lists that child.
4. Link the correct child.

If a child was moved under the wrong primary:

1. Use `Move variant to primary` with the intended primary ID.
2. Or unlink first, then link again.

## Restore Plugin Files

If you copied this plugin into `.stash\plugins` and need to restore a previous plugin version:

1. Stop Stash or leave the plugin idle.
2. Replace the plugin folder with your backup.
3. Reload plugins in Stash.

Do not edit the Stash SQLite database directly.
