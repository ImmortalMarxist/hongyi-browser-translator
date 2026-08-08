const sourceText = document.getElementById("source-text");
const sourceTextCount = document.getElementById("source-text-count");
const targetLanguage = document.getElementById("target-language");
const translateButton = document.getElementById("translate-button");
const results = document.getElementById("results");
const status = document.getElementById("status");
const providerGoogle = document.getElementById("provider-google");
const providerDeepSeek = document.getElementById("provider-deepseek");
const providerDeepL = document.getElementById("provider-deepl");
const deepseekSettings = document.getElementById("deepseek-settings");
const deepseekApiKey = document.getElementById("deepseek-api-key");
const saveApiKey = document.getElementById("save-api-key");
const clearApiKey = document.getElementById("clear-api-key");
const apiKeyStatus = document.getElementById("api-key-status");
const verticalMaxButton = document.getElementById("vertical-max-button");
const alwaysOnTopButton = document.getElementById("always-on-top-button");
const extensionPowerButton = document.getElementById("extension-power-button");
const errorBox = document.getElementById("error-box");
const appRoot = document.querySelector(".app");
const windowHeader = document.querySelector(".header");
const settingsPanel = document.querySelector(".panel");
const resultPanel = document.querySelector(".result-panel");
const appHomeMarker = document.createComment("translator-app-home");
appRoot.before(appHomeMarker);

const MAX_TEXT_LENGTH = 50000;
const SELECTION_WATCH_INTERVAL_MS = 300;
const SELECTION_READ_TIMEOUT_MS = 700;
const VALID_TRANSLATION_PROVIDERS = ["google", "deepseek", "deepl"];
const DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS = 30000;
const DEEPL_TRANSLATION_MESSAGE_TIMEOUT_MS = 35000;
const HOSTED_PIP_CHANNEL = "hongyi-hosted-pip-v1";
const popupMode = new URLSearchParams(location.search).get("mode");
const isHostedPictureInPicture = popupMode === "hosted-pip";
const isMovableWindow = popupMode === "window" || isHostedPictureInPicture;
let selectedProviderOrder = ["google"];
let extensionEnabled = true;
let requestId = 0;
let autoTranslateTimer = null;
let hasDeepSeekApiKey = false;
let toolbarWindowVerticallyMaximized = false;
let toolbarWindowRestoreBounds = null;
let pictureInPictureWindow = null;
let pictureInPictureRestoreBounds = null;
let pictureInPictureVerticallyMaximized = false;
let toolbarPopupWindowId = null;
let restoringFromPictureInPicture = false;
let selectionWatchTimer = null;
let selectionWatchWindow = null;
let selectionProbeInProgress = false;
let clipboardProbeInProgress = false;
let clipboardInteractionProbePending = false;
let clipboardInteractionDocument = null;
let clipboardBaselineReady = false;
let lastObservedClipboardText = "";
let lastRecognizedSelectionText = "";
let lastRecognizedClipboardText = "";
let selectionCurrentlyPresent = false;
let lastRenderedRecords = [];
const providerRetryTokens = new Map();
let edgeAutoTopAttemptInProgress = false;
let alwaysOnTopRequested = isHostedPictureInPicture;
let lastEdgeWindowId = null;
let edgeMainWindowFocused = false;
let lastPinnedInteractionProbeAt = 0;
let pictureInPictureDrag = null;
let selectionPriorityRevision = 0;

verticalMaxButton.hidden = !isMovableWindow;
alwaysOnTopButton.hidden = !isMovableWindow;

translateButton.addEventListener("click", () => translateCurrentText());
verticalMaxButton.addEventListener("click", toggleToolbarVerticalMaximize);
alwaysOnTopButton.addEventListener("click", toggleAlwaysOnTop);
extensionPowerButton.addEventListener("click", toggleExtensionEnabled);
providerGoogle.addEventListener("change", handleProviderChange);
providerDeepSeek.addEventListener("change", handleProviderChange);
providerDeepL.addEventListener("change", handleProviderChange);
saveApiKey.addEventListener("click", saveDeepSeekApiKey);
clearApiKey.addEventListener("click", clearDeepSeekApiKey);

if (isMovableWindow) {
  chrome.windows.onFocusChanged.addListener(handleBrowserWindowFocusChanged);
  chrome.runtime.onMessage.addListener(handleToolbarRuntimeMessage);
  appRoot.addEventListener("pointerenter", handlePinnedPopupInteraction, { passive: true });
  windowHeader.addEventListener("pointerdown", startPictureInPictureDrag);
  window.addEventListener("beforeunload", cleanupMovableWindowFeatures);

  if (isHostedPictureInPicture) {
    window.addEventListener("message", handleHostedPictureInPictureMessage);
    window.addEventListener("pointermove", updatePictureInPictureDrag, true);
    window.addEventListener("pointerup", finishPictureInPictureDrag, true);
    window.addEventListener("pointercancel", finishPictureInPictureDrag, true);
    updateAlwaysOnTopUI();
  } else {
    // Ordinary fallback/restored windows start genuinely unpinned. The user can
    // still click the bell manually, which supplies the required user gesture.
    updateAlwaysOnTopUI();
  }
}

initialize().finally(() => {
  if (isHostedPictureInPicture) postHostedPictureInPictureMessage({ type: "FRAME_READY" });
});

deepseekApiKey.addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveDeepSeekApiKey();
});

sourceText.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    clearTimeout(autoTranslateTimer);
    translateCurrentText();
  }
});

sourceText.addEventListener("input", () => {
  updateSourceTextCount();
  clearTimeout(autoTranslateTimer);
  if (!sourceText.value.trim()) {
    renderPlaceholder();
    hideError();
    return;
  }

  status.textContent = "等待自动翻译…";
  autoTranslateTimer = setTimeout(() => translateCurrentText(), 550);
});

targetLanguage.addEventListener("change", async () => {
  await chrome.storage.local.set({ targetLanguage: targetLanguage.value });
  if (sourceText.value.trim()) translateCurrentText();
});

