const MENU_ID = "translate-selection-with-google";
const MAX_TEXT_LENGTH = 50000;
const TRANSLATION_CHUNK_LENGTH = 4500;
const DEEPL_TRANSLATION_CHUNK_LENGTH = 1400;
const DEEPL_TRANSLATION_TIMEOUT_MS = 30000;
const GOOGLE_REQUEST_MIN_INTERVAL_MS = 180;
const GOOGLE_BATCH_TRANSLATE_URL = "https://translate.google.com/_/TranslateWebserverUi/data/batchexecute";
const DEEPL_ONESHOT_URL = "https://oneshot-free.www.deepl.com/v1/translate";
const DEEPL_INSTANCE_STORAGE_KEY = "deepLInstanceId";
const LEGACY_DEEPL_WORKER_STORAGE_KEY = "deepLWorkerTabState";
const OFFSCREEN_DOCUMENT_PATH = "offscreen/offscreen.html";
const DEEPSEEK_CHAT_URL = "https://chat.deepseek.com/";
const DEEPL_TRANSLATOR_URL = "https://www.deepl.com/zh/translator";
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const TOOLBAR_WINDOW_STORAGE_KEY = "toolbarPopupWindowId";
const TOOLBAR_TAB_STORAGE_KEY = "toolbarPopupTabId";
const HOSTED_PIP_TAB_STORAGE_KEY = "hostedToolbarPipTabId";
const HOSTED_PIP_SCRIPT = "content/hosted-pip.js";
const EXTENSION_ENABLED_STORAGE_KEY = "extensionEnabled";
const LAST_EDGE_WINDOW_STORAGE_KEY = "lastEdgeWindowId";
const TOOLBAR_MESSAGE_TIMEOUT_MS = 900;
const SELECTION_ROUTE_MESSAGE_TIMEOUT_MS = 2500;
const CLIPBOARD_MESSAGE_TIMEOUT_MS = 1800;
const ENABLED_ACTION_ICONS = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png"
};
const DISABLED_ACTION_ICONS = {
  16: "icons/icon16-disabled.png",
  32: "icons/icon32-disabled.png",
  48: "icons/icon48-disabled.png",
  128: "icons/icon128-disabled.png"
};
const cache = new Map();
const googleChunkRequests = new Map();
let googleRequestQueue = Promise.resolve();
let lastGoogleRequestStartedAt = 0;
let creatingOffscreenDocument = null;
let offscreenClipboardQueue = Promise.resolve();
let toolbarPopupWindowId = null;
let toolbarPopupTabId = null;
let hostedToolbarPipTabId = null;
let popupCoordinationQueue = Promise.resolve();
let deepLInstanceIdPromise = null;
const deepLSessionId = createUuid();

cleanupLegacyDeepLWorker().catch(() => undefined);
syncExtensionAvailability().catch(() => undefined);
ensureContextMenu().catch(() => undefined);

chrome.runtime.onInstalled.addListener(async () => {
  await cleanupLegacyDeepLWorker().catch(() => undefined);
  const current = await chrome.storage.local.get([
    "targetLanguage",
    EXTENSION_ENABLED_STORAGE_KEY
  ]);
  const defaults = {};
  if (!current.targetLanguage) defaults.targetLanguage = "zh-CN";
  if (typeof current[EXTENSION_ENABLED_STORAGE_KEY] !== "boolean") {
    defaults[EXTENSION_ENABLED_STORAGE_KEY] = true;
  }
  if (Object.keys(defaults).length) {
    await chrome.storage.local.set(defaults);
  }

  const enabled = current[EXTENSION_ENABLED_STORAGE_KEY] !== false;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "\u4f7f\u7528\u8c37\u6b4c\u7ffb\u8bd1\u201c%s\u201d",
      contexts: ["selection"],
      enabled
    }, () => {
      syncExtensionAvailability(enabled).catch(() => undefined);
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  syncExtensionAvailability().catch(() => undefined);
  ensureContextMenu().catch(() => undefined);
});

async function ensureContextMenu() {
  const enabled = await isExtensionEnabled();
  try {
    await chrome.contextMenus.update(MENU_ID, {
      title: "\u4f7f\u7528\u8c37\u6b4c\u7ffb\u8bd1\u201c%s\u201d",
      enabled
    });
    return;
  } catch {
    // The menu can be absent after an interrupted extension reload.
  }

  try {
    await chrome.contextMenus.create({
      id: MENU_ID,
      title: "\u4f7f\u7528\u8c37\u6b4c\u7ffb\u8bd1\u201c%s\u201d",
      contexts: ["selection"],
      enabled
    });
  } catch {
    // Another startup path may have created it concurrently.
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[EXTENSION_ENABLED_STORAGE_KEY]) return;
  const enabled = changes[EXTENSION_ENABLED_STORAGE_KEY].newValue !== false;
  syncExtensionAvailability(enabled).catch(() => undefined);
  if (!enabled) {
    chrome.storage.local.remove("pendingSelection").catch(() => undefined);
    Promise.allSettled([
      closeHostedToolbarPip(),
      closeToolbarPopupWindow(),
      closeAllFloatingPanels()
    ]).catch(() => undefined);
  }
});

