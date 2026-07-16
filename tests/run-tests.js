const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const plugin = require("../scene-metadata-variants.js");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeDb(seed) {
  return {
    scenes: clone(seed.scenes || {}),
    studios: clone(seed.studios || {}),
    groups: clone(seed.groups || {}),
    tags: clone(seed.tags || {}),
    duplicates: clone(seed.duplicates || []),
    nextStudio: 1000,
    nextGroup: 2000,
    nextTag: 3000,
    calls: []
  };
}

function aliasList(obj) {
  if (!obj || !obj.aliases) return [];
  if (Array.isArray(obj.aliases)) return obj.aliases;
  if (typeof obj.aliases === "string") return obj.aliases.split(/[|,;\n\r]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesName(obj, name) {
  const n = norm(name);
  if (norm(obj.name) === n) return true;
  return aliasList(obj).some(a => norm(a) === n);
}

function sceneForGraphQL(db, scene) {
  const s = clone(scene);
  s.studio = s.studio_id ? clone(db.studios[s.studio_id]) : null;
  s.groups = (s.group_ids || []).map(id => ({ group: clone(db.groups[id]), scene_index: null })).filter(g => g.group);
  s.tags = (s.tag_ids || []).map(id => clone(db.tags[id])).filter(Boolean);
  s.files = s.files || [];
  return s;
}

function makeRuntime(db) {
  function orderedSceneIds(vars) {
    let ids = Object.keys(db.scenes);
    const filter = vars && vars.filter || {};
    ids.sort((a, b) => {
      const an = Number(a);
      const bn = Number(b);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(a).localeCompare(String(b));
    });
    if (String(filter.direction || "").toUpperCase() === "DESC") ids.reverse();
    return ids;
  }

  function filteredSceneIds(vars) {
    let ids = orderedSceneIds(vars);
    const filter = vars && vars.filter || {};
    const queryTokens = norm(filter.q).split(/\s+/).filter(Boolean);
    if (!queryTokens.length) return ids;
    return ids.filter(id => {
      const scene = db.scenes[id];
      const related = [
        scene.title,
        scene.details,
        ...(scene.files || []).flatMap(file => [file.basename, file.path]),
        scene.studio_id && db.studios[scene.studio_id] && db.studios[scene.studio_id].name,
        ...(scene.group_ids || []).map(groupId => db.groups[groupId] && db.groups[groupId].name),
        ...(scene.tag_ids || []).map(tagId => db.tags[tagId] && db.tags[tagId].name)
      ].filter(Boolean).join(" ");
      const haystack = norm(related);
      return queryTokens.every(token => haystack.includes(token));
    });
  }

  function pagedScenes(vars) {
    const ids = filteredSceneIds(vars);
    const filter = vars && vars.filter || {};
    const perPage = Number(filter.per_page) || ids.length || 1;
    const page = Math.max(1, Number(filter.page) || 1);
    const start = (page - 1) * perPage;
    return ids.slice(start, start + perPage).map(id => sceneForGraphQL(db, db.scenes[id]));
  }

  function listObjects(kind, vars) {
    const map = kind === "studio" ? db.studios : (kind === "group" ? db.groups : db.tags);
    let items = Object.keys(map).map(id => clone(map[id]));
    const filter = vars && (vars.studio_filter || vars.group_filter || vars.tag_filter);
    if (filter && filter.name && filter.name.value) {
      items = items.filter(item => matchesName(item, filter.name.value));
    }
    if (vars && vars.filter && vars.filter.q) {
      const q = norm(vars.filter.q);
      items = items.filter(item => norm(item.name).includes(q) || q.includes(norm(item.name)) || aliasList(item).some(a => norm(a).includes(q)));
    }
    return items;
  }

  function updateScene(input) {
    const scene = db.scenes[String(input.id)];
    if (!scene) throw new Error("missing scene " + input.id);
    if (Object.prototype.hasOwnProperty.call(input, "studio_id")) scene.studio_id = input.studio_id || null;
    if (input.groups) scene.group_ids = input.groups.map(g => String(g.group_id));
    if (input.tag_ids) scene.tag_ids = input.tag_ids.map(String);
    if (input.custom_fields) {
      scene.custom_fields = scene.custom_fields || {};
      if (input.custom_fields.partial) {
        Object.keys(input.custom_fields.partial).forEach(k => {
          scene.custom_fields[k] = input.custom_fields.partial[k];
        });
      }
      if (input.custom_fields.remove) {
        input.custom_fields.remove.forEach(k => delete scene.custom_fields[k]);
      }
    }
    return sceneForGraphQL(db, scene);
  }

  return {
    gql: {
      Do(query, vars) {
        db.calls.push({ query, vars: clone(vars || {}) });
        if (query.includes("FindSceneForMetadataVariants")) {
          const scene = db.scenes[String(vars.id)];
          return { findScene: scene ? sceneForGraphQL(db, scene) : null };
        }
        if (query.includes("FindScenesWithCustomFields") || query.includes("FindScenesForMetadataVariants")) {
          return { findScenes: { count: filteredSceneIds(vars).length, scenes: pagedScenes(vars) } };
        }
        if (query.includes("findDuplicateScenes")) {
          return {
            findDuplicateScenes: db.duplicates.map(cluster => cluster.map(id => sceneForGraphQL(db, db.scenes[String(id)])).filter(Boolean))
          };
        }
        if (query.includes("findStudios")) {
          return { findStudios: { count: listObjects("studio", vars).length, studios: listObjects("studio", vars) } };
        }
        if (query.includes("findGroups")) {
          return { findGroups: { count: listObjects("group", vars).length, groups: listObjects("group", vars) } };
        }
        if (query.includes("findTags")) {
          return { findTags: { count: listObjects("tag", vars).length, tags: listObjects("tag", vars) } };
        }
        if (query.includes("studioCreate")) {
          const id = String(db.nextStudio++);
          db.studios[id] = { id, name: vars.input.name, aliases: [] };
          return { studioCreate: clone(db.studios[id]) };
        }
        if (query.includes("groupCreate")) {
          const id = String(db.nextGroup++);
          db.groups[id] = { id, name: vars.input.name, aliases: "" };
          return { groupCreate: clone(db.groups[id]) };
        }
        if (query.includes("tagCreate")) {
          const id = String(db.nextTag++);
          db.tags[id] = { id, name: vars.input.name, aliases: [], parents: [] };
          return { tagCreate: clone(db.tags[id]) };
        }
        if (query.includes("sceneUpdate")) {
          return { sceneUpdate: updateScene(vars.input) };
        }
        throw new Error("unhandled query: " + query.slice(0, 80));
      }
    }
  };
}

function countMutations(db) {
  return db.calls.filter(c => c.query.includes("mutation")).length;
}

function baseSeed() {
  return {
    studios: {
      "10": { id: "10", name: "Street Fighter", aliases: [] }
    },
    groups: {
      "20": { id: "20", name: "AxenAnim", aliases: "Axen Anim" },
      "21": { id: "21", name: "Existing Group", aliases: "" }
    },
    tags: {
      "30": { id: "30", name: "Cammy White", aliases: ["Cammy"], parents: [] },
      "31": { id: "31", name: "Existing Tag", aliases: [], parents: [] },
      "32": { id: "32", name: "Variant Hidden", aliases: [], parents: [] }
    },
    scenes: {
      "1": {
        id: "1",
        title: "",
        details: "",
        custom_fields: {},
        studio_id: null,
        group_ids: ["21"],
        tag_ids: ["31"],
        files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Gym Loop [4K].mp4", basename: "AxenAnim - Cammy Gym Loop [4K].mp4" }]
      },
      "2": {
        id: "2",
        title: "Primary",
        details: "",
        custom_fields: {},
        studio_id: "10",
        group_ids: ["20"],
        tag_ids: ["30"],
        files: [{ path: "primary.mp4", basename: "primary.mp4" }]
      },
      "3": {
        id: "3",
        title: "Alt Angle",
        details: "",
        custom_fields: {},
        studio_id: null,
        group_ids: [],
        tag_ids: ["31"],
        files: [{ path: "alt.mp4", basename: "alt.mp4" }]
      }
    }
  };
}

function variantDiscoverySeed() {
  const seed = baseSeed();
  seed.scenes["4"] = {
    id: "4",
    title: "Canonical Ride",
    details: "Full version",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Ride [4K].mp4", basename: "AxenAnim - Cammy Ride [4K].mp4", width: 3840, height: 2160, duration: 18.5 }],
    paths: {
      screenshot: "http://127.0.0.1:9999/scene/4/screenshot",
      preview: "http://127.0.0.1:9999/scene/4/preview",
      webp: "http://127.0.0.1:9999/scene/4/webp",
      vtt: "http://127.0.0.1:9999/scene/4/thumbs.vtt",
      sprite: "http://127.0.0.1:9999/scene/4/sprite.jpg"
    }
  };
  seed.scenes["5"] = {
    id: "5",
    title: "Canonical Ride Preview",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Ride Preview [1080P].mp4", basename: "AxenAnim - Cammy Ride Preview [1080P].mp4" }]
  };
  seed.scenes["6"] = {
    id: "6",
    title: "Canonical Ride Watermarked",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Ride Watermarked [720P].mp4", basename: "AxenAnim - Cammy Ride Watermarked [720P].mp4" }]
  };
  seed.scenes["7"] = {
    id: "7",
    title: "Different Scene",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Different Pose [4K].mp4", basename: "AxenAnim - Cammy Different Pose [4K].mp4" }]
  };
  seed.duplicates = [["4", "5", "6"]];
  return seed;
}

function spizzyCammySeed() {
  const seed = baseSeed();
  seed.groups["40"] = { id: "40", name: "Spizzy", aliases: "" };
  const definitions = [
    ["4130", "Alt 1", 20, 2560, 1440],
    ["4131", "Alt 2", 20, 2560, 1440],
    ["4132", "Alt 3", 20, 2560, 1440],
    ["4133", "Alt 4", 20, 2560, 1440],
    ["4134", "Alt 5", 20, 2560, 1440],
    ["4135", "Alt 6", 20, 2560, 1440],
    ["4136", "Alt 7", 20, 2560, 1440],
    ["4137", "V4, Bonus", 9, 1920, 1080],
    ["4138", "V4, Std", 9, 1920, 1080],
    ["4139", "Vertical", 20, 1440, 2560],
    ["4140", "Vertical, Alt 1", 20, 1440, 2560],
    ["4141", "Vertical, Alt 2", 20, 1440, 2560],
    ["4142", "Vertical, Alt 3", 20, 1440, 2560],
    ["4143", "", 20, 2560, 1440]
  ];
  definitions.forEach(entry => {
    const [id, descriptor, duration, width, height] = entry;
    const suffix = descriptor ? ` - ${descriptor}` : "";
    const basename = `Spizzy - Cammy White${suffix} [4K].mp4`;
    seed.scenes[id] = {
      id,
      title: basename.replace(/\.mp4$/, ""),
      details: "",
      custom_fields: {},
      studio_id: "10",
      group_ids: ["40"],
      tag_ids: ["30"],
      files: [{
        path: `E:/Rule34/Street Fighter/${basename}`,
        basename,
        duration,
        width,
        height
      }]
    };
  });
  seed.scenes["4135"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_4135",
    variant_children: JSON.stringify(["4136"])
  };
  seed.scenes["4136"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_4135",
    variant_parent_id: "4135",
    variant_label: "Alternate",
    variant_sort_index: "1"
  };
  seed.duplicates = [["4135", "4136"]];
  return seed;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function familyBySceneIds(families, ids) {
  const wanted = ids.map(String).sort().join(",");
  return (families || []).find(f => (f.evidence.sceneIds || []).map(String).sort().join(",") === wanted);
}

test("dry-run auto-tag does not mutate", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  const before = clone(db);
  const result = plugin.bulkAutoTag({ scene_ids: ["1"], dryRun: true, createMissingTags: true, createMissingGroups: true, createMissingStudios: true }, runtime);
  assert.strictEqual(result.summary.scanned, 1);
  assert.strictEqual(result.summary.dryRun, 1);
  assert.strictEqual(countMutations(db), 0);
  assert.deepStrictEqual(db.scenes, before.scenes);
});

test("real auto-tag merges existing groups and tags", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  plugin.bulkAutoTag({ scene_ids: ["1"], dryRun: false, createMissingTags: false, createMissingGroups: false, createMissingStudios: false }, runtime);
  assert.strictEqual(db.scenes["1"].studio_id, "10");
  assert.deepStrictEqual(db.scenes["1"].group_ids.sort(), ["20", "21"]);
  assert.deepStrictEqual(db.scenes["1"].tag_ids.sort(), ["30", "31"]);
});

test("dispatch honors Stash input.args config for live variant tasks", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  const result = plugin.dispatch({
    args: {
      mode: "link_variant",
      dryRun: false,
      createMissingTags: true,
      primarySceneId: "2",
      childSceneId: "3",
      label: "Wrapped Args"
    }
  }, runtime);
  assert.strictEqual(result.result, "linked");
  assert.strictEqual(db.scenes["2"].custom_fields.variant_role, "primary");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_label, "Wrapped Args");
  assert.ok(db.scenes["3"].tag_ids.includes("32"), "wrapped args dryRun=false should allow hidden tag write");
});