function countSourceUnits(value) {
  const text = String(value || "");
  const englishWords = text.match(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g) || [];
  const nonEnglishRemainder = text.replace(/[A-Za-z]+(?:['\u2019][A-Za-z]+)*/g, "");
  return englishWords.length + Array.from(nonEnglishRemainder).filter((character) => !/\s/.test(character)).length;
}

function updateSourceTextCount() {
  sourceTextCount.textContent = String(countSourceUnits(sourceText.value));
}

function setSourceTextValue(value) {
  sourceText.value = String(value || "");
  updateSourceTextCount();
}

updateSourceTextCount();

function updateExtensionEnabledUI() {
  document.body.classList.toggle("extension-disabled", !extensionEnabled);
  extensionPowerButton.classList.toggle("is-off", !extensionEnabled);
  extensionPowerButton.setAttribute("aria-pressed", String(extensionEnabled));
  extensionPowerButton.title = extensionEnabled ? "\u5173\u95ed\u63d2\u4ef6" : "\u5f00\u542f\u63d2\u4ef6";
  extensionPowerButton.setAttribute("aria-label", extensionPowerButton.title);
  settingsPanel.inert = !extensionEnabled;
  resultPanel.inert = !extensionEnabled;
  settingsPanel.setAttribute("aria-disabled", String(!extensionEnabled));
  resultPanel.setAttribute("aria-disabled", String(!extensionEnabled));
}

function renderExtensionDisabledState() {
  clearTimeout(autoTranslateTimer);
  requestId += 1;
  stopSelectionWatch();
  translateButton.disabled = false;
  targetLanguage.disabled = false;
  lastRenderedRecords = [];
  results.className = "results empty";
  results.textContent = "\u63d2\u4ef6\u5df2\u5173\u95ed\uff0c\u5212\u8bcd\u65f6\u4e0d\u4f1a\u663e\u793a\u201c\u8bd1\u201d\u5b57\u6309\u94ae\u3002";
  status.textContent = "\u5df2\u5173\u95ed";
  hideError();
}

async function toggleExtensionEnabled() {
  const previousState = extensionEnabled;
  const nextState = !previousState;
  extensionPowerButton.disabled = true;
  extensionEnabled = nextState;
  updateExtensionEnabledUI();
  try {
    const response = await sendMessage({ type: "SET_EXTENSION_ENABLED", enabled: nextState });
    if (!response?.ok) throw new Error(response?.error || "\u65e0\u6cd5\u66f4\u6539\u63d2\u4ef6\u72b6\u6001\u3002");
    if (!nextState) {
      await chrome.storage.local.remove("pendingSelection");
      renderExtensionDisabledState();
      return;
    }
    renderPlaceholder();
    hideError();
    if (isMovableWindow) startSelectionWatch();
    if (await refreshEdgeMainWindowFocusState()) {
      const selectedText = await readSelectionFromEdgeWindow(lastEdgeWindowId);
      if (selectedText) {
        await applyToolbarSourceText(selectedText, "selection");
        return;
      }
    }
    // The toolbar window reads the clipboard only on pointer entry and only when no eligible selection exists.
    if (sourceText.value.trim()) await translateCurrentText();
    else sourceText.focus();
  } catch (error) {
    extensionEnabled = previousState;
    updateExtensionEnabledUI();
    if (!extensionEnabled) renderExtensionDisabledState();
    showError(friendlyError(error));
  } finally {
    extensionPowerButton.disabled = false;
  }
}

async function handleProviderChange(event) {
  const provider = event.target?.value;
  if (!VALID_TRANSLATION_PROVIDERS.includes(provider)) return;

  if (event.target === providerDeepSeek && providerDeepSeek.checked && !hasDeepSeekApiKey) {
    providerDeepSeek.checked = false;
    selectedProviderOrder = selectedProviderOrder.filter((item) => item !== "deepseek");
    deepseekSettings.open = true;
    apiKeyStatus.textContent = "\u8bf7\u5148\u586b\u5199\u5e76\u4fdd\u5b58 DeepSeek API Key\uff0c\u4fdd\u5b58\u540e\u624d\u80fd\u52fe\u9009 DeepSeek\u3002";
    apiKeyStatus.classList.remove("saved");
    showError("DeepSeek \u5c1a\u672a\u914d\u7f6e API Key\uff0c\u672c\u6b21\u52fe\u9009\u672a\u751f\u6548\u3002\u8bf7\u5148\u5728\u4e0a\u65b9\u586b\u5199\u5e76\u4fdd\u5b58 API Key\u3002");
    renderResults(getVisibleResultRecords());
    setTimeout(() => deepseekApiKey.focus(), 0);
    return;
  }

  const previousOrder = selectedProviderOrder.slice();
  selectedProviderOrder = selectedProviderOrder.filter((item) => item !== provider);
  if (event.target.checked) selectedProviderOrder.push(provider);

  let providers = getSelectedProviders();
  if (!providers.length) {
    event.target.checked = true;
    selectedProviderOrder = previousOrder.length ? previousOrder : [provider];
    providers = getSelectedProviders();
    showError("\u81f3\u5c11\u9700\u8981\u4fdd\u7559\u4e00\u4e2a\u7ffb\u8bd1\u6765\u6e90\u3002\u82e5\u8981\u4f7f\u7528 DeepSeek\uff0c\u8bf7\u5148\u586b\u5199 API Key\u3002");
    return;
  }

  requestId += 1;
  renderResults(getVisibleResultRecords());
  await chrome.storage.local.set({ translationProviders: providers });
  hideError();
  if (sourceText.value.trim()) translateCurrentText();
}

async function saveDeepSeekApiKey() {
  const key = deepseekApiKey.value.trim();
  if (!key) {
    showError(hasDeepSeekApiKey
      ? "API Key \u5df2\u4fdd\u5b58\u4e14\u4e0d\u4f1a\u56de\u663e\u3002\u5982\u9700\u66f4\u6362\uff0c\u8bf7\u8f93\u5165\u65b0 Key\uff1b\u5982\u9700\u5220\u9664\uff0c\u8bf7\u70b9\u51fb\u201c\u6e05\u9664 API\u201d\u3002"
      : "\u8bf7\u5148\u8f93\u5165 DeepSeek API Key\u3002");
    return;
  }

  saveApiKey.disabled = true;
  try {
    const response = await sendMessage({ type: "SAVE_DEEPSEEK_API_KEY", apiKey: key });
    if (!response?.ok) throw new Error(response?.error || "\u4fdd\u5b58\u5931\u8d25\u3002");
    hasDeepSeekApiKey = true;
    deepseekApiKey.value = "";
    deepseekApiKey.placeholder = "API Key \u5df2\u4fdd\u5b58\uff08\u4e0d\u56de\u663e\uff09";
    apiKeyStatus.textContent = "API Key \u5df2\u4fdd\u5b58\u3002\u8f93\u5165\u6846\u5df2\u6e05\u7a7a\uff0c\u6269\u5c55\u4e0d\u4f1a\u56de\u663e Key \u5185\u5bb9\uff0c\u73b0\u5728\u53ef\u4ee5\u52fe\u9009 DeepSeek\u3002";
    apiKeyStatus.classList.add("saved");
    hideError();
  } catch (error) {
    deepseekApiKey.value = "";
    showError(`\u4fdd\u5b58 API Key \u5931\u8d25\uff1a${friendlyError(error)}`);
  } finally {
    saveApiKey.disabled = false;
  }
}

async function clearDeepSeekApiKey() {
  clearApiKey.disabled = true;
  try {
    const response = await sendMessage({ type: "CLEAR_DEEPSEEK_API_KEY" });
    if (!response?.ok) throw new Error(response?.error || "\u6e05\u9664\u5931\u8d25\u3002");
    hasDeepSeekApiKey = false;
    deepseekApiKey.value = "";
    deepseekApiKey.placeholder = "\u586b\u5199 DeepSeek API Key\uff08\u4ec5\u663e\u793a\u9ed1\u70b9\uff09";
    providerDeepSeek.checked = false;
    selectedProviderOrder = selectedProviderOrder.filter((provider) => provider !== "deepseek");
    if (!providerGoogle.checked && !providerDeepL.checked) providerGoogle.checked = true;
    await chrome.storage.local.set({ translationProviders: getSelectedProviders() });
    apiKeyStatus.textContent = "API Key \u5df2\u6e05\u9664\uff0cDeepSeek \u5df2\u53d6\u6d88\u52fe\u9009\u3002";
    apiKeyStatus.classList.remove("saved");
    renderResults(getVisibleResultRecords());
    showError("DeepSeek API Key \u5df2\u6e05\u9664\uff0c\u672a\u914d\u7f6e Key \u65f6 DeepSeek \u52fe\u9009\u4e0d\u4f1a\u751f\u6548\u3002");
  } catch (error) {
    showError(`\u6e05\u9664 API Key \u5931\u8d25\uff1a${friendlyError(error)}`);
  } finally {
    clearApiKey.disabled = false;
  }
}

function normalizeProviderOrder(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((provider) => VALID_TRANSLATION_PROVIDERS.includes(provider))
    .filter((provider) => {
      if (seen.has(provider)) return false;
      seen.add(provider);
      return true;
    });
}

function isProviderSelected(provider) {
  if (provider === "google") return providerGoogle.checked;
  if (provider === "deepseek") return providerDeepSeek.checked && hasDeepSeekApiKey;
  if (provider === "deepl") return providerDeepL.checked;
  return false;
}

function getSelectedProviders() {
  const selected = normalizeProviderOrder(selectedProviderOrder)
    .filter((provider) => isProviderSelected(provider));
  for (const provider of VALID_TRANSLATION_PROVIDERS) {
    if (isProviderSelected(provider) && !selected.includes(provider)) selected.push(provider);
  }
  selectedProviderOrder = selected.slice();
  return selected;
}

function applyProviderSelection(value) {
  selectedProviderOrder = normalizeProviderOrder(value);
  providerGoogle.checked = selectedProviderOrder.includes("google");
  providerDeepSeek.checked = hasDeepSeekApiKey && selectedProviderOrder.includes("deepseek");
  providerDeepL.checked = selectedProviderOrder.includes("deepl");
  if (!providerGoogle.checked && !providerDeepSeek.checked && !providerDeepL.checked) {
    providerGoogle.checked = true;
  }
  selectedProviderOrder = getSelectedProviders();
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

function getProviderOpenLabel(provider) {
  if (provider === "deepl") return "\u5728 DeepL \u4e2d\u6253\u5f00";
  if (provider === "deepseek") return "\u5728 DeepSeek \u4e2d\u6253\u5f00";
  return "\u5728\u8c37\u6b4c\u7ffb\u8bd1\u4e2d\u6253\u5f00";
}

async function initialize() {
  const enabledState = await chrome.storage.local.get(["extensionEnabled", "lastEdgeWindowId"]);
  extensionEnabled = enabledState.extensionEnabled !== false;
  if (Number.isInteger(Number(enabledState.lastEdgeWindowId))) lastEdgeWindowId = Number(enabledState.lastEdgeWindowId);
  updateExtensionEnabledUI();

  if (isMovableWindow) {
    try {
      if (!isHostedPictureInPicture) {
        const currentWindow = await chrome.windows.getCurrent();
        toolbarPopupWindowId = Number.isInteger(currentWindow?.id) ? currentWindow.id : null;
        if (Number.isInteger(toolbarPopupWindowId)) {
          await sendMessage({ type: "REGISTER_TOOLBAR_POPUP", windowId: toolbarPopupWindowId });
        }
      }
      try {
        const focusedWindow = await chrome.windows.getLastFocused();
        edgeMainWindowFocused = focusedWindow?.type === "normal" && focusedWindow?.focused === true;
        if (edgeMainWindowFocused && Number.isInteger(focusedWindow.id)) lastEdgeWindowId = focusedWindow.id;
      } catch {
        edgeMainWindowFocused = false;
        // Keep the remembered normal Edge window id, but do not read its selection while unfocused.
      }
      if (extensionEnabled) {
        startSelectionWatch();
      }
    } catch (error) {
      console.warn("Unable to register toolbar translator window:", error);
      if (extensionEnabled) startSelectionWatch();
    }
  }

  const data = await chrome.storage.local.get(["targetLanguage", "translationProviders", "pendingSelection", "lastTranslation"]);
  targetLanguage.value = data.targetLanguage || "zh-CN";
  const apiStatus = await sendMessage({ type: "GET_DEEPSEEK_STATUS" });
  hasDeepSeekApiKey = Boolean(apiStatus?.ok && apiStatus.configured);
  deepseekApiKey.value = "";
  deepseekApiKey.placeholder = hasDeepSeekApiKey ? "API Key \u5df2\u4fdd\u5b58\uff08\u4e0d\u4f1a\u56de\u663e\uff09" : "\u586b\u5199 DeepSeek API Key\uff08\u4ec5\u663e\u793a\u9ed1\u70b9\uff09";
  apiKeyStatus.textContent = hasDeepSeekApiKey
    ? "API Key \u5df2\u4fdd\u5b58\u3002\u6269\u5c55\u4e0d\u4f1a\u56de\u663e Key \u5185\u5bb9\u3002"
    : "API Key \u672a\u586b\u5199\uff1bGoogle \u548c DeepL \u53ef\u6b63\u5e38\u4f7f\u7528\uff0cDeepSeek \u6682\u4e0d\u53ef\u52fe\u9009\u3002";
  apiKeyStatus.classList.toggle("saved", hasDeepSeekApiKey);

  const savedProviders = Array.isArray(data.translationProviders) ? data.translationProviders : ["google"];
  applyProviderSelection(savedProviders);
  await chrome.storage.local.set({ translationProviders: getSelectedProviders() });
  if (!extensionEnabled) {
    renderExtensionDisabledState();
    return;
  }

  // The toolbar window reads the clipboard only on pointer entry and only when no selection exists.
  let clipboardText = "";
  if (!isMovableWindow) {
    clipboardText = await readClipboardText();
    rememberObservedClipboardText(clipboardText);
  }

  const pending = data.pendingSelection;
  const pendingIsFresh = isHostedPictureInPicture === false && pending?.text && Date.now() - pending.createdAt < 2 * 60 * 1000;
  if (pendingIsFresh) {
    rememberRecognizedSelection(pending.text);
    setSourceTextValue(pending.text.slice(0, MAX_TEXT_LENGTH));
    await chrome.storage.local.remove("pendingSelection");
    status.textContent = "\u5df2\u8bfb\u53d6\u6587\u672c\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1";
    translateCurrentText();
    return;
  }
  if (clipboardText) {
    rememberRecognizedClipboard(clipboardText);
    setSourceTextValue(clipboardText.slice(0, MAX_TEXT_LENGTH));
    status.textContent = clipboardText.length > MAX_TEXT_LENGTH ? `\u526a\u8d34\u677f\u8f83\u957f\uff0c\u5df2\u8bfb\u53d6\u524d ${MAX_TEXT_LENGTH} \u5b57\u7b26` : "\u5df2\u8bfb\u53d6\u526a\u8d34\u677f";
    translateCurrentText();
    return;
  }
  if (data.lastTranslation?.sourceText) {
    setSourceTextValue(data.lastTranslation.sourceText);
    if (Array.isArray(data.lastTranslation.results)) {
      renderResults(data.lastTranslation.results.filter((record) => getSelectedProviders().includes(record.provider)));
    } else if (data.lastTranslation.translatedText && providerGoogle.checked) {
      renderResults([{ provider: "google", label: "\u8c37\u6b4c\u7ffb\u8bd1", ok: true, translatedText: data.lastTranslation.translatedText }]);
    }
    return;
  }
  renderPlaceholder();
  sourceText.focus();
}

async function readClipboardText(readDocument = document) {
  const clipboard = readDocument?.defaultView?.navigator?.clipboard || navigator.clipboard;
  if (clipboard?.readText) {
    try {
      const directText = (await clipboard.readText()).trim();
      if (directText) return directText;
    } catch {
      // Try the background offscreen-document path below.
    }
  }

  try {
    const response = await sendMessage({ type: "READ_CLIPBOARD" });
    return response?.ok ? String(response.text || "").trim() : "";
  } catch {
    return "";
  }
}

function normalizeRecognizedText(text) {
  return String(text || "").trim().slice(0, MAX_TEXT_LENGTH);
}

function rememberRecognizedSelection(text) {
  lastRecognizedSelectionText = normalizeRecognizedText(text);
  selectionCurrentlyPresent = Boolean(lastRecognizedSelectionText);
}

function clearRecognizedSelectionIfReleased() {
  lastRecognizedSelectionText = "";
  selectionCurrentlyPresent = false;
}

function rememberRecognizedClipboard(text) {
  lastRecognizedClipboardText = normalizeRecognizedText(text);
}

function rememberObservedClipboardText(text) {
  lastObservedClipboardText = String(text || "").trim();
  clipboardBaselineReady = true;
}

async function handleBrowserWindowFocusChanged(windowId) {
  if (!isMovableWindow || !extensionEnabled) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    edgeMainWindowFocused = false;
    return;
  }

  let focusedWindow;
  try {
    focusedWindow = await chrome.windows.get(windowId);
  } catch {
    edgeMainWindowFocused = false;
    return;
  }

  edgeMainWindowFocused = focusedWindow?.type === "normal" && focusedWindow?.focused === true;
  if (!edgeMainWindowFocused) return;
  if (Number.isInteger(focusedWindow.id)) {
    lastEdgeWindowId = focusedWindow.id;
    await chrome.storage.local.set({ lastEdgeWindowId }).catch(() => undefined);
  }
  void checkSelectionForChanges();
}

async function refreshEdgeMainWindowFocusState() {
  try {
    const windows = await chrome.windows.getAll({ populate: false });
    const focusedNormalWindow = windows.find(
      (browserWindow) => browserWindow?.type === "normal" && browserWindow.focused === true
    );
    edgeMainWindowFocused = Boolean(focusedNormalWindow);
    if (Number.isInteger(focusedNormalWindow?.id)) {
      const changed = focusedNormalWindow.id !== lastEdgeWindowId;
      lastEdgeWindowId = focusedNormalWindow.id;
      if (changed) {
        void chrome.storage.local.set({ lastEdgeWindowId }).catch(() => undefined);
      }
    }
    return edgeMainWindowFocused;
  } catch {
    // A failed live-focus query must never authorize reading a remembered selection.
    edgeMainWindowFocused = false;
    return false;
  }
}

async function readSelectionFromEdgeWindow(windowId) {
  const resolvedWindowId = Number.isInteger(windowId)
    ? windowId
    : await ensureLastEdgeWindowId();
  if (!Number.isInteger(resolvedWindowId)) return "";

  // Keep all selection reads on the background path. It first asks the content
  // script and then performs a direct scripting probe, so a missed content
  // script event can never make the clipboard win over a live Edge selection.
  try {
    const response = await sendMessage({
      type: "READ_SELECTION_FROM_EDGE_WINDOW",
      windowId: resolvedWindowId
    }, SELECTION_READ_TIMEOUT_MS + 500);
    return String(response?.text || "").trim();
  } catch {
    return "";
  }
}


function postHostedPictureInPictureMessage(payload) {
  if (!isHostedPictureInPicture) return;
  window.parent.postMessage({ channel: HOSTED_PIP_CHANNEL, ...payload }, "*");
}

function handleHostedPictureInPictureMessage(event) {
  if (!isHostedPictureInPicture || event.source !== window.parent || event.data?.channel !== HOSTED_PIP_CHANNEL) return;
  const message = event.data;
  if (message.type === "APPLY_SELECTION_TEXT") {
    void applyToolbarSourceText(message.text, message.source || "selection");
    return;
  }
  if (message.type === "VERTICAL_MAX_STATE") {
    pictureInPictureVerticallyMaximized = Boolean(message.active);
    updateToolbarVerticalMaximizeUI();
  }
}

async function handlePinnedPopupInteraction(event) {
  if (!isMovableWindow || !extensionEnabled) return;
  const now = Date.now();
  if (now - lastPinnedInteractionProbeAt < 250) return;
  lastPinnedInteractionProbeAt = now;
  // Query the real OS/Edge focus state now; a remembered flag is not enough.
  const edgePageFocused = await refreshEdgeMainWindowFocusState();
  if (edgePageFocused) {
    const selectedText = await readSelectionFromEdgeWindow(lastEdgeWindowId);
    if (selectedText) {
      const selectedValue = normalizeRecognizedText(selectedText);
      selectionCurrentlyPresent = true;
      if (selectedValue !== lastRecognizedSelectionText) {
        await applyToolbarSourceText(selectedText, "selection");
      }
      return;
    }
    clearRecognizedSelectionIfReleased();
  }
  // When Edge is not focused, pointer entry goes directly to clipboard handling.
  const interactionDocument = event?.currentTarget?.ownerDocument || appRoot.ownerDocument || document;
  void checkClipboardForChanges(true, interactionDocument);
}

function handleToolbarRuntimeMessage(message, sender, sendResponse) {
  if (!message || typeof message.type !== "string") return false;
  if (Number.isInteger(message.targetWindowId) && message.targetWindowId !== toolbarPopupWindowId) {
    return false;
  }

  if (message.type === "APPLY_SELECTION_TEXT") {
    const source = message.source || "selection";
    const applyMessageText = async () => {
      if (source === "selection" && !await refreshEdgeMainWindowFocusState()) {
        return { ok: false, ignored: true, reason: "edge-main-window-not-focused" };
      }
      const nextText = normalizeRecognizedText(message.text);
      if (source === "selection" && selectionCurrentlyPresent && nextText === lastRecognizedSelectionText) {
        return { ok: true, duplicate: true };
      }
      const applied = await applyToolbarSourceText(message.text, source);
      return { ok: Boolean(applied) };
    };
    applyMessageText()
      .then(sendResponse)
      .catch((error) => {
        showError(friendlyError(error));
        sendResponse({ ok: false, error: friendlyError(error) });
      });
    return true;
  }

  if (message.type === "FOCUS_TOOLBAR_WINDOW") {
    bringToolbarWindowToFront()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  if (message.type === "CLOSE_TOOLBAR_WINDOW") {
    closeToolbarWindowForRemoval()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: friendlyError(error) }));
    return true;
  }

  return false;
}

async function applyToolbarSourceText(rawText, source = "selection") {
  if (!extensionEnabled) return false;
  const fullText = String(rawText || "").trim();
  if (!fullText) return false;
  const nextText = fullText.slice(0, MAX_TEXT_LENGTH);
  const isSelection = source === "selection";
  if (isSelection) {
    if (selectionCurrentlyPresent && nextText === lastRecognizedSelectionText) return false;
    rememberRecognizedSelection(nextText);
    selectionPriorityRevision += 1;
  } else {
    if (nextText === lastRecognizedClipboardText) return false;
    rememberRecognizedClipboard(nextText);
    rememberObservedClipboardText(fullText);
  }

  clearTimeout(autoTranslateTimer);
  setSourceTextValue(nextText);
  hideError();
  status.textContent = isSelection
    ? (fullText.length > MAX_TEXT_LENGTH
      ? `\u5df2\u8bfb\u53d6\u7f51\u9875\u9009\u4e2d\u6587\u5b57\u7684\u524d ${MAX_TEXT_LENGTH} \u4e2a\u5b57\u7b26\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1`
      : "\u5df2\u8bfb\u53d6\u7f51\u9875\u9009\u4e2d\u6587\u5b57\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1")
    : (fullText.length > MAX_TEXT_LENGTH
      ? `\u5df2\u4f18\u5148\u8bfb\u53d6\u9009\u4e2d\u6587\u5b57\u6216\u526a\u8d34\u677f\u7684\u524d ${MAX_TEXT_LENGTH} \u4e2a\u5b57\u7b26\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1`
      : "\u5df2\u8bfb\u53d6\u9009\u4e2d\u6587\u5b57\u6216\u526a\u8d34\u677f\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1");
  await translateCurrentText();
  return true;
}

async function bringToolbarWindowToFront() {
  if (!isMovableWindow) return;
  if (isHostedPictureInPicture) {
    postHostedPictureInPictureMessage({ type: "FOCUS_HOSTED_PIP" });
    return;
  }
  if (pictureInPictureWindow && !pictureInPictureWindow.closed) {
    pictureInPictureWindow.focus();
    return;
  }

  if (!Number.isInteger(toolbarPopupWindowId)) {
    const currentWindow = await chrome.windows.getCurrent();
    toolbarPopupWindowId = Number.isInteger(currentWindow?.id) ? currentWindow.id : null;
  }
  if (Number.isInteger(toolbarPopupWindowId)) {
    await chrome.windows.update(toolbarPopupWindowId, { state: "normal", focused: true });
  }
}

async function closeToolbarWindowForRemoval() {
  if (isHostedPictureInPicture) {
    postHostedPictureInPictureMessage({ type: "CLOSE_HOSTED_PIP" });
    return;
  }
  const pipWindow = pictureInPictureWindow;
  restoringFromPictureInPicture = true;
  try {
    pictureInPictureDrag = null;
    if (appRoot.ownerDocument !== document) {
      if (appHomeMarker.parentNode) {
        appHomeMarker.parentNode.insertBefore(appRoot, appHomeMarker.nextSibling);
      } else {
        document.body.prepend(appRoot);
      }
    }
    detachPictureInPictureDragListeners(pipWindow);
    pictureInPictureWindow = null;
    pictureInPictureVerticallyMaximized = false;
    pictureInPictureRestoreBounds = null;
    if (pipWindow && !pipWindow.closed) pipWindow.close();
  } finally {
    restoringFromPictureInPicture = false;
  }
}

async function ensureLastEdgeWindowId() {
  if (Number.isInteger(lastEdgeWindowId)) return lastEdgeWindowId;

  try {
    const stored = await chrome.storage.local.get(["lastEdgeWindowId"]);
    const storedId = Number(stored?.lastEdgeWindowId);
    if (Number.isInteger(storedId)) {
      lastEdgeWindowId = storedId;
      return lastEdgeWindowId;
    }
  } catch {
    // Continue with window discovery below.
  }

  try {
    const windows = await chrome.windows.getAll({ populate: false });
    const normalWindow = windows.find((browserWindow) => browserWindow?.type === "normal");
    if (Number.isInteger(normalWindow?.id)) {
      lastEdgeWindowId = normalWindow.id;
      await chrome.storage.local.set({ lastEdgeWindowId }).catch(() => undefined);
      return lastEdgeWindowId;
    }
  } catch {
    // No normal Edge window is available yet.
  }

  return null;
}

function startSelectionWatch() {
  if (!isMovableWindow || !extensionEnabled || selectionWatchTimer !== null) return;
  const timerWindow = appRoot.ownerDocument?.defaultView || window;
  selectionWatchWindow = timerWindow;
  void checkSelectionForChanges();
  selectionWatchTimer = timerWindow.setInterval(checkSelectionForChanges, SELECTION_WATCH_INTERVAL_MS);
}

function stopSelectionWatch() {
  if (selectionWatchTimer === null) return;
  (selectionWatchWindow || window).clearInterval(selectionWatchTimer);
  selectionWatchTimer = null;
  selectionWatchWindow = null;
}

async function checkSelectionForChanges() {
  if (!isMovableWindow || !extensionEnabled || selectionProbeInProgress) return;
  selectionProbeInProgress = true;
  try {
    if (!await refreshEdgeMainWindowFocusState()) return;
    const edgeWindowId = await ensureLastEdgeWindowId();
    const selectedText = await readSelectionFromEdgeWindow(edgeWindowId);
    if (!selectedText) {
      clearRecognizedSelectionIfReleased();
      return;
    }

    const selectedValue = normalizeRecognizedText(selectedText);
    selectionCurrentlyPresent = true;
    // The selection monitor is only a safety net for a genuinely new selection.
    // It compares with the recognized source event, not the editable textarea,
    // so a user edit is never restored or replaced by the same live selection.
    if (selectedValue === lastRecognizedSelectionText) return;
    await applyToolbarSourceText(selectedText, "selection");
  } catch {
    // Restricted pages and pages without the content script are ignored.
  } finally {
    selectionProbeInProgress = false;
  }
}

async function checkClipboardForChanges(forceCurrentClipboard = false, readDocument = document) {
  if (!isMovableWindow || !extensionEnabled) return;
  if (clipboardProbeInProgress) {
    if (forceCurrentClipboard) {
      clipboardInteractionProbePending = true;
      clipboardInteractionDocument = readDocument;
    }
    return;
  }

  const priorityRevisionAtStart = selectionPriorityRevision;
  clipboardProbeInProgress = true;
  try {
    // Webpage selection is always the highest-priority source. Check it before
    // clipboard access and again immediately before applying clipboard text so
    // a slow clipboard read can never overwrite a newer selection message.
    if (await refreshEdgeMainWindowFocusState()) {
      const selectedText = await readSelectionFromEdgeWindow(lastEdgeWindowId);
      if (selectedText) {
        const selectedValue = normalizeRecognizedText(selectedText);
        selectionCurrentlyPresent = true;
        if (selectedValue !== lastRecognizedSelectionText) {
          await applyToolbarSourceText(selectedText, "selection");
        }
        return;
      }
      clearRecognizedSelectionIfReleased();
    }

    const clipboardText = String(await readClipboardText(readDocument)).trim();

    // Focus may have returned to Edge during clipboard access. In that case,
    // re-check the live selection before allowing clipboard text to replace it.
    if (await refreshEdgeMainWindowFocusState()) {
      if (selectionPriorityRevision !== priorityRevisionAtStart) return;
      const latestSelectedText = await readSelectionFromEdgeWindow(lastEdgeWindowId);
      if (latestSelectedText) {
        const selectedValue = normalizeRecognizedText(latestSelectedText);
        selectionCurrentlyPresent = true;
        if (selectedValue !== lastRecognizedSelectionText) {
          await applyToolbarSourceText(latestSelectedText, "selection");
        }
        return;
      }
      clearRecognizedSelectionIfReleased();
      if (selectionPriorityRevision !== priorityRevisionAtStart) return;
    }

    if (!clipboardBaselineReady) {
      rememberObservedClipboardText(clipboardText);
      if (!forceCurrentClipboard) return;
    }

    if (!clipboardText) return;
    const clipboardChanged = clipboardText !== lastObservedClipboardText;
    if (!clipboardChanged && !forceCurrentClipboard) return;
    rememberObservedClipboardText(clipboardText);

    const nextText = normalizeRecognizedText(clipboardText);
    // Pointer entry permits a read, but the same clipboard value can only be
    // recognized once and cannot overwrite user-edited source text again.
    if (nextText === lastRecognizedClipboardText) return;
    rememberRecognizedClipboard(nextText);

    clearTimeout(autoTranslateTimer);
    setSourceTextValue(nextText);
    hideError();
    status.textContent = forceCurrentClipboard
      ? (clipboardText.length > MAX_TEXT_LENGTH
        ? `\u5df2\u4ece\u526a\u8d34\u677f\u8bfb\u53d6\u524d ${MAX_TEXT_LENGTH} \u4e2a\u5b57\u7b26\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1`
        : "\u5df2\u4ece\u526a\u8d34\u677f\u8bfb\u53d6\u6587\u672c\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1")
      : (clipboardText.length > MAX_TEXT_LENGTH
        ? `\u68c0\u6d4b\u5230\u526a\u8d34\u677f\u53d8\u5316\uff0c\u5df2\u8bfb\u53d6\u524d ${MAX_TEXT_LENGTH} \u4e2a\u5b57\u7b26\u5e76\u81ea\u52a8\u7ffb\u8bd1`
        : "\u68c0\u6d4b\u5230\u526a\u8d34\u677f\u53d8\u5316\uff0c\u6b63\u5728\u81ea\u52a8\u7ffb\u8bd1");
    await translateCurrentText();
  } catch (error) {
    console.warn("Clipboard watch failed:", error);
  } finally {
    clipboardProbeInProgress = false;
    if (clipboardInteractionProbePending) {
      clipboardInteractionProbePending = false;
      const nextReadDocument = clipboardInteractionDocument || document;
      clipboardInteractionDocument = null;
      void checkClipboardForChanges(true, nextReadDocument);
    }
  }
}

async function translateCurrentText() {
  if (!extensionEnabled) {
    renderExtensionDisabledState();
    return;
  }

  const text = sourceText.value.trim();
  if (!text) {
    showError("\u8bf7\u5148\u8f93\u5165\u3001\u9009\u4e2d\u6216\u590d\u5236\u9700\u8981\u7ffb\u8bd1\u7684\u6587\u672c\u3002");
    sourceText.focus();
    return;
  }

  const providers = getSelectedProviders();
  if (!providers.length) {
    providerGoogle.checked = true;
    selectedProviderOrder = ["google"];
    await chrome.storage.local.set({ translationProviders: ["google"] });
    showError("\u6ca1\u6709\u53ef\u7528\u7684\u7ffb\u8bd1\u6765\u6e90\uff0c\u5df2\u81ea\u52a8\u6062\u590d\u4e3a\u8c37\u6b4c\u7ffb\u8bd1\u3002");
    return;
  }

  const currentRequest = ++requestId;
  const targetSnapshot = targetLanguage.value;
  let resolvedTargetLanguage = targetSnapshot;
  setBusy(true);
  hideError();
  renderLoading(providers);

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
      currentRequest !== requestId
      || sourceText.value.trim() !== text
      || targetLanguage.value !== targetSnapshot
    ) return;

    const nextRecords = lastRenderedRecords.map((item) => (
      item.provider === provider ? record : item
    ));
    renderResults(nextRecords);
    void persistIndependentTranslationResults(
      text,
      targetSnapshot,
      resolvedTargetLanguage,
      providers,
      nextRecords
    );
  });

  await Promise.allSettled(tasks);
  if (currentRequest === requestId) setBusy(false);
}

