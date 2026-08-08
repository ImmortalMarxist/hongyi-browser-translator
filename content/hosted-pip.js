(() => {
  const STATE_KEY = "__hongyiHostedTranslatorPipState";
  const CHANNEL = "hongyi-hosted-pip-v1";

  async function openHostedTranslator() {
    const existing = globalThis[STATE_KEY];
    if (existing?.pipWindow && !existing.pipWindow.closed) {
      existing.pipWindow.focus();
      return { ok: true, reused: true };
    }
    if (!("documentPictureInPicture" in window)) {
      return { ok: false, error: "document-picture-in-picture-unsupported" };
    }

    const width = 430;
    const height = Math.max(420, Math.min(720, Math.round(window.screen?.availHeight || 720) - 96));
    const pipWindow = await documentPictureInPicture.requestWindow({ width, height, disallowReturnToOpener: true });
    const pipDocument = pipWindow.document;
    pipDocument.title = "宏译·置顶";
    pipDocument.documentElement.lang = "zh-CN";
    pipDocument.documentElement.style.cssText = "width:100%;height:100%;margin:0;background:#f8f9fb;overflow:hidden";
    pipDocument.body.style.cssText = "width:100%;height:100%;margin:0;background:#f8f9fb;overflow:hidden";

    const frame = pipDocument.createElement("iframe");
    frame.id = "hongyi-hosted-translator-frame";
    frame.src = chrome.runtime.getURL("popup/popup.html?mode=hosted-pip");
    frame.title = "宏译";
    frame.allow = "clipboard-read; clipboard-write";
    frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:#f8f9fb";
    pipDocument.body.append(frame);

    const state = { pipWindow, frame, pendingText: "", drag: null, verticalRestore: null, closingForCancel: false };
    globalThis[STATE_KEY] = state;
    const postToFrame = (payload) => frame.contentWindow?.postMessage({ channel: CHANNEL, ...payload }, "*");

    const runtimeListener = (message, _sender, sendResponse) => {
      if (!message || typeof message.type !== "string") return false;
      if (message.type === "HOSTED_PIP_APPLY_TEXT") {
        state.pendingText = String(message.text || "");
        postToFrame({ type: "APPLY_SELECTION_TEXT", text: state.pendingText, source: message.source || "selection" });
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "HOSTED_PIP_FOCUS") {
        try { pipWindow.focus(); } catch {}
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "HOSTED_PIP_CLOSE") {
        try { pipWindow.close(); } catch {}
        sendResponse({ ok: true });
        return false;
      }
      return false;
    };

    const frameMessageListener = (event) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== CHANNEL) return;
      const message = event.data;
      if (message.type === "FRAME_READY") {
        if (state.pendingText) postToFrame({ type: "APPLY_SELECTION_TEXT", text: state.pendingText, source: "selection" });
        return;
      }
      if (message.type === "FOCUS_HOSTED_PIP") {
        try { pipWindow.focus(); } catch {}
        return;
      }
      if (message.type === "CANCEL_ALWAYS_ON_TOP") {
        state.closingForCancel = true;
        chrome.runtime.sendMessage({
          type: "HOSTED_PIP_CANCEL",
          sourceText: String(message.sourceText || ""),
          targetLanguage: String(message.targetLanguage || ""),
          providers: Array.isArray(message.providers) ? message.providers : []
        }).catch(() => undefined);
        try { pipWindow.close(); } catch {}
        return;
      }
      if (message.type === "CLOSE_HOSTED_PIP") {
        try { pipWindow.close(); } catch {}
        return;
      }
      if (message.type === "TOGGLE_VERTICAL_MAX") {
        if (!state.verticalRestore) {
          state.verticalRestore = {
            width: Math.round(pipWindow.outerWidth || width), height: Math.round(pipWindow.outerHeight || height),
            left: Math.round(pipWindow.screenX || 0), top: Math.round(pipWindow.screenY || 0)
          };
          try {
            pipWindow.moveTo(Math.round(screen.availLeft || 0), Math.round(screen.availTop || 0));
            pipWindow.resizeTo(state.verticalRestore.width, Math.max(420, Math.round(screen.availHeight || screen.height || 720)));
          } catch {}
          postToFrame({ type: "VERTICAL_MAX_STATE", active: true });
        } else {
          const restore = state.verticalRestore;
          state.verticalRestore = null;
          try { pipWindow.moveTo(restore.left, restore.top); pipWindow.resizeTo(restore.width, restore.height); } catch {}
          postToFrame({ type: "VERTICAL_MAX_STATE", active: false });
        }
        return;
      }
      if (message.type === "DRAG_START") {
        state.drag = { pointerX: Number(message.screenX || 0), pointerY: Number(message.screenY || 0), left: Number(pipWindow.screenX || 0), top: Number(pipWindow.screenY || 0) };
        return;
      }
      if (message.type === "DRAG_MOVE" && state.drag) {
        try {
          pipWindow.moveTo(
            Math.round(state.drag.left + Number(message.screenX || 0) - state.drag.pointerX),
            Math.round(state.drag.top + Number(message.screenY || 0) - state.drag.pointerY)
          );
        } catch {}
        return;
      }
      if (message.type === "DRAG_END") state.drag = null;
    };

    chrome.runtime.onMessage.addListener(runtimeListener);
    pipWindow.addEventListener("message", frameMessageListener);
    frame.addEventListener("load", () => postToFrame({ type: "HOST_CONNECTED" }), { once: true });
    pipWindow.addEventListener("pagehide", () => {
      chrome.runtime.onMessage.removeListener(runtimeListener);
      pipWindow.removeEventListener("message", frameMessageListener);
      if (globalThis[STATE_KEY] === state) delete globalThis[STATE_KEY];
      chrome.runtime.sendMessage({ type: "HOSTED_PIP_CLOSED", cancelled: state.closingForCancel }).catch(() => undefined);
    }, { once: true });

    chrome.runtime.sendMessage({ type: "REGISTER_HOSTED_PIP" }).catch(() => undefined);
    return { ok: true, reused: false };
  }

  return openHostedTranslator().catch((error) => ({ ok: false, error: error?.message || String(error) }));
})();