test("dispatch honors Stash input.Args config casing from v0.31.1", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  const result = plugin.dispatch({
    Args: {
      mode: "link_variant",
      dryRun: false,
      createMissingTags: true,
      primarySceneId: "2",
      childSceneId: "3",
      label: "Capital Args"
    }
  }, runtime);
  assert.strictEqual(result.result, "linked");
  assert.strictEqual(db.scenes["2"].custom_fields.variant_role, "primary");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_label, "Capital Args");
});

test("linkVariant updates parent and child and preserves child metadata", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  plugin.linkVariant("2", "3", "Alt Angle", { dryRun: false, createMissingTags: true }, runtime);
  assert.strictEqual(db.scenes["2"].custom_fields.variant_role, "primary");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_parent_id, "2");
  assert.ok(db.scenes["3"].tag_ids.includes("31"), "existing child tag preserved");
  assert.ok(db.scenes["3"].tag_ids.includes("32"), "Variant Hidden tag added");
  assert.strictEqual(db.scenes["3"].studio_id, "10", "missing studio copied");
  assert.deepStrictEqual(db.scenes["3"].group_ids, ["20"], "missing groups copied");
});

test("unlinkVariant removes plugin fields and hidden tag only", () => {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  plugin.linkVariant("2", "3", "Alt Angle", { dryRun: false, createMissingTags: true }, runtime);
  plugin.unlinkVariant("3", { dryRun: false, removeHiddenTagWhenUnlinked: true }, runtime);
  assert.strictEqual(db.scenes["3"].custom_fields.variant_role, undefined);
  assert.strictEqual(db.scenes["3"].custom_fields.variant_parent_id, undefined);
  assert.ok(db.scenes["3"].tag_ids.includes("31"), "unrelated tag preserved");
  assert.ok(!db.scenes["3"].tag_ids.includes("32"), "hidden tag removed");
});

test("linkVariant rejects self-link", () => {
  const db = makeDb(baseSeed());
  assert.throws(() => plugin.linkVariant("2", "2", "Bad", { dryRun: true }, makeRuntime(db)), /itself/);
});

test("linkVariant rejects nesting a primary with children", () => {
  const seed = baseSeed();
  seed.scenes["3"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_3",
    variant_children: JSON.stringify(["1"])
  };
  const db = makeDb(seed);
  assert.throws(() => plugin.linkVariant("2", "3", "Bad", { dryRun: true }, makeRuntime(db)), /primary scene with variants/);
});

test("validateVariantGraph reports parent missing child", () => {
  const seed = baseSeed();
  seed.scenes["3"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_2",
    variant_parent_id: "2",
    variant_label: "Alt Angle"
  };
  seed.scenes["2"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_2",
    variant_children: JSON.stringify([])
  };
  const db = makeDb(seed);
  const report = plugin.validateVariantGraph({ dryRun: true }, makeRuntime(db));
  assert.ok(report.errors.some(e => e.includes("parent_missing_child")));
});

test("validateVariantGraph scans beyond bulk discovery limit by default", () => {
  const seed = baseSeed();
  for (let i = 4; i <= 75; i++) {
    seed.scenes[String(i)] = {
      id: String(i),
      title: `Scene ${i}`,
      details: "",
      custom_fields: {},
      studio_id: null,
      group_ids: [],
      tag_ids: [],
      files: [{ path: `${i}.mp4`, basename: `${i}.mp4` }]
    };
  }
  seed.scenes["75"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_2",
    variant_parent_id: "2",
    variant_label: "Late Page Variant"
  };
  seed.scenes["2"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_2",
    variant_children: JSON.stringify([])
  };
  const db = makeDb(seed);
  const report = plugin.validateVariantGraph({ dryRun: true, sceneDiscoveryLimit: 10, variantScanPageSize: 25 }, makeRuntime(db));
  assert.ok(report.scenesChecked >= 75, `expected at least 75 scenes checked, got ${report.scenesChecked}`);
  assert.ok(report.errors.some(e => e.includes("75")), "late-page variant error should be visible");
});