chrome.action.onClicked.addListener((tab) => {
  // Consume the toolbar click directly in the active page. This creates the
  // real always-on-top Document PiP before any awaited background work can
  // consume the transient user activation.
  const hostedPipPromise = openHostedToolbarPip(tab);

  if (Number.isInteger(tab?.windowId)) {
    void chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: tab.windowId }).catch(() => undefined);
  }

  void runPopupCoordination(async () => {
    const hosted = await hostedPipPromise;
    if (hosted?.ok && Number.isInteger(tab?.id)) {
      await setHostedToolbarPipTabId(tab.id);
      await Promise.allSettled([closeToolbarPopupWindow(), closeAllFloatingPanels()]);
      await chrome.storage.local.remove("pendingSelection").catch(() => undefined);
      const enabled = await isExtensionEnabled();
      const text = enabled ? await getTextForToolbarPopup(tab) : "";
      if (text) {
        await sendMessageToHostedPip(tab.id, {
          type: "HOSTED_PIP_APPLY_TEXT",
          text,
          source: "selection"
        }, SELECTION_ROUTE_MESSAGE_TIMEOUT_MS).catch(() => undefined);
      }
      return;
    }

    // edge:// pages and other restricted documents cannot host the injected
    // script. Use an ordinary window there, without a fake blue pinned state.
    await closeHostedToolbarPip();
    await closeAllFloatingPanels();
    const enabled = await isExtensionEnabled();
    const text = enabled ? await getTextForToolbarPopup(tab) : "";
    if (text) await savePendingSelection(text);
    else await chrome.storage.local.remove("pendingSelection");
    await openMovableToolbarPopup(tab?.windowId, text);
    await closeAllFloatingPanels();
  }).catch((error) => console.error("Unable to open translator window:", error));
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!Number.isInteger(windowId) || windowId === chrome.windows.WINDOW_ID_NONE) return;
  chrome.windows.get(windowId).then((browserWindow) => {
    if (browserWindow?.type === "normal") {
      return chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: windowId });
    }
    return undefined;
  }).catch(() => undefined);
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === toolbarPopupWindowId) {
    toolbarPopupWindowId = null;
    toolbarPopupTabId = null;
    chrome.storage.local.remove([TOOLBAR_WINDOW_STORAGE_KEY, TOOLBAR_TAB_STORAGE_KEY]).catch(() => undefined);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.selectionText) return;
  if (Number.isInteger(tab?.windowId)) {
    await chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: tab.windowId }).catch(() => undefined);
  }
  if (!await isExtensionEnabled()) return;

  const text = normalizeText(info.selectionText);
  if (!text) return;

  await savePendingSelection(text);

  try {
    await runPopupCoordination(async () => {
      await closeAllFloatingPanels();
      await openMovableToolbarPopup(tab?.windowId, text);
      await closeAllFloatingPanels();
    });
  } catch {
    await chrome.tabs.create({ url: buildGoogleTranslateUrl(text, "auto", "zh-CN") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "PREPARE_SELECTION") {
    prepareSelection(message.text, sender?.tab?.windowId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "READ_CLIPBOARD") {
    readClipboardFromOffscreen()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, text: "", error: friendlyError(error) }));
    return true;
  }

  if (message.type === "READ_SELECTION_FROM_EDGE_WINDOW") {
    readSelectionFromEdgeWindow(message.windowId)
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({ ok: false, text: "", error: friendlyError(error) }));
    return true;
  }

  if (message.type === "WRITE_CLIPBOARD") {
    writeClipboardToOffscreen(message.text)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "REGISTER_HOSTED_PIP") {
    registerHostedToolbarPip(sender?.tab?.id)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "HOSTED_PIP_CLOSED") {
    clearHostedToolbarPip(sender?.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "HOSTED_PIP_CANCEL") {
    const sourceText = normalizeText(message.sourceText || "");
    const tabId = sender?.tab?.id;
    clearHostedToolbarPip(tabId)
      .then(async () => {
        const updates = {};
        if (message.targetLanguage) updates.targetLanguage = String(message.targetLanguage);
        const providers = normalizeProviders(message.providers);
        if (providers.length) updates.translationProviders = providers;
        if (Object.keys(updates).length) await chrome.storage.local.set(updates);
        if (sourceText) await savePendingSelection(sourceText);
        else await chrome.storage.local.remove("pendingSelection");
        await runPopupCoordination(async () => {
          await closeHostedToolbarPip();
          await closeToolbarPopupWindow();
          await closeAllFloatingPanels();
          await openMovableToolbarPopup(sender?.tab?.windowId, sourceText);
          await closeAllFloatingPanels();
        });
        return { ok: true };
      })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "REGISTER_TOOLBAR_POPUP") {
    registerToolbarPopup(sender?.tab?.windowId ?? message.windowId, sender?.tab?.id ?? message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "ROUTE_SELECTION_TO_OPEN_TRANSLATOR") {
    routeSelectionToOpenToolbarPopup(message.text, sender?.tab?.windowId)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, routed: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "ACTIVATE_PAGE_TRANSLATOR") {
    runPopupCoordination(() => activatePageTranslator(sender?.tab?.id))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "SET_EXTENSION_ENABLED") {
    setExtensionEnabled(message.enabled !== false)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "GET_DEEPSEEK_STATUS") {
    chrome.storage.local.get(["deepseekApiKey"])
      .then((data) => sendResponse({ ok: true, configured: Boolean(String(data.deepseekApiKey || "").trim()) }))
      .catch((error) => sendResponse({ ok: false, configured: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "SAVE_DEEPSEEK_API_KEY") {
    saveDeepSeekApiKey(message.apiKey)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "CLEAR_DEEPSEEK_API_KEY") {
    clearDeepSeekApiKey()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "TRANSLATE") {
    translateMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "TRANSLATE_MULTI") {
    translateMultiMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "OPEN_GOOGLE_TRANSLATE") {
    const text = normalizeText(message.text || "");
    const source = normalizeSourceLanguage(message.sourceLanguage || "auto");
    const target = resolveTargetLanguage(message.targetLanguage || "zh-CN", text);

    chrome.tabs.create({ url: buildGoogleTranslateUrl(text, source, target) })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "OPEN_DEEPSEEK") {
    chrome.tabs.create({ url: DEEPSEEK_CHAT_URL })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "OPEN_DEEPL_TRANSLATE") {
    openDeepLTranslator(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  return false;
});

async function isExtensionEnabled() {
  const data = await chrome.storage.local.get([EXTENSION_ENABLED_STORAGE_KEY]);
  return data[EXTENSION_ENABLED_STORAGE_KEY] !== false;
}

async function syncExtensionAvailability(forcedEnabled) {
  const enabled = typeof forcedEnabled === "boolean"
    ? forcedEnabled
    : await isExtensionEnabled();
  await Promise.all([
    chrome.action.setIcon({ path: enabled ? ENABLED_ACTION_ICONS : DISABLED_ACTION_ICONS }),
    chrome.action.setTitle({ title: enabled ? "\u5b8f\u8bd1" : "\u5b8f\u8bd1\uff08\u5df2\u5173\u95ed\uff09" })
  ]);
  try {
    await chrome.contextMenus.update(MENU_ID, { enabled });
  } catch {
    // The menu may not exist yet during installation or service-worker startup.
  }
  return enabled;
}

async function setExtensionEnabled(enabled) {
  const nextEnabled = enabled !== false;
  await chrome.storage.local.set({ [EXTENSION_ENABLED_STORAGE_KEY]: nextEnabled });
  await syncExtensionAvailability(nextEnabled).catch(() => undefined);
  if (!nextEnabled) {
    await chrome.storage.local.remove("pendingSelection").catch(() => undefined);
    await Promise.allSettled([
      closeHostedToolbarPip(),
      closeToolbarPopupWindow(),
      closeAllFloatingPanels()
    ]);
  }
  return { ok: true, enabled: nextEnabled };
}

function runPopupCoordination(task) {
  const operation = popupCoordinationQueue
    .catch(() => undefined)
    .then(task);
  popupCoordinationQueue = operation.catch(() => undefined);
  return operation;
}

async function activatePageTranslator(activeTabId) {
  await Promise.all([
    closeHostedToolbarPip(),
    closeToolbarPopupWindow(),
    closeAllFloatingPanels(activeTabId)
  ]);
}

async function closeAllFloatingPanels(exceptTabId = null) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }

  await Promise.allSettled(tabs.map(async (tab) => {
    if (!Number.isInteger(tab.id) || tab.id === exceptTabId) return;
    try {
      // Discarded, frozen, PDF, and extension-reloaded tabs can occasionally keep
      // tabs.sendMessage pending. A stale tab must never block every later popup
      // coordination request or prevent the active page from starting translation.
      await withTimeout(
        chrome.tabs.sendMessage(tab.id, { type: "CLOSE_FLOATING_PANEL" }),
        TOOLBAR_MESSAGE_TIMEOUT_MS,
        "Closing a stale floating translator panel timed out."
      );
    } catch {
      // Restricted Edge pages and tabs without a responsive content script can be ignored.
    }
  }));
}

function isToolbarPopupTab(tab) {
  if (!tab) return false;
  const popupUrl = chrome.runtime.getURL("popup/popup.html");
  const candidates = [tab.url, tab.pendingUrl].filter((value) => typeof value === "string" && value);
  // During Document PiP/restore, Edge can temporarily omit the URL. The tab
  // identity is validated separately by getLiveToolbarPopupWindow().
  return candidates.length === 0 || candidates.some((url) => (
    url === popupUrl || url.startsWith(`${popupUrl}?`) || url.startsWith(`${popupUrl}#`)
  ));
}

function getToolbarPopupTab(browserWindow) {
  if (!Array.isArray(browserWindow?.tabs)) return null;
  return browserWindow.tabs.find((tab) => isToolbarPopupTab(tab) && (
    [tab?.url, tab?.pendingUrl].some((value) => typeof value === "string" && value)
      ? isToolbarPopupTab(tab)
      : tab?.id === toolbarPopupTabId
  )) || null;
}

function isToolbarPopupWindow(browserWindow) {
  if (!Number.isInteger(browserWindow?.id) || !Array.isArray(browserWindow.tabs)) return false;
  const popupUrl = chrome.runtime.getURL("popup/popup.html");
  return browserWindow.tabs.some((tab) => {
    const candidates = [tab?.url, tab?.pendingUrl].filter((value) => typeof value === "string" && value);
    return candidates.some((url) => (
      url === popupUrl || url.startsWith(`${popupUrl}?`) || url.startsWith(`${popupUrl}#`)
    )) || (candidates.length === 0 && tab?.id === toolbarPopupTabId);
  });
}

async function findToolbarPopupWindows() {
  // Do not restrict this query to windowTypes: ["popup"]. Edge can report a
  // detached extension window as a different window type while it is being
  // focused, restored, or converted to a picture-in-picture owner window.
  const windows = await chrome.windows.getAll({ populate: true });
  return windows.filter(isToolbarPopupWindow);
}

async function getLiveToolbarPopupWindow(windowId, tabId = toolbarPopupTabId) {
  if (!Number.isInteger(windowId)) return null;
  try {
    const browserWindow = await chrome.windows.get(windowId, { populate: true });
    if (isToolbarPopupWindow(browserWindow)) return browserWindow;

    // Edge may omit popup tab URLs while the detached window is being restored.
    // A stored window+tab pair is still safe: if the tab has a non-extension URL,
    // reject it; if the URL is temporarily blank, accept only the exact tab pair.
    if (!Number.isInteger(tabId)) return null;
    const tab = await withTimeout(
      chrome.tabs.get(tabId),
      TOOLBAR_MESSAGE_TIMEOUT_MS,
      "\u5b8f\u8bd1\u7a97\u53e3\u6807\u8bc6\u54cd\u5e94\u8d85\u65f6\u3002"
    );
    if (tab?.windowId !== windowId || !isToolbarPopupTab(tab)) return null;
    return browserWindow;
  } catch {
    return null;
  }
}

async function getRegisteredToolbarPopupWindow() {
  if (!Number.isInteger(toolbarPopupWindowId)) {
    try {
      const stored = await chrome.storage.local.get([
        TOOLBAR_WINDOW_STORAGE_KEY,
        TOOLBAR_TAB_STORAGE_KEY
      ]);
      const storedWindowId = Number(stored?.[TOOLBAR_WINDOW_STORAGE_KEY]);
      const storedTabId = Number(stored?.[TOOLBAR_TAB_STORAGE_KEY]);
      toolbarPopupWindowId = Number.isInteger(storedWindowId) ? storedWindowId : null;
      toolbarPopupTabId = Number.isInteger(storedTabId) ? storedTabId : null;
    } catch {
      toolbarPopupWindowId = null;
      toolbarPopupTabId = null;
    }
  }

  const liveWindow = await getLiveToolbarPopupWindow(toolbarPopupWindowId, toolbarPopupTabId);
  if (liveWindow) return liveWindow;

  toolbarPopupWindowId = null;
  toolbarPopupTabId = null;
  await chrome.storage.local.remove([
    TOOLBAR_WINDOW_STORAGE_KEY,
    TOOLBAR_TAB_STORAGE_KEY
  ]).catch(() => undefined);
  return null;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, milliseconds, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function sendRuntimeMessageWithTimeout(message, milliseconds = TOOLBAR_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.id) {
      reject(new Error("\u6269\u5c55\u5df2\u91cd\u65b0\u52a0\u8f7d\uff0c\u8bf7\u91cd\u65b0\u52a0\u8f7d\u6269\u5c55\u540e\u518d\u8bd5\u3002"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("\u6269\u5c55\u7a97\u53e3\u54cd\u5e94\u8d85\u65f6\u3002"));
    }, milliseconds);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
  });
}

async function openHostedToolbarPip(tab) {
  if (!Number.isInteger(tab?.id)) return { ok: false, error: "missing-tab" };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [HOSTED_PIP_SCRIPT]
    });
    const value = (Array.isArray(results) ? results : []).find((item) => item?.frameId === 0)?.result;
    return value?.ok
      ? { ok: true, tabId: tab.id, reused: Boolean(value.reused) }
      : { ok: false, tabId: tab.id, error: value?.error || "document-picture-in-picture-failed" };
  } catch (error) {
    return { ok: false, tabId: tab.id, error: friendlyError(error) };
  }
}

