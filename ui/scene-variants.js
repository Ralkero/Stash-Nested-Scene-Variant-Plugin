(function () {
  "use strict";

  var PLUGIN_IDS = ["scene-metadata-variants-v1", "stash-scene-metadata-variants-v1", "scene-metadata-variants", "Scene Metadata Variants"];
  var DRY_RUN_KEY = "scene-metadata-variants-ui-dry-run";
  var SHOW_NESTED_KEY = "scene-metadata-variants-show-nested";
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
    var m = window.location.pathname.match(/(?:^|\/)scenes?\/(\d+)\/?$/);
    return m ? m[1] : null;
  }

  function isScenesBrowseRoute() {
    return /(?:^|\/)scenes\/?$/.test(window.location.pathname);
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

  function uiDryRun() {
    return window.localStorage.getItem(DRY_RUN_KEY) !== "false";
  }

  function setUiDryRun(value) {
    window.localStorage.setItem(DRY_RUN_KEY, value ? "true" : "false");
  }

  function taskJobId(data) {
    return data && data.runPluginTask ? String(data.runPluginTask) : "";
  }

  function afterTask(data, dryRun) {
    var job = taskJobId(data);
    if (dryRun) {
      window.alert("Dry run queued" + (job ? " as job " + job : "") + ". Check the Stash task log before applying.");
      return;
    }
    window.location.reload();
  }

  function showNestedVariants() {
    return window.localStorage.getItem(SHOW_NESTED_KEY) === "true";
  }

  function setShowNestedVariants(value) {
    window.localStorage.setItem(SHOW_NESTED_KEY, value ? "true" : "false");
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

    var mode = el("label", "smv-mode");
    var dryRunBox = document.createElement("input");
    dryRunBox.type = "checkbox";
    dryRunBox.checked = uiDryRun();
    dryRunBox.addEventListener("change", function () { setUiDryRun(dryRunBox.checked); });
    mode.appendChild(dryRunBox);
    mode.appendChild(document.createTextNode(" Dry run"));
    panel.appendChild(mode);

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
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run add " : "Add ") + "\"" + sceneTitle(selected) + "\" as a variant of \"" + sceneTitle(scene) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: dryRun, primarySceneId: String(scene.id), childSceneId: String(selected.id), label: label }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      });
    }));
    actions.appendChild(button("Add This Under Another", function () {
      openSceneSearchModal("Add This Scene as Variant of Another Scene", function (selected) {
        var label = window.prompt("Variant label", "Variant") || "Variant";
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run making " : "Make ") + "\"" + sceneTitle(scene) + "\" a variant of \"" + sceneTitle(selected) + "\"?")) return;
        runPluginTask(TASKS.link, { mode: "link_variant", dryRun: dryRun, primarySceneId: String(selected.id), childSceneId: String(scene.id), label: label }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      });
    }));

    if (cf.variant_role === "variant") {
      actions.appendChild(button("Unlink", function () {
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run unlink this variant?" : "Unlink this variant?") + " This does not delete files or scenes.")) return;
        runPluginTask(TASKS.unlink, { mode: "unlink_variant", dryRun: dryRun, childSceneId: String(scene.id) }).then(function (data) {
          afterTask(data, dryRun);
        }).catch(alert);
      }));
      actions.appendChild(button("Promote", function () {
        var dryRun = uiDryRun();
        if (!window.confirm((dryRun ? "Dry-run promote this variant to primary?" : "Promote this variant to primary?") + " This does not delete files or scenes.")) return;
        runPluginTask(TASKS.promote, { mode: "promote_variant", dryRun: dryRun, childSceneId: String(scene.id) }).then(function (data) {
          afterTask(data, dryRun);
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

  function removePanel() {
    var old = document.querySelector(".smv-panel");
    if (old) old.remove();
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
    if (!id) {
      removePanel();
      return;
    }
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

  function cardForAnchor(anchor) {
    return anchor.closest(".scene-card") ||
      anchor.closest(".scene-card-container") ||
      anchor.closest(".card") ||
      anchor.closest("[class*='scene-card']") ||
      anchor.parentElement;
  }

  function metadataRowScore(node, card) {
    if (!node || node === card || node.querySelector(".smv-card-variant-menu")) return 0;
    var text = (node.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 80) return 0;
    var iconCount = node.querySelectorAll("svg, i, .fa, .svg-inline--fa, [data-icon]").length;
    var digitCount = (text.match(/\d+/g) || []).length;
    var className = String(node.className || "");
    var score = 0;
    if (iconCount >= 2) score += 8;
    else if (iconCount === 1) score += 4;
    if (digitCount >= 2) score += 8;
    else if (digitCount === 1) score += 4;
    if (/tag|group|studio|performer|marker|meta|indicator|count|footer/i.test(className)) score += 5;
    if (/title|image|thumbnail|preview|caption|description/i.test(className)) score -= 8;
    if (node.querySelector("a[href*='/scenes/']")) score -= 6;
    return score;
  }

  function bestMetadataRow(card) {
    if (!card) return null;
    var best = null;
    var bestScore = 0;
    var nodes = Array.prototype.slice.call(card.querySelectorAll("div, span, footer, section"));
    nodes.forEach(function (node) {
      var score = metadataRowScore(node, card);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return bestScore >= 8 ? best : null;
  }

  function ensureMetadataRow(card) {
    var row = bestMetadataRow(card);
    if (row) return row;
    row = el("div", "smv-metadata-row-fallback");
    card.appendChild(row);
    return row;
  }

  function cardFooter(card) {
    if (!card) return null;
    var selectors = [
      ".scene-card-footer .scene-card-tags",
      ".scene-card-footer [class*='tag']",
      ".scene-card-footer [class*='group']",
      ".scene-card-footer",
      ".scene-card__footer",
      ".card-footer",
      ".scene-card__details",
      ".scene-card-info",
      ".scene-card__info"
    ];
    for (var i = 0; i < selectors.length; i++) {
      var found = card.querySelector(selectors[i]);
      if (found) return found;
    }
    return ensureMetadataRow(card);
  }

  function chainIcon() {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "smv-chain-icon");
    var p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p1.setAttribute("d", "M10.5 13.5 13.5 10.5");
    var p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("d", "M8.6 15.4 7.4 16.6a3.2 3.2 0 0 1-4.5-4.5l3.2-3.2a3.2 3.2 0 0 1 4.5 0l.7.7");
    var p3 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p3.setAttribute("d", "M15.4 8.6 16.6 7.4a3.2 3.2 0 0 1 4.5 4.5l-3.2 3.2a3.2 3.2 0 0 1-4.5 0l-.7-.7");
    [p1, p2, p3].forEach(function (path) {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);
    });
    return svg;
  }

  function closeVariantMenus() {
    Array.prototype.forEach.call(document.querySelectorAll(".smv-card-variant-menu.is-open"), function (node) {
      node.classList.remove("is-open");
    });
  }

  function fillVariantMenu(menu, scene) {
    if (menu.getAttribute("data-loaded") === "true") return;
    var dropdown = menu.querySelector(".smv-variant-dropdown");
    dropdown.textContent = "Loading...";
    Promise.all(variantChildren(scene).map(findScene)).then(function (children) {
      dropdown.innerHTML = "";
      children.filter(Boolean).forEach(function (child) {
        var item = el("button", "smv-variant-option", (customFields(child).variant_label || "Variant") + ": " + sceneTitle(child));
        item.type = "button";
        item.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          goScene(child.id);
        });
        dropdown.appendChild(item);
      });
      if (!dropdown.children.length) dropdown.appendChild(el("div", "smv-variant-empty", "No variants found"));
      menu.setAttribute("data-loaded", "true");
    }).catch(function () {
      dropdown.textContent = "Variant list failed";
    });
  }

  function applyVariantVisibility(card, scene) {
    if (!card) return;
    var isChild = customFields(scene).variant_role === "variant";
    if (isChild && !showNestedVariants()) {
      card.classList.add("smv-hidden-variant-card");
      card.setAttribute("data-smv-hidden-variant", "true");
    } else {
      card.classList.remove("smv-hidden-variant-card");
      if (card.getAttribute("data-smv-hidden-variant") === "true") card.removeAttribute("data-smv-hidden-variant");
    }
  }

  function addVariantMenuToCard(anchor, scene) {
    var cf = customFields(scene);
    var count = variantChildren(scene).length;
    var card = cardForAnchor(anchor);
    if (!card) return;
    applyVariantVisibility(card, scene);
    if (cf.variant_role !== "primary" || !count || card.querySelector(".smv-card-variant-menu")) return;
    var footer = ensureMetadataRow(card) || cardFooter(card);
    var menu = el("span", "smv-card-variant-menu");
    var trigger = el("button", "smv-variant-trigger");
    trigger.type = "button";
    trigger.title = count + " variants";
    trigger.appendChild(chainIcon());
    trigger.appendChild(el("span", "smv-variant-count", String(count)));
    var dropdown = el("div", "smv-variant-dropdown");
    dropdown.setAttribute("role", "menu");
    menu.appendChild(trigger);
    menu.appendChild(dropdown);
    trigger.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      var opening = !menu.classList.contains("is-open");
      closeVariantMenus();
      if (opening) {
        menu.classList.add("is-open");
        fillVariantMenu(menu, scene);
      }
    });
    footer.appendChild(menu);
  }

  function setupCardVariantMenus() {
    if (sceneIdFromLocation()) return;
    var anchors = Array.prototype.slice.call(document.querySelectorAll("a[href*='/scene']"));
    anchors.slice(0, 80).forEach(function (a) {
      var id = sceneIdFromHref(a.getAttribute("href"));
      if (!id || cache[id] === "loading") return;
      if (cache[id]) {
        addVariantMenuToCard(a, cache[id]);
        return;
      }
      cache[id] = "loading";
      findScene(id).then(function (scene) {
        cache[id] = scene;
        addVariantMenuToCard(a, scene);
      }).catch(function () {
        cache[id] = null;
      });
    });
  }

  function toggleNestedVariantVisibility() {
    setShowNestedVariants(!showNestedVariants());
    Array.prototype.forEach.call(document.querySelectorAll("[data-smv-hidden-variant='true'], .smv-hidden-variant-card"), function (card) {
      card.classList.remove("smv-hidden-variant-card");
      card.removeAttribute("data-smv-hidden-variant");
    });
    setupCardVariantMenus();
  }

  function menuText() {
    return showNestedVariants() ? "Hide nested variants" : "Show nested variants";
  }

  function injectEllipsisMenuToggle(root) {
    if (!isScenesBrowseRoute()) return;
    var containers = Array.prototype.slice.call((root || document).querySelectorAll(".dropdown-menu, [role='menu'], .popover, .modal, .btn-group.open > .dropdown-menu, .show > .dropdown-menu, .show[role='menu']"));
    containers.forEach(function (container) {
      if (!container || container.querySelector(".smv-show-nested-toggle")) return;
      if (container.classList && container.classList.contains("smv-variant-dropdown")) return;
      if (container.closest && container.closest(".smv-card-variant-menu")) return;
      if (container.querySelector(".smv-variant-option")) return;
      var item = el("button", "smv-show-nested-toggle", menuText());
      item.type = "button";
      item.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleNestedVariantVisibility();
        item.textContent = menuText();
      });
      container.appendChild(item);
    });
  }

  function setupToolbarToggleWatcher() {
    document.addEventListener("click", function (event) {
      if (!isScenesBrowseRoute()) return;
      var target = event.target;
      var button = target && target.closest && target.closest("button, .btn, [role='button']");
      if (!button) return;
      var text = (button.textContent || "").trim();
      var label = button.getAttribute("aria-label") || button.getAttribute("title") || "";
      var hasIcon = !!button.querySelector("svg, i, .fa, .svg-inline--fa");
      if (text === "..." || text === "\u2026" || /more|options|ellipsis|menu/i.test(label) || hasIcon) {
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 80);
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 250);
        setTimeout(function () { injectEllipsisMenuToggle(document); }, 600);
      }
    }, true);
  }

  function refresh() {
    setupScenePage();
    setupCardVariantMenus();
  }

  function start() {
    refresh();
    if (window.PluginApi && PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", function () {
        setTimeout(refresh, 250);
      });
    }
    var observer = new MutationObserver(function () {
      setupCardVariantMenus();
      injectEllipsisMenuToggle(document);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", function () { closeVariantMenus(); });
    setupToolbarToggleWatcher();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