test("rollbackVariantData scans all pages and preserves unrelated metadata", () => {
  const seed = baseSeed();
  for (let i = 4; i <= 75; i++) {
    seed.scenes[String(i)] = {
      id: String(i),
      title: `Scene ${i}`,
      details: "",
      custom_fields: {},
      studio_id: null,
      group_ids: [],
      tag_ids: [],
      files: [{ path: `${i}.mp4`, basename: `${i}.mp4` }]
    };
  }
  seed.scenes["75"].custom_fields = {
    variant_role: "variant",
    variant_parent_id: "2",
    keep_me: "yes"
  };
  seed.scenes["75"].tag_ids = ["31", "32"];
  const db = makeDb(seed);
  const result = plugin.rollbackVariantData({ dryRun: false, sceneDiscoveryLimit: 10, variantScanPageSize: 25 }, makeRuntime(db));
  assert.strictEqual(result.scenes, 1);
  assert.strictEqual(db.scenes["75"].custom_fields.variant_role, undefined);
  assert.strictEqual(db.scenes["75"].custom_fields.variant_parent_id, undefined);
  assert.strictEqual(db.scenes["75"].custom_fields.keep_me, "yes");
  assert.deepStrictEqual(db.scenes["75"].tag_ids, ["31"]);
});

test("variant discovery ingests Stash duplicate clusters as candidate families", () => {
  const db = makeDb(variantDiscoverySeed());
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantFilenameHeuristics: false }, makeRuntime(db));
  assert.strictEqual(countMutations(db), 0);
  assert.ok(result.families.length >= 1, "expected at least one duplicate-seeded family");
  assert.strictEqual(result.families[0].evidence.stashDuplicateCluster, true);
  assert.strictEqual(result.families[0].proposedPrimaryId, "4", "full 4K scene should be proposed primary");
  const primary = result.families[0].members.find(member => member.sceneId === "4");
  assert.strictEqual(primary.media.screenshot, "http://127.0.0.1:9999/scene/4/screenshot");
  assert.strictEqual(primary.media.preview, "http://127.0.0.1:9999/scene/4/preview");
  assert.strictEqual(primary.media.width, 3840);
  assert.strictEqual(primary.media.height, 2160);
  assert.strictEqual(result.families[0].evidence.candidateType, "new_family");
  assert.deepStrictEqual(result.families[0].evidence.existingFamilySceneIds, []);
});

test("variant discovery omits families that are already completely linked", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["4"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_4",
    variant_children: JSON.stringify(["5", "6"])
  };
  seed.scenes["5"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_4",
    variant_parent_id: "4",
    variant_label: "Preview",
    variant_sort_index: "1"
  };
  seed.scenes["6"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_4",
    variant_parent_id: "4",
    variant_label: "Watermarked",
    variant_sort_index: "2"
  };
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true }, makeRuntime(db));
  assert.strictEqual(result.families.length, 0);
  assert.ok(result.suppressedExistingFamilies >= 1);
  assert.strictEqual(countMutations(db), 0);
});

test("variant discovery places one unassigned match beside its complete existing family", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["4"].custom_fields = {
    variant_role: "primary",
    variant_set_id: "set_scene_4",
    variant_children: JSON.stringify(["5"])
  };
  seed.scenes["5"].custom_fields = {
    variant_role: "variant",
    variant_set_id: "set_scene_4",
    variant_parent_id: "4",
    variant_label: "Preview",
    variant_sort_index: "1"
  };
  seed.duplicates = [["5", "6"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true }, makeRuntime(db));
  assert.strictEqual(result.families.length, 1);
  const family = result.families[0];
  assert.strictEqual(family.evidence.candidateType, "attach_to_existing");
  assert.strictEqual(family.proposedPrimaryId, "4");
  assert.deepStrictEqual(family.evidence.candidateSceneIds, ["6"]);
  assert.deepStrictEqual(family.evidence.existingFamilySceneIds, ["4", "5"]);
  assert.deepStrictEqual(family.members.map(member => member.sceneId), ["4", "5", "6"]);
  assert.strictEqual(family.members.find(member => member.sceneId === "4").relationshipState, "existing_primary");
  assert.strictEqual(family.members.find(member => member.sceneId === "5").relationshipState, "existing_child");
  assert.strictEqual(family.members.find(member => member.sceneId === "6").relationshipState, "proposed_addition");
  assert.strictEqual(countMutations(db), 0);
});

test("variant filename normalization strips quality and downgrade tokens", () => {
  const seed = variantDiscoverySeed();
  const a = sceneForGraphQL(makeDb(seed), seed.scenes["4"]);
  const b = sceneForGraphQL(makeDb(seed), seed.scenes["5"]);
  assert.strictEqual(plugin._test.normalizedVariantStem(a), "cammy ride");
  assert.strictEqual(plugin._test.normalizedVariantStem(b), "cammy ride");
  assert.ok(plugin._test.filenameSimilarity(a, b) >= 0.95);
});

test("variant metadata overlap and parent scoring are deterministic", () => {
  const db = makeDb(variantDiscoverySeed());
  const full = sceneForGraphQL(db, db.scenes["4"]);
  const preview = sceneForGraphQL(db, db.scenes["5"]);
  assert.ok(plugin._test.metadataSimilarity(full, preview) >= 0.9);
  assert.ok(plugin._test.parentScore(full) > plugin._test.parentScore(preview), "preview token should reduce parent score");
});

test("variant parent scoring prefers canonical unnumbered or lowest numbered file", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["8"] = {
    id: "8",
    title: "Baal 1",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Genshin Impact/baal_1.mp4", basename: "baal_1.mp4" }]
  };
  seed.scenes["9"] = {
    id: "9",
    title: "Baal 2",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Genshin Impact/baal_2.mp4", basename: "baal_2.mp4" }]
  };
  seed.scenes["10"] = {
    id: "10",
    title: "Baal 3",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Genshin Impact/baal_3.mp4", basename: "baal_3.mp4" }]
  };
  seed.duplicates = [["9", "8", "10"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 10 }, makeRuntime(db));
  const numberedFamily = familyBySceneIds(result.families, ["8", "9", "10"]);
  assert.ok(numberedFamily, "expected family for the three numbered files");
  assert.strictEqual(numberedFamily.proposedPrimaryId, "8", "lowest numbered file should be primary when all files are numbered");

  seed.scenes["11"] = {
    id: "11",
    title: "Kawakami Nude",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Persona/Kawakami_nude.mp4", basename: "Kawakami_nude.mp4" }]
  };
  seed.scenes["12"] = {
    id: "12",
    title: "Kawakami Nude 2",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Persona/Kawakami_nude_2.mp4", basename: "Kawakami_nude_2.mp4" }]
  };
  seed.duplicates = [["12", "11"]];
  const db2 = makeDb(seed);
  const result2 = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 10 }, makeRuntime(db2));
  const family = familyBySceneIds(result2.families, ["11", "12"]);
  assert.ok(family, "expected family for unnumbered/numbered pair");
  assert.strictEqual(family.proposedPrimaryId, "11", "unnumbered file should beat numbered variant");
});

test("numbered filename families bridge split duplicate clusters and keep the original primary", () => {
  const seed = variantDiscoverySeed();
  const numberedIds = { 2: "2684", 3: "2685", 4: "2686", 5: "2687", 6: "2688", 7: "2690", 8: "2691", 9: "2683" };
  for (let number = 2; number <= 9; number++) {
    const id = numberedIds[number];
    seed.scenes[id] = {
      id,
      title: `Megaera - Makima Cowgirl Nude All Angles ${number}`,
      details: "",
      custom_fields: {},
      studio_id: "10",
      group_ids: ["20"],
      tag_ids: ["30"],
      files: [{
        path: `E:/Rule34/Chainsaw Man/Megaera - Makima - Cowgirl Nude All Angles ${number} [4K].mp4`,
        basename: `Megaera - Makima - Cowgirl Nude All Angles ${number} [4K].mp4`
      }]
    };
  }
  seed.scenes["2689"] = {
    id: "2689",
    title: "Megaera - Makima Cowgirl Nude All Angles",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{
      path: "E:/Rule34/Chainsaw Man/Megaera - Makima - Cowgirl Nude All Angles [4K].mp4",
      basename: "Megaera - Makima - Cowgirl Nude All Angles [4K].mp4"
    }]
  };
  const familyIds = ["2683", "2684", "2685", "2686", "2687", "2688", "2689", "2690", "2691"];
  seed.duplicates = [["2684", "2686", "2688"], ["2685", "2687", "2689"], ["2683", "2690", "2691"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 5 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, familyIds);
  assert.ok(family, "all nine Makima files should form one connected family");
  assert.strictEqual(family.proposedPrimaryId, "2689", "the unnumbered original should be primary");
  assert.strictEqual(family.evidence.source, "duplicate_neighborhood");
  assert.strictEqual(family.evidence.duplicateNeighborhood, true);
  const overlapping = result.families.filter(candidate => candidate.members.some(member => familyIds.includes(String(member.sceneId))));
  assert.strictEqual(overlapping.length, 1, "split fingerprint clusters should not remain as separate families");
});

