(function () {
  "use strict";

  var PLUGIN_IDS = ["scene-metadata-variants-v1", "stash-scene-metadata-variants-v1", "scene-metadata-variants", "Scene Metadata Variants"];
  var TASKS = {
    link: "Link variant",
    unlink: "Unlink variant",
    promote: "Promote variant to primary",
    rename: "Rename variant",
    reorder: "Reorder variants"
  };
  var baseURL = (document.querySelector("base") && document.querySelector("base").getAttribute("href")) || "/";
  var cache = {};

  function gql(query, variables) {
    return fetch(baseURL + "graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: query, variables: variables || {} })
    }).then(function (res) {
      return res.json();
    }).then(function (json) {
      if (json.errors && json.errors.length) throw new Error(json.errors.map(function (e) { return e.message; }).join("; "));
      return json.data;
    });
  }

  function sceneIdFromLocation() {
    var m = window.location.pathname.match(/\/scenes?\/(\d+)/);
    return m ? m[1] : null;
  }

  function customFields(scene) {
    return scene && scene.custom_fields && typeof scene.custom_fields === "object" ? scene.custom_fields : {};
  }

  function variantChildren(scene) {
    var raw = customFields(scene).variant_children;
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === "string" && raw.trim()) {
      try {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch (e) {
        return raw.split(/[,\s|]+/).filter(Boolean).map(String);
      }
    }
    return [];
  }

  function findScene(id) {
    var query = "query VariantUiFindScene($id: ID!) { findScene(id: $id) { id title custom_fields studio { id name } groups { group { id name } } tags { id name } files { path basename } } }";
    return gql(query, { id: String(id) }).then(function (data) {
      return data.findScene;
    });
  }

  function searchScenes(text) {
    if (/^\d+$/.test(String(text || "").trim())) {
      return findScene(String(text).trim()).then(function (scene) {
        return scene ? [scene] : [];
      });
    }
    var query = "query VariantUiSearchScenes($filter: FindFilterType) { findScenes(filter: $filter) { count scenes { id title custom_fields studio { id name } groups { group { id name } } tags { id name } files { path basename } } } }";
    return gql(query, { filter: { q: String(text || ""), per_page: 20 } }).then(function (data) {
      return (data.findScenes && data.findScenes.scenes) || [];
    });
  }

  function runPluginTaskWithId(pluginId, taskName, args) {
    var query = "mutation RunVariantPluginTask($plugin_id: ID!, $task_name: String!, $args_map: Map) { runPluginTask(plugin_id: $plugin_id, task_name: $task_name, args_map: $args_map) }";
    return gql(query, { plugin_id: pluginId, task_name: taskName, args_map: args || {} });
  }

  function runPluginTask(taskName, args) {
    var index = 0;
    function attempt() {
      return runPluginTaskWithId(PLUGIN_IDS[index], taskName, args).catch(function (err) {
        index++;
        if (index < PLUGIN_IDS.length) return attempt();
        throw err;
      });
    }
    return attempt();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function sceneTitle(scene) {
    if (!scene) return "";
    if (scene.title) return scene.title;
    var file = scene.files && scene.files[0];
    return (file && (file.basename || file.path)) || ("Scene " + scene.id);
  }

  function goScene(id) {
    window.location.href = baseURL.replace(/\/$/, "") + "/scenes/" + id;
  }

  function infoText(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") return variantChildren(scene).length + " linked variants";
    if (cf.variant_role === "variant") return "Variant of scene " + cf.variant_parent_id;
    return "No variants linked.";
  }

  function button(label, onClick) {
    var b = el("button", "smv-button", label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function variantStatus(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") return "Primary scene with " + variantChildren(scene).length + " variants";
    if (cf.variant_role === "variant") return "Already variant of: " + cf.variant_parent_id;
    return "Normal";
  }

  function sceneSummary(scene) {
    var file = scene.files && scene.files[0];
    var groups = (scene.groups || []).map(function (g) { return g.group && g.group.name; }).filter(Boolean).join(", ");
    var tags = (scene.tags || []).slice(0, 5).map(function (t) { return t.name; }).join(", ");
    return {
      studio: scene.studio && scene.studio.name || "",
      groups: groups,
      tags: tags,
      path: file && (file.basename || file.path) || ""
    };
  }

  function openSceneSearchModal(title, onSelect) {
    var backdrop = el("div", "smv-modal-backdrop");
    var modal = el("div", "smv-modal");
    modal.appendChild(el("div", "smv-modal-title", title));

    var searchRow = el("div", "smv-search-row");
    var input = el("input", "smv-search-input");
    input.type = "text";
    input.placeholder = "Search title, path, or paste scene ID";
    var searchButton = button("Search", runSearch);
    searchRow.appendChild(input);
    searchRow.appendChild(searchButton);
    modal.appendChild(searchRow);

    var results = el("div", "smv-search-results");
    modal.appendChild(results);

    var footer = el("div", "smv-modal-footer");
    footer.appendChild(button("Cancel", function () { backdrop.remove(); }));
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    input.focus();

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") runSearch();
      if (event.key === "Escape") backdrop.remove();
    });

    function runSearch() {
      var q = input.value.trim();
      results.textContent = "Searching...";
      searchScenes(q).then(function (scenes) {
        results.innerHTML = "";
        if (!scenes.length) {
          results.appendChild(el("div", "smv-empty", "No scenes found."));
          return;
        }
        scenes.forEach(function (scene) {
          var summary = sceneSummary(scene);
          var row = el("div", "smv-result");
          var main = el("div", "smv-result-main");
          main.appendChild(el("div", "smv-result-title", sceneTitle(scene)));
          main.appendChild(el("div", "smv-result-meta", "ID " + scene.id + " | " + variantStatus(scene)));
          if (summary.studio) main.appendChild(el("div", "smv-result-meta", "Studio: " + summary.studio));
          if (summary.groups) main.appendChild(el("div", "smv-result-meta", "Groups: " + summary.groups));
          if (summary.tags) main.appendChild(el("div", "smv-result-meta", "Tags: " + summary.tags));
          if (summary.path) main.appendChild(el("div", "smv-result-path", summary.path));
          row.appendChild(main);
          row.appendChild(button("Select", function () {
            backdrop.remove();
            onSelect(scene);
          }));
          results.appendChild(row);
        });
      }).catch(function (err) {
        results.textContent = "Search failed: " + (err && err.message || err);
      });
    }
  }

  function renderPanel(scene, related) {
    var old = document.querySelector(".smv-panel");
    if (old) old.remove();

    var panel = el("section", "smv-panel");
    panel.appendChild(el("div", "smv-title", "Variants"));
    panel.appendChild(el("div", "smv-status", infoText(scene)));

    var cf = customFields(scene);
    var list = el("div", "smv-list");

    if (cf.variant_role === "primary") {
      var main = el("button", "smv-item smv-current", "Main: " + sceneTitle(scene));
      main.type = "button";
      list.appendChild(main);
      related.children.forEach(function (child) {
        var label = customFields(child).variant_label || "Variant";
        list.appendChild(button(label + ": " + sceneTitle(child), function () { goScene(child.id); }));
      });
    } else if (cf.variant_role === "variant") {
      if (related.primary) list.appendChild(button("Primary: " + sceneTitle(related.primary), function () { goScene(related.primary.id); }));
      related.siblings.forEach(function (sib) {
        var label = customFields(sib).variant_label || "Variant";
        var cls = String(sib.id) === String(scene.id) ? "smv-item smv-current" : "smv-button";
        var item = el("button", cls, label + ": " + sceneTitle(sib));
        item.type = "button";
        if (String(sib.id) !== String(scene.id)) item.addEventListener("click", function () { goScene(sib.id); });
        list.appendChild(item);
      });
    }
    panel.appendChild(list);

    var actions = el("div", "smv-actions");
    actions.appendChild(button("Add Existing Scene", function () {
      openSceneSearchModal("Add Existing Scene as Variant", function (selected) {
        var label = window.prompt("Variant label", "Variant") || "Variant";
        if (!window.confirm("Add \"" + sceneTitle(selected) + "\" as a variant of \"" + sceneTitle(scene) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: false, primarySceneId: String(scene.id), childSceneId: String(selected.id), label: label }).then(function () {
          window.location.reload();
        }).catch(alert);
      });
    }));
    actions.appendChild(button("Add This Under Another", function () {
      openSceneSearchModal("Add This Scene as Variant of Another Scene", function (selected) {
        var label = window.prompt("Variant label", "Variant") || "Variant";
        if (!window.confirm("Make \"" + sceneTitle(scene) + "\" a variant of \"" + sceneTitle(selected) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: false, primarySceneId: String(selected.id), childSceneId: String(scene.id), label: label }).then(function () {
          window.location.reload();
        }).catch(alert);
      });
    }));

    if (cf.variant_role === "variant") {
      actions.appendChild(button("Unlink", function () {
        if (!window.confirm("Unlink this variant? This does not delete files or scenes.")) return;
        runPluginTask(TASKS.unlink, { mode: "unlink_variant", dryRun: false, childSceneId: String(scene.id) }).then(function () {
          window.location.reload();
        }).catch(alert);
      }));
      actions.appendChild(button("Promote", function () {
        if (!window.confirm("Promote this variant to primary? This does not delete files or scenes.")) return;
        runPluginTask(TASKS.promote, { mode: "promote_variant", dryRun: false, childSceneId: String(scene.id) }).then(function () {
          window.location.reload();
        }).catch(alert);
      }));
    }

    panel.appendChild(actions);
    mountPanel(panel);
  }

  function mountPanel(panel) {
    var target = document.querySelector(".scene-tabs") ||
      document.querySelector(".scene-container") ||
      document.querySelector(".container-fluid") ||
      document.body;
    target.insertBefore(panel, target.firstChild);
  }

  function loadRelated(scene) {
    var cf = customFields(scene);
    if (cf.variant_role === "primary") {
      return Promise.all(variantChildren(scene).map(findScene)).then(function (children) {
        return { children: children.filter(Boolean), siblings: [], primary: null };
      });
    }
    if (cf.variant_role === "variant" && cf.variant_parent_id) {
      return findScene(cf.variant_parent_id).then(function (primary) {
        return Promise.all(variantChildren(primary).map(findScene)).then(function (siblings) {
          return { primary: primary, siblings: siblings.filter(Boolean), children: [] };
        });
      });
    }
    return Promise.resolve({ children: [], siblings: [], primary: null });
  }

  function setupScenePage() {
    var id = sceneIdFromLocation();
    if (!id) return;
    findScene(id).then(function (scene) {
      if (!scene) return;
      return loadRelated(scene).then(function (related) {
        renderPanel(scene, related);
      });
    }).catch(function (err) {
      console.warn("[scene-metadata-variants] panel failed", err);
    });
  }

  function sceneIdFromHref(href) {
    var m = String(href || "").match(/\/scenes?\/(\d+)/);
    return m ? m[1] : null;
  }

  function addBadgeToCard(anchor, scene) {
    var cf = customFields(scene);
    var count = variantChildren(scene).length;
    if (cf.variant_role !== "primary" || !count) return;
    var card = anchor.closest(".scene-card") || anchor.closest(".card") || anchor.parentElement;
    if (!card || card.querySelector(".smv-card-badge")) return;
    var badge = el("span", "smv-card-badge", count + " variants");
    card.appendChild(badge);
  }

  function setupCardBadges() {
    var anchors = Array.prototype.slice.call(document.querySelectorAll("a[href*='/scene']"));
    anchors.slice(0, 80).forEach(function (a) {
      var id = sceneIdFromHref(a.getAttribute("href"));
      if (!id || cache[id] === "loading") return;
      if (cache[id]) {
        addBadgeToCard(a, cache[id]);
        return;
      }
      cache[id] = "loading";
      findScene(id).then(function (scene) {
        cache[id] = scene;
        addBadgeToCard(a, scene);
      }).catch(function () {
        cache[id] = null;
      });
    });
  }

  function refresh() {
    setupScenePage();
    setupCardBadges();
  }

  function start() {
    refresh();
    if (window.PluginApi && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", function () {
        setTimeout(refresh, 250);
      });
    }
    var observer = new MutationObserver(function () {
      setupCardBadges();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