async function getHostedToolbarPipTabId() {
  if (Number.isInteger(hostedToolbarPipTabId)) return hostedToolbarPipTabId;
  try {
    const stored = await chrome.storage.local.get([HOSTED_PIP_TAB_STORAGE_KEY]);
    const tabId = Number(stored?.[HOSTED_PIP_TAB_STORAGE_KEY]);
    hostedToolbarPipTabId = Number.isInteger(tabId) ? tabId : null;
  } catch {
    hostedToolbarPipTabId = null;
  }
  return hostedToolbarPipTabId;
}

async function setHostedToolbarPipTabId(tabId) {
  hostedToolbarPipTabId = Number.isInteger(tabId) ? tabId : null;
  if (Number.isInteger(hostedToolbarPipTabId)) {
    await chrome.storage.local.set({ [HOSTED_PIP_TAB_STORAGE_KEY]: hostedToolbarPipTabId }).catch(() => undefined);
  } else {
    await chrome.storage.local.remove(HOSTED_PIP_TAB_STORAGE_KEY).catch(() => undefined);
  }
}

async function registerHostedToolbarPip(tabId) {
  if (!Number.isInteger(tabId)) return { ok: false, error: "Unable to identify the hosted translator tab." };
  const previousTabId = await getHostedToolbarPipTabId();
  await setHostedToolbarPipTabId(tabId);
  if (Number.isInteger(previousTabId) && previousTabId !== tabId) {
    await closeHostedToolbarPip(previousTabId, { clearRegistration: false });
  }
  return { ok: true, tabId };
}

async function clearHostedToolbarPip(expectedTabId = null) {
  const currentTabId = await getHostedToolbarPipTabId();
  if (Number.isInteger(expectedTabId) && currentTabId !== expectedTabId) return;
  await setHostedToolbarPipTabId(null);
}

async function sendMessageToHostedPip(tabId, message, timeoutMs = TOOLBAR_MESSAGE_TIMEOUT_MS) {
  if (!Number.isInteger(tabId)) throw new Error("Unable to identify the pinned translator window.");
  return withTimeout(
    chrome.tabs.sendMessage(tabId, message),
    timeoutMs,
    "Pinned translator window response timed out."
  );
}

async function closeHostedToolbarPip(tabId = null, options = {}) {
  const resolvedTabId = Number.isInteger(tabId) ? tabId : await getHostedToolbarPipTabId();
  if (!Number.isInteger(resolvedTabId)) return;
  try {
    await sendMessageToHostedPip(resolvedTabId, { type: "HOSTED_PIP_CLOSE" });
  } catch {
    // The host may already be gone after a navigation, reload, or native close.
  }
  if (options.clearRegistration !== false && resolvedTabId === await getHostedToolbarPipTabId()) {
    await setHostedToolbarPipTabId(null);
  }
}

async function sendMessageToToolbarWindow(windowId, message, timeoutMs = TOOLBAR_MESSAGE_TIMEOUT_MS) {
  // Runtime messaging reaches extension pages such as popup.html. tabs.sendMessage
  // only targets content scripts and therefore cannot reliably control this window.
  // Selection routing uses a slightly longer timeout because Edge can briefly pause
  // an extension window while the browser is processing a new selection.
  await withTimeout(
    chrome.windows.get(windowId),
    timeoutMs,
    "\u7ffb\u8bd1\u7a97\u53e3\u54cd\u5e94\u8d85\u65f6\u3002"
  );
  return sendRuntimeMessageWithTimeout(
    { ...message, targetWindowId: windowId },
    timeoutMs
  );
}

async function closeToolbarPopupWindow(exceptWindowId = null) {
  const candidateIds = new Set();
  const registered = await getRegisteredToolbarPopupWindow();
  if (Number.isInteger(registered?.id)) candidateIds.add(registered.id);

  try {
    const windows = await findToolbarPopupWindows();
    for (const browserWindow of windows) {
      if (Number.isInteger(browserWindow.id)) candidateIds.add(browserWindow.id);
    }
  } catch {
    // The tracked id is still useful if the query temporarily fails.
  }

  const closingIds = [...candidateIds].filter((windowId) => windowId !== exceptWindowId);
  // A pinned Document PiP window is owned by popup.html, but is not removed by
  // chrome.windows.remove(). Ask its owner to close it before removing the owner.
  await Promise.allSettled(closingIds.map(async (windowId) => {
    try {
      await sendMessageToToolbarWindow(windowId, { type: "CLOSE_TOOLBAR_WINDOW" });
    } catch {
      // It can be loading or already gone; removal below is still required.
    }
  }));

  await Promise.allSettled(closingIds.map((windowId) => chrome.windows.remove(windowId)));
  toolbarPopupWindowId = Number.isInteger(exceptWindowId) ? exceptWindowId : null;
  if (Number.isInteger(toolbarPopupWindowId)) {
    const keptWindow = await getLiveToolbarPopupWindow(toolbarPopupWindowId, toolbarPopupTabId);
    if (!keptWindow) {
      toolbarPopupWindowId = null;
      toolbarPopupTabId = null;
    } else if (!Number.isInteger(toolbarPopupTabId)) {
      const popupTab = getToolbarPopupTab(keptWindow);
      toolbarPopupTabId = Number.isInteger(popupTab?.id) ? popupTab.id : null;
    }
  } else {
    toolbarPopupTabId = null;
  }
  if (Number.isInteger(toolbarPopupWindowId)) {
    await chrome.storage.local.set({
      [TOOLBAR_WINDOW_STORAGE_KEY]: toolbarPopupWindowId,
      [TOOLBAR_TAB_STORAGE_KEY]: toolbarPopupTabId
    }).catch(() => undefined);
  } else {
    await chrome.storage.local.remove([
      TOOLBAR_WINDOW_STORAGE_KEY,
      TOOLBAR_TAB_STORAGE_KEY
    ]).catch(() => undefined);
  }
}