test("bare character numbers do not create a filename family without sequence evidence", () => {
  const seed = variantDiscoverySeed();
  seed.duplicates = [];
  ["17", "18", "21"].forEach((number, index) => {
    const id = String(2800 + index);
    seed.scenes[id] = {
      id,
      title: `Android ${number}`,
      details: "",
      custom_fields: {},
      studio_id: "10",
      group_ids: ["20"],
      tag_ids: ["30"],
      files: [{ path: `E:/Rule34/Dragon Ball/Artist - Android ${number} [4K].mp4`, basename: `Artist - Android ${number} [4K].mp4` }]
    };
  });
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 30 }, makeRuntime(db));
  const androidIds = ["2800", "2801", "2802"];
  assert.ok(!result.families.some(family => family.members.filter(member => androidIds.includes(String(member.sceneId))).length > 1));
});

test("variant discovery hard-splits duplicate clusters by canonical artist", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Artist A", aliases: "ArtistA" };
  seed.groups["41"] = { id: "41", name: "Artist B", aliases: "ArtistB" };
  seed.tags["50"] = { id: "50", name: "Makima", aliases: [], parents: [] };
  [["2900", "Artist A", "40"], ["2901", "Artist A", "40"], ["2902", "Artist B", "41"], ["2903", "Artist B", "41"]].forEach((entry, index) => {
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: [entry[2]], tag_ids: ["50"],
      files: [{ path: `E:/Rule34/Chainsaw Man/${entry[1]} - Makima - Shared Scene ${index % 2 ? 2 : 1} [4K].mp4`, basename: `${entry[1]} - Makima - Shared Scene ${index % 2 ? 2 : 1} [4K].mp4` }]
    };
  });
  seed.duplicates = [["2900", "2901", "2902", "2903"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  assert.ok(familyBySceneIds(result.families, ["2900", "2901"]), "Artist A should retain its own family");
  assert.ok(familyBySceneIds(result.families, ["2902", "2903"]), "Artist B should retain its own family");
  assert.ok(!result.families.some(family => {
    const artists = new Set(family.members.map(member => member.identity.artistKey).filter(Boolean));
    return artists.size > 1;
  }), "no proposed family should contain multiple known artists");
});

test("variant discovery hard-splits one artist's duplicate cluster by character", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Megaera", aliases: [] };
  seed.tags["50"] = { id: "50", name: "Makima", aliases: [], parents: [] };
  seed.tags["51"] = { id: "51", name: "Tifa Lockhart", aliases: ["Tifa"], parents: [] };
  [["2910", "Makima", "50"], ["2911", "Makima", "50"], ["2912", "Tifa Lockhart", "51"], ["2913", "Tifa Lockhart", "51"]].forEach((entry, index) => {
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: [entry[2]],
      files: [{ path: `E:/Rule34/Megaera - ${entry[1]} - Cowgirl ${index % 2 ? 2 : 1} [4K].mp4`, basename: `Megaera - ${entry[1]} - Cowgirl ${index % 2 ? 2 : 1} [4K].mp4` }]
    };
  });
  seed.duplicates = [["2910", "2911", "2912", "2913"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  assert.ok(familyBySceneIds(result.families, ["2910", "2911"]), "Makima should retain her own family");
  assert.ok(familyBySceneIds(result.families, ["2912", "2913"]), "Tifa should retain her own family");
  assert.ok(!result.families.some(family => {
    const characters = new Set(family.members.map(member => member.identity.characterKey).filter(Boolean));
    return characters.size > 1;
  }), "no proposed family should contain multiple known character sets");
});

test("canonical Stash groups and tags keep filename aliases in one family", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "LazyProcrastinator", aliases: "Lazy Procrastinator" };
  seed.tags["50"] = { id: "50", name: "Gwen Stacy", aliases: ["Spider-Gwen"], parents: [] };
  seed.scenes["2920"] = {
    id: "2920", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/Lazy Procrastinator - Gwen Stacy (Spider-Gwen) - Lesson [4K].mp4", basename: "Lazy Procrastinator - Gwen Stacy (Spider-Gwen) - Lesson [4K].mp4" }]
  };
  seed.scenes["2921"] = {
    id: "2921", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/LazyProcrastinator - Gwen Stacy - Lesson 2 [4K].mp4", basename: "LazyProcrastinator - Gwen Stacy - Lesson 2 [4K].mp4" }]
  };
  seed.duplicates = [["2920", "2921"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["2920", "2921"]);
  assert.ok(family, "canonical metadata should preserve legitimate filename aliases");
  assert.strictEqual(family.identity.artistLabel, "LazyProcrastinator");
  assert.deepStrictEqual(family.identity.characterLabels, ["Gwen Stacy"]);
});

test("strong standard markers beat higher-resolution nude variants for primary", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "AlenAbyss", aliases: [] };
  seed.tags["50"] = { id: "50", name: "Tifa Lockhart", aliases: ["Tifa"], parents: [] };
  seed.scenes["2930"] = {
    id: "2930", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/Final Fantasy/AlenAbyss - Tifa Lockhart Innocence - Nude [4K].mp4", basename: "AlenAbyss - Tifa Lockhart Innocence - Nude [4K].mp4", width: 3840, height: 2160 }]
  };
  seed.scenes["2931"] = {
    id: "2931", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/Final Fantasy/AlenAbyss - Tifa Lockhart Innocence - Std [1080P].mp4", basename: "AlenAbyss - Tifa Lockhart Innocence - Std [1080P].mp4", width: 1920, height: 1080 }]
  };
  seed.duplicates = [["2930", "2931"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["2930", "2931"]);
  assert.ok(family, "standard and nude versions should remain one candidate family");
  assert.strictEqual(family.proposedPrimaryId, "2931", "Std should override the resolution advantage of the nude variant");
  assert.deepStrictEqual(family.members.find(member => member.sceneId === "2931").parentSignals, ["Standard"]);
});

test("Default is a strong parent marker but Regular POV remains a variant", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "LazyProcrastinator", aliases: "Lazy Procrastinator" };
  seed.tags["50"] = { id: "50", name: "Nyotengu", aliases: [], parents: [] };
  seed.scenes["2940"] = {
    id: "2940", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/Dead or Alive/Lazy Procrastinator - Nyotengu - Amazon Cliffhanger [1080P].mp4", basename: "Lazy Procrastinator - Nyotengu - Amazon Cliffhanger [1080P].mp4" }]
  };
  seed.scenes["2941"] = {
    id: "2941", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
    files: [{ path: "E:/Rule34/Dead or Alive/Lazy Procrastinator - Nyotengu - Amazon Cliffhanger Default [1080P].mp4", basename: "Lazy Procrastinator - Nyotengu - Amazon Cliffhanger Default [1080P].mp4" }]
  };
  seed.duplicates = [["2940", "2941"]];
  let db = makeDb(seed);
  let result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  let family = familyBySceneIds(result.families, ["2940", "2941"]);
  assert.strictEqual(family.proposedPrimaryId, "2941");

  seed.groups["41"] = { id: "41", name: "Bouquetman", aliases: [] };
  seed.tags["51"] = { id: "51", name: "Honoka", aliases: [], parents: [] };
  seed.scenes["2942"] = {
    id: "2942", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["41"], tag_ids: ["51"],
    files: [{ path: "E:/Rule34/Dead or Alive/Bouquetman - Honoka - Doggystyle [1080P].mp4", basename: "Bouquetman - Honoka - Doggystyle [1080P].mp4" }]
  };
  seed.scenes["2943"] = {
    id: "2943", title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["41"], tag_ids: ["51"],
    files: [{ path: "E:/Rule34/Dead or Alive/Bouquetman - Honoka - Doggystyle Regular POV [1080P].mp4", basename: "Bouquetman - Honoka - Doggystyle Regular POV [1080P].mp4" }]
  };
  seed.duplicates = [["2942", "2943"]];
  db = makeDb(seed);
  result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  family = familyBySceneIds(result.families, ["2942", "2943"]);
  assert.strictEqual(family.proposedPrimaryId, "2942", "POV penalty should outweigh the weak Regular preference");
});

test("contextual full markers avoid Full Nelson and Final Fantasy false positives", () => {
  assert.deepStrictEqual(plugin._test.canonicalParentInfo("Scene - Full Version").labels, ["Full version"]);
  assert.deepStrictEqual(plugin._test.canonicalParentInfo("Scene - Full [4K]").labels, ["Full"]);
  assert.deepStrictEqual(plugin._test.canonicalParentInfo("Marika - Full Nelson").labels, []);
  assert.deepStrictEqual(plugin._test.canonicalParentInfo("Tifa Plays Final Fantasy").labels, []);
  assert.deepStrictEqual(plugin._test.canonicalParentInfo("Cortana X Master Chief").labels, []);
});