async function persistIndependentTranslationResults(text, requestedTarget, resolvedTarget, providers, records) {
  const completedRecords = orderResultRecords(records, providers).filter((record) => !record.loading);
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

function renderPlaceholder() {
  lastRenderedRecords = [];
  results.className = "results empty";
  results.textContent = "翻译结果会按所选来源显示在这里";
  status.textContent = "";
}

function renderLoading(providers) {
  renderResults(providers.map((provider) => ({
    provider,
    label: getProviderLabel(provider),
    loading: true
  })));
}

function orderResultRecords(records, providers = getSelectedProviders()) {
  const recordMap = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (VALID_TRANSLATION_PROVIDERS.includes(record?.provider)) {
      recordMap.set(record.provider, record);
    }
  }
  return providers.map((provider) => recordMap.get(provider)).filter(Boolean);
}

function getVisibleResultRecords() {
  return orderResultRecords(lastRenderedRecords);
}

function renderResults(records) {
  lastRenderedRecords = Array.isArray(records) ? records.slice() : [];
  const visibleRecords = orderResultRecords(lastRenderedRecords);
  results.className = "results";
  results.textContent = "";

  if (!visibleRecords.length) {
    renderPlaceholder();
    return;
  }

  for (const record of visibleRecords) {
    const provider = ["google", "deepseek", "deepl"].includes(record.provider) ? record.provider : "google";
    const card = document.createElement("article");
    card.className = `result-card ${provider}`;

    const header = document.createElement("div");
    header.className = "provider-card-header";

    const name = document.createElement("span");
    name.className = "provider-name";
    const badge = document.createElement("span");
    badge.className = "provider-badge";
    badge.textContent = getProviderBadge(provider);
    const label = document.createElement("span");
    label.textContent = record.label || getProviderLabel(provider);
    name.append(badge, label);

    const state = document.createElement("span");
    state.className = "provider-state";
    state.textContent = record.loading ? "\u7ffb\u8bd1\u4e2d\u2026" : record.ok ? "\u5b8c\u6210" : "\u672a\u5b8c\u6210";
    if (!record.loading && !record.ok) state.classList.add("error");

    const statusGroup = document.createElement("span");
    statusGroup.className = "provider-status-group";
    statusGroup.append(state);
    if (!record.loading) {
      const retryButton = document.createElement("button");
      retryButton.className = "provider-retry-button";
      retryButton.type = "button";
      retryButton.title = "\u91cd\u65b0\u7ffb\u8bd1";
      retryButton.setAttribute("aria-label", `${record.label || getProviderLabel(provider)}\u91cd\u65b0\u7ffb\u8bd1`);
      retryButton.textContent = "\u21bb";
      retryButton.addEventListener("click", () => retryProvider(provider));
      statusGroup.append(retryButton);
    }
    header.append(name, statusGroup);

    const body = document.createElement("div");
    body.className = "provider-result";
    if (record.loading) {
      body.classList.add("loading");
      body.textContent = getProviderLoadingText(provider);
    } else if (record.external) {
      body.classList.add("loading");
      body.textContent = "\u4e0d\u4f7f\u7528 API\uff1b\u8bf7\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\uff0c\u5728 DeepL \u7f51\u9875\u7a97\u53e3\u4e2d\u7ffb\u8bd1\u3002";
    } else if (record.ok) {
      body.textContent = record.translatedText || "\u6ca1\u6709\u5f97\u5230\u7ffb\u8bd1\u7ed3\u679c";
    } else {
      body.classList.add("error");
      body.textContent = record.error || "翻译失败。";
    }

    const actions = document.createElement("div");
    actions.className = "card-actions";
    if (record.ok && record.translatedText) {
      actions.append(createActionButton("复制结果", async (button) => {
        await writeClipboardText(record.translatedText);
        const oldText = button.textContent;
        button.textContent = "已复制";
        setTimeout(() => { button.textContent = oldText; }, 1200);
      }));
    }
    if (provider === "deepseek" && !hasDeepSeekApiKey) {
      actions.append(createActionButton("填写 API Key", () => {
        deepseekSettings.open = true;
        deepseekApiKey.focus();
      }));
    }
    actions.append(createActionButton(
      getProviderOpenLabel(provider),
      () => openProviderWebsite(provider)
    ));

    card.append(header, body, actions);
    results.append(card);
  }

  status.textContent = visibleRecords.some((record) => record.loading) ? "翻译中…" : "";
}

