const assert = require("assert");
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

  function pagedScenes(vars) {
    const ids = orderedSceneIds(vars);
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
          return { findScenes: { count: Object.keys(db.scenes).length, scenes: pagedScenes(vars) } };
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

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
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