test("variant parent scoring demotes censored/clothed variants", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["8"] = {
    id: "8",
    title: "Android 18 Raw",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Dragon Ball/Android 18 raw.mp4", basename: "Android 18 raw.mp4" }]
  };
  seed.scenes["9"] = {
    id: "9",
    title: "Android 18 Censored",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Dragon Ball/Android 18 censor.mp4", basename: "Android 18 censor.mp4" }]
  };
  seed.duplicates = [["9", "8"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 10 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["8", "9"]);
  assert.ok(family, "expected family for raw/censored pair");
  assert.strictEqual(family.proposedPrimaryId, "8", "raw/non-censored file should be primary");
});

test("default variant thresholds send mid-confidence matches to review", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["8"] = {
    id: "8",
    title: "Android 18 Censored",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Dragon Ball/Android 18 censor.mp4", basename: "Android 18 censor.mp4" }]
  };
  seed.scenes["9"] = {
    id: "9",
    title: "Android 18 NSFW",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Dragon Ball/Android 18 nsfw_1.mp4", basename: "Android 18 nsfw_1.mp4" }]
  };
  seed.duplicates = [["8", "9"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 10 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["8", "9"]);
  assert.ok(family, "expected family for mid-confidence pair");
  assert.strictEqual(family.status, "review");
  assert.ok(family.confidence >= 0.82 && family.confidence < 0.94);
});

test("low-confidence variant family is classified for review or ignored", () => {
  const seed = variantDiscoverySeed();
  seed.duplicates = [["4", "7"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({
    dryRun: true,
    variantFilenameHeuristics: false,
    variantAutoSuggestThreshold: 0.98,
    variantReviewThreshold: 0.9
  }, makeRuntime(db));
  assert.ok(["review", "ignore"].includes(result.families[0].status));
});

test("descriptor families are proposed for review without Stash duplicate evidence", () => {
  const seed = variantDiscoverySeed();
  seed.duplicates = [];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantFilenameHeuristics: true }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["4", "5", "6"]);
  assert.ok(family, "explicit preview and watermarked descriptors should create a review family");
  assert.strictEqual(family.status, "review");
  assert.strictEqual(family.evidence.descriptorFamily, true);
  assert.strictEqual(countMutations(db), 0);
});

test("phone renders and stacked numbered descriptors remain in one descriptor family", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Spizzy", aliases: "" };
  seed.tags["50"] = { id: "50", name: "Nyotengu", aliases: [], parents: [] };
  [
    ["5100", "V8, Std", 2560, 1440],
    ["5101", "V8, Alt 5, Rev 2", 2560, 1440],
    ["5102", "V8, Phone", 1440, 2560]
  ].forEach(entry => {
    const basename = `Spizzy - Nyotengu - ${entry[1]} [4K].mp4`;
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
      files: [{ path: `E:/Rule34/Dead or Alive/${basename}`, basename, duration: 10, width: entry[2], height: entry[3] }]
    };
  });
  seed.duplicates = [];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["5100", "5101", "5102"]);
  assert.ok(family, "phone orientation and stacked Alt/Rev numbering should not split an exact V8 family");
  assert.strictEqual(family.proposedPrimaryId, "5100");
  assert.strictEqual(family.status, "review");
});

test("NMA alternate-angle and camera descriptors qualify as review evidence", () => {
  const seed = variantDiscoverySeed();
  seed.groups["41"] = { id: "41", name: "HowlSFM", aliases: "" };
  seed.tags["51"] = { id: "51", name: "Marika The Eternal", aliases: [], parents: [] };
  [
    ["5110", "V2, Std, NMA"],
    ["5111", "V2, Nude, No Male Audio"],
    ["5112", "V2, Alt Angles, NMA"],
    ["5113", "V2 (Cam 2), NMA"]
  ].forEach(entry => {
    const basename = `HowlSFM - Marika The Eternal - ${entry[1]} [4K].mp4`;
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["41"], tag_ids: ["51"],
      files: [{ path: `E:/Rule34/Elden Ring/${basename}`, basename, duration: 12, width: 2560, height: 1440 }]
    };
  });
  seed.duplicates = [];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["5110", "5111", "5112", "5113"]);
  assert.ok(family, "established audio, angle, and camera descriptors should form one exact V2 review family");
  assert.strictEqual(family.status, "review");
});

test("strict duplicate anchors do not expand to numeric-only siblings", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["8"] = {
    id: "8",
    title: "Cammy Ride 2",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Ride 2 [4K].mp4", basename: "AxenAnim - Cammy Ride 2 [4K].mp4", duration: 18.5, width: 3840, height: 2160 }]
  };
  seed.duplicates = [["4", "5"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantFilenameHeuristics: true }, makeRuntime(db));
  assert.ok(!result.families.some(family => family.members.some(member => member.sceneId === "8")),
    "a plain numeric suffix should not expand beyond strict duplicate evidence");

  seed.scenes["9"] = {
    id: "9",
    title: "Cammy Different Scene 2",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{ path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Different Scene 2 [4K].mp4", basename: "AxenAnim - Cammy Different Scene 2 [4K].mp4", duration: 18.5, width: 3840, height: 2160 }]
  };
  const result2 = plugin.discoverVariantCandidates({ dryRun: true, variantFilenameHeuristics: true }, makeRuntime(makeDb(seed)));
  assert.ok(!result2.families.some(family => family.members.some(member => member.sceneId === "9")),
    "same artist and character are insufficient when the normalized family stem differs");
});

test("explicit V numbers remain separate descriptor families", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Spizzy", aliases: "" };
  seed.tags["50"] = { id: "50", name: "Ayane", aliases: [], parents: [] };
  [["5000", "V3, Std"], ["5001", "V3, Bonus"], ["5002", "V4, Std"], ["5003", "V4, Bonus"]].forEach(entry => {
    const basename = `Spizzy - Ayane - ${entry[1]} [1080P].mp4`;
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
      files: [{ path: `E:/Rule34/Dead or Alive/${basename}`, basename, duration: 10, width: 1920, height: 1080 }]
    };
  });
  seed.duplicates = [["5000", "5002"], ["5001", "5003"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  assert.ok(familyBySceneIds(result.families, ["5000", "5001"]), "V3 should remain its own family");
  assert.ok(familyBySceneIds(result.families, ["5002", "5003"]), "V4 should remain its own family");
  assert.ok(!result.families.some(family => {
    const ids = family.members.map(member => member.sceneId);
    return ids.some(id => ["5000", "5001"].includes(id)) && ids.some(id => ["5002", "5003"].includes(id));
  }), "explicit versions must not be bridged");
});

test("complete filename character signatures prevent incomplete-tag cross-character grouping", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Spizzy", aliases: "" };
  seed.tags["50"] = { id: "50", name: "2B", aliases: [], parents: [] };
  [["5010", "2B, Commander White", "Alt 1"], ["5011", "2B, A2", "Alt 2"]].forEach(entry => {
    const basename = `Spizzy - ${entry[1]} - ${entry[2]} [4K].mp4`;
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
      files: [{ path: `E:/Rule34/Nier/${basename}`, basename, duration: 10, width: 2560, height: 1440 }]
    };
  });
  seed.duplicates = [["5010", "5011"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  assert.ok(!result.families.some(family => family.members.some(member => member.sceneId === "5010") &&
    family.members.some(member => member.sceneId === "5011")),
  "the shared 2B tag must not erase Commander White versus A2 filename identity");
});