async function retryProvider(provider) {
  const text = sourceText.value.trim();
  if (!text) {
    showError("\u8bf7\u5148\u8f93\u5165\u3001\u9009\u4e2d\u6216\u590d\u5236\u9700\u8981\u7ffb\u8bd1\u7684\u6587\u672c\u3002");
    return;
  }

  const retryToken = (providerRetryTokens.get(provider) || 0) + 1;
  providerRetryTokens.set(provider, retryToken);
  const requestSnapshot = requestId;
  const targetSnapshot = targetLanguage.value;
  const loadingRecord = {
    provider,
    label: getProviderLabel(provider),
    loading: true
  };
  const loadingRecords = lastRenderedRecords.some((record) => record.provider === provider)
    ? lastRenderedRecords.map((record) => record.provider === provider ? loadingRecord : record)
    : [...lastRenderedRecords, loadingRecord];
  renderResults(loadingRecords);
  hideError();

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
      providerRetryTokens.get(provider) !== retryToken
      || requestId !== requestSnapshot
      || sourceText.value.trim() !== text
      || targetLanguage.value !== targetSnapshot
    ) return;
    if (!response?.ok) throw new Error(response?.error || "\u7ffb\u8bd1\u5931\u8d25\u3002");

    const refreshed = (response.results || []).find((record) => record.provider === provider) || {
      provider,
      label: getProviderLabel(provider),
      ok: false,
      error: "\u6ca1\u6709\u5f97\u5230\u7ffb\u8bd1\u7ed3\u679c\u3002"
    };
    const mergedRecords = lastRenderedRecords.map((record) => (
      record.provider === provider ? refreshed : record
    ));
    renderResults(mergedRecords);
    await persistMergedRetryResult(text, targetSnapshot, response, mergedRecords);
  } catch (error) {
    if (
      providerRetryTokens.get(provider) !== retryToken
      || requestId !== requestSnapshot
      || sourceText.value.trim() !== text
    ) return;
    const failed = {
      provider,
      label: getProviderLabel(provider),
      ok: false,
      error: friendlyError(error)
    };
    renderResults(lastRenderedRecords.map((record) => (
      record.provider === provider ? failed : record
    )));
  }
}