async function registerToolbarPopup(windowId, tabId = null) {
  if (!Number.isInteger(windowId)) return { ok: false, error: "\u672a\u80fd\u8bc6\u522b\u5b8f\u8bd1\u83dc\u5355\u680f\u7a97\u53e3\u3002" };

  await runPopupCoordination(async () => {
    await closeHostedToolbarPip();
    await closeToolbarPopupWindow(windowId);
    toolbarPopupWindowId = windowId;
    toolbarPopupTabId = Number.isInteger(tabId) ? tabId : null;
    await chrome.storage.local.set({
      [TOOLBAR_WINDOW_STORAGE_KEY]: windowId,
      [TOOLBAR_TAB_STORAGE_KEY]: toolbarPopupTabId
    });
  });
  return { ok: true, windowId };
}

async function routeSelectionToOpenToolbarPopup(rawText, sourceWindowId = null) {
  if (Number.isInteger(sourceWindowId)) {
    await chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: sourceWindowId }).catch(() => undefined);
  }
  if (!await isExtensionEnabled()) return { ok: true, routed: false, disabled: true };
  const text = normalizeText(rawText);
  if (!text) return { ok: true, routed: false };

  const hostedTabId = await getHostedToolbarPipTabId();
  if (Number.isInteger(hostedTabId)) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await sendMessageToHostedPip(hostedTabId, {
          type: "HOSTED_PIP_APPLY_TEXT",
          text,
          source: "selection"
        }, SELECTION_ROUTE_MESSAGE_TIMEOUT_MS);
        if (response?.ok) return { ok: true, routed: true, hosted: true, tabId: hostedTabId };
      } catch {
        // Retry briefly while the hosted iframe finishes loading.
      }
      if (attempt < 2) await wait(60);
    }
    await clearHostedToolbarPip(hostedTabId);
  }

  // This path must not wait behind popupCoordinationQueue. Opening/closing a
  // toolbar window can involve stale windows or a Document-PiP restore and may
  // take longer than the short selection event window. If we wait there, a new
  // Edge selection is lost and the toolbar keeps showing the previous text.
  const candidates = [];
  const candidateIds = new Set();

  // Prefer the id registered by the visible popup. This remains reliable while
  // Edge temporarily omits the popup tab URL from windows.getAll().
  const registered = await getRegisteredToolbarPopupWindow();
  if (registered && Number.isInteger(registered.id)) {
    candidates.push(registered);
    candidateIds.add(registered.id);
  }

  try {
    const windows = await findToolbarPopupWindows();
    for (const browserWindow of windows) {
      if (!Number.isInteger(browserWindow.id) || candidateIds.has(browserWindow.id)) continue;
      candidates.push(browserWindow);
      candidateIds.add(browserWindow.id);
    }
  } catch {
    // The registered window above is still enough to route the selection.
  }

  if (!candidates.length) return { ok: true, routed: false };

  const canonical = candidates.find((item) => item.id === toolbarPopupWindowId) || candidates[0];
  const canonicalId = canonical.id;
  toolbarPopupWindowId = canonicalId;
  const canonicalTab = getToolbarPopupTab(canonical);
  if (Number.isInteger(canonicalTab?.id)) toolbarPopupTabId = canonicalTab.id;
  await chrome.storage.local.set({
    [TOOLBAR_WINDOW_STORAGE_KEY]: canonicalId,
    [TOOLBAR_TAB_STORAGE_KEY]: toolbarPopupTabId
  }).catch(() => undefined);

  // Remove duplicate translator windows without making the current selection
  // wait for their page-side CLOSE messages. The canonical window is never
  // included, so it remains available for the APPLY_SELECTION_TEXT message.
  const duplicateIds = candidates
    .map((item) => item.id)
    .filter((windowId) => windowId !== canonicalId);
  for (const windowId of duplicateIds) {
    void sendMessageToToolbarWindow(windowId, { type: "CLOSE_TOOLBAR_WINDOW" }).catch(() => undefined);
    void chrome.windows.remove(windowId).catch(() => undefined);
  }

  const message = {
    type: "APPLY_SELECTION_TEXT",
    text,
    source: "selection"
  };

  // popup.html may still be finishing initialization immediately after the
  // window becomes visible. Retry independently of normal window coordination.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await sendMessageToToolbarWindow(
        canonicalId,
        message,
        SELECTION_ROUTE_MESSAGE_TIMEOUT_MS
      );
      if (response?.ok) {
        return { ok: true, routed: true, windowId: canonicalId };
      }
    } catch {
      // Retry while the extension page is loading or being restored.
    }
    if (attempt < 3) await wait(80);
  }

  return { ok: true, routed: false };
}

async function focusToolbarPopupWindow(windowId = toolbarPopupWindowId) {
  if (!Number.isInteger(windowId)) return { ok: false };
  try {
    const response = await sendMessageToToolbarWindow(windowId, { type: "FOCUS_TOOLBAR_WINDOW" });
    if (response?.ok) return { ok: true };
  } catch {
    // Fall back to the normal Edge window API if popup messaging is still loading.
  }
  try {
    await chrome.windows.update(windowId, { state: "normal", focused: true });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function getTextForToolbarPopup(tab) {
  return await readSelectionFromTab(tab?.id);
}

async function readSelectionFromTab(tabId) {
  if (!Number.isInteger(tabId)) return "";

  // First ask the installed content script. It knows about selections inside
  // text inputs and can return the exact current selection without stealing
  // focus from Edge.
  try {
    const response = await withTimeout(
      chrome.tabs.sendMessage(tabId, { type: "GET_CURRENT_SELECTION" }),
      700,
      "\u7f51\u9875\u9009\u533a\u54cd\u5e94\u8d85\u65f6\u3002"
    );
    const text = normalizeText(response?.text || "");
    if (text) return text;
  } catch {
    // The page may be old (opened before the extension was reloaded), a
    // restricted page, or a frame without the content script. Use the direct
    // active-tab probe below as a fallback.
  }

  // Do not fall back to clipboard here. This function is specifically the
  // selection source and is used before every clipboard read. A direct probe
  // keeps the priority rule intact even when the content script missed an
  // event or has not been injected into an already-open tab.
  try {
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const active = document.activeElement;
          if (
            active &&
            (active.tagName === "TEXTAREA" || active.tagName === "INPUT") &&
            Number.isInteger(active.selectionStart) &&
            active.selectionStart !== active.selectionEnd
          ) {
            return String(active.value || "").slice(active.selectionStart, active.selectionEnd).trim();
          }
          const selection = window.getSelection?.();
          return selection && !selection.isCollapsed ? String(selection.toString() || "").trim() : "";
        }
      }),
      900,
      "\u7f51\u9875\u9009\u533a\u8bfb\u53d6\u8d85\u65f6\u3002"
    );
    for (const item of Array.isArray(results) ? results : []) {
      const text = normalizeText(item?.result || "");
      if (text) return text;
    }
  } catch {
    // Restricted pages (edge://, PDF viewer, extensions, etc.) cannot be
    // probed. Only in this case does the caller continue to clipboard fallback.
  }

  return "";
}