test("mixed existing explicit-version sets produce safe split repair candidates", () => {
  const seed = variantDiscoverySeed();
  seed.groups["40"] = { id: "40", name: "Spizzy", aliases: "" };
  seed.tags["50"] = { id: "50", name: "Ayane", aliases: [], parents: [] };
  [["5020", "V3, Std"], ["5021", "V3, Bonus"], ["5022", "V4, Std"], ["5023", "V4, Bonus"], ["5024", "V4, Alt 1"]].forEach(entry => {
    const basename = `Spizzy - Ayane - ${entry[1]} [1080P].mp4`;
    seed.scenes[entry[0]] = {
      id: entry[0], title: "", details: "", custom_fields: {}, studio_id: "10", group_ids: ["40"], tag_ids: ["50"],
      files: [{ path: `E:/Rule34/Dead or Alive/${basename}`, basename, duration: 10, width: 1920, height: 1080 }]
    };
  });
  seed.scenes["5020"].custom_fields = {
    variant_role: "primary", variant_set_id: "set_scene_5020", variant_children: JSON.stringify(["5021", "5022", "5023"])
  };
  ["5021", "5022", "5023"].forEach((id, index) => {
    seed.scenes[id].custom_fields = {
      variant_role: "variant", variant_set_id: "set_scene_5020", variant_parent_id: "5020",
      variant_label: "Variant", variant_sort_index: String(index + 1)
    };
  });
  seed.duplicates = [["5020", "5022"], ["5021", "5023"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const family = familyBySceneIds(result.families, ["5022", "5023", "5024"]);
  assert.ok(family, "the V4 members should be offered as a separate repair family");
  assert.strictEqual(family.evidence.candidateType, "split_existing_family");
  assert.strictEqual(family.proposedPrimaryId, "5022");
  assert.strictEqual(family.evidence.replaceExistingChildren, true);
  assert.ok(family.evidence.excludedExistingFamilySceneIds.includes("5020"));
  assert.ok(family.evidence.excludedExistingFamilySceneIds.includes("5021"));

  const approval = {
    familyId: family.familyId,
    approved: true,
    primarySceneId: family.proposedPrimaryId,
    replaceExistingChildren: true,
    children: family.evidence.approvalSceneIds.map(sceneId => ({ sceneId, label: "Variant", include: true }))
  };
  const applied = plugin.applyVariantBatch({
    dryRun: false,
    confirmed: true,
    approvalsJson: JSON.stringify([approval]),
    createMissingTags: true
  }, makeRuntime(db));
  assert.strictEqual(applied.failures.length, 0);
  assert.deepStrictEqual(JSON.parse(db.scenes["5020"].custom_fields.variant_children), ["5021"]);
  assert.strictEqual(db.scenes["5021"].custom_fields.variant_parent_id, "5020");
  assert.strictEqual(db.scenes["5022"].custom_fields.variant_role, "primary");
  assert.deepStrictEqual(JSON.parse(db.scenes["5022"].custom_fields.variant_children).sort(), ["5023", "5024"]);
  assert.strictEqual(db.scenes["5023"].custom_fields.variant_parent_id, "5022");
  assert.strictEqual(db.scenes["5024"].custom_fields.variant_parent_id, "5022");
});

test("Spizzy Cammy duplicate neighborhood forms duration-specific families and prefers canonical parents", () => {
  const db = makeDb(spizzyCammySeed());
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const longIds = ["4130", "4131", "4132", "4133", "4134", "4135", "4136", "4139", "4140", "4141", "4142", "4143"];
  const shortIds = ["4137", "4138"];
  const longFamily = familyBySceneIds(result.families, longIds);
  const shortFamily = familyBySceneIds(result.families, shortIds);
  assert.ok(longFamily, "all twelve 20-second wardrobe, numbered, and vertical renders should be grouped");
  assert.ok(shortFamily, "the two 9-second V4 renders should form their own family");
  assert.strictEqual(longFamily.proposedPrimaryId, "4143", "the unnumbered original should replace the partial Alt 6 primary");
  assert.strictEqual(longFamily.evidence.candidateType, "replace_existing_primary");
  assert.deepStrictEqual(longFamily.evidence.existingFamilySceneIds.sort(), ["4135", "4136"]);
  assert.ok(longFamily.evidence.approvalSceneIds.includes("4135"), "the old primary must be included in family reconciliation");
  assert.ok(longFamily.evidence.approvalSceneIds.includes("4136"), "the old child must remain in the rebuilt family");
  assert.strictEqual(shortFamily.proposedPrimaryId, "4138", "Std should be primary for the separate V4 family");
  assert.strictEqual(shortFamily.status, "review");
  assert.strictEqual(countMutations(db), 0);
});

test("duplicate clusters split scenes with incompatible duration or aspect ratio", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["5"].files[0].duration = 30;
  seed.scenes["5"].files[0].width = 1080;
  seed.scenes["5"].files[0].height = 1920;
  seed.duplicates = [["4", "5"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true }, makeRuntime(db));
  assert.strictEqual(result.families.length, 0);
  assert.strictEqual(countMutations(db), 0);
});

test("strong filename-coherent duplicate subgroup excludes an unrelated title outlier", () => {
  const seed = variantDiscoverySeed();
  seed.scenes["8"] = {
    id: "8",
    title: "Cammy Different Scene",
    details: "",
    custom_fields: {},
    studio_id: "10",
    group_ids: ["20"],
    tag_ids: ["30"],
    files: [{
      path: "E:/Rule34/Street Fighter/AxenAnim - Cammy Different Scene [4K].mp4",
      basename: "AxenAnim - Cammy Different Scene [4K].mp4",
      duration: 18.5,
      width: 3840,
      height: 2160
    }]
  };
  seed.duplicates = [["4", "5", "8"]];
  const db = makeDb(seed);
  const result = plugin.discoverVariantCandidates({ dryRun: true }, makeRuntime(db));
  const family = result.families.find(candidate => {
    const ids = candidate.members.map(member => String(member.sceneId));
    return ids.includes("4") && ids.includes("5");
  });
  assert.ok(family, "the coherent Cammy Ride pair should remain");
  assert.ok(!family.members.some(member => member.sceneId === "8"), "the unrelated title outlier should be split away");
});

test("variant batch dry run previews approved links without mutating", () => {
  const db = makeDb(variantDiscoverySeed());
  const approvals = [{
    familyId: "manual",
    approved: true,
    primarySceneId: "4",
    children: [{ sceneId: "5", label: "Preview", include: true }]
  }];
  const before = clone(db.scenes);
  const result = plugin.applyVariantBatch({ dryRun: true, approvalsJson: JSON.stringify(approvals) }, makeRuntime(db));
  assert.strictEqual(result.result, "dry_run");
  assert.strictEqual(result.links, 1);
  assert.strictEqual(countMutations(db), 0);
  assert.deepStrictEqual(db.scenes, before);
});

test("variant batch live apply requires explicit confirmation", () => {
  const db = makeDb(variantDiscoverySeed());
  const approvals = [{
    familyId: "manual",
    approved: true,
    primarySceneId: "4",
    children: [{ sceneId: "5", label: "Preview", include: true }]
  }];
  assert.throws(() => plugin.applyVariantBatch({ dryRun: false, approvalsJson: JSON.stringify(approvals) }, makeRuntime(db)), /confirmed=true/);
  const result = plugin.applyVariantBatch({ dryRun: false, confirmed: true, approvalsJson: JSON.stringify(approvals), createMissingTags: true }, makeRuntime(db));
  assert.strictEqual(result.result, "applied");
  assert.strictEqual(db.scenes["4"].custom_fields.variant_role, "primary");
  assert.strictEqual(db.scenes["5"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["5"].custom_fields.variant_parent_id, "4");
});

test("variant batch can replace an existing primary without losing its children", () => {
  const db = makeDb(spizzyCammySeed());
  const result = plugin.discoverVariantCandidates({ dryRun: true, variantDiscoveryLimit: 50 }, makeRuntime(db));
  const longIds = ["4130", "4131", "4132", "4133", "4134", "4135", "4136", "4139", "4140", "4141", "4142", "4143"];
  const family = familyBySceneIds(result.families, longIds);
  const approval = {
    familyId: family.familyId,
    approved: true,
    primarySceneId: family.proposedPrimaryId,
    children: family.evidence.approvalSceneIds.map(sceneId => ({ sceneId, label: "Variant", include: true }))
  };
  const applied = plugin.applyVariantBatch({
    dryRun: false,
    confirmed: true,
    approvalsJson: JSON.stringify([approval]),
    createMissingTags: true
  }, makeRuntime(db));
  assert.strictEqual(applied.failures.length, 0);
  assert.strictEqual(db.scenes["4143"].custom_fields.variant_role, "primary");
  assert.deepStrictEqual(JSON.parse(db.scenes["4143"].custom_fields.variant_children).sort(), longIds.filter(id => id !== "4143").sort());
  assert.strictEqual(db.scenes["4135"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["4135"].custom_fields.variant_parent_id, "4143");
  assert.strictEqual(db.scenes["4135"].custom_fields.variant_children, undefined);
  assert.strictEqual(db.scenes["4136"].custom_fields.variant_parent_id, "4143");
});

test("UI task runner includes the Stash manifest plugin id", () => {
  const uiSource = fs.readFileSync(path.join(__dirname, "..", "ui", "scene-variants.js"), "utf8");
  const pluginIdsLine = uiSource.split(/\r?\n/).find(line => line.includes("var PLUGIN_IDS")) || "";
  assert.ok(pluginIdsLine.includes("\"scene-metadata-variants-v1\""), "UI must try the actual manifest filename plugin ID");
  assert.ok(pluginIdsLine.indexOf("\"scene-metadata-variants-v1\"") < pluginIdsLine.indexOf("\"stash-scene-metadata-variants-v1\""), "actual plugin ID should be attempted first");
  assert.ok(uiSource.includes("scene-metadata-variants-ui-dry-run"), "UI should expose a persistent dry-run mode");
  assert.ok(!uiSource.includes("dryRun: false"), "UI actions should not force live writes");
  assert.ok(uiSource.includes("scene-metadata-variants-v2-review"), "UI should persist V2 review state in localStorage");
  assert.ok(uiSource.includes("runPluginOperation"), "UI should use immediate plugin operation for discovery results");
  assert.ok(uiSource.includes("lastDryRunAt"), "UI should gate live apply behind a queued dry run");
  assert.ok(uiSource.includes("args.dryRun = false"), "UI should have an explicit live apply path after dry-run gating");
  assert.ok(uiSource.includes("scene-metadata-variants-show-nested"), "UI should persist the show/hide nested variants preference");
  assert.ok(uiSource.includes("smv-hidden-variant-card"), "UI should hide child variant cards by default");
  assert.ok(uiSource.includes("smv-card-variant-menu"), "UI should render the card footer variants menu");
  assert.ok(uiSource.includes("bestMetadataRow"), "UI should target the existing metadata counter row");
  assert.ok(uiSource.includes("smv-metadata-row-fallback"), "UI should provide a metadata row fallback only when needed");
  assert.ok(uiSource.includes("injectEllipsisMenuToggle(document)"), "UI should inject show/hide into opened toolbar menus");
  assert.ok(uiSource.includes("positionVariantDropdown"), "variant dropdown should be positioned outside clipped card overflow");
  assert.ok(!uiSource.includes("smv-card-badge"), "old thumbnail-corner variant badge should not be rendered");
  assert.ok(uiSource.includes("removePanel()"), "scene page panel should be removed when leaving a scene route");
  assert.ok(uiSource.includes("findScenesByIds"), "scene player should batch-load linked variants");
  assert.ok(uiSource.includes("retrySceneRead"), "scene player reads should tolerate transient SQLite lock contention");
  assert.ok(uiSource.includes("scheduleScenePageSetup"), "scene player panel should remount after Stash replaces its DOM");
  assert.ok(uiSource.includes("data-smv-scene-id"), "scene player panel should track the scene it represents");
  assert.ok(uiSource.includes("scenePanelTarget"), "scene player panel should wait for the real Stash scene details container");
  assert.ok(uiSource.includes("panelMatchesScene"), "scene player panel should verify both scene identity and mount location");
  assert.ok(!uiSource.includes("document.querySelector(\".container-fluid\") ||\n      document.body"), "scene player panel should not mount into generic page fallbacks");
  assert.ok(uiSource.includes("}, 750);"), "scene player panel should have a route and mount watchdog");
  assert.ok(uiSource.includes("smv-load-warning"), "scene player should expose relationship loading failures");
  assert.ok(uiSource.includes("Retry Variant List"), "scene player should let the user retry a failed relationship load");
  assert.ok(uiSource.includes("window.StashSessionQueue"), "scene-player variant queues should use the Session Scene Queue public API");
  assert.ok(uiSource.includes("stash:session-scene-queue-add"), "scene-player queue integration should retain a custom-event fallback");
  assert.ok(uiSource.includes("Add Selected (0)"), "scene-player variants should support selected queue additions");
  assert.ok(uiSource.includes("Add All Variants"), "scene-player variants should support queueing the complete related set");
  assert.ok(uiSource.includes("playerVariantThumbnail"), "scene-player variants should render Stash-backed hover previews");
  assert.ok(uiSource.includes("comparePlayerVariantScenes"), "scene-player variants should use deterministic numeric ordering");
  assert.ok(uiSource.includes("uniqueFamilyScenes.sort(comparePlayerVariantScenes)"), "visible and queued variants should share numeric order");
  assert.ok(uiSource.includes('panelToggle.setAttribute("aria-expanded", "true")'), "scene-player variant manager should start expanded");
  assert.ok(uiSource.includes("smv-panel-toggle-chevron"), "scene-player variant manager should expose a bottom chevron toggle");
  assert.ok(uiSource.includes("installControlTooltips"), "plugin controls should install delegated hover and focus tooltips");
  assert.ok(uiSource.includes("BUTTON_TOOLTIPS"), "plugin button tooltip descriptions should be centralized");
  assert.ok(uiSource.includes("tooltipControlFromEvent"), "dynamically rendered controls should be covered by delegated tooltip lookup");
  assert.ok(uiSource.includes("smv-review-family, .smv-resize-handle"), "candidate drag and resize controls should expose tooltips");
  assert.ok(uiSource.includes('setAttribute("aria-describedby", tooltip.id)'), "visible tooltips should be associated with focused controls");
  assert.ok(uiSource.includes("smv-player-queue-selector"), "scene-player variants should expose individual queue selection");
  assert.ok(uiSource.includes("candidateMembers"), "review approvals should distinguish proposed additions from existing context");
  assert.ok(uiSource.includes("existingFamilyMembers"), "review UI should expose the complete existing family");
  assert.ok(uiSource.includes("Existing family ("), "existing-family suggestions should be visibly labeled");
  assert.ok(uiSource.includes("Proposed additions"), "new members should be separated from established family members");
  assert.ok(uiSource.includes("unsupported singletons"), "discovery summary should explain omitted lone scenes");
  assert.ok(uiSource.includes("Variant Family Review"), "discovery UI should use distinctive family-review language");
  assert.ok(uiSource.includes("Create Variant Sets"), "live action should name the relationship it creates");
  assert.ok(uiSource.includes("Preview Approved Links"), "dry-run action should be clearly differentiated from live apply");
  assert.ok(uiSource.includes("SCENE VARIANT SETS"), "scene panel should expose the plugin identity");
  assert.ok(uiSource.includes("Discovering candidate variants"), "discovery should expose an active progress state");
  assert.ok(uiSource.includes("smv-discovery-spinner"), "discovery should render a visible activity indicator");
  assert.ok(uiSource.includes("Filter by scene title or ID"), "candidate families should be searchable");
  assert.ok(uiSource.includes("All families"), "candidate families should expose status filters");
  assert.ok(uiSource.includes("setupDiscoveryTaskInterceptor"), "the Stash discovery task should open interactive review");
  assert.ok(uiSource.includes("stopImmediatePropagation"), "interactive discovery should replace the invisible queued task action");
  assert.ok(uiSource.includes("smv-scene-link"), "candidate rows should link to their Stash scene pages");
  assert.ok(uiSource.includes("Create Manual Family"), "review UI should create manually curated families");
  assert.ok(uiSource.includes("Merge Families"), "review UI should merge split candidate families");
  assert.ok(uiSource.includes("Actions (0)"), "bulk scene actions should start disabled with no selection");
  assert.ok(uiSource.includes("Move Scenes"), "bulk actions should support moving selected scenes");
  assert.ok(uiSource.includes('input.addEventListener("input", renderCandidates)'), "merge family search should filter live while typing");
  assert.ok(uiSource.includes("smv-scene-selector"), "family members should expose dedicated editing selection checkboxes");
  assert.ok(uiSource.includes("Select Scenes"), "editing selection should require an explicit mode");
  assert.ok(uiSource.includes("if (editMode && proposedPrimary)"), "editing checkboxes should stay hidden outside selection mode");
  assert.ok(uiSource.includes("Approve All Suggested"), "approval menu should support bulk confidence-based approval");
  assert.ok(uiSource.includes("Approve Visible"), "approval menu should support the current filtered result set");
  assert.ok(uiSource.includes("Clear All Approvals"), "approval menu should support a clean reset");
  assert.ok(uiSource.includes("smv-family-status-approved"), "family approval should replace the review badge with an Approved status");
  assert.ok(!uiSource.includes('document.createTextNode(" Approve")'), "family approval should not require a separate checkbox label");
  assert.ok(uiSource.includes("function setupFamilyDrag"), "complete family cards should support direct drag merging");
  assert.ok(uiSource.includes("mergeFamilyDrafts(targetId, sourceId)"), "drag merging should reuse the guarded draft merge path");
  assert.ok(uiSource.includes("requestAnimationFrame(autoScrollFamilyDrag)"), "family dragging should continuously scroll near list edges");
  assert.ok(uiSource.includes("familyDragInteractiveTarget"), "family dragging should preserve clickable controls");
  assert.ok(uiSource.includes("approved: suggested"), "suggested families should default to approved");
  assert.ok(uiSource.includes("membershipPolicyVersion"), "saved drafts should migrate to authoritative family membership");
  assert.ok(uiSource.includes('include: true, label: member.label || "Variant"'), "all family children should be included automatically");
  assert.ok(uiSource.includes('var includedIndicator = el("span", "smv-member-included", "Included")'), "scene membership should render as a read-only indicator");
  assert.ok(!uiSource.includes('include.type = "checkbox"'), "scene membership should not have a second functional checkbox");
  assert.ok(!uiSource.includes('button("Remove", function () { removeSceneFromFamily'), "per-row removal should use the explicit Select Scenes workflow");
  assert.ok(uiSource.includes("manualApproval"), "manual approval decisions should survive unchanged-family rediscovery");
  assert.ok(uiSource.includes("scenes selected for editing"), "summary should distinguish editing selection from approval");
  assert.ok(uiSource.includes("Preview Required"), "live action should explain the missing dry-run prerequisite");
  assert.ok(uiSource.includes("queueDryRun();"), "clicking the preview-required action should queue the existing safe dry run");
  assert.ok(uiSource.includes("preview ready"), "summary should expose dry-run readiness");
  assert.ok(uiSource.includes("Add Scene"), "review UI should add missed scenes to a family");
  assert.ok(uiSource.includes("Remove"), "review UI should remove incorrect members from a family");
  assert.ok(uiSource.includes("function sceneThumbnail"), "review UI should render Stash-backed scene thumbnails");
  assert.ok(uiSource.includes("smv-scene-thumbnail-video"), "review UI should layer generated preview video over screenshots");
  assert.ok(uiSource.includes('video.preload = "none"'), "hover previews should load lazily");
  assert.ok(uiSource.includes('link.addEventListener("mouseenter", startPreview)'), "hover should start generated previews");
  assert.ok(uiSource.includes("paths { screenshot preview webp vtt sprite }"), "manual scene lookup should request Stash media paths");
  assert.ok(uiSource.includes("needsMediaRefresh"), "older review drafts should preserve approvals while refreshing media metadata");
  assert.ok(uiSource.includes("function makeResizableReviewModal"), "candidate review should support custom edge resizing");
  assert.ok(uiSource.includes('["n", "e", "s", "w", "ne", "nw", "se", "sw"]'), "all review modal edges and corners should be draggable");
  assert.ok(uiSource.includes("scene-metadata-variants-review-bounds-v1"), "review modal bounds should persist in browser storage");
  assert.ok(uiSource.includes('window.addEventListener("resize", onWindowResize)'), "saved review bounds should be constrained after viewport changes");
  assert.ok(uiSource.includes("reviewIdentityCompatible"), "manual family edits should enforce artist and character identity boundaries");
  assert.ok(uiSource.includes("different known artists or characters"), "manual identity conflicts should explain why a merge was rejected");
  assert.ok(uiSource.includes('"artist " + (identity.artistLabel || "unresolved")'), "family evidence should expose the canonical artist");
  assert.ok(uiSource.includes("reviewParentPreference"), "manual scene additions should use the same parent descriptor policy");
  assert.ok(uiSource.includes("smv-parent-signal"), "review rows should display detected parent signals");
  assert.ok(uiSource.includes("DISCOVERY_MODEL_VERSION"), "backend policy changes should refresh saved candidate drafts independently of UI-only versions");
  const cssSource = fs.readFileSync(path.join(__dirname, "..", "ui", "scene-variants.css"), "utf8");
  assert.ok(cssSource.includes("smv-button-preview"), "preview actions should have a dedicated visual treatment");
  assert.ok(cssSource.includes("smv-button-apply"), "live actions should have a dedicated visual treatment");
  assert.ok(cssSource.includes("@keyframes smv-spin"), "discovery activity should be animated");
  assert.ok(cssSource.includes(".smv-scene-thumbnail.is-previewing"), "preview video should visibly replace the still thumbnail while playing");
  assert.ok(cssSource.includes(".smv-review-modal.smv-resizable-modal"), "review modal should have a dedicated resizable layout");
  assert.ok(cssSource.includes(".smv-resize-se"), "review modal should expose a visible corner resize grip");
  assert.ok(cssSource.includes("max-width: none"), "resizable review modal should not retain the old 980px width cap");
  assert.ok(cssSource.includes("border: 1px solid #e0a83b"), "candidate family sections should have a high-contrast outline");
  assert.ok(cssSource.includes("rgba(224, 168, 59, 0.24)"), "candidate family outlines should have a restrained contrast halo");
  assert.ok(cssSource.includes(".smv-member-included"), "included family members should have a clear read-only indicator");
  assert.ok(cssSource.includes(".smv-player-variant-row"), "scene-player variant rows should have a structured preview layout");
  assert.ok(cssSource.includes(".smv-scene-thumbnail.smv-player-variant-thumbnail"), "player thumbnail sizing should override the shared thumbnail width");
  assert.ok(cssSource.includes("max-width: 100%"), "player thumbnails should remain contained within their grid column");
  assert.ok(cssSource.includes(".smv-panel.is-collapsed .smv-panel-toggle-chevron::before"), "collapsed player manager should reverse the chevron direction");
  assert.ok(cssSource.includes("width: calc(100% + 24px)"), "player manager toggle should span the panel width");
  assert.ok(cssSource.includes(".smv-control-tooltip"), "plugin controls should have a consistent visible tooltip surface");
  assert.ok(cssSource.includes("z-index: 1000010"), "tooltips should appear above the candidate review modal");
  assert.ok(cssSource.includes("accent-color: #32a6bf"), "editing selection controls should use cyan semantics");
  assert.ok(cssSource.includes(".smv-review-family.is-drop-target"), "drag merge targets should have clear positive feedback");
  assert.ok(cssSource.includes(".smv-review-family.is-drop-invalid"), "incompatible drag merge targets should have clear negative feedback");
  assert.ok(cssSource.includes(".smv-family-drag-ghost"), "family dragging should show a compact floating preview");
  assert.ok(cssSource.includes(".smv-button-apply.is-preview-required"), "missing dry-run state should have a visible button treatment");
});

function runEmbeddedEntrypointSmoke(contextExtras) {
  const db = makeDb(baseSeed());
  const runtime = makeRuntime(db);
  const source = fs.readFileSync(path.join(__dirname, "..", "scene-metadata-variants.js"), "utf8");
  const context = Object.assign({
    console,
    module: { exports: {} },
    input: {
      args: {
        mode: "link_variant",
        dryRun: false,
        createMissingTags: true,
        primarySceneId: "2",
        childSceneId: "3",
        label: "Vm Wrapped Args"
      }
    },
    gql: runtime.gql,
    log: { Info() {}, Progress() {} }
  }, contextExtras || {});
  const output = vm.runInNewContext(source, context);
  assert.strictEqual(db.scenes["2"].custom_fields.variant_role, "primary");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_role, "variant");
  assert.strictEqual(db.scenes["3"].custom_fields.variant_label, "Vm Wrapped Args");
  assert.ok(output && output.Output && output.Output.result === "linked", "embedded script should return Stash's PluginOutput envelope");
}

test("manifest does not register scan-time scene create hooks", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "scene-metadata-variants-v1.yml"), "utf8");
  assert.ok(manifest.includes("Variant Sets: Preview metadata backfill"), "manual metadata helper should remain available with a distinct label");
  const unsafeTaskNames = manifest.split(/\r?\n/).filter(line => /^\s*- name:\s+[^\"'].*:\s+/.test(line));
  assert.deepStrictEqual(unsafeTaskNames, [], "task names containing colons must be YAML-quoted");
  assert.ok(!manifest.includes("Scene.Create.Post"), "scan-time create hook must stay disabled");
});

test("manifest, backend, and UI versions stay synchronized", () => {
  const manifest = fs.readFileSync(path.join(__dirname, "..", "scene-metadata-variants-v1.yml"), "utf8");
  const backend = fs.readFileSync(path.join(__dirname, "..", "scene-metadata-variants.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "..", "ui", "scene-variants.js"), "utf8");
  const version = (manifest.match(/^version:\s*([^\s]+)$/m) || [])[1];
  assert.strictEqual(version, "0.5.17");
  assert.ok(backend.includes(`var VERSION = "${version}"`));
  assert.ok(ui.includes(`var PLUGIN_VERSION = "${version}"`));
  assert.ok(backend.includes("SceneMetadataVariantsOutput = { Output: SceneMetadataVariants.main() }"));
});

test("embedded script runs main in Stash-like context even when module exists", () => {
  runEmbeddedEntrypointSmoke();
});

test("embedded script runs main when Stash exposes module and process-like globals", () => {
  runEmbeddedEntrypointSmoke({ process: { versions: { node: "stash-goja" } } });
});

let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log("PASS", t.name);
  } catch (err) {
    failed++;
    console.error("FAIL", t.name);
    console.error(err && err.stack || err);
  }
}

if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}

console.log(`${tests.length} tests passed`);