async function persistMergedRetryResult(text, requestedTarget, response, records) {
  const providers = getSelectedProviders();
  await chrome.storage.local.set({
    lastTranslation: {
      sourceText: text,
      sourceLanguage: "auto",
      targetLanguage: response?.targetLanguage || requestedTarget,
      requestedTarget,
      providers,
      results: records.filter((record) => providers.includes(record.provider)),
      translatedAt: Date.now()
    }
  });
}

function createActionButton(text, handler) {
  const button = document.createElement("button");
  button.className = "secondary-button";
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", async () => {
    try {
      await handler(button);
    } catch (error) {
      showError(friendlyError(error));
    }
  });
  return button;
}

async function openProviderWebsite(provider) {
  const text = sourceText.value.trim();
  const message = provider === "google"
    ? {
        type: "OPEN_GOOGLE_TRANSLATE",
        text,
        sourceLanguage: "auto",
        targetLanguage: targetLanguage.value
      }
    : provider === "deepl"
      ? {
          type: "OPEN_DEEPL_TRANSLATE",
          text,
          sourceLanguage: "auto",
          targetLanguage: targetLanguage.value
        }
      : { type: "OPEN_DEEPSEEK" };
  const response = await sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || `\u65e0\u6cd5\u6253\u5f00 ${getProviderLabel(provider)}\u3002`);
  }
}