async function readSelectionFromEdgeWindow(windowId) {
  const candidateWindowIds = [];
  const seenWindowIds = new Set();
  const addWindowId = (value) => {
    const id = Number(value);
    if (!Number.isInteger(id) || seenWindowIds.has(id)) return;
    seenWindowIds.add(id);
    candidateWindowIds.push(id);
  };

  // The explicit id comes from the menu-bar window's remembered Edge window
  // and must be tried first. Storage is a fallback for service-worker restarts.
  addWindowId(windowId);
  try {
    const stored = await chrome.storage.local.get([LAST_EDGE_WINDOW_STORAGE_KEY]);
    addWindowId(stored?.[LAST_EDGE_WINDOW_STORAGE_KEY]);
  } catch {
    // Continue with live normal-window discovery.
  }

  try {
    const windows = await chrome.windows.getAll({ populate: false });
    for (const browserWindow of windows) {
      if (browserWindow?.type === "normal" && browserWindow.focused) addWindowId(browserWindow.id);
    }
    for (const browserWindow of windows) {
      if (browserWindow?.type === "normal") addWindowId(browserWindow.id);
    }
  } catch {
    // The remembered window id may still be valid.
  }

  for (const candidateWindowId of candidateWindowIds) {
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId: candidateWindowId });
      const tabId = Number(tabs?.[0]?.id);
      if (!Number.isInteger(tabId)) continue;
      const text = await readSelectionFromTab(tabId);
      if (text) {
        await chrome.storage.local.set({
          [LAST_EDGE_WINDOW_STORAGE_KEY]: candidateWindowId
        }).catch(() => undefined);
        return text;
      }
    } catch {
      // Try the next remembered normal Edge window.
    }
  }

  return "";
}

async function openMovableToolbarPopup(browserWindowId, text = "") {
  await closeHostedToolbarPip();
  if (Number.isInteger(browserWindowId)) {
    await chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: browserWindowId }).catch(() => undefined);
  }
  const normalizedText = normalizeText(text);
  const registered = await getRegisteredToolbarPopupWindow();
  let existing = registered ? [registered] : [];
  try {
    const discovered = await findToolbarPopupWindows();
    const knownIds = new Set(existing.map((item) => item.id));
    existing.push(...discovered.filter((item) => !knownIds.has(item.id)));
  } catch {
    // The registered window, when present, is still enough to reuse it.
  }

  if (existing.length) {
    const canonical = existing.find((item) => item.id === toolbarPopupWindowId) || existing[0];
    const canonicalId = canonical.id;
    await closeToolbarPopupWindow(canonicalId);
    toolbarPopupWindowId = canonicalId;
    const canonicalTab = getToolbarPopupTab(canonical);
    if (Number.isInteger(canonicalTab?.id)) toolbarPopupTabId = canonicalTab.id;
    await chrome.storage.local.set({
      [TOOLBAR_WINDOW_STORAGE_KEY]: canonicalId,
      [TOOLBAR_TAB_STORAGE_KEY]: toolbarPopupTabId
    }).catch(() => undefined);

    if (normalizedText) {
      await sendMessageToToolbarWindow(canonicalId, {
        type: "APPLY_SELECTION_TEXT",
        text: normalizedText,
        source: "selection"
      }).catch(() => undefined);
    }
    await focusToolbarPopupWindow(canonicalId);
    return canonical;
  }

  const browserWindow = browserWindowId
    ? await chrome.windows.get(browserWindowId)
    : await chrome.windows.getCurrent();
  const width = 430;
  const height = Math.max(420, Math.min(720, (browserWindow.height || 800) - 92));
  const left = Math.round((browserWindow.left || 0) + (browserWindow.width || 1200) - width - 12);
  const top = Math.round((browserWindow.top || 0) + 68);

  const created = await chrome.windows.create({
    url: chrome.runtime.getURL("popup/popup.html?mode=window"),
    type: "popup",
    focused: true,
    width,
    height,
    left,
    top
  });

  toolbarPopupWindowId = created.id ?? null;
  toolbarPopupTabId = Number.isInteger(created?.tabs?.[0]?.id) ? created.tabs[0].id : null;
  if (Number.isInteger(toolbarPopupWindowId)) {
    await chrome.storage.local.set({
      [TOOLBAR_WINDOW_STORAGE_KEY]: toolbarPopupWindowId,
      [TOOLBAR_TAB_STORAGE_KEY]: toolbarPopupTabId
    }).catch(() => undefined);
  }
  return created;
}

function runOffscreenClipboardOperation(task) {
  const operation = offscreenClipboardQueue
    .catch(() => undefined)
    .then(task);
  offscreenClipboardQueue = operation.catch(() => undefined);
  return operation;
}

function readClipboardFromOffscreen() {
  return runOffscreenClipboardOperation(() => performReadClipboardFromOffscreen());
}

async function performReadClipboardFromOffscreen() {
  if (!chrome.offscreen) {
    throw new Error("当前 Edge 版本不支持后台读取剪贴板。");
  }

  await withTimeout(
    ensureOffscreenDocument(),
    CLIPBOARD_MESSAGE_TIMEOUT_MS,
    "\u526a\u8d34\u677f\u540e\u53f0\u9875\u9762\u54cd\u5e94\u8d85\u65f6\u3002"
  );

  try {
    const response = await sendRuntimeMessageWithTimeout({
      type: "OFFSCREEN_READ_CLIPBOARD"
    }, CLIPBOARD_MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
      throw new Error(response?.error || "无法读取剪贴板。");
    }

    return {
      ok: true,
      text: normalizeText(response.text || "")
    };
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // It may already have been closed by another request.
    }
  }
}

function writeClipboardToOffscreen(rawText) {
  return runOffscreenClipboardOperation(() => performWriteClipboardToOffscreen(rawText));
}

async function performWriteClipboardToOffscreen(rawText) {
  if (!chrome.offscreen) {
    throw new Error("\u5f53\u524d Edge \u7248\u672c\u4e0d\u652f\u6301\u540e\u53f0\u5199\u5165\u526a\u8d34\u677f\u3002");
  }

  const text = String(rawText || "");
  await withTimeout(
    ensureOffscreenDocument(),
    CLIPBOARD_MESSAGE_TIMEOUT_MS,
    "\u526a\u8d34\u677f\u540e\u53f0\u9875\u9762\u54cd\u5e94\u8d85\u65f6\u3002"
  );

  try {
    const response = await sendRuntimeMessageWithTimeout({
      type: "OFFSCREEN_WRITE_CLIPBOARD",
      text
    }, CLIPBOARD_MESSAGE_TIMEOUT_MS);

    if (!response?.ok) {
      throw new Error(response?.error || "\u65e0\u6cd5\u5199\u5165\u526a\u8d34\u677f\u3002");
    }

    return { ok: true };
  } finally {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // It may already have been closed by another request.
    }
  }
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);

  if (await hasOffscreenDocument(offscreenUrl)) return;

  if (creatingOffscreenDocument) {
    await creatingOffscreenDocument;
    return;
  }

  creatingOffscreenDocument = chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: [chrome.offscreen.Reason?.CLIPBOARD || "CLIPBOARD"],
    justification: "Read and write clipboard text for the user-requested translation operation."
  });

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = null;
  }
}

async function hasOffscreenDocument(offscreenUrl) {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }

  const matchedClients = await clients.matchAll();
  return matchedClients.some((client) => client.url === offscreenUrl);
}

async function prepareSelection(rawText, browserWindowId) {
  if (Number.isInteger(browserWindowId)) {
    await chrome.storage.local.set({ [LAST_EDGE_WINDOW_STORAGE_KEY]: browserWindowId }).catch(() => undefined);
  }
  if (!await isExtensionEnabled()) {
    return { ok: false, disabled: true, error: "插件已关闭。" };
  }
  const text = normalizeText(rawText);
  if (!text) throw new Error("没有可翻译的文本。");

  await savePendingSelection(text);

  try {
    await runPopupCoordination(async () => {
      await closeAllFloatingPanels();
      await openMovableToolbarPopup(browserWindowId, text);
      await closeAllFloatingPanels();
    });
    return { ok: true, popupOpened: true };
  } catch (error) {
    return {
      ok: true,
      popupOpened: false,
      reason: friendlyError(error)
    };
  }
}

async function savePendingSelection(text) {
  await chrome.storage.local.set({
    pendingSelection: {
      text,
      createdAt: Date.now()
    }
  });
}

async function saveDeepSeekApiKey(rawKey) {
  const apiKey = String(rawKey || "").trim();
  if (!apiKey) throw new Error("\u8bf7\u5148\u8f93\u5165 DeepSeek API Key\u3002");

  await chrome.storage.local.set({
    deepseekApiKey: apiKey,
    deepseekApiConfigured: true
  });
  return { ok: true, configured: true };
}

