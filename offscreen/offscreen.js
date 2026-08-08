chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_READ_CLIPBOARD") {
    readClipboardText()
      .then((text) => sendResponse({ ok: true, text }))
      .catch((error) => sendResponse({
        ok: false,
        text: "",
        error: error.message || String(error)
      }));

    return true;
  }

  if (message?.type === "OFFSCREEN_WRITE_CLIPBOARD") {
    writeClipboardText(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({
        ok: false,
        error: error.message || String(error)
      }));

    return true;
  }

  return false;
});

async function readClipboardText() {
  if (navigator.clipboard?.readText) {
    try {
      return (await navigator.clipboard.readText()).trim();
    } catch {
      // Fall through to the paste-command compatibility path.
    }
  }

  const target = document.getElementById("clipboard-target");
  target.value = "";
  target.focus();

  const pasted = document.execCommand("paste");
  if (!pasted && !target.value) {
    throw new Error("Edge 没有允许读取剪贴板，请重新加载扩展并确认剪贴板权限。");
  }

  return target.value.trim();
}


async function writeClipboardText(rawText) {
  const text = String(rawText || "");

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the copy-command compatibility path.
    }
  }

  const target = document.getElementById("clipboard-target");
  target.value = text;
  target.focus();
  target.select();

  if (!document.execCommand("copy")) {
    throw new Error("\u5fae\u8f6f Edge \u4e0d\u5141\u8bb8\u5199\u5165\u526a\u8d34\u677f\u3002");
  }
}