function setBusy(busy) {
  translateButton.disabled = busy;
  targetLanguage.disabled = busy;
  status.textContent = busy ? "翻译中…" : "";
}

async function toggleToolbarVerticalMaximize() {
  if (!isMovableWindow) return;
  if (isHostedPictureInPicture) {
    postHostedPictureInPictureMessage({ type: "TOGGLE_VERTICAL_MAX" });
    return;
  }
  if (pictureInPictureWindow && !pictureInPictureWindow.closed) {
    togglePictureInPictureVerticalMaximize();
    return;
  }

  verticalMaxButton.disabled = true;
  try {
    const currentWindow = await chrome.windows.getCurrent();
    if (!currentWindow?.id) throw new Error("无法找到翻译窗口。");

    if (!toolbarWindowVerticallyMaximized) {
      toolbarWindowRestoreBounds = { top: currentWindow.top, height: currentWindow.height };
      const availableTop = Number.isFinite(screen.availTop) ? Math.round(screen.availTop) : 0;
      const availableHeight = Math.max(420, Math.round(screen.availHeight || screen.height || 720));
      await chrome.windows.update(currentWindow.id, { top: availableTop, height: availableHeight });
      toolbarWindowVerticallyMaximized = true;
    } else {
      const restore = toolbarWindowRestoreBounds;
      if (restore) {
        await chrome.windows.update(currentWindow.id, {
          top: Math.round(restore.top ?? currentWindow.top ?? 0),
          height: Math.max(420, Math.round(restore.height || 720))
        });
      }
      toolbarWindowVerticallyMaximized = false;
      toolbarWindowRestoreBounds = null;
    }
    updateToolbarVerticalMaximizeUI();
  } catch (error) {
    showError(friendlyError(error));
  } finally {
    verticalMaxButton.disabled = false;
  }
}

