(() => {
  const HOST_ID = "google-selection-translator-host";
  const MAX_SELECTION_LENGTH = 50000;
  const DEFAULT_PANEL_WIDTH = 390;
  const DEFAULT_PANEL_HEIGHT = 320;
  const MIN_PANEL_WIDTH = 300;
  const MIN_PANEL_HEIGHT = 220;
  const VIEWPORT_MARGIN = 8;
  const SELECTION_CHECK_DELAY = 80;
  const VALID_TRANSLATION_PROVIDERS = ["google", "deepseek", "deepl"];
  const DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS = 10000;
  const DEEPL_TRANSLATION_MESSAGE_TIMEOUT_MS = 35000;

  if (document.getElementById(HOST_ID)) return;

  let selectedText = "";
  let selectionAnchorRect = null;
  let lastMouseUpPoint = null;
  let selectionTimer = null;
  let requestSerial = 0;
  let selectionRouteSerial = 0;
  let translatedResults = [];
  let panelProviderOrder = ["google"];
  let extensionEnabled = false;
  let deepseekApiConfigured = false;
  let panelPinned = false;
  let savedPanelState = null;
  let interaction = null;
  let panelVerticallyMaximized = false;
  let panelRestoreState = null;
  let panelSourceEditTimer = null;
  const panelRetryTokens = new Map();
  let panelProviderChangeRevision = 0;

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "0",
    height: "0",
    zIndex: "2147483647",
    pointerEvents: "none"
  });
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      button, select, input, textarea { font: inherit; }

      #translate-button {
        position: fixed;
        display: none;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 1px solid rgba(255, 255, 255, 0.95);
        border-radius: 50%;
        color: #fff;
        background: linear-gradient(145deg, #4285f4, #1a73e8);
        box-shadow: 0 4px 14px rgba(32, 33, 36, 0.34);
        font: 700 17px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        cursor: pointer;
        pointer-events: auto;
        user-select: none;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      #translate-button:hover {
        transform: translateY(-1px) scale(1.06);
        box-shadow: 0 6px 18px rgba(32, 33, 36, 0.4);
      }
      #translate-button:active { transform: scale(0.95); }
      #translate-button[aria-busy="true"] { cursor: wait; opacity: 0.78; }

      #translation-panel {
        position: fixed;
        display: none;
        flex-direction: column;
        width: ${DEFAULT_PANEL_WIDTH}px;
        height: ${DEFAULT_PANEL_HEIGHT}px;
        min-width: ${MIN_PANEL_WIDTH}px;
        min-height: ${MIN_PANEL_HEIGHT}px;
        border: 1px solid rgba(60, 64, 67, 0.25);
        border-radius: 12px;
        color: #202124;
        background: #fff;
        box-shadow: 0 12px 38px rgba(60, 64, 67, 0.34);
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
        pointer-events: auto;
        overflow: hidden;
      }
      #translation-panel.is-pinned {
        border-color: #1a73e8;
        box-shadow: 0 12px 38px rgba(26, 115, 232, 0.25);
      }

      #panel-header {
        display: flex;
        flex: 0 0 auto;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        height: 43px;
        padding: 7px 8px 7px 12px;
        border-bottom: 1px solid #e8eaed;
        background: #f8fafd;
        cursor: move;
        user-select: none;
        touch-action: none;
      }
      .panel-title-wrap {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 8px;
      }
      .panel-mark {
        display: grid;
        flex: 0 0 auto;
        place-items: center;
        width: 27px;
        height: 27px;
        border-radius: 8px;
        color: #fff;
        background: #1a73e8;
        font-weight: 750;
      }
      .panel-title {
        overflow: hidden;
        font-weight: 650;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .panel-controls { display: flex; gap: 4px; }
      .header-button {
        height: 28px;
        padding: 0 8px;
        border: 0;
        border-radius: 7px;
        color: #5f6368;
        background: transparent;
        cursor: pointer;
      }
      .header-button:hover { background: #e8f0fe; color: #1a73e8; }
      #panel-vertical-max {
        width: 30px;
        padding: 0;
        font-size: 17px;
        line-height: 1;
      }
      #panel-vertical-max.is-active {
        color: #1a73e8;
        background: #dbe8fd;
      }
      #panel-close {
        width: 28px;
        padding: 0;
        font-size: 20px;
        line-height: 1;
      }

      #panel-body {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        flex-direction: column;
        overflow: auto;
      }
      .panel-section { padding: 10px 12px; }
      #source-section {
        flex: 0 0 96px;
        min-height: 58px;
        overflow: hidden;
      }
      #section-splitter {
        position: relative;
        flex: 0 0 9px;
        border-top: 1px solid #edf0f4;
        border-bottom: 1px solid #edf0f4;
        background: #f8fafd;
        cursor: ns-resize;
        touch-action: none;
        user-select: none;
      }
      #section-splitter::after {
        content: "";
        position: absolute;
        left: 50%;
        top: 3px;
        width: 42px;
        height: 3px;
        border-radius: 3px;
        background: #bdc1c6;
        transform: translateX(-50%);
      }
      #section-splitter:hover,
      #section-splitter.is-dragging { background: #e8f0fe; }
      #section-splitter:hover::after,
      #section-splitter.is-dragging::after { background: #1a73e8; }
      .panel-section.result-section { flex: 1 1 auto; min-height: 76px; }
      .section-row,
      .source-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 5px;
      }
      .panel-label { color: #5f6368; font-size: 12px; font-weight: 650; }
      .source-count {
        color: #9aa0a6;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        user-select: none;
      }
      #panel-language {
        max-width: 160px;
        padding: 4px 24px 4px 7px;
        border: 1px solid #dadce0;
        border-radius: 7px;
        outline: 0;
        color: #202124;
        background: #fff;
        font-size: 12px;
      }
      #panel-source {
        display: block;
        width: 100%;
        height: calc(100% - 23px);
        min-height: 24px;
        margin: 0;
        padding: 3px 5px;
        resize: none;
        border: 1px solid transparent;
        border-radius: 6px;
        outline: 0;
        color: #5f6368;
        background: transparent;
        line-height: 1.5;
        overflow: auto;
        overflow-wrap: anywhere;
      }
      #panel-source:hover { border-color: #dadce0; }
      #panel-source:focus {
        border-color: #1a73e8;
        background: #fff;
        box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.15);
      }
      .panel-provider-picker {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 7px 12px;
        margin: 2px 0 9px;
      }
      .provider-option {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #3c4043;
        font-size: 12px;
        cursor: pointer;
        user-select: none;
      }
      .provider-option input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      .provider-check {
        display: grid;
        width: 18px;
        height: 18px;
        place-items: center;
        border: 1px solid #9aa0a6;
        border-radius: 5px;
        color: transparent;
        background: #fff;
        font-size: 13px;
        font-weight: 800;
        line-height: 1;
      }
      .provider-check::after {
        content: "";
        width: 5px;
        height: 9px;
        border: solid transparent;
        border-width: 0 2px 2px 0;
        transform: translateY(-1px) rotate(45deg) scale(0);
        transform-origin: center;
      }
      .provider-option input:checked + .provider-check {
        border-color: #1a73e8;
        background: #1a73e8;
      }
      .provider-option input:checked + .provider-check::after {
        border-color: #fff;
        transform: translateY(-1px) rotate(45deg) scale(1);
      }
      .provider-option input:focus-visible + .provider-check {
        outline: 2px solid #aecbfa;
        outline-offset: 2px;
      }
      #panel-provider-notice {
        margin: 0 0 8px;
        padding: 7px 9px;
        border: 1px solid #f6aea8;
        border-radius: 8px;
        color: #b3261e;
        background: #fce8e6;
        font-size: 12px;
      }
      #panel-provider-notice[hidden] { display: none; }
      #panel-results {
        display: flex;
        min-height: 26px;
        flex-direction: column;
        gap: 9px;
      }
      .provider-result-card {
        overflow: hidden;
        border: 1px solid #dadce0;
        border-radius: 10px;
        background: #fff;
      }
      .provider-result-card.deepseek { border-color: #c9c2ff; }
      .provider-result-card.deepl { border-color: #a8dac7; }
      .provider-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 9px;
        border-bottom: 1px solid #edf0f4;
        background: #f8fafd;
        font-size: 12px;
      }
      .provider-card-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
      .provider-card-badge {
        display: grid;
        width: 20px;
        height: 20px;
        place-items: center;
        border-radius: 6px;
        color: #fff;
        background: #1a73e8;
        font-size: 11px;
        font-weight: 800;
      }
      .provider-result-card.deepseek .provider-card-badge { background: #6554c0; }
      .provider-result-card.deepl .provider-card-badge { background: #0f9d70; }
      .provider-card-state { color: #5f6368; }
      .provider-card-state.error { color: #b3261e; }
      .provider-card-status-group { display: inline-flex; align-items: center; gap: 5px; }
      .provider-card-retry {
        display: grid;
        width: 23px;
        height: 23px;
        padding: 0;
        place-items: center;
        border: 1px solid #b8c2d1;
        border-radius: 7px;
        color: #1769aa;
        background: #e8f4ff;
        font-size: 17px;
        line-height: 1;
        cursor: pointer;
      }
      .provider-card-retry:hover { color: #fff; border-color: #1a73e8; background: #1a73e8; }
      .provider-card-body {
        min-height: 42px;
        padding: 9px 10px 10px;
        color: #202124;
        font-size: 15px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .provider-card-body.loading { color: #5f6368; font-size: 13px; }
      .provider-card-body.error { color: #b3261e; font-size: 13px; }
      .panel-result-placeholder { color: #5f6368; font-size: 13px; }

      #panel-actions {
        display: flex;
        flex: 0 0 auto;
        gap: 8px;
        padding: 9px 12px 11px;
        border-top: 1px solid #e8eaed;
      }
      .action-button {
        padding: 6px 10px;
        border: 1px solid #dadce0;
        border-radius: 8px;
        color: #1a73e8;
        background: #fff;
        cursor: pointer;
      }
      .action-button:hover:not(:disabled) { background: #f1f6fe; }
      .action-button:disabled { cursor: default; opacity: 0.5; }

      .resize-handle {
        position: absolute;
        z-index: 5;
        touch-action: none;
      }
      .resize-handle[data-dir="n"] { top: -4px; left: 12px; right: 12px; height: 8px; cursor: ns-resize; }
      .resize-handle[data-dir="s"] { bottom: -4px; left: 12px; right: 12px; height: 8px; cursor: ns-resize; }
      .resize-handle[data-dir="e"] { right: -4px; top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }
      .resize-handle[data-dir="w"] { left: -4px; top: 12px; bottom: 12px; width: 8px; cursor: ew-resize; }
      .resize-handle[data-dir="ne"] { top: -5px; right: -5px; width: 14px; height: 14px; cursor: nesw-resize; }
      .resize-handle[data-dir="nw"] { top: -5px; left: -5px; width: 14px; height: 14px; cursor: nwse-resize; }
      .resize-handle[data-dir="se"] { bottom: -5px; right: -5px; width: 14px; height: 14px; cursor: nwse-resize; }
      .resize-handle[data-dir="sw"] { bottom: -5px; left: -5px; width: 14px; height: 14px; cursor: nesw-resize; }

      @media (prefers-color-scheme: dark) {
        #translation-panel { color: #e8eaed; background: #202124; border-color: #5f6368; }
        #panel-header { background: #292a2d; border-bottom-color: #3c4043; }
        .header-button { color: #bdc1c6; }
        .header-button:hover { color: #8ab4f8; background: #303134; }
        #panel-actions { border-color: #3c4043; }
        #section-splitter { border-color: #3c4043; background: #292a2d; }
        #section-splitter:hover,
        #section-splitter.is-dragging { background: #303134; }
        .panel-label, .source-count, #panel-source, .provider-option { color: #bdc1c6; }
        #panel-source:hover { border-color: #5f6368; }
        #panel-source:focus {
          border-color: #8ab4f8;
          background: #303134;
          box-shadow: 0 0 0 2px rgba(138, 180, 248, 0.18);
        }
        .provider-check { border-color: #7f8388; background: #292a2d; }
        #panel-provider-notice { color: #f6aea8; background: #4a2421; border-color: #8c4a45; }
        .provider-result-card { background: #202124; border-color: #5f6368; }
        .provider-result-card.deepseek { border-color: #7568b8; }
        .provider-result-card.deepl { border-color: #438d71; }
        .provider-card-header { background: #292a2d; border-color: #3c4043; }
        .provider-card-body { color: #e8eaed; }
        .provider-card-body.loading, .panel-result-placeholder { color: #bdc1c6; }
        #panel-language, .action-button { color: #e8eaed; background: #292a2d; border-color: #5f6368; }
        .action-button { color: #8ab4f8; }
        .action-button:hover:not(:disabled) { background: #303134; }
      }
    </style>

    <button id="translate-button" type="button" title="使用谷歌翻译" aria-label="使用谷歌翻译">译</button>

    <section id="translation-panel" role="dialog" aria-label="谷歌翻译结果">
      <div class="resize-handle" data-dir="n"></div>
      <div class="resize-handle" data-dir="s"></div>
      <div class="resize-handle" data-dir="e"></div>
      <div class="resize-handle" data-dir="w"></div>
      <div class="resize-handle" data-dir="ne"></div>
      <div class="resize-handle" data-dir="nw"></div>
      <div class="resize-handle" data-dir="se"></div>
      <div class="resize-handle" data-dir="sw"></div>

      <header id="panel-header">
        <div class="panel-title-wrap">
          <span class="panel-mark">译</span>
          <span class="panel-title">宏译</span>
        </div>
        <div class="panel-controls">
          <button id="panel-vertical-max" class="header-button" type="button" title="&#32437;&#21521;&#26368;&#22823;&#21270;" aria-label="&#32437;&#21521;&#26368;&#22823;&#21270;" aria-pressed="false">&#8597;</button>
          <button id="panel-pin" class="header-button" type="button" title="固定窗口位置">固定</button>
          <button id="panel-close" class="header-button" type="button" title="关闭" aria-label="关闭">×</button>
        </div>
      </header>

      <div id="panel-body">
        <section id="source-section" class="panel-section">
          <div class="source-heading">
            <div class="panel-label">原文</div>
            <span id="panel-source-count" class="source-count" aria-label="原文统计">0</span>
          </div>
          <textarea id="panel-source" maxlength="50000" spellcheck="false" aria-label="Source text, editable"></textarea>
        </section>
        <div id="section-splitter" title="上下拖动调整原文和译文区域高度" aria-label="调整原文和译文区域高度"></div>
        <section id="result-section" class="panel-section result-section">
          <div class="section-row">
            <span class="panel-label">译文</span>
            <select id="panel-language" title="目标语言">
              <option value="zh-CN">简体中文</option>
              <option value="smart">智能中英互译</option>
              <option value="zh-TW">繁体中文</option>
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
              <option value="es">西班牙语</option>
              <option value="ru">俄语</option>
            </select>
          </div>
          <div class="panel-provider-picker" role="group" aria-label="\u7ffb\u8bd1\u6765\u6e90\uff0c\u53ef\u591a\u9009">
            <label class="provider-option">
              <input id="panel-provider-google" type="checkbox" value="google" checked>
              <span class="provider-check" aria-hidden="true"></span>
              <span>\u8c37\u6b4c\u7ffb\u8bd1</span>
            </label>
            <label class="provider-option">
              <input id="panel-provider-deepseek" type="checkbox" value="deepseek">
              <span class="provider-check" aria-hidden="true"></span>
              <span>DeepSeek</span>
            </label>
            <label class="provider-option">
              <input id="panel-provider-deepl" type="checkbox" value="deepl">
              <span class="provider-check" aria-hidden="true"></span>
              <span>DeepL</span>
            </label>
          </div>
          <div id="panel-provider-notice" role="alert" hidden></div>
          <div id="panel-results" aria-live="polite"></div>
        </section>
      </div>

      <footer id="panel-actions">
        <button id="panel-copy" class="action-button" type="button" disabled>复制译文</button>
        <button id="panel-open" class="action-button" type="button">谷歌翻译</button>
        <button id="panel-open-deepseek" class="action-button" type="button">DeepSeek</button>
        <button id="panel-open-deepl" class="action-button" type="button">DeepL</button>
      </footer>
    </section>
  `;

  const button = shadow.getElementById("translate-button");
  const panel = shadow.getElementById("translation-panel");
  const panelHeader = shadow.getElementById("panel-header");
  const panelBody = shadow.getElementById("panel-body");
  const sourceSection = shadow.getElementById("source-section");
  const sectionSplitter = shadow.getElementById("section-splitter");
  const panelVerticalMax = shadow.getElementById("panel-vertical-max");
  const panelPin = shadow.getElementById("panel-pin");
  const panelClose = shadow.getElementById("panel-close");
  const panelSource = shadow.getElementById("panel-source");
  const panelSourceCount = shadow.getElementById("panel-source-count");
  const panelResults = shadow.getElementById("panel-results");
  const panelProviderNotice = shadow.getElementById("panel-provider-notice");
  const panelProviderGoogle = shadow.getElementById("panel-provider-google");
  const panelProviderDeepSeek = shadow.getElementById("panel-provider-deepseek");
  const panelProviderDeepL = shadow.getElementById("panel-provider-deepl");
  const panelLanguage = shadow.getElementById("panel-language");
  const panelCopy = shadow.getElementById("panel-copy");
  const panelOpen = shadow.getElementById("panel-open");
  const panelOpenDeepSeek = shadow.getElementById("panel-open-deepseek");
  const panelOpenDeepL = shadow.getElementById("panel-open-deepl");
  const resizeHandles = [...shadow.querySelectorAll(".resize-handle")];

  loadSavedState();
  chrome.storage.onChanged.addListener(handleStorageChanges);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "CLOSE_FLOATING_PANEL") {
      // Only translation panels are mutually exclusive; selection buttons may remain visible.
      hidePanel();
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type !== "GET_CURRENT_SELECTION") return false;

    const data = extensionEnabled ? readSelection() : { text: "" };
    sendResponse({
      ok: true,
      text: data.text || ""
    });
    return false;
  });

  document.addEventListener("mouseup", (event) => {
    if (event.composedPath().includes(host)) return;
    lastMouseUpPoint = { x: event.clientX, y: event.clientY };
    scheduleSelectionCheck(lastMouseUpPoint);
  }, true);

  // Some article readers and embedded document viewers update the browser
  // selection just after mouseup. Listening for selectionchange as well avoids
  // missing the blue button when that delayed update occurs, and also supports
  // keyboard selection.
  document.addEventListener("selectionchange", () => {
    scheduleSelectionCheck(null);
  }, true);

  document.addEventListener("keyup", (event) => {
    if (event.key.startsWith("Arrow") || event.key === "Shift" || event.shiftKey) {
      scheduleSelectionCheck(null);
    }
  }, true);

  document.addEventListener("mousedown", (event) => {
    if (event.composedPath().includes(host)) return;
    hideButton();
  }, true);

  window.addEventListener("resize", () => {
    hideButton();
    if (getComputedStyle(panel).display === "none") return;
    if (panelVerticallyMaximized) {
      applyPanelVerticalMaximize();
    } else {
      keepPanelInsideViewport();
    }
  }, true);

  button.addEventListener("mousedown", preserveSelection);
  button.addEventListener("pointerdown", preserveSelection);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!extensionEnabled) {
      hideButton();
      return;
    }

    const text = selectedText;
    const anchorRect = selectionAnchorRect;
    if (!text) return;

    button.setAttribute("aria-busy", "true");
    hideButton();

    // Show the page panel before asking the background to close other translator windows.
    // A stale content script can display a refresh-page error instead of appearing unresponsive.
    setPanelSourceValue(text);
    panelCopy.disabled = true;
    showPanel(anchorRect);
    showPanelNotice("\u6b63\u5728\u51c6\u5907\u7ffb\u8bd1\u2026");

    try {
      const activation = await sendMessage({ type: "ACTIVATE_PAGE_TRANSLATOR" });
      if (!activation?.ok) throw new Error(activation?.error || "\u65e0\u6cd5\u5173\u95ed\u5de5\u5177\u680f\u7ffb\u8bd1\u7a97\u53e3\u3002");
      clearPanelNotice();
      await translateInPanel(text, anchorRect, true);
    } catch (error) {
      showPanelError(friendlyError(error));
    } finally {
      button.removeAttribute("aria-busy");
    }
  });

  panelClose.addEventListener("click", hidePanel);
  panelVerticalMax.addEventListener("click", togglePanelVerticalMaximize);

  panelPin.addEventListener("click", async () => {
    panelPinned = !panelPinned;
    updatePinnedUI();
    await persistPanelState();
  });

  panelLanguage.addEventListener("change", async () => {
    await chrome.storage.local.set({ targetLanguage: panelLanguage.value });
    if (panelSource.value.trim()) {
      translateInPanel(panelSource.value.trim(), selectionAnchorRect, true);
    }
  });

  panelSource.addEventListener("input", () => {
    updatePanelSourceCount();
    schedulePanelSourceTranslation();
  });

  panelSource.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      schedulePanelSourceTranslation(true);
    }
  });

  panelProviderGoogle.addEventListener("change", handlePanelProviderChange);
  panelProviderDeepSeek.addEventListener("change", handlePanelProviderChange);
  panelProviderDeepL.addEventListener("change", handlePanelProviderChange);

  panelCopy.addEventListener("click", async () => {
    const selectedProviders = new Set(getPanelSelectedProviders());
    const successful = orderPanelResultRecords(translatedResults)
      .filter((record) => selectedProviders.has(record.provider) && record.ok && record.translatedText);
    if (!successful.length) return;

    const copyText = successful.length === 1
      ? successful[0].translatedText
      : successful.map((record) => `${record.label || getProviderLabel(record.provider)}\n${record.translatedText}`).join("\n\n");
    try {
      const response = await sendMessage({
        type: "WRITE_CLIPBOARD",
        text: copyText
      });
      if (!response?.ok) {
        throw new Error(response?.error || "\u590d\u5236\u5931\u8d25\u3002");
      }

      const oldText = panelCopy.textContent;
      panelCopy.textContent = "\u5df2\u590d\u5236";
      setTimeout(() => { panelCopy.textContent = oldText; }, 1200);
    } catch {
      panelCopy.textContent = "\u590d\u5236\u5931\u8d25";
    }
  });

  panelOpen.addEventListener("click", async () => {
    try {
      await sendMessage({
        type: "OPEN_GOOGLE_TRANSLATE",
        text: panelSource.value || selectedText,
        sourceLanguage: "auto",
        targetLanguage: panelLanguage.value
      });
    } catch (error) {
      showPanelError(friendlyError(error));
    }
  });

  panelOpenDeepSeek.addEventListener("click", async () => {
    try {
      const response = await sendMessage({ type: "OPEN_DEEPSEEK" });
      if (!response?.ok) throw new Error(response?.error || "无法打开 DeepSeek。");
    } catch (error) {
      showPanelError(friendlyError(error));
    }
  });

  panelOpenDeepL.addEventListener("click", async () => {
    try {
      const response = await sendMessage({
        type: "OPEN_DEEPL_TRANSLATE",
        text: panelSource.value.trim(),
        sourceLanguage: "auto",
        targetLanguage: panelLanguage.value
      });
      if (!response?.ok) throw new Error(response?.error || "\u65e0\u6cd5\u6253\u5f00 DeepL\u3002");
    } catch (error) {
      showPanelError(friendlyError(error));
    }
  });

  panelHeader.addEventListener("pointerdown", startDrag);
  sectionSplitter.addEventListener("pointerdown", startSectionSplit);
  resizeHandles.forEach((handle) => {
    handle.addEventListener("pointerdown", startResize);
  });
  window.addEventListener("pointermove", updateInteraction, true);
  window.addEventListener("pointerup", finishInteraction, true);
  window.addEventListener("pointercancel", finishInteraction, true);

  function preserveSelection(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function scheduleSelectionCheck(point) {
    clearTimeout(selectionTimer);
    if (!extensionEnabled) {
      hideButton();
      return;
    }
    // Waiting briefly lets sites that render selections asynchronously finish
    // updating window.getSelection() before we read it.
    selectionTimer = window.setTimeout(() => updateSelection(point), SELECTION_CHECK_DELAY);
  }

  async function updateSelection(mousePoint) {
    if (!extensionEnabled) {
      hideButton();
      return;
    }

    const data = readSelection();
    const routeId = ++selectionRouteSerial;
    if (!data.text || data.text.length > MAX_SELECTION_LENGTH) {
      hideButton();
      return;
    }

    selectedText = data.text;
    selectionAnchorRect = data.lastLineRect || data.rect;

    const panelIsOpen = getComputedStyle(panel).display !== "none";
    if (panelIsOpen) {
      hideButton();

      if (panelSource.value.trim() !== data.text) {
        translateInPanel(data.text, selectionAnchorRect, true);
      }
      return;
    }

    // If the independent toolbar translator window already exists, it owns the
    // translation experience. Send the newly selected text there and do not show
    // a second page popup. If no toolbar window exists, retain the original "?"
    // button flow.
    try {
      const response = await sendMessage({
        type: "ROUTE_SELECTION_TO_OPEN_TRANSLATOR",
        text: data.text
      }, 5000);
      if (!extensionEnabled || routeId !== selectionRouteSerial) return;
      if (response?.ok && response.routed) {
        // Keep the blue translation button available while the independent
        // toolbar window owns the current translation. Clicking it closes that
        // window before opening the page card, preserving single-window behavior.
        positionButton(mousePoint || lastMouseUpPoint, selectionAnchorRect);
        button.style.display = "flex";
        return;
      }
    } catch {
      // The extension may have just been reloaded; fall back to the page button.
    }

    if (!extensionEnabled || routeId !== selectionRouteSerial) return;
    positionButton(mousePoint || lastMouseUpPoint, selectionAnchorRect);
    button.style.display = "flex";
  }

  function readSelection() {
    const active = document.activeElement;

    if (
      active &&
      (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && isTextInput(active))) &&
      Number.isInteger(active.selectionStart) &&
      active.selectionStart !== active.selectionEnd
    ) {
      const text = active.value.slice(active.selectionStart, active.selectionEnd).trim();
      const rect = active.getBoundingClientRect();
      return { text, rect, lastLineRect: rect };
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return { text: "", rect: null, lastLineRect: null };
    }

    const text = selection.toString().trim();
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const lineRects = [...range.getClientRects()].filter((item) => item.width || item.height);
    const lastLineRect = lineRects.length ? lineRects[lineRects.length - 1] : rect;
    return { text, rect, lastLineRect };
  }

  function positionButton(point, rect) {
    const size = 36;
    const gap = 9;
    const origin = point || {
      x: rect ? rect.right : VIEWPORT_MARGIN,
      y: rect ? rect.bottom : VIEWPORT_MARGIN
    };

    let left = origin.x + gap;
    let top = origin.y + gap;

    if (left + size > window.innerWidth - VIEWPORT_MARGIN) {
      left = origin.x - size - gap;
    }
    if (top + size > window.innerHeight - VIEWPORT_MARGIN) {
      top = origin.y - size - gap;
    }

    button.style.left = `${clamp(left, VIEWPORT_MARGIN, window.innerWidth - size - VIEWPORT_MARGIN)}px`;
    button.style.top = `${clamp(top, VIEWPORT_MARGIN, window.innerHeight - size - VIEWPORT_MARGIN)}px`;
  }

  function countSourceUnits(value) {
    const text = String(value || "");
    const englishWords = text.match(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g) || [];
    const nonEnglishRemainder = text.replace(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g, "");
    return englishWords.length + Array.from(nonEnglishRemainder).filter((character) => !/\s/.test(character)).length;
  }

  function updatePanelSourceCount() {
    panelSourceCount.textContent = String(countSourceUnits(panelSource.value));
  }

  function setPanelSourceValue(value) {
    panelSource.value = String(value || "");
    updatePanelSourceCount();
  }

  updatePanelSourceCount();

  function schedulePanelSourceTranslation(immediate = false) {
    clearTimeout(panelSourceEditTimer);
    requestSerial += 1;

    const text = panelSource.value;
    if (!text.trim()) {
      translatedResults = [];
      panelCopy.disabled = true;
      clearPanelNotice();
      renderPanelResults([]);
      return;
    }

    translatedResults = [];
    panelCopy.disabled = true;
    renderPanelResults([]);
    showPanelNotice("\u539f\u6587\u5df2\u4fee\u6539\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1\u2026");

    const translateEditedSource = () => {
      panelSourceEditTimer = null;
      clearPanelNotice();
      void translateInPanel(text, selectionAnchorRect, true);
    };

    if (immediate) {
      translateEditedSource();
    } else {
      panelSourceEditTimer = window.setTimeout(translateEditedSource, 550);
    }
  }

async function translateInPanel(text, anchorRect, keepCurrentPosition = false) {
    if (!extensionEnabled) {
      hideButton();
      hidePanel();
      return;
    }

    const serial = ++requestSerial;
    translatedResults = [];
    setPanelSourceValue(text);
    panelCopy.disabled = true;

    if (!keepCurrentPosition) showPanel(anchorRect);

    try {
      const settings = await chrome.storage.local.get(["targetLanguage"]);
      panelLanguage.value = settings.targetLanguage || panelLanguage.value || "zh-CN";

      if (panelProviderDeepSeek.checked && !deepseekApiConfigured) {
        const apiStatus = await sendMessage({ type: "GET_DEEPSEEK_STATUS" });
        if (
          serial !== requestSerial
          || panelSource.value.trim() !== text
        ) return;
        deepseekApiConfigured = Boolean(apiStatus?.ok && apiStatus.configured);
        if (!deepseekApiConfigured) {
          panelProviderDeepSeek.checked = false;
          panelProviderOrder = panelProviderOrder.filter((provider) => provider !== "deepseek");
          showPanelNotice("DeepSeek API Key 不可用，DeepSeek 已取消勾选。");
        }
      }

      // The visible panel controls are authoritative while translating. Re-applying
      // a stored list here can restore the stale state from the preceding uncheck.
      const providers = getPanelSelectedProviders();
      const targetSnapshot = panelLanguage.value;
      let resolvedTargetLanguage = targetSnapshot;
      renderPanelLoading(providers);

      const tasks = providers.map(async (provider) => {
        let record;
        try {
          const response = await sendMessage({
            type: "TRANSLATE_MULTI",
            text,
            sourceLanguage: "auto",
            targetLanguage: targetSnapshot,
            providers: [provider]
          }, getTranslationMessageTimeout(provider));
          if (!response?.ok) throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25\u3002");
          resolvedTargetLanguage = response.targetLanguage || resolvedTargetLanguage;
          record = (response.results || []).find((item) => item.provider === provider) || {
            provider,
            label: getProviderLabel(provider),
            ok: false,
            error: "\u6ca1\u6709\u5f97\u5230\u7ffb\u8bd1\u7ed3\u679c\u3002"
          };
        } catch (error) {
          record = {
            provider,
            label: getProviderLabel(provider),
            ok: false,
            error: friendlyError(error)
          };
        }

        if (
          serial !== requestSerial
          || panelSource.value.trim() !== text
          || panelLanguage.value !== targetSnapshot
        ) return;

        translatedResults = translatedResults.map((item) => (
          item.provider === provider ? record : item
        ));
        renderPanelResults(translatedResults);
        void persistIndependentPanelTranslationResults(
          text,
          targetSnapshot,
          resolvedTargetLanguage,
          providers,
          translatedResults
        );
      });

      await Promise.allSettled(tasks);
    } catch (error) {
      if (serial !== requestSerial) return;
      const providers = getPanelSelectedProviders();
      translatedResults = providers.map((provider) => ({
        provider,
        label: getProviderLabel(provider),
        ok: false,
        error: friendlyError(error)
      }));
      renderPanelResults(translatedResults);
      showPanelNotice(friendlyError(error));
    }
  }

  async function persistIndependentPanelTranslationResults(text, requestedTarget, resolvedTarget, providers, records) {
    const completedRecords = orderPanelResultRecords(records, providers).filter((record) => !record.loading);
    await chrome.storage.local.set({
      lastTranslation: {
        sourceText: text,
        sourceLanguage: "auto",
        targetLanguage: resolvedTarget,
        requestedTarget,
        providers: providers.slice(),
        results: completedRecords,
        translatedAt: Date.now()
      }
    });
  }

  function showPanel(anchorRect) {
    panelVerticallyMaximized = false;
    panelRestoreState = null;
    updatePanelVerticalMaximizeUI();
    panel.style.display = "flex";

    if (panelPinned && savedPanelState) {
      applyPanelState(savedPanelState);
      keepPanelInsideViewport();
      return;
    }

    panel.style.width = `${DEFAULT_PANEL_WIDTH}px`;
    panel.style.height = `${DEFAULT_PANEL_HEIGHT}px`;
    sourceSection.style.flex = "0 0 96px";
    positionPanelNearLastLine(anchorRect);
  }

  function positionPanelNearLastLine(rect) {
    const panelWidth = Math.min(DEFAULT_PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const panelHeight = Math.min(DEFAULT_PANEL_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
    const anchor = rect || {
      left: lastMouseUpPoint?.x || VIEWPORT_MARGIN,
      right: lastMouseUpPoint?.x || VIEWPORT_MARGIN,
      top: lastMouseUpPoint?.y || VIEWPORT_MARGIN,
      bottom: lastMouseUpPoint?.y || VIEWPORT_MARGIN
    };

    let left = anchor.left;
    let top = anchor.bottom + 6;

    if (left + panelWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - panelWidth - VIEWPORT_MARGIN;
    }
    if (top + panelHeight > window.innerHeight - VIEWPORT_MARGIN) {
      top = anchor.top - panelHeight - 6;
    }

    panel.style.left = `${clamp(left, VIEWPORT_MARGIN, window.innerWidth - panelWidth - VIEWPORT_MARGIN)}px`;
    panel.style.top = `${clamp(top, VIEWPORT_MARGIN, window.innerHeight - panelHeight - VIEWPORT_MARGIN)}px`;
  }

  function hideButton() {
    button.style.display = "none";
  }

  function hidePanel() {
    panel.style.display = "none";
    panelVerticallyMaximized = false;
    panelRestoreState = null;
    updatePanelVerticalMaximizeUI();
    requestSerial += 1;
  }

  function togglePanelVerticalMaximize() {
    const sourceRatio = getSourceSectionRatio();
    if (!panelVerticallyMaximized) {
      const rect = panel.getBoundingClientRect();
      panelRestoreState = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      panelVerticallyMaximized = true;
      applyPanelVerticalMaximize(sourceRatio);
    } else {
      panelVerticallyMaximized = false;
      const restore = panelRestoreState;
      panelRestoreState = null;
      if (restore) {
        panel.style.left = `${restore.left}px`;
        panel.style.top = `${restore.top}px`;
        panel.style.width = `${restore.width}px`;
        panel.style.height = `${restore.height}px`;
      }
      keepPanelInsideViewport();
      applySourceSectionRatio(sourceRatio);
    }
    updatePanelVerticalMaximizeUI();
  }

  function applyPanelVerticalMaximize(sourceRatio = getSourceSectionRatio()) {
    const rect = panel.getBoundingClientRect();
    const width = clamp(rect.width, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const left = clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    panel.style.left = `${left}px`;
    panel.style.top = `${VIEWPORT_MARGIN}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${Math.max(MIN_PANEL_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2)}px`;
    applySourceSectionRatio(sourceRatio);
  }

  function getSourceSectionRatio() {
    return sourceSection.getBoundingClientRect().height / Math.max(1, panelBody.clientHeight);
  }

  function applySourceSectionRatio(ratio) {
    const splitterHeight = sectionSplitter.getBoundingClientRect().height || 9;
    const maxSourceHeight = Math.max(58, panelBody.clientHeight - splitterHeight - 76);
    const sourceHeight = clamp(panelBody.clientHeight * (Number(ratio) || 0.36), 58, maxSourceHeight);
    sourceSection.style.flex = `0 0 ${sourceHeight}px`;
  }

  function cancelPanelVerticalMaximizeForManualChange() {
    if (!panelVerticallyMaximized) return;
    panelVerticallyMaximized = false;
    panelRestoreState = null;
    updatePanelVerticalMaximizeUI();
  }

  function updatePanelVerticalMaximizeUI() {
    panelVerticalMax.classList.toggle("is-active", panelVerticallyMaximized);
    panelVerticalMax.setAttribute("aria-pressed", String(panelVerticallyMaximized));
    panelVerticalMax.title = panelVerticallyMaximized
      ? "还原窗口高度"
      : "纵向最大化";
    panelVerticalMax.setAttribute("aria-label", panelVerticalMax.title);
  }

  async function handlePanelProviderChange(event) {
    const provider = event.target?.value;
    if (!VALID_TRANSLATION_PROVIDERS.includes(provider)) return;

    const changeRevision = ++panelProviderChangeRevision;
    const checked = Boolean(event.target.checked);

    if (event.target === panelProviderDeepSeek && checked) {
      try {
        const status = await sendMessage({ type: "GET_DEEPSEEK_STATUS" });
        if (
          changeRevision !== panelProviderChangeRevision
          || event.target.checked !== checked
        ) return;
        deepseekApiConfigured = Boolean(status?.ok && status.configured);
      } catch {
        if (
          changeRevision !== panelProviderChangeRevision
          || event.target.checked !== checked
        ) return;
        deepseekApiConfigured = false;
      }

      if (!deepseekApiConfigured) {
        panelProviderDeepSeek.checked = false;
        panelProviderOrder = panelProviderOrder.filter((item) => item !== "deepseek");
        if (!panelProviderGoogle.checked && !panelProviderDeepL.checked) panelProviderGoogle.checked = true;
        await chrome.storage.local.set({ translationProviders: getPanelSelectedProviders() });
        renderPanelResults(translatedResults);
        showPanelNotice("请点击 Edge 菜单栏上的“宏”图标，在 DeepSeek API 设置中填写并保存 API Key；未填写时 DeepSeek 勾选不会生效。");
        return;
      }
    }

    if (changeRevision !== panelProviderChangeRevision) return;

    const previousOrder = panelProviderOrder.slice();
    panelProviderOrder = panelProviderOrder.filter((item) => item !== provider);
    if (checked) panelProviderOrder.push(provider);

    let providers = getPanelSelectedProviders();
    if (!providers.length) {
      event.target.checked = true;
      panelProviderOrder = previousOrder.length ? previousOrder : [provider];
      providers = getPanelSelectedProviders();
      showPanelNotice("至少需要保留一个翻译来源。");
      return;
    }

    requestSerial += 1;
    renderPanelResults(translatedResults);
    await chrome.storage.local.set({ translationProviders: providers });
    if (changeRevision !== panelProviderChangeRevision) return;

    clearPanelNotice();
    if (panelSource.value.trim()) {
      void translateInPanel(panelSource.value.trim(), selectionAnchorRect, true);
    }
  }

  function normalizePanelProviderOrder(value) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .filter((provider) => VALID_TRANSLATION_PROVIDERS.includes(provider))
      .filter((provider) => {
        if (seen.has(provider)) return false;
        seen.add(provider);
        return true;
      });
  }

  function isPanelProviderSelected(provider) {
    if (provider === "google") return panelProviderGoogle.checked;
    if (provider === "deepseek") return panelProviderDeepSeek.checked && deepseekApiConfigured;
    if (provider === "deepl") return panelProviderDeepL.checked;
    return false;
  }

  function getPanelSelectedProviders() {
    const providers = normalizePanelProviderOrder(panelProviderOrder)
      .filter((provider) => isPanelProviderSelected(provider));
    for (const provider of VALID_TRANSLATION_PROVIDERS) {
      if (isPanelProviderSelected(provider) && !providers.includes(provider)) providers.push(provider);
    }
    panelProviderOrder = providers.slice();
    return providers;
  }

  function applyPanelProviderSelection(value) {
    panelProviderOrder = normalizePanelProviderOrder(value);
    panelProviderGoogle.checked = panelProviderOrder.includes("google");
    panelProviderDeepSeek.checked = deepseekApiConfigured && panelProviderOrder.includes("deepseek");
    panelProviderDeepL.checked = panelProviderOrder.includes("deepl");
    if (!panelProviderGoogle.checked && !panelProviderDeepSeek.checked && !panelProviderDeepL.checked) {
      panelProviderGoogle.checked = true;
    }
    panelProviderOrder = getPanelSelectedProviders();
  }

  function getProviderLabel(provider) {
    if (provider === "deepl") return "DeepL";
    if (provider === "deepseek") return "DeepSeek";
    return "\u8c37\u6b4c\u7ffb\u8bd1";
  }

  function getProviderBadge(provider) {
    if (provider === "deepl") return "L";
    if (provider === "deepseek") return "D";
    return "G";
  }

  function getProviderLoadingText(provider) {
    if (provider === "deepl") return "\u6b63\u5728\u901a\u8fc7 DeepL \u7f51\u9875\u7ffb\u8bd1\u2026";
    if (provider === "deepseek") return "\u6b63\u5728\u8fde\u63a5 DeepSeek API\u2026";
    return "\u6b63\u5728\u8fde\u63a5\u8c37\u6b4c\u7ffb\u8bd1\u2026";
  }

  function renderPanelLoading(providers) {
    translatedResults = providers.map((provider) => ({
      provider,
      label: getProviderLabel(provider),
      loading: true
    }));
    renderPanelResults(translatedResults);
  }

  function orderPanelResultRecords(records, providers = getPanelSelectedProviders()) {
    const recordMap = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      if (VALID_TRANSLATION_PROVIDERS.includes(record?.provider)) {
        recordMap.set(record.provider, record);
      }
    }
    return providers.map((provider) => recordMap.get(provider)).filter(Boolean);
  }

  function renderPanelResults(records) {
    const visibleRecords = orderPanelResultRecords(records);

    panelResults.textContent = "";
    if (!visibleRecords.length) {
      const placeholder = document.createElement("div");
      placeholder.className = "panel-result-placeholder";
      placeholder.textContent = "\u6240\u9009\u7ffb\u8bd1\u6765\u6e90\u7684\u7ed3\u679c\u4f1a\u663e\u793a\u5728\u8fd9\u91cc\u3002";
      panelResults.append(placeholder);
      panelCopy.disabled = true;
      return;
    }

    for (const record of visibleRecords) {
      const provider = ["google", "deepseek", "deepl"].includes(record.provider) ? record.provider : "google";
      const card = document.createElement("article");
      card.className = `provider-result-card ${provider}`;

      const header = document.createElement("div");
      header.className = "provider-card-header";

      const name = document.createElement("span");
      name.className = "provider-card-name";
      const badge = document.createElement("span");
      badge.className = "provider-card-badge";
      badge.textContent = getProviderBadge(provider);
      const label = document.createElement("span");
      label.textContent = record.label || getProviderLabel(provider);
      name.append(badge, label);

      const state = document.createElement("span");
      state.className = "provider-card-state";
      state.textContent = record.loading ? "\u7ffb\u8bd1\u4e2d\u2026" : record.external ? "\u7f51\u9875\u7ffb\u8bd1" : record.ok ? "\u5b8c\u6210" : "\u672a\u5b8c\u6210";
      if (!record.loading && !record.ok) state.classList.add("error");

      const statusGroup = document.createElement("span");
      statusGroup.className = "provider-card-status-group";
      statusGroup.append(state);
      if (!record.loading) {
        const retryButton = document.createElement("button");
        retryButton.className = "provider-card-retry";
        retryButton.type = "button";
        retryButton.title = "\u91cd\u65b0\u7ffb\u8bd1";
        retryButton.setAttribute("aria-label", `${record.label || getProviderLabel(provider)}\u91cd\u65b0\u7ffb\u8bd1`);
        retryButton.textContent = "\u21bb";
        retryButton.addEventListener("click", () => retryPanelProvider(provider));
        statusGroup.append(retryButton);
      }
      header.append(name, statusGroup);

      const body = document.createElement("div");
      body.className = "provider-card-body";
      if (record.loading) {
        body.classList.add("loading");
        body.textContent = getProviderLoadingText(provider);
      } else if (record.external) {
        body.classList.add("loading");
        body.textContent = "\u4e0d\u4f7f\u7528 API\uff1b\u8bf7\u70b9\u51fb\u4e0b\u65b9 DeepL \u6309\u94ae\uff0c\u5728 DeepL \u7f51\u9875\u7a97\u53e3\u4e2d\u7ffb\u8bd1\u3002";
      } else if (record.ok) {
        body.textContent = record.translatedText || "\u6ca1\u6709\u5f97\u5230\u7ffb\u8bd1\u7ed3\u679c\u3002";
      } else {
        body.classList.add("error");
        body.textContent = record.error || "\u7ffb\u8bd1\u5931\u8d25\u3002";
      }

      card.append(header, body);
      panelResults.append(card);
    }

    panelCopy.disabled = !visibleRecords.some((record) => record.ok && record.translatedText);
  }

  async function retryPanelProvider(provider) {
    const text = panelSource.value.trim();
    if (!text) {
      showPanelNotice("\u8bf7\u5148\u8f93\u5165\u6216\u9009\u4e2d\u9700\u8981\u7ffb\u8bd1\u7684\u6587\u672c\u3002");
      return;
    }

    const retryToken = (panelRetryTokens.get(provider) || 0) + 1;
    panelRetryTokens.set(provider, retryToken);
    const serialSnapshot = requestSerial;
    const targetSnapshot = panelLanguage.value;
    const loadingRecord = {
      provider,
      label: getProviderLabel(provider),
      loading: true
    };
    translatedResults = translatedResults.some((record) => record.provider === provider)
      ? translatedResults.map((record) => record.provider === provider ? loadingRecord : record)
      : [...translatedResults, loadingRecord];
    renderPanelResults(translatedResults);
    clearPanelNotice();

    try {
      const response = await sendMessage({
        type: "TRANSLATE_MULTI",
        text,
        sourceLanguage: "auto",
        targetLanguage: targetSnapshot,
        providers: [provider],
        forceRefresh: true
      }, getTranslationMessageTimeout(provider));
      if (
        panelRetryTokens.get(provider) !== retryToken
        || requestSerial !== serialSnapshot
        || panelSource.value.trim() !== text
        || panelLanguage.value !== targetSnapshot
      ) return;
      if (!response?.ok) throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25\u3002");

      const refreshed = (response.results || []).find((record) => record.provider === provider) || {
        provider,
        label: getProviderLabel(provider),
        ok: false,
        error: "\u6ca1\u6709\u5f97\u5230\u7ffb\u8bd1\u7ed3\u679c\u3002"
      };
      translatedResults = translatedResults.map((record) => (
        record.provider === provider ? refreshed : record
      ));
      renderPanelResults(translatedResults);
      await persistPanelRetryResult(text, targetSnapshot, response);
    } catch (error) {
      if (
        panelRetryTokens.get(provider) !== retryToken
        || requestSerial !== serialSnapshot
        || panelSource.value.trim() !== text
      ) return;
      const failed = {
        provider,
        label: getProviderLabel(provider),
        ok: false,
        error: friendlyError(error)
      };
      translatedResults = translatedResults.map((record) => (
        record.provider === provider ? failed : record
      ));
      renderPanelResults(translatedResults);
      showPanelNotice(friendlyError(error));
    }
  }

  async function persistPanelRetryResult(text, requestedTarget, response) {
    const providers = getPanelSelectedProviders();
    await chrome.storage.local.set({
      lastTranslation: {
        sourceText: text,
        sourceLanguage: "auto",
        targetLanguage: response?.targetLanguage || requestedTarget,
        requestedTarget,
        providers,
        results: translatedResults.filter((record) => providers.includes(record.provider)),
        translatedAt: Date.now()
      }
    });
  }

  function showPanelNotice(message) {
    panelProviderNotice.textContent = message;
    panelProviderNotice.hidden = false;
  }

  function clearPanelNotice() {
    panelProviderNotice.hidden = true;
    panelProviderNotice.textContent = "";
  }

  function showPanelError(message) {
    translatedResults = [];
    panelResults.textContent = "";
    const error = document.createElement("div");
    error.className = "provider-card-body error";
    error.textContent = message;
    panelResults.append(error);
    panelCopy.disabled = true;
    showPanelNotice(message);
  }

  async function handleStorageChanges(changes, areaName) {
    if (areaName !== "local") return;

    if (changes.extensionEnabled) {
      extensionEnabled = changes.extensionEnabled.newValue !== false;
      selectionRouteSerial += 1;
      clearTimeout(selectionTimer);
      clearTimeout(panelSourceEditTimer);
      if (!extensionEnabled) {
        selectedText = "";
        selectionAnchorRect = null;
        hideButton();
        hidePanel();
      } else {
        scheduleSelectionCheck(lastMouseUpPoint);
      }
    }

    if (changes.deepseekApiConfigured) {
      deepseekApiConfigured = Boolean(changes.deepseekApiConfigured.newValue);
      if (!deepseekApiConfigured && panelProviderDeepSeek.checked) {
        panelProviderDeepSeek.checked = false;
        panelProviderOrder = panelProviderOrder.filter((provider) => provider !== "deepseek");
        if (!panelProviderGoogle.checked && !panelProviderDeepL.checked) panelProviderGoogle.checked = true;
        await chrome.storage.local.set({ translationProviders: getPanelSelectedProviders() });
        renderPanelResults(translatedResults);
        showPanelNotice("DeepSeek API Key \u5df2\u6e05\u9664\uff0cDeepSeek \u5df2\u53d6\u6d88\u52fe\u9009\u3002");
        if (panel.style.display !== "none" && panelSource.value.trim()) {
          translateInPanel(panelSource.value.trim(), selectionAnchorRect, true);
        }
      }
    }

    if (changes.translationProviders) {
      // This page card owns its checkbox state while visible. Storage events also
      // include this card's own writes and may arrive after a later user click.
      if (panel.style.display !== "none") return;
      applyPanelProviderSelection(changes.translationProviders.newValue);
      renderPanelResults(translatedResults);
    }
  }

  function startDrag(event) {
    if (event.button !== 0 || event.target.closest("button")) return;
    event.preventDefault();
    cancelPanelVerticalMaximizeForManualChange();

    const rect = panel.getBoundingClientRect();
    interaction = {
      type: "drag",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    panelHeader.setPointerCapture?.(event.pointerId);
  }

  function startSectionSplit(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    interaction = {
      type: "section-split",
      pointerId: event.pointerId,
      startY: event.clientY,
      sourceHeight: sourceSection.getBoundingClientRect().height
    };
    sectionSplitter.classList.add("is-dragging");
    sectionSplitter.setPointerCapture?.(event.pointerId);
  }

  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cancelPanelVerticalMaximizeForManualChange();

    const rect = panel.getBoundingClientRect();
    interaction = {
      type: "resize",
      dir: event.currentTarget.dataset.dir,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function updateInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    event.preventDefault();

    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;

    if (interaction.type === "drag") {
      const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - interaction.width - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - interaction.height - VIEWPORT_MARGIN);
      panel.style.left = `${clamp(interaction.left + dx, VIEWPORT_MARGIN, maxLeft)}px`;
      panel.style.top = `${clamp(interaction.top + dy, VIEWPORT_MARGIN, maxTop)}px`;
      return;
    }

    if (interaction.type === "section-split") {
      const splitterHeight = sectionSplitter.getBoundingClientRect().height;
      const maxSourceHeight = Math.max(58, panelBody.clientHeight - splitterHeight - 76);
      const nextSourceHeight = clamp(interaction.sourceHeight + dy, 58, maxSourceHeight);
      sourceSection.style.flex = `0 0 ${nextSourceHeight}px`;
      return;
    }

    const dir = interaction.dir;
    let left = interaction.left;
    let top = interaction.top;
    let width = interaction.width;
    let height = interaction.height;

    if (dir.includes("e")) width = interaction.width + dx;
    if (dir.includes("s")) height = interaction.height + dy;
    if (dir.includes("w")) {
      width = interaction.width - dx;
      left = interaction.left + dx;
    }
    if (dir.includes("n")) {
      height = interaction.height - dy;
      top = interaction.top + dy;
    }

    const maxWidth = window.innerWidth - VIEWPORT_MARGIN * 2;
    const maxHeight = window.innerHeight - VIEWPORT_MARGIN * 2;
    const nextWidth = clamp(width, MIN_PANEL_WIDTH, maxWidth);
    const nextHeight = clamp(height, MIN_PANEL_HEIGHT, maxHeight);

    if (dir.includes("w")) left = interaction.left + interaction.width - nextWidth;
    if (dir.includes("n")) top = interaction.top + interaction.height - nextHeight;

    left = clamp(left, VIEWPORT_MARGIN, window.innerWidth - nextWidth - VIEWPORT_MARGIN);
    top = clamp(top, VIEWPORT_MARGIN, window.innerHeight - nextHeight - VIEWPORT_MARGIN);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${nextWidth}px`;
    panel.style.height = `${nextHeight}px`;
  }

  async function finishInteraction(event) {
    if (!interaction || event.pointerId !== interaction.pointerId) return;
    sectionSplitter.classList.remove("is-dragging");
    interaction = null;
    if (panelPinned) await persistPanelState();
  }

  async function loadSavedState() {
    try {
      const data = await chrome.storage.local.get([
        "floatingPanelState",
        "targetLanguage",
        "translationProviders",
        "extensionEnabled"
      ]);
      extensionEnabled = data.extensionEnabled !== false;
      savedPanelState = data.floatingPanelState || null;
      panelPinned = Boolean(savedPanelState?.pinned);
      panelLanguage.value = data.targetLanguage || "zh-CN";

      const status = await sendMessage({ type: "GET_DEEPSEEK_STATUS" });
      deepseekApiConfigured = Boolean(status?.ok && status.configured);
      applyPanelProviderSelection(data.translationProviders);
      if (!deepseekApiConfigured && Array.isArray(data.translationProviders) && data.translationProviders.includes("deepseek")) {
        await chrome.storage.local.set({ translationProviders: getPanelSelectedProviders() });
      }
      renderPanelResults([]);
      updatePinnedUI();
      if (extensionEnabled) {
        scheduleSelectionCheck(lastMouseUpPoint);
      } else {
        hideButton();
        hidePanel();
      }
    } catch {
      extensionEnabled = true;
      deepseekApiConfigured = false;
      applyPanelProviderSelection(["google"]);
      renderPanelResults([]);
      // The current page only needs a refresh if the extension was reloaded.
    }
  }

  async function persistPanelState() {
    const currentRect = panel.getBoundingClientRect();
    const rect = panelVerticallyMaximized && panelRestoreState
      ? panelRestoreState
      : currentRect;
    savedPanelState = {
      pinned: panelPinned,
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      sourceRatio: getSourceSectionRatio()
    };
    await chrome.storage.local.set({ floatingPanelState: savedPanelState });
  }

  function applyPanelState(state) {
    const width = clamp(Number(state.width) || DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = clamp(Number(state.height) || DEFAULT_PANEL_HEIGHT, MIN_PANEL_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2);
    const left = clamp(Number(state.left) || VIEWPORT_MARGIN, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const top = clamp(Number(state.top) || VIEWPORT_MARGIN, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);

    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    applySourceSectionRatio(Number(state.sourceRatio) || 0.36);
  }

  function keepPanelInsideViewport() {
    const rect = panel.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - VIEWPORT_MARGIN * 2);
    const height = Math.min(rect.height, window.innerHeight - VIEWPORT_MARGIN * 2);
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)}px`;
    panel.style.top = `${clamp(rect.top, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)}px`;
  }

  function updatePinnedUI() {
    panel.classList.toggle("is-pinned", panelPinned);
    panelPin.textContent = panelPinned ? "已固定" : "固定";
    panelPin.title = panelPinned ? "取消固定；下次贴近新选区打开" : "固定当前大小和位置";
  }

  function isTextInput(element) {
    const type = (element.type || "text").toLowerCase();
    return ["text", "search", "url", "tel", "email", "password"].includes(type);
  }

  function getTranslationMessageTimeout(provider) {
    return provider === "deepl"
      ? DEEPL_TRANSLATION_MESSAGE_TIMEOUT_MS
      : DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS;
  }

  function sendMessage(message, timeoutMs = DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.id) {
        reject(new Error("\u6269\u5c55\u5df2\u91cd\u65b0\u52a0\u8f7d\uff0c\u8bf7\u5237\u65b0\u5f53\u524d\u7f51\u9875\u540e\u518d\u8bd5\u3002"));
        return;
      }

      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("\u6269\u5c55\u54cd\u5e94\u8d85\u65f6\u3002"));
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(
              /context invalidated/i.test(error.message)
                ? "\u6269\u5c55\u5df2\u91cd\u65b0\u52a0\u8f7d\uff0c\u8bf7\u5237\u65b0\u5f53\u524d\u7f51\u9875\u540e\u518d\u8bd5\u3002"
                : error.message
            ));
            return;
          }
          resolve(response);
        });
      } catch (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      }
    });
  }

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.min(Math.max(value, min), max);
  }

  function friendlyError(error) {
    if (!error) return "发生未知错误。";
    return error.message || String(error);
  }
})();

