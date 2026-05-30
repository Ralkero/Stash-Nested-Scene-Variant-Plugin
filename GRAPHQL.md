# GraphQL Operations

The embedded engine uses only GraphQL through `gql.Do()`. It does not write to SQLite.

## Queries

- `FindSceneForMetadataVariants`
  - `findScene(id)`
  - reads `id`, `title`, `details`, `custom_fields`, `studio`, `groups`, `tags`, `files`

- `FindScenesForMetadataVariants`
  - `findScenes(filter)`
  - used by bulk auto-tagging when no explicit `scene_ids` are supplied

- `FindScenesWithCustomFields`
  - `findScenes(filter)`
  - used by validation and rollback scans

- `FindStudiosForMetadataVariants`
  - `findStudios(studio_filter, filter)`

- `FindGroupsForMetadataVariants`
  - `findGroups(group_filter, filter)`

- `FindTagsForMetadataVariants`
  - `findTags(tag_filter, filter)`

## Mutations

- `CreateStudioForMetadataVariants`
  - `studioCreate(input: StudioCreateInput!)`

- `CreateGroupForMetadataVariants`
  - `groupCreate(input: GroupCreateInput!)`

- `CreateTagForMetadataVariants`
  - `tagCreate(input: TagCreateInput!)`

- `UpdateSceneForMetadataVariants`
  - `sceneUpdate(input: SceneUpdateInput!)`
  - applies `studio_id`, `groups`, `tag_ids`, and `custom_fields`

## Safety Assumptions

- `sceneUpdate.groups` and `sceneUpdate.tag_ids` are treated as replacement fields.
- The plugin reads current scene state first and sends merged arrays.
- Variant data uses `custom_fields.partial` and `custom_fields.remove`.
- V1 writes `variant_children` as a JSON string for portability and reads either JSON strings or arrays.

## Live Verification Needed

Confirm these in the target Stash v0.31.1 GraphQL playground:

- `CustomFieldsInput.partial` accepts string values for all variant keys.
- `SceneUpdateInput.groups` accepts `[{ group_id: ID }]`.
- `runPluginTask(plugin_id, task_name, args_map)` is callable from UI JavaScript.
- `Group.aliases` shape matches the target instance behavior.