async function clearDeepSeekApiKey() {
  await chrome.storage.local.remove("deepseekApiKey");
  await chrome.storage.local.set({ deepseekApiConfigured: false });
  return { ok: true, configured: false };
}

async function translateMultiMessage(message) {
  const text = normalizeText(message.text);
  if (!text) throw new Error("请输入或选中需要翻译的文本。");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`一次最多翻译 ${MAX_TEXT_LENGTH} 个字符。`);
  }

  const providers = normalizeProviders(message.providers);
  const forceRefresh = Boolean(message.forceRefresh);
  const sourceLanguage = normalizeSourceLanguage(message.sourceLanguage || "auto");
  const requestedTarget = message.targetLanguage || "zh-CN";
  const targetLanguage = resolveTargetLanguage(requestedTarget, text);
  const settings = await chrome.storage.local.get(["deepseekApiKey"]);
  const deepseekApiKey = String(settings.deepseekApiKey || "").trim();

  const results = await Promise.all(providers.map(async (provider) => {
    try {
      let translatedText = "";
      if (provider === "google") {
        const key = `google\n${sourceLanguage}\n${targetLanguage}\n${text}`;
        translatedText = forceRefresh ? "" : (cache.get(key) || "");
        if (!translatedText) {
          translatedText = await translateTextInChunks(
            text,
            (chunk) => fetchGoogleTranslation(chunk, sourceLanguage, targetLanguage)
          );
          rememberTranslation(key, translatedText);
        }
      } else if (provider === "deepseek") {
        if (!deepseekApiKey) {
          throw new Error("\u8bf7\u5148\u5728\u5b8f\u8bd1\u5de5\u5177\u680f\u7a97\u53e3\u4e2d\u586b\u5199\u5e76\u4fdd\u5b58 DeepSeek API Key\u3002");
        }
        const key = `deepseek\n${targetLanguage}\n${text}`;
        translatedText = forceRefresh ? "" : (cache.get(key) || "");
        if (!translatedText) {
          translatedText = await translateTextInChunks(
            text,
            (chunk) => fetchDeepSeekTranslation(chunk, targetLanguage, deepseekApiKey)
          );
          rememberTranslation(key, translatedText);
        }
      } else if (provider === "deepl") {
        const deepLSourceLanguage = sourceLanguage === "auto"
          ? "auto"
          : normalizeDeepLSourceLanguage(sourceLanguage);
        const deepLTargetLanguage = normalizeDeepLTargetLanguage(targetLanguage);
        const key = `deepl\n${deepLSourceLanguage}\n${deepLTargetLanguage}\n${text}`;
        translatedText = forceRefresh ? "" : (cache.get(key) || "");
        if (!translatedText) {
          translatedText = await runDeepLTranslationQueue(() => translateTextInChunks(
            text,
            (chunk) => fetchDeepLOneShotTranslation(
              chunk,
              deepLSourceLanguage,
              deepLTargetLanguage
            ),
            DEEPL_TRANSLATION_CHUNK_LENGTH,
            { concurrency: 3 }
          ));
          rememberTranslation(key, translatedText);
        }
      }

      return {
        provider,
        label: getProviderLabel(provider),
        ok: true,
        translatedText
      };
    } catch (error) {
      return {
        provider,
        label: getProviderLabel(provider),
        ok: false,
        error: friendlyError(error)
      };
    }
  }));

  const record = {
    sourceText: text,
    sourceLanguage,
    targetLanguage,
    requestedTarget,
    providers,
    results,
    translatedAt: Date.now()
  };
  await chrome.storage.local.set({ lastTranslation: record });
  return { ok: true, ...record };
}

function getProviderLabel(provider) {
  if (provider === "deepl") return "DeepL";
  if (provider === "deepseek") return "DeepSeek";
  return "\u8c37\u6b4c\u7ffb\u8bd1";
}

function normalizeProviders(value) {
  const allowed = new Set(["google", "deepseek", "deepl"]);
  const providers = Array.isArray(value)
    ? [...new Set(value.filter((provider) => allowed.has(provider)))]
    : [];
  return providers.length ? providers : ["google"];
}

function rememberTranslation(key, value) {
  cache.set(key, value);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
}

function splitTextForTranslation(text, maxLength = TRANSLATION_CHUNK_LENGTH) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLength, text.length);
    if (end < text.length) {
      const segment = text.slice(start, end);
      const minimumBreakIndex = Math.floor(segment.length * 0.55);
      let boundary = -1;
      for (const separator of ["\n", "?", "?", "?", ".", "!", "?", "?", ";", "?", ",", " "]) {
        const index = segment.lastIndexOf(separator);
        if (index >= minimumBreakIndex) {
          boundary = Math.max(boundary, index + separator.length);
        }
      }
      if (boundary > 0) end = start + boundary;
    }

    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

async function translateTextInChunks(text, translateChunk, maxLength = TRANSLATION_CHUNK_LENGTH, options = {}) {
  const chunks = splitTextForTranslation(text, maxLength);
  if (chunks.length === 1) return translateChunk(chunks[0]);

  const concurrency = Math.max(1, Math.min(Number(options.concurrency) || 1, chunks.length));
  if (concurrency === 1) {
    const translatedChunks = [];
    for (let index = 0; index < chunks.length; index += 1) {
      try {
        translatedChunks.push(await translateChunk(chunks[index]));
      } catch (error) {
        throw new Error(`\u7b2c ${index + 1}/${chunks.length} \u6bb5\u7ffb\u8bd1\u5931\u8d25\uff1a${friendlyError(error)}`);
      }
    }
    return translatedChunks.join("\n\n");
  }

  const translatedChunks = new Array(chunks.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= chunks.length) return;
      try {
        translatedChunks[index] = await translateChunk(chunks[index]);
      } catch (error) {
        throw new Error(`\u7b2c ${index + 1}/${chunks.length} \u6bb5\u7ffb\u8bd1\u5931\u8d25\uff1a${friendlyError(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return translatedChunks.join("\n\n");
}

async function fetchDeepSeekTranslation(text, targetLanguage, apiKey) {
  const targetName = getTargetLanguageName(targetLanguage);
  const response = await fetch(DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the user's text into ${targetName}. Preserve paragraphs, punctuation, names, numbers, and formatting. Return only the translation without explanations, labels, or quotation marks.`
        },
        { role: "user", content: text }
      ],
      thinking: { type: "disabled" },
      temperature: 0.2
    })
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The status-specific message below is clearer than a JSON parsing error.
  }

  if (!response.ok) {
    const detail = payload?.error?.message || "";
    if (response.status === 401) throw new Error("DeepSeek API Key 无效或已失效。");
    if (response.status === 402) throw new Error("DeepSeek API 余额不足，请先充值。");
    if (response.status === 429) throw new Error("DeepSeek API 请求过于频繁，请稍后重试。");
    throw new Error(`DeepSeek API 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : "。"}`);
  }

  const translatedText = String(payload?.choices?.[0]?.message?.content || "").trim();
  if (!translatedText) throw new Error("DeepSeek 返回了空结果。");
  return translatedText;
}

function getTargetLanguageName(language) {
  const names = {
    "zh-CN": "Simplified Chinese",
    "zh-TW": "Traditional Chinese",
    en: "English",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    de: "German",
    es: "Spanish",
    ru: "Russian"
  };
  return names[language] || "Simplified Chinese";
}

async function translateMessage(message) {
  const text = normalizeText(message.text);
  if (!text) throw new Error("请输入或选中需要翻译的文本。");
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`一次最多翻译 ${MAX_TEXT_LENGTH} 个字符。`);
  }

  const sourceLanguage = normalizeSourceLanguage(message.sourceLanguage || "auto");
  const requestedTarget = message.targetLanguage || "zh-CN";
  const targetLanguage = resolveTargetLanguage(requestedTarget, text);
  const key = `${sourceLanguage}\n${targetLanguage}\n${text}`;

  let result = cache.get(key);
  if (!result) {
    result = await translateTextInChunks(
      text,
      (chunk) => fetchGoogleTranslation(chunk, sourceLanguage, targetLanguage)
    );
    cache.set(key, result);
    if (cache.size > 80) {
      cache.delete(cache.keys().next().value);
    }
  }

  const record = {
    sourceText: text,
    translatedText: result,
    sourceLanguage,
    targetLanguage,
    requestedTarget,
    translatedAt: Date.now()
  };

  await chrome.storage.local.set({ lastTranslation: record });
  return { ok: true, ...record };
}