function updateToolbarVerticalMaximizeUI() {
  const active = isHostedPictureInPicture
    ? pictureInPictureVerticallyMaximized
    : (pictureInPictureWindow && !pictureInPictureWindow.closed
      ? pictureInPictureVerticallyMaximized
      : toolbarWindowVerticallyMaximized);
  verticalMaxButton.classList.toggle("is-active", active);
  verticalMaxButton.setAttribute("aria-pressed", String(active));
  verticalMaxButton.title = active ? "\u8fd8\u539f\u7a97\u53e3\u9ad8\u5ea6" : "\u7eb5\u5411\u6700\u5927\u5316";
  verticalMaxButton.setAttribute("aria-label", verticalMaxButton.title);
}

function togglePictureInPictureVerticalMaximize() {
  const pipWindow = pictureInPictureWindow;
  if (!pipWindow || pipWindow.closed) return;

  try {
    if (!pictureInPictureVerticallyMaximized) {
      pictureInPictureRestoreBounds = {
        width: Math.max(360, Math.round(pipWindow.outerWidth || 430)),
        height: Math.max(420, Math.round(pipWindow.outerHeight || 650))
      };
      const pipScreen = pipWindow.screen || screen;
      pipWindow.resizeTo(
        Math.max(360, Math.round(pipWindow.outerWidth || 430)),
        Math.max(420, Math.round(pipScreen.availHeight || pipScreen.height || 720))
      );
      pictureInPictureVerticallyMaximized = true;
    } else {
      const restore = pictureInPictureRestoreBounds;
      if (restore) pipWindow.resizeTo(restore.width, restore.height);
      pictureInPictureVerticallyMaximized = false;
      pictureInPictureRestoreBounds = null;
    }
    updateToolbarVerticalMaximizeUI();
  } catch (error) {
    showError(friendlyError(error));
  }
}

async function toggleAlwaysOnTop() {
  if (!isMovableWindow || edgeAutoTopAttemptInProgress) return;
  if (isHostedPictureInPicture) {
    alwaysOnTopRequested = false;
    updateAlwaysOnTopUI();
    postHostedPictureInPictureMessage({
      type: "CANCEL_ALWAYS_ON_TOP",
      sourceText: sourceText.value,
      targetLanguage: targetLanguage.value,
      providers: getSelectedProviders()
    });
    return;
  }
  const active = Boolean(pictureInPictureWindow && !pictureInPictureWindow.closed);
  alwaysOnTopButton.disabled = true;
  try {
    if (active) {
      alwaysOnTopRequested = false;
      await restoreOrdinaryToolbarWindow(true);
    } else if (alwaysOnTopRequested) {
      // Clicking the already-blue bell always cancels the default auto-pin request.
      alwaysOnTopRequested = false;
    } else {
      alwaysOnTopRequested = true;
      updateAlwaysOnTopUI();
      await enterAlwaysOnTopMode();
    }
  } catch (error) {
    alwaysOnTopRequested = false;
    showError(friendlyError(error));
  } finally {
    updateAlwaysOnTopUI();
  }
}

async function autoEnterAlwaysOnTopMode() {
  if (!isMovableWindow || edgeAutoTopAttemptInProgress) return;
  if (pictureInPictureWindow && !pictureInPictureWindow.closed) return;

  // The toolbar click enters the blue auto-pin state immediately. When Edge
  // exposes transient activation to the new window, complete PiP now;
  // otherwise the first trusted interaction inside the window completes it.
  alwaysOnTopRequested = true;
  updateAlwaysOnTopUI();
  if (!navigator.userActivation?.isActive) return;

  edgeAutoTopAttemptInProgress = true;
  updateAlwaysOnTopUI();
  try {
    await enterAlwaysOnTopMode();
  } catch (error) {
    alwaysOnTopRequested = false;
    console.warn("Automatic always-on-top failed:", error);
  } finally {
    edgeAutoTopAttemptInProgress = false;
    updateAlwaysOnTopUI();
  }
}

function completePendingAutoTopFromTrustedInteraction(event) {
  if (!isMovableWindow || !alwaysOnTopRequested || edgeAutoTopAttemptInProgress) return;
  if (pictureInPictureWindow && !pictureInPictureWindow.closed) return;
  if (!event?.isTrusted || !navigator.userActivation?.isActive) return;
  if (event.target?.closest?.("#always-on-top-button")) return;

  edgeAutoTopAttemptInProgress = true;
  updateAlwaysOnTopUI();
  void enterAlwaysOnTopMode()
    .catch((error) => {
      alwaysOnTopRequested = false;
      showError(friendlyError(error));
    })
    .finally(() => {
      edgeAutoTopAttemptInProgress = false;
      updateAlwaysOnTopUI();
    });
}

async function enterAlwaysOnTopMode() {
  if (!("documentPictureInPicture" in window)) {
    throw new Error("\u5f53\u524d Edge \u7248\u672c\u4e0d\u652f\u6301\u771f\u6b63\u7684\u624b\u52a8\u7f6e\u9876\u7a97\u53e3\uff0c\u8bf7\u66f4\u65b0 Edge \u540e\u91cd\u8bd5\u3002");
  }

  const width = Math.max(360, Math.min(900, Math.round(window.outerWidth || 430)));
  const height = Math.max(420, Math.min(1000, Math.round(window.outerHeight || 650)));
  const browserWindowPromise = chrome.windows.getCurrent().catch(() => null);
  const pipWindow = await documentPictureInPicture.requestWindow({ width, height });
  const browserWindow = await browserWindowPromise;

  toolbarPopupWindowId = Number.isInteger(browserWindow?.id) ? browserWindow.id : null;
  preparePictureInPictureDocument(pipWindow.document);
  pictureInPictureWindow = pipWindow;
  alwaysOnTopRequested = true;
  pictureInPictureVerticallyMaximized = false;
  pictureInPictureRestoreBounds = null;
  pipWindow.addEventListener("pagehide", handlePictureInPictureClosed, { once: true });
  attachPictureInPictureDragListeners(pipWindow);
  pipWindow.document.body.append(appRoot);
  stopSelectionWatch();
  startSelectionWatch();
  updateAlwaysOnTopUI();
  updateToolbarVerticalMaximizeUI();
  hideError();

  if (Number.isInteger(toolbarPopupWindowId)) {
    try {
      await chrome.windows.update(toolbarPopupWindowId, { state: "minimized" });
    } catch (error) {
      console.warn("Unable to minimize the ordinary translator window:", error);
    }
  }
}

