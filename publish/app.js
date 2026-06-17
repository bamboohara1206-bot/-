(() => {
  "use strict";

  const STORAGE_KEY = "emergency-meds-personal:data:v1";
  const PREF_KEY = "emergency-meds-personal:prefs:v1";
  const DEFAULT_DATA = clone(window.EMERGENCY_MEDS_DEFAULT_DATA || { categories: [], scenarios: [] });

  const els = {
    body: document.body,
    list: document.getElementById("scenarioList"),
    chips: document.getElementById("categoryChips"),
    search: document.getElementById("searchInput"),
    count: document.getElementById("countText"),
    storage: document.getElementById("storageText"),
    saveState: document.getElementById("saveState"),
    editToggle: document.getElementById("editToggle"),
    editStrip: document.getElementById("editStrip"),
    addScenario: document.getElementById("addScenarioBtn"),
    reset: document.getElementById("resetBtn"),
    export: document.getElementById("exportBtn"),
    import: document.getElementById("importBtn"),
    importFile: document.getElementById("importFile"),
    theme: document.getElementById("themeBtn"),
    sync: document.getElementById("syncBtn"),
    weight: document.getElementById("weightInput"),
    dialog: document.getElementById("editorDialog"),
    form: document.getElementById("scenarioForm"),
    dialogTitle: document.getElementById("dialogTitle"),
    closeDialog: document.getElementById("closeDialogBtn"),
    cancelDialog: document.getElementById("cancelDialogBtn"),
    deleteScenario: document.getElementById("deleteScenarioBtn"),
    addDrug: document.getElementById("addDrugBtn"),
    drugEditor: document.getElementById("drugEditor"),
    categoryList: document.getElementById("categoryList"),
    categoryField: document.getElementById("categoryField"),
    scenarioField: document.getElementById("scenarioField"),
    goalField: document.getElementById("goalField"),
    pointField: document.getElementById("pointField"),
    syncDialog: document.getElementById("syncDialog"),
    syncForm: document.getElementById("syncForm"),
    closeSync: document.getElementById("closeSyncBtn"),
    syncUrl: document.getElementById("syncUrlField"),
    pullSync: document.getElementById("pullSyncBtn"),
    pushSync: document.getElementById("pushSyncBtn"),
    syncStatus: document.getElementById("syncStatus"),
  };

  const categoryPalette = {
    CPA: "#e45c78",
    循環器: "#3f8efc",
    ショック: "#df5a4f",
    呼吸器: "#2aa79b",
    神経: "#8d6be8",
    代謝内分泌: "#c7588d",
    消化器: "#b77924",
  };

  let data = normalizeData(loadJSON(STORAGE_KEY) || DEFAULT_DATA);
  let prefs = {
    theme: "light",
    weight: 50,
    syncUrl: "",
    ...loadJSON(PREF_KEY),
  };
  let ui = {
    activeCategory: "all",
    query: "",
    editing: false,
    editingIndex: null,
    draftDrugs: [],
  };

  init();

  async function init() {
    applyTheme(prefs.theme);
    els.weight.value = String(safeWeight(prefs.weight));
    bindEvents();
    registerServiceWorker();

    const unlocked = await authenticateIfNeeded();
    if (!unlocked) return;
    unlockApp();
    render();
  }

  async function authenticateIfNeeded() {
    const auth = window.EMERGENCY_MEDS_AUTH || {};
    if (!auth.enabled) return true;

    const sessionKey = `emergency-meds-auth:${auth.hash}`;
    try {
      if (sessionStorage.getItem(sessionKey) === "ok") return true;
    } catch (error) {}

    return showAuthScreen(auth, sessionKey);
  }

  function unlockApp() {
    els.body.classList.remove("auth-pending");
    document.querySelector(".auth-screen")?.remove();
  }

  function showAuthScreen(auth, sessionKey) {
    return new Promise((resolve) => {
      const screen = document.createElement("div");
      screen.className = "auth-screen";
      screen.innerHTML = `
        <form class="auth-panel">
          <p class="eyebrow">PRIVATE</p>
          <h2>救急投与ノート</h2>
          <p>閲覧するにはパスワードを入力してください。</p>
          <label>
            <span>パスワード</span>
            <input type="password" autocomplete="current-password" required autofocus>
          </label>
          <button class="primary-button" type="submit">開く</button>
          <div class="auth-message" aria-live="polite"></div>
        </form>
      `;
      document.body.appendChild(screen);

      const form = screen.querySelector("form");
      const input = screen.querySelector("input");
      const message = screen.querySelector(".auth-message");
      setTimeout(() => input.focus(), 0);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        message.textContent = "確認しています...";
        const ok = await verifyPassword(input.value, auth);
        if (ok) {
          try {
            sessionStorage.setItem(sessionKey, "ok");
          } catch (error) {}
          resolve(true);
          return;
        }
        input.value = "";
        input.focus();
        message.textContent = "パスワードが違います。";
      });
    });
  }

  async function verifyPassword(password, auth) {
    if (!password || !auth.salt || !auth.hash || !window.crypto?.subtle) return false;
    try {
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: base64ToBytes(auth.salt),
          iterations: Number(auth.iterations) || 120000,
          hash: "SHA-256",
        },
        keyMaterial,
        256,
      );
      return safeEquals(bytesToBase64(new Uint8Array(bits)), auth.hash);
    } catch (error) {
      return false;
    }
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function safeEquals(left, right) {
    if (left.length !== right.length) return false;
    let diff = 0;
    for (let index = 0; index < left.length; index++) {
      diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
    }
    return diff === 0;
  }

  function bindEvents() {
    els.search.addEventListener("input", () => {
      ui.query = els.search.value.trim();
      renderList();
    });

    els.weight.addEventListener("input", () => {
      prefs.weight = safeWeight(els.weight.value);
      savePrefs();
      renderList();
    });

    els.theme.addEventListener("click", () => {
      prefs.theme = prefs.theme === "dark" ? "light" : "dark";
      applyTheme(prefs.theme);
      savePrefs();
    });

    els.editToggle.addEventListener("click", () => {
      ui.editing = !ui.editing;
      els.editToggle.setAttribute("aria-pressed", String(ui.editing));
      els.editStrip.hidden = !ui.editing;
      renderList();
    });

    els.addScenario.addEventListener("click", () => openEditor(null));
    els.reset.addEventListener("click", resetToDefault);
    els.export.addEventListener("click", exportData);
    els.import.addEventListener("click", () => els.importFile.click());
    els.importFile.addEventListener("change", importData);
    els.sync.addEventListener("click", openSyncDialog);
    els.closeSync.addEventListener("click", closeSyncDialog);
    els.pullSync.addEventListener("click", pullSyncData);
    els.pushSync.addEventListener("click", pushSyncData);
    els.syncUrl.addEventListener("input", () => {
      prefs.syncUrl = els.syncUrl.value.trim();
      savePrefs();
    });

    els.closeDialog.addEventListener("click", () => closeEditor());
    els.cancelDialog.addEventListener("click", () => closeEditor());
    els.addDrug.addEventListener("click", () => {
      syncDraftFromEditor();
      ui.draftDrugs.push(blankDrug());
      renderDrugEditor();
    });

    els.deleteScenario.addEventListener("click", () => {
      if (ui.editingIndex === null) {
        closeEditor();
        return;
      }
      const target = data.scenarios[ui.editingIndex];
      if (!confirm(`「${target.scenario}」を削除しますか？`)) return;
      data.scenarios.splice(ui.editingIndex, 1);
      saveData();
      closeEditor();
      render();
    });

    els.form.addEventListener("submit", (event) => {
      event.preventDefault();
      saveScenarioFromForm();
    });

    els.dialog.addEventListener("close", () => {
      els.body.classList.remove("dialog-open");
    });

    els.syncDialog.addEventListener("close", () => {
      els.body.classList.remove("dialog-open");
    });
  }

  function render() {
    data = normalizeData(data);
    renderCategoryDatalist();
    renderChips();
    renderList();
    updateStorageText();
  }

  function renderCategoryDatalist() {
    els.categoryList.innerHTML = data.categories
      .map((category) => `<option value="${escapeHTML(category)}"></option>`)
      .join("");
  }

  function renderChips() {
    const categories = ["all", ...data.categories];
    const currentExists = ui.activeCategory === "all" || data.categories.includes(ui.activeCategory);
    if (!currentExists) ui.activeCategory = "all";

    els.chips.innerHTML = "";
    for (const category of categories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chip${category === ui.activeCategory ? " is-active" : ""}`;
      button.textContent = category === "all" ? "すべて" : category;
      button.style.setProperty("--cat-color", category === "all" ? "var(--ink)" : categoryColor(category));
      button.addEventListener("click", () => {
        ui.activeCategory = category;
        renderChips();
        renderList();
      });
      els.chips.appendChild(button);
    }
  }

  function renderList() {
    els.body.dataset.editing = String(ui.editing);
    const filtered = data.scenarios
      .map((scenario, index) => ({ scenario, index }))
      .filter(({ scenario }) => {
        const categoryOk = ui.activeCategory === "all" || scenario.category === ui.activeCategory;
        const queryOk = !ui.query || searchText(scenario).includes(ui.query.toLowerCase());
        return categoryOk && queryOk;
      });

    els.count.textContent = `${filtered.length} / ${data.scenarios.length}件`;
    els.list.innerHTML = "";

    if (filtered.length === 0) {
      els.list.innerHTML = `<div class="empty">該当するメニューがありません</div>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const item of filtered) {
      frag.appendChild(scenarioCard(item.scenario, item.index));
    }
    els.list.appendChild(frag);
  }

  function scenarioCard(scenario, index) {
    const article = document.createElement("article");
    article.className = "scenario";
    article.style.setProperty("--cat-color", categoryColor(scenario.category));

    article.innerHTML = `
      <div class="scenario-head">
        <span class="category-badge">${escapeHTML(scenario.category)}</span>
        <h2 class="scenario-title">${escapeHTML(scenario.scenario)}</h2>
        ${scenario.goal ? `<p class="scenario-goal">${nl2br(scenario.goal)}</p>` : ""}
        ${scenario.point ? `<p class="scenario-point">${nl2br(scenario.point)}</p>` : ""}
        <div class="scenario-tools">
          <button class="tool-button" type="button" data-action="edit">編集</button>
          <button class="tool-button" type="button" data-action="duplicate">複製</button>
          <button class="tool-button" type="button" data-action="delete">削除</button>
        </div>
      </div>
      <div class="drug-list">
        ${(scenario.drugs || []).map(drugHTML).join("")}
      </div>
    `;

    article.querySelector('[data-action="edit"]').addEventListener("click", () => openEditor(index));
    article.querySelector('[data-action="duplicate"]').addEventListener("click", () => duplicateScenario(index));
    article.querySelector('[data-action="delete"]').addEventListener("click", () => deleteScenario(index));
    return article;
  }

  function drugHTML(drug) {
    return `
      <section class="drug">
        <div class="drug-name">
          <span>${escapeHTML(drug.name)}</span>
          ${drug.brand ? `<span class="brand">（${escapeHTML(drug.brand)}）</span>` : ""}
          ${tagHTML(drug.tag)}
        </div>
        ${fieldHTML("希釈・準備", drug.prep)}
        ${drug.calc ? calcHTML(drug.calc) : ""}
        ${drug.start ? `<div class="start-box"><span>${escapeHTML(drug.startLabel || "初期投与")}</span><span>${nl2br(drug.start)}</span></div>` : ""}
        ${fieldHTML("調整・漸増", drug.titrate)}
        ${fieldHTML("補足・適応", drug.note)}
        ${drug.warn ? `<div class="note-box warn"><strong>注意</strong>${nl2br(drug.warn)}</div>` : ""}
        ${drug.tip ? `<div class="note-box tip"><strong>コツ</strong>${nl2br(drug.tip)}</div>` : ""}
      </section>
    `;
  }

  function tagHTML(tag) {
    if (!tag) return "";
    const tags = Array.isArray(tag) ? tag : [tag];
    return tags
      .filter(Boolean)
      .map((item) => `<span class="tag">${escapeHTML(item)}</span>`)
      .join("");
  }

  function fieldHTML(label, value) {
    if (!value) return "";
    return `
      <div class="field">
        <div class="field-label">${escapeHTML(label)}</div>
        <div class="field-value">${nl2br(value)}</div>
      </div>
    `;
  }

  function calcHTML(calc) {
    const weight = safeWeight(prefs.weight);
    const conc = Number(calc.conc);
    const doses = Array.isArray(calc.doses) ? calc.doses.map(Number).filter(Number.isFinite) : [];
    if (!conc || doses.length === 0) return "";

    const rows = doses.map((dose) => {
      const rate = dose * weight * 60 / conc;
      const isStart = Number(calc.start) === dose;
      const peripheralMax = Number(calc.peripheralMax);
      const route = Number.isFinite(peripheralMax) && peripheralMax > 0
        ? dose <= peripheralMax
          ? `<span class="route-pill ok">末梢可</span>`
          : `<span class="route-pill caution">要CV</span>`
        : "";
      return `
        <tr class="${isStart ? "start-row" : ""}">
          <td>${escapeHTML(formatDose(dose))}γ</td>
          <td class="rate">${formatRate(rate)} <small>mL/h</small></td>
          <td class="route">${route}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="calc-box">
        <div class="calc-head"><span>体重連動</span><span>${escapeHTML(String(weight))} kg / ${escapeHTML(String(conc))} µg/mL</span></div>
        <table class="calc-table"><tbody>${rows}</tbody></table>
      </div>
    `;
  }

  function openSyncDialog() {
    const defaultUrl = defaultSyncUrl();
    els.syncUrl.value = prefs.syncUrl || defaultUrl;
    setSyncStatus(`同期先: ${els.syncUrl.value || "未設定"}`, "");
    els.body.classList.add("dialog-open");
    if (typeof els.syncDialog.showModal === "function") {
      els.syncDialog.showModal();
    } else {
      els.syncDialog.setAttribute("open", "");
    }
  }

  function closeSyncDialog() {
    if (els.syncDialog.open) els.syncDialog.close();
    els.body.classList.remove("dialog-open");
  }

  async function pullSyncData() {
    const url = currentSyncUrl();
    if (!url) {
      setSyncStatus("同期URLを入力してください。", "error");
      return;
    }
    if (!confirm("共有データをこの端末に取り込みますか？現在の端末内データは置き換わります。必要なら先にJSONを書き出してください。")) return;

    setSyncStatus("共有データを取得しています...", "");
    try {
      const raw = isGoogleScriptUrl(url) ? await getJsonp(url) : await getJson(url);
      const imported = normalizeData(raw.payload || raw.data || raw);
      if (!imported.scenarios.length) throw new Error("No scenarios");

      data = imported;
      saveData();
      render();
      setSyncStatus(`取り込み完了: ${data.scenarios.length}件`, "ok");
    } catch (error) {
      setSyncStatus("取り込みに失敗しました。同期URL、Drive側の公開設定、またはPC同期サーバーを確認してください。", "error");
    }
  }

  async function pushSyncData() {
    const url = currentSyncUrl();
    if (!url) {
      setSyncStatus("同期URLを入力してください。", "error");
      return;
    }
    if (!confirm("この端末の内容で共有データを上書きしますか？")) return;

    setSyncStatus("共有データへ保存しています...", "");
    try {
      if (isGoogleScriptUrl(url)) {
        await postViaForm(url, syncPayload());
      } else {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8" },
          body: JSON.stringify(syncPayload()),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      setSyncStatus(`共有へ保存しました: ${data.scenarios.length}件`, "ok");
    } catch (error) {
      setSyncStatus("共有への保存に失敗しました。同期URL、Drive側の公開設定、またはPC同期サーバーを確認してください。", "error");
    }
  }

  async function getJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function getJsonp(url) {
    return new Promise((resolve, reject) => {
      const callbackName = `__emergencyMedsSync${Date.now()}${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const src = new URL(url);
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("JSONP timeout"));
      }, 20000);

      function cleanup() {
        window.clearTimeout(timeout);
        delete window[callbackName];
        script.remove();
      }

      window[callbackName] = (payload) => {
        cleanup();
        resolve(payload);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP failed"));
      };
      src.searchParams.set("callback", callbackName);
      src.searchParams.set("_", Date.now().toString());
      script.src = src.href;
      document.body.append(script);
    });
  }

  function postViaForm(url, payload) {
    return new Promise((resolve, reject) => {
      const id = `syncFrame${Date.now()}${Math.random().toString(36).slice(2)}`;
      const iframe = document.createElement("iframe");
      const form = document.createElement("form");
      const input = document.createElement("textarea");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Form post timeout"));
      }, 20000);
      let submitted = false;

      function cleanup() {
        window.clearTimeout(timeout);
        form.remove();
        iframe.remove();
      }

      iframe.name = id;
      iframe.hidden = true;
      iframe.addEventListener("load", () => {
        if (!submitted) return;
        cleanup();
        resolve();
      });

      form.method = "POST";
      form.action = url;
      form.target = id;
      form.hidden = true;

      input.name = "payload";
      input.value = JSON.stringify(payload);
      form.append(input);

      document.body.append(iframe, form);
      submitted = true;
      form.submit();
    });
  }

  function isGoogleScriptUrl(url) {
    try {
      const host = new URL(url).hostname;
      return host.endsWith("script.google.com") || host.endsWith("googleusercontent.com");
    } catch (error) {
      return false;
    }
  }

  function syncPayload() {
    return {
      app: "emergency-meds-personal",
      updatedAt: new Date().toISOString(),
      categories: data.categories,
      scenarios: data.scenarios,
    };
  }

  function defaultSyncUrl() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      return new URL("./api/sync", location.href).href;
    }
    return "";
  }

  function currentSyncUrl() {
    const value = els.syncUrl.value.trim();
    prefs.syncUrl = value;
    savePrefs();
    return value || defaultSyncUrl();
  }

  function setSyncStatus(message, type) {
    els.syncStatus.textContent = message;
    els.syncStatus.classList.toggle("ok", type === "ok");
    els.syncStatus.classList.toggle("error", type === "error");
  }

  function openEditor(index) {
    ui.editingIndex = index;
    const scenario = index === null
      ? {
          category: ui.activeCategory !== "all" ? ui.activeCategory : data.categories[0] || "",
          scenario: "",
          goal: "",
          point: "",
          drugs: [blankDrug()],
        }
      : clone(data.scenarios[index]);

    els.dialogTitle.textContent = index === null ? "新規状況" : scenario.scenario;
    els.categoryField.value = scenario.category || "";
    els.scenarioField.value = scenario.scenario || "";
    els.goalField.value = scenario.goal || "";
    els.pointField.value = scenario.point || "";
    els.deleteScenario.hidden = index === null;
    ui.draftDrugs = clone(scenario.drugs && scenario.drugs.length ? scenario.drugs : [blankDrug()]);
    renderDrugEditor();

    els.body.classList.add("dialog-open");
    if (typeof els.dialog.showModal === "function") {
      els.dialog.showModal();
    } else {
      els.dialog.setAttribute("open", "");
    }
  }

  function closeEditor() {
    if (els.dialog.open) els.dialog.close();
    els.body.classList.remove("dialog-open");
    ui.editingIndex = null;
    ui.draftDrugs = [];
  }

  function renderDrugEditor() {
    els.drugEditor.innerHTML = ui.draftDrugs.map((drug, index) => drugEditHTML(drug, index)).join("");
    els.drugEditor.querySelectorAll("[data-drug-action]").forEach((button) => {
      button.addEventListener("click", () => {
        syncDraftFromEditor();
        const index = Number(button.dataset.index);
        const action = button.dataset.drugAction;
        if (action === "delete") {
          ui.draftDrugs.splice(index, 1);
          if (ui.draftDrugs.length === 0) ui.draftDrugs.push(blankDrug());
        }
        if (action === "up" && index > 0) {
          [ui.draftDrugs[index - 1], ui.draftDrugs[index]] = [ui.draftDrugs[index], ui.draftDrugs[index - 1]];
        }
        if (action === "down" && index < ui.draftDrugs.length - 1) {
          [ui.draftDrugs[index + 1], ui.draftDrugs[index]] = [ui.draftDrugs[index], ui.draftDrugs[index + 1]];
        }
        renderDrugEditor();
      });
    });
  }

  function drugEditHTML(drug, index) {
    const title = drug.name || `薬剤 ${index + 1}`;
    return `
      <details class="drug-edit" open data-drug-index="${index}">
        <summary>${escapeHTML(title)} <span>${index + 1}</span></summary>
        <div class="drug-edit-body">
          ${inputField(index, "name", "薬剤名・手順名", drug.name, true)}
          ${inputField(index, "brand", "商品名", drug.brand)}
          ${inputField(index, "tag", "タグ（複数はカンマ区切り）", formatTags(drug.tag))}
          ${inputField(index, "startLabel", "初期投与ラベル", drug.startLabel)}
          ${textField(index, "prep", "希釈・準備", drug.prep)}
          ${textField(index, "start", "初期投与", drug.start)}
          ${textField(index, "titrate", "調整・漸増", drug.titrate)}
          ${textField(index, "note", "補足・適応", drug.note)}
          ${textField(index, "warn", "注意", drug.warn)}
          ${textField(index, "tip", "コツ", drug.tip)}
          ${inputField(index, "calcConc", "計算: 濃度 µg/mL", drug.calc?.conc)}
          ${inputField(index, "calcDoses", "計算: γ一覧", drug.calc?.doses?.join(", "))}
          ${inputField(index, "calcStart", "計算: 開始γ", drug.calc?.start)}
          ${inputField(index, "calcPeripheralMax", "計算: 末梢上限γ", drug.calc?.peripheralMax)}
          <div class="drug-actions">
            <button class="tool-button" type="button" data-drug-action="up" data-index="${index}">↑</button>
            <button class="tool-button" type="button" data-drug-action="down" data-index="${index}">↓</button>
            <button class="tool-button" type="button" data-drug-action="delete" data-index="${index}">削除</button>
          </div>
        </div>
      </details>
    `;
  }

  function inputField(index, key, label, value = "", required = false) {
    return `
      <label>
        <span>${escapeHTML(label)}</span>
        <input data-field="${key}" data-index="${index}" value="${escapeHTML(value ?? "")}" ${required ? "required" : ""}>
      </label>
    `;
  }

  function textField(index, key, label, value = "") {
    return `
      <label class="wide">
        <span>${escapeHTML(label)}</span>
        <textarea data-field="${key}" data-index="${index}" rows="3">${escapeHTML(value ?? "")}</textarea>
      </label>
    `;
  }

  function syncDraftFromEditor() {
    ui.draftDrugs = readDrugEditor();
  }

  function readDrugEditor() {
    return Array.from(els.drugEditor.querySelectorAll(".drug-edit")).map((panel) => {
      const get = (key) => panel.querySelector(`[data-field="${key}"]`)?.value.trim() || "";
      const drug = cleanObject({
        name: get("name"),
        brand: get("brand"),
        tag: parseTags(get("tag")),
        startLabel: get("startLabel"),
        prep: get("prep"),
        start: get("start"),
        titrate: get("titrate"),
        note: get("note"),
        warn: get("warn"),
        tip: get("tip"),
      });

      const conc = numberOrNull(get("calcConc"));
      const doses = parseNumberList(get("calcDoses"));
      if (conc && doses.length) {
        drug.calc = cleanObject({
          conc,
          doses,
          start: numberOrNull(get("calcStart")),
          peripheralMax: numberOrNull(get("calcPeripheralMax")),
        });
      }

      if (!drug.name) drug.name = "名称未設定";
      return drug;
    });
  }

  function saveScenarioFromForm() {
    syncDraftFromEditor();
    const scenario = cleanObject({
      category: els.categoryField.value.trim(),
      scenario: els.scenarioField.value.trim(),
      goal: els.goalField.value.trim(),
      point: els.pointField.value.trim(),
      drugs: ui.draftDrugs.filter((drug) => drug.name || drug.start || drug.note),
    });

    if (!scenario.category || !scenario.scenario) return;
    if (!scenario.drugs || scenario.drugs.length === 0) scenario.drugs = [blankDrug()];
    if (!data.categories.includes(scenario.category)) data.categories.push(scenario.category);

    if (ui.editingIndex === null) {
      data.scenarios.push(scenario);
    } else {
      data.scenarios[ui.editingIndex] = scenario;
    }

    saveData();
    closeEditor();
    render();
  }

  function duplicateScenario(index) {
    const copy = clone(data.scenarios[index]);
    copy.scenario = `${copy.scenario} のコピー`;
    data.scenarios.splice(index + 1, 0, copy);
    saveData();
    render();
  }

  function deleteScenario(index) {
    const target = data.scenarios[index];
    if (!confirm(`「${target.scenario}」を削除しますか？`)) return;
    data.scenarios.splice(index, 1);
    saveData();
    render();
  }

  function resetToDefault() {
    if (!confirm("現在の編集内容を初期データで置き換えますか？必要なら先にJSONを書き出してください。")) return;
    data = normalizeData(DEFAULT_DATA);
    saveData();
    ui.activeCategory = "all";
    ui.query = "";
    els.search.value = "";
    render();
  }

  function exportData() {
    const payload = {
      app: "emergency-meds-personal",
      exportedAt: new Date().toISOString(),
      categories: data.categories,
      scenarios: data.scenarios,
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emergency-meds-${dateStamp()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importData() {
    const file = els.importFile.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeData(JSON.parse(String(reader.result)));
        if (!imported.scenarios.length) throw new Error("No scenarios");
        if (!confirm(`${imported.scenarios.length}件のメニューで現在の内容を置き換えますか？`)) return;
        data = imported;
        saveData();
        ui.activeCategory = "all";
        ui.query = "";
        els.search.value = "";
        render();
      } catch (error) {
        alert("JSONを読み込めませんでした。形式を確認してください。");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function saveData() {
    data = normalizeData(data);
    saveJSON(STORAGE_KEY, data);
    els.saveState.textContent = `保存済み ${timeStamp()}`;
    updateStorageText();
  }

  function savePrefs() {
    saveJSON(PREF_KEY, prefs);
  }

  function updateStorageText() {
    const hasLocal = Boolean(loadJSON(STORAGE_KEY));
    els.storage.textContent = hasLocal ? "端末内データ" : "初期データ";
  }

  function normalizeData(input) {
    const source = input?.data || input || {};
    const scenarios = Array.isArray(source.scenarios)
      ? source.scenarios.map(normalizeScenario).filter((scenario) => scenario.scenario)
      : [];
    const categories = unique([
      ...(Array.isArray(source.categories) ? source.categories : []),
      ...scenarios.map((scenario) => scenario.category),
    ].map((item) => String(item || "").trim()).filter(Boolean));
    return { categories, scenarios };
  }

  function normalizeScenario(scenario) {
    return cleanObject({
      category: String(scenario.category || "未分類").trim(),
      scenario: String(scenario.scenario || "").trim(),
      goal: String(scenario.goal || "").trim(),
      point: String(scenario.point || "").trim(),
      drugs: Array.isArray(scenario.drugs) ? scenario.drugs.map(normalizeDrug) : [],
    });
  }

  function normalizeDrug(drug) {
    const normalized = cleanObject({
      name: String(drug.name || "").trim(),
      brand: String(drug.brand || "").trim(),
      tag: normalizeTag(drug.tag),
      prep: String(drug.prep || "").trim(),
      start: String(drug.start || "").trim(),
      startLabel: String(drug.startLabel || "").trim(),
      titrate: String(drug.titrate || "").trim(),
      note: String(drug.note || "").trim(),
      warn: String(drug.warn || "").trim(),
      tip: String(drug.tip || "").trim(),
    });

    if (drug.calc && typeof drug.calc === "object") {
      const conc = numberOrNull(drug.calc.conc);
      const doses = Array.isArray(drug.calc.doses)
        ? drug.calc.doses.map(numberOrNull).filter((value) => value !== null)
        : [];
      if (conc && doses.length) {
        normalized.calc = cleanObject({
          conc,
          doses,
          start: numberOrNull(drug.calc.start),
          peripheralMax: numberOrNull(drug.calc.peripheralMax),
        });
      }
    }

    return normalized;
  }

  function normalizeTag(tag) {
    if (Array.isArray(tag)) return tag.map((item) => String(item).trim()).filter(Boolean);
    if (!tag) return "";
    return String(tag).trim();
  }

  function parseTags(value) {
    if (!value) return "";
    const tags = value.split(/[,\u3001]/).map((item) => item.trim()).filter(Boolean);
    if (tags.length === 0) return "";
    return tags.length === 1 ? tags[0] : tags;
  }

  function parseNumberList(value) {
    return String(value || "")
      .split(/[,\u3001\s]+/)
      .map(numberOrNull)
      .filter((item) => item !== null);
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function blankDrug() {
    return { name: "", prep: "", start: "", note: "" };
  }

  function cleanObject(object) {
    const result = {};
    for (const [key, value] of Object.entries(object)) {
      if (value === "" || value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      result[key] = value;
    }
    return result;
  }

  function searchText(scenario) {
    return JSON.stringify(scenario).toLowerCase();
  }

  function categoryColor(category) {
    if (categoryPalette[category]) return categoryPalette[category];
    let hash = 0;
    for (const char of String(category)) hash = ((hash << 5) - hash) + char.charCodeAt(0);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 58% 48%)`;
  }

  function safeWeight(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 50;
    return Math.min(300, Math.max(1, Math.round(number * 10) / 10));
  }

  function formatDose(value) {
    return Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 3 });
  }

  function formatRate(value) {
    return Number(value).toLocaleString("ja-JP", { minimumFractionDigits: value < 10 ? 1 : 0, maximumFractionDigits: 1 });
  }

  function formatTags(tag) {
    if (Array.isArray(tag)) return tag.join(", ");
    return tag || "";
  }

  function nl2br(value) {
    return escapeHTML(value).replace(/\n/g, "<br>");
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char]));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function loadJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      alert("ブラウザの保存領域に書き込めませんでした。JSONを書き出してバックアップしてください。");
    }
  }

  function applyTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    prefs.theme = next;
    document.documentElement.dataset.theme = next;
    els.theme.textContent = next === "dark" ? "◐" : "●";
  }

  function dateStamp() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  }

  function timeStamp() {
    return new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
})();