async function fetchGoogleTranslation(text, sourceLanguage, targetLanguage) {
  const requestKey = `${sourceLanguage}\n${targetLanguage}\n${text}`;
  const pendingRequest = googleChunkRequests.get(requestKey);
  if (pendingRequest) return pendingRequest;

  const request = runGoogleRequest(async () => {
    let batchError = null;
    try {
      // Prefer the channel used by the current Google Translate web page. It
      // commonly remains available when the legacy mobile result page is 429.
      return await fetchGoogleBatchTranslation(text, sourceLanguage, targetLanguage);
    } catch (error) {
      batchError = error;
    }

    try {
      // Retain the previous mobile-page parser as a compatibility fallback.
      return await fetchGoogleMobileTranslation(text, sourceLanguage, targetLanguage);
    } catch (mobileError) {
      if (batchError?.status === 429 || mobileError?.status === 429) {
        throw new Error("Google \u7ffb\u8bd1\u6682\u65f6\u9650\u5236\u4e86\u5f53\u524d\u7f51\u7edc\u7684\u81ea\u52a8\u8bf7\u6c42\uff08HTTP 429\uff09\u3002\u8bf7\u7a0d\u540e\u70b9\u51fb\u5237\u65b0\uff1b\u6269\u5c55\u5df2\u81ea\u52a8\u5207\u6362\u5e76\u5c1d\u8bd5\u4e24\u6761\u514d API \u7ffb\u8bd1\u901a\u9053\u3002");
      }
      throw batchError || mobileError;
    }
  }).finally(() => {
    if (googleChunkRequests.get(requestKey) === request) {
      googleChunkRequests.delete(requestKey);
    }
  });

  googleChunkRequests.set(requestKey, request);
  return request;
}

function runGoogleRequest(task) {
  const operation = googleRequestQueue
    .catch(() => undefined)
    .then(async () => {
      const waitMs = Math.max(
        0,
        GOOGLE_REQUEST_MIN_INTERVAL_MS - (Date.now() - lastGoogleRequestStartedAt)
      );
      if (waitMs > 0) await wait(waitMs);
      lastGoogleRequestStartedAt = Date.now();
      return task();
    });
  googleRequestQueue = operation.catch(() => undefined);
  return operation;
}