function preparePictureInPictureDocument(pipDocument) {
  pipDocument.title = "\u5b8f\u8bd1\u00b7\u7f6e\u9876";
  pipDocument.documentElement.lang = "zh-CN";
  pipDocument.body.className = "picture-in-picture";

  for (const styleSheet of document.styleSheets) {
    if (styleSheet.href) {
      const link = pipDocument.createElement("link");
      link.rel = "stylesheet";
      link.href = styleSheet.href;
      pipDocument.head.append(link);
      continue;
    }

    try {
      const style = pipDocument.createElement("style");
      style.textContent = [...styleSheet.cssRules].map((rule) => rule.cssText).join("\n");
      pipDocument.head.append(style);
    } catch {
      // Ignore inaccessible stylesheets; popup.css is same-origin and normally copied above.
    }
  }
}

function startPictureInPictureDrag(event) {
  if (!isMovableWindow) return;
  if (!isHostedPictureInPicture && (!pictureInPictureWindow || pictureInPictureWindow.closed)) return;
  if (event.button !== 0) return;
  if (event.target.closest("button, input, textarea, select, a, summary")) return;

  event.preventDefault();
  pictureInPictureDrag = {
    pointerId: event.pointerId,
    startPointerX: event.screenX,
    startPointerY: event.screenY,
    startLeft: Number(pictureInPictureWindow?.screenX || 0),
    startTop: Number(pictureInPictureWindow?.screenY || 0)
  };
  if (isHostedPictureInPicture) {
    postHostedPictureInPictureMessage({ type: "DRAG_START", screenX: event.screenX, screenY: event.screenY });
  }
  try {
    windowHeader.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is not available in every Document PiP implementation.
  }
}

function updatePictureInPictureDrag(event) {
  const drag = pictureInPictureDrag;
  const pipWindow = pictureInPictureWindow;
  if (!drag || event.pointerId !== drag.pointerId) return;
  if (!isHostedPictureInPicture && (!pipWindow || pipWindow.closed)) return;

  event.preventDefault();
  if (isHostedPictureInPicture) {
    postHostedPictureInPictureMessage({ type: "DRAG_MOVE", screenX: event.screenX, screenY: event.screenY });
    return;
  }
  try {
    pipWindow.moveTo(
      Math.round(drag.startLeft + event.screenX - drag.startPointerX),
      Math.round(drag.startTop + event.screenY - drag.startPointerY)
    );
  } catch {
    // Ignore a transient move failure while the PiP window is closing.
  }
}

function finishPictureInPictureDrag(event) {
  if (!pictureInPictureDrag) return;
  if (event && event.pointerId !== pictureInPictureDrag.pointerId) return;
  if (isHostedPictureInPicture) postHostedPictureInPictureMessage({ type: "DRAG_END" });
  pictureInPictureDrag = null;
}

function attachPictureInPictureDragListeners(pipWindow) {
  pipWindow.addEventListener("pointermove", updatePictureInPictureDrag, true);
  pipWindow.addEventListener("pointerup", finishPictureInPictureDrag, true);
  pipWindow.addEventListener("pointercancel", finishPictureInPictureDrag, true);
}

function detachPictureInPictureDragListeners(pipWindow) {
  if (!pipWindow) return;
  pipWindow.removeEventListener("pointermove", updatePictureInPictureDrag, true);
  pipWindow.removeEventListener("pointerup", finishPictureInPictureDrag, true);
  pipWindow.removeEventListener("pointercancel", finishPictureInPictureDrag, true);
}

function handlePictureInPictureClosed() {
  if (restoringFromPictureInPicture) return;
  alwaysOnTopRequested = false;
  detachPictureInPictureDragListeners(pictureInPictureWindow);
  pictureInPictureDrag = null;
  void restoreOrdinaryToolbarWindow(false);
}

async function restoreOrdinaryToolbarWindow(closePictureInPicture) {
  const pipWindow = pictureInPictureWindow;
  if (!pipWindow && appRoot.ownerDocument === document) return;

  restoringFromPictureInPicture = true;
  try {
    if (appHomeMarker.parentNode) {
      appHomeMarker.parentNode.insertBefore(appRoot, appHomeMarker.nextSibling);
    } else {
      document.body.prepend(appRoot);
    }
    stopSelectionWatch();
    startSelectionWatch();

    detachPictureInPictureDragListeners(pipWindow);
    pictureInPictureDrag = null;
    pictureInPictureWindow = null;
    pictureInPictureVerticallyMaximized = false;
    pictureInPictureRestoreBounds = null;
    updateAlwaysOnTopUI();
    updateToolbarVerticalMaximizeUI();

    if (closePictureInPicture && pipWindow && !pipWindow.closed) {
      pipWindow.close();
    }

    if (Number.isInteger(toolbarPopupWindowId)) {
      try {
        await chrome.windows.update(toolbarPopupWindowId, { state: "normal", focused: true });
      } catch (error) {
        console.warn("Unable to restore the ordinary translator window:", error);
      }
    }
  } finally {
    restoringFromPictureInPicture = false;
  }
}

function updateAlwaysOnTopUI() {
  const active = isHostedPictureInPicture || Boolean(pictureInPictureWindow && !pictureInPictureWindow.closed);
  const visuallyActive = active || alwaysOnTopRequested || edgeAutoTopAttemptInProgress;
  alwaysOnTopButton.classList.toggle("is-active", visuallyActive);
  alwaysOnTopButton.setAttribute("aria-pressed", String(visuallyActive));
  alwaysOnTopButton.dataset.active = String(visuallyActive);
  alwaysOnTopButton.disabled = edgeAutoTopAttemptInProgress;
  alwaysOnTopButton.title = active
    ? "\u53d6\u6d88\u7f6e\u9876\uff0c\u6062\u590d\u666e\u901a\u7a97\u53e3"
    : (edgeAutoTopAttemptInProgress
      ? "\u6b63\u5728\u81ea\u52a8\u7f6e\u9876"
      : (alwaysOnTopRequested ? "\u53d6\u6d88\u81ea\u52a8\u7f6e\u9876" : "\u624b\u52a8\u7f6e\u9876"));
  alwaysOnTopButton.setAttribute("aria-label", alwaysOnTopButton.title);
}

function cleanupMovableWindowFeatures() {
  stopSelectionWatch();
  appRoot.removeEventListener("pointerdown", completePendingAutoTopFromTrustedInteraction, true);
  window.removeEventListener("keydown", completePendingAutoTopFromTrustedInteraction, true);
  window.removeEventListener("message", handleHostedPictureInPictureMessage);
  window.removeEventListener("pointermove", updatePictureInPictureDrag, true);
  window.removeEventListener("pointerup", finishPictureInPictureDrag, true);
  window.removeEventListener("pointercancel", finishPictureInPictureDrag, true);
  if (chrome.windows.onFocusChanged.hasListener(handleBrowserWindowFocusChanged)) {
    chrome.windows.onFocusChanged.removeListener(handleBrowserWindowFocusChanged);
  }
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

async function writeClipboardText(text) {
  const response = await sendMessage({
    type: "WRITE_CLIPBOARD",
    text
  });

  if (!response?.ok) {
    throw new Error(response?.error || "\u590d\u5236\u5931\u8d25\u3002");
  }
}

function getTranslationMessageTimeout(provider) {
  return provider === "deepl"
    ? DEEPL_TRANSLATION_MESSAGE_TIMEOUT_MS
    : DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS;
}

function sendMessage(message, timeoutMs = DEFAULT_TRANSLATION_MESSAGE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
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
          reject(new Error(error.message));
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

function friendlyError(error) {
  if (!error) return "发生未知错误。";
  return error.message || String(error);
}