async function fetchGoogleBatchTranslation(text, sourceLanguage, targetLanguage) {
  const url = new URL(GOOGLE_BATCH_TRANSLATE_URL);
  url.searchParams.set("rpcids", "MkEWBc");
  url.searchParams.set("source-path", "/");
  url.searchParams.set("hl", "en");
  url.searchParams.set("soc-app", "1");
  url.searchParams.set("soc-platform", "1");
  url.searchParams.set("soc-device", "1");
  url.searchParams.set("rt", "c");

  const requestPayload = JSON.stringify([[
    ["MkEWBc", JSON.stringify([[text, sourceLanguage, targetLanguage, true], [null]]), null, "generic"]
  ]]);
  const body = new URLSearchParams({ "f.req": requestPayload });
  const response = await fetch(url.toString(), {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/json,text/plain,*/*"
    },
    body: body.toString()
  });

  if (!response.ok) {
    const error = new Error(`Google \u7f51\u9875\u7ffb\u8bd1\u8bf7\u6c42\u5931\u8d25\uff08HTTP ${response.status}\uff09\u3002`);
    error.status = response.status;
    throw error;
  }

  return parseGoogleBatchTranslation(await response.text());
}

function parseGoogleBatchTranslation(responseText) {
  for (const line of String(responseText || "").split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith("[[")) continue;

    let responseRows;
    try {
      responseRows = JSON.parse(candidate);
    } catch {
      continue;
    }

    const translationRow = Array.isArray(responseRows)
      ? responseRows.find((row) => Array.isArray(row) && row[0] === "wrb.fr" && row[1] === "MkEWBc")
      : null;
    if (!translationRow || typeof translationRow[2] !== "string") continue;

    let payload;
    try {
      payload = JSON.parse(translationRow[2]);
    } catch {
      continue;
    }

    const blocks = Array.isArray(payload?.[1]?.[0]) ? payload[1][0] : [];
    const translatedParts = [];
    for (const block of blocks) {
      const segments = Array.isArray(block?.[5]) ? block[5] : [];
      for (const segment of segments) {
        if (typeof segment?.[0] === "string") translatedParts.push(segment[0]);
      }
    }

    const translatedText = translatedParts.join("").trim();
    if (translatedText) return translatedText;
  }

  throw new Error("\u6ca1\u6709\u4ece Google \u4e3b\u7f51\u9875\u7ffb\u8bd1\u54cd\u5e94\u4e2d\u8bfb\u53d6\u5230\u7ed3\u679c\uff0c\u5df2\u51c6\u5907\u5c1d\u8bd5\u517c\u5bb9\u901a\u9053\u3002");
}

async function fetchGoogleMobileTranslation(text, sourceLanguage, targetLanguage) {
  const url = new URL("https://translate.google.com/m");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("q", text);

  const response = await fetch(url.toString(), {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow"
  });

  if (!response.ok) {
    const error = new Error(`谷歌翻译请求失败（HTTP ${response.status}）。`);
    error.status = response.status;
    throw error;
  }

  const html = await response.text();

  if (/unusual traffic|automated queries|detected unusual traffic/i.test(html)) {
    throw new Error("谷歌暂时限制了当前网络的自动翻译请求，请稍后再试或点击“在谷歌翻译中打开”。");
  }

  const match = html.match(
    /<div[^>]*class=["'][^"']*\bresult-container\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i
  );

  if (!match) {
    throw new Error("没有从谷歌翻译页面读取到结果，页面结构可能已更新。");
  }

  const translatedText = decodeHtml(
    match[1]
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).trim();

  if (!translatedText) {
    throw new Error("谷歌翻译返回了空结果。");
  }

  return translatedText;
}


async function cleanupLegacyDeepLWorker() {
  const storageAreas = [chrome.storage.session, chrome.storage.local].filter(Boolean);
  const handledTabs = new Set();
  const handledWindows = new Set();

  for (const storageArea of storageAreas) {
    let state = null;
    try {
      const stored = await storageArea.get([LEGACY_DEEPL_WORKER_STORAGE_KEY]);
      state = stored?.[LEGACY_DEEPL_WORKER_STORAGE_KEY] || null;
    } catch {
      state = null;
    }

    await storageArea.remove(LEGACY_DEEPL_WORKER_STORAGE_KEY).catch(() => undefined);
    if (!Number.isInteger(state?.tabId) || handledTabs.has(state.tabId)) continue;
    handledTabs.add(state.tabId);

    try {
      const tab = await chrome.tabs.get(state.tabId);
      if (!/^https:\/\/www\.deepl\.com\//i.test(String(tab?.url || ""))) continue;

      if (state.backgroundWindow && Number.isInteger(state.windowId) && !handledWindows.has(state.windowId)) {
        handledWindows.add(state.windowId);
        await chrome.windows.remove(state.windowId).catch(() => chrome.tabs.remove(state.tabId));
      } else {
        await chrome.tabs.remove(state.tabId);
      }
    } catch {
      // The legacy worker tab/window is already gone.
    }
  }
}

async function openDeepLTranslator(message) {
  const text = normalizeText(message.text || "");
  const sourceLanguage = await resolveDeepLSourceLanguage(
    normalizeSourceLanguage(message.sourceLanguage || "auto"),
    text
  );
  const targetLanguage = resolveTargetLanguage(message.targetLanguage || "zh-CN", text);
  const url = text
    ? buildDeepLTranslateUrl(text, sourceLanguage, targetLanguage)
    : DEEPL_TRANSLATOR_URL;
  await chrome.tabs.create({ url });
}

function runDeepLTranslationQueue(task) {
  // Do not serialize a new selection behind an old/stale DeepL request. The
  // content card already ignores stale responses, so the latest request can
  // start immediately and return the fastest visible result.
  return Promise.resolve().then(task);
}

async function fetchDeepLOneShotTranslation(text, sourceLanguage, targetLanguage) {
  const deepLSource = sourceLanguage === "auto"
    ? ""
    : normalizeDeepLSourceLanguage(sourceLanguage);
  const deepLTarget = normalizeDeepLTargetLanguage(targetLanguage);

  if (deepLSource && getDeepLLanguageBase(deepLSource) === getDeepLLanguageBase(deepLTarget)) {
    return text;
  }

  const instanceId = await getDeepLInstanceId();
  const body = {
    text: [text],
    target_lang: deepLTarget,
    usage_type: "translate",
    app_information: {
      os: "iOS",
      os_version: "26.0",
      app_version: "26.42",
      app_build: "5443737",
      instance_id: instanceId
    }
  };
  if (deepLSource) body.source_lang = deepLSource;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEEPL_TRANSLATION_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(DEEPL_ONESHOT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "None",
        "x-app-os-version": "26.0",
        "x-app-instance-id": instanceId,
        "x-app-session-id": deepLSessionId,
        Accept: "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("DeepL \u7ffb\u8bd1\u8bf7\u6c42\u8d85\u65f6\uff0c\u8bf7\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002");
    }
    throw new Error(`\u65e0\u6cd5\u8fde\u63a5 DeepL \u7ffb\u8bd1\u670d\u52a1\uff1a${friendlyError(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Use the status-specific message below when the service returns non-JSON.
  }

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error("DeepL \u6682\u65f6\u62d2\u7edd\u4e86\u514d API \u8bf7\u6c42\uff0c\u8bf7\u7a0d\u540e\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002");
    }
    if (response.status === 413) {
      throw new Error("DeepL \u5355\u6b21\u6587\u672c\u8fc7\u957f\uff0c\u6269\u5c55\u4f1a\u5206\u6bb5\u7ffb\u8bd1\uff1b\u8bf7\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002");
    }
    if (response.status === 429) {
      throw new Error("DeepL \u514d API \u8bf7\u6c42\u8fc7\u4e8e\u9891\u7e41\uff0c\u8bf7\u7a0d\u540e\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002");
    }
    throw new Error(`DeepL \u7ffb\u8bd1\u8bf7\u6c42\u5931\u8d25\uff08HTTP ${response.status}\uff09\uff0c\u8bf7\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002`);
  }

  const translatedText = String(payload?.translations?.[0]?.text || "").trim();
  if (!translatedText) {
    throw new Error("DeepL \u6ca1\u6709\u8fd4\u56de\u8bd1\u6587\uff0c\u8bf7\u70b9\u51fb\u5237\u65b0\u6309\u94ae\u91cd\u8bd5\u3002");
  }
  return translatedText;
}

async function getDeepLInstanceId() {
  if (!deepLInstanceIdPromise) {
    deepLInstanceIdPromise = (async () => {
      const stored = await chrome.storage.local.get([DEEPL_INSTANCE_STORAGE_KEY]);
      const existing = String(stored?.[DEEPL_INSTANCE_STORAGE_KEY] || "").trim();
      if (isUuid(existing)) return existing;

      const instanceId = createUuid();
      await chrome.storage.local.set({ [DEEPL_INSTANCE_STORAGE_KEY]: instanceId });
      return instanceId;
    })().catch((error) => {
      deepLInstanceIdPromise = null;
      throw error;
    });
  }
  return deepLInstanceIdPromise;
}

function createUuid() {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getDeepLLanguageBase(language) {
  return String(language || "").toLowerCase().split(/[-_]/)[0];
}

function normalizeDeepLSourceLanguage(language) {
  const raw = String(language || "").trim().toLowerCase();
  if (!raw || raw === "auto") return "";
  if (raw === "zh-tw" || raw === "zh-hant") return "zh-Hant";
  if (raw === "zh-cn" || raw === "zh-hans" || raw === "zh") return "zh-Hans";
  if (raw === "en-us") return "en-US";
  if (raw === "en-gb") return "en-GB";
  if (raw === "pt-br") return "pt-BR";
  if (raw === "pt-pt") return "pt-PT";
  if (raw === "fr-ca") return "fr-CA";
  if (raw === "de-ch") return "de-CH";
  if (raw === "es-419") return "es-419";
  return normalizeDeepLLanguage(raw, "en");
}

async function resolveDeepLSourceLanguage(sourceLanguage, text) {
  if (sourceLanguage && sourceLanguage !== "auto") {
    return normalizeDeepLLanguage(sourceLanguage, fallbackDeepLSourceLanguage(text));
  }

  if (text && chrome.i18n?.detectLanguage) {
    try {
      const detection = await new Promise((resolve) => {
        chrome.i18n.detectLanguage(text.slice(0, 5000), resolve);
      });
      const detected = [...(detection?.languages || [])]
        .sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0))
        .find((item) => Number(item.percentage || 0) > 0);
      if (detected?.language) {
        return normalizeDeepLLanguage(detected.language, fallbackDeepLSourceLanguage(text));
      }
    } catch {
      // Fall back to script-based detection below.
    }
  }

  return fallbackDeepLSourceLanguage(text);
}

function fallbackDeepLSourceLanguage(text) {
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u3400-\u9fff]/.test(text)) return "zh";
  if (/[\u0100-\u017f]/.test(text) && /[\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c]/i.test(text)) return "pl";
  if (/[\u00e4\u00f6\u00fc\u00df]/i.test(text)) return "de";
  if (/[\u00e0\u00e2\u00e7\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00fb\u00f9\u00fc\u00ff\u0153]/i.test(text)) return "fr";
  if (/[\u00bf\u00a1\u00f1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc]/i.test(text)) return "es";
  return "en";
}

function normalizeDeepLLanguage(language, fallback) {
  const raw = String(language || "").trim().toLowerCase();
  const base = raw.split(/[-_]/)[0];
  const aliases = { no: "nb" };
  const normalized = aliases[base] || base;
  const supported = new Set([
    "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr",
    "hu", "id", "it", "ja", "ko", "lt", "lv", "nb", "nl", "pl", "pt",
    "ro", "ru", "sk", "sl", "sv", "tr", "uk", "zh"
  ]);
  return supported.has(normalized) ? normalized : fallback;
}

function normalizeDeepLTargetLanguage(language) {
  const raw = String(language || "").trim().toLowerCase();
  if (raw === "zh-tw" || raw === "zh-hant") return "zh-Hant";
  if (raw === "zh-cn" || raw === "zh-hans" || raw === "zh") return "zh-Hans";
  if (raw === "en" || raw === "en-us") return "en-US";
  if (raw === "en-gb") return "en-GB";
  if (raw === "pt" || raw === "pt-br") return "pt-BR";
  if (raw === "pt-pt") return "pt-PT";
  if (raw === "fr-ca") return "fr-CA";
  if (raw === "de-ch") return "de-CH";
  if (raw === "es-419") return "es-419";
  return normalizeDeepLLanguage(raw, "zh-Hans");
}

function buildDeepLTranslateUrl(text, sourceLanguage, targetLanguage) {
  const source = normalizeDeepLLanguage(sourceLanguage, "en");
  const target = normalizeDeepLTargetLanguage(targetLanguage);
  return `${DEEPL_TRANSLATOR_URL}#${source}/${target}/${encodeURIComponent(text)}`;
}

function resolveTargetLanguage(requestedTarget, text) {
  if (requestedTarget === "smart") {
    return /[\u3400-\u9fff]/.test(text) ? "en" : "zh-CN";
  }

  const supported = new Set([
    "zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "ru"
  ]);

  return supported.has(requestedTarget) ? requestedTarget : "zh-CN";
}

function normalizeSourceLanguage(language) {
  return /^[a-zA-Z-]{2,10}$/.test(language) ? language : "auto";
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function buildGoogleTranslateUrl(text, sourceLanguage, targetLanguage) {
  const url = new URL("https://translate.google.com/");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  url.searchParams.set("text", text);
  url.searchParams.set("op", "translate");
  return url.toString();
}

function decodeHtml(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"'
  };

  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const normalized = code.toLowerCase();
    if (normalized in named) return named[normalized];

    if (normalized.startsWith("#x")) {
      const point = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }

    if (normalized.startsWith("#")) {
      const point = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
    }

    return entity;
  });
}

function friendlyError(error) {
  if (!error) return "发生未知错误。";
  return error.message || String(error);
}
