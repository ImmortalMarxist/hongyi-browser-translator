# 第一次使用：把扩展导入 Edge 浏览器

如果你第一次拿到“宏译”的 ZIP 压缩包，请按照下面的步骤安装。**ZIP 文件不能直接加载到 Edge，必须先解压。**

1. 下载版本压缩包，例如：

   ```text
   edge-google-selection-translator-v1.4.0.35.zip
   ```

2. 右键单击 ZIP 文件，选择“全部解压”，或使用其他解压软件将它解压到一个固定目录。
3. 打开解压后的文件夹，确认该文件夹中能够直接看到：

   ```text
   manifest.json
   background.js
   README.md
   content
   popup
   icons
   ```

4. 打开 Microsoft Edge，在地址栏输入：

   ```text
   edge://extensions
   ```

5. 打开扩展管理页面中的“开发人员模式”。
6. 点击“加载解压缩的扩展”。
7. 选择第 3 步中**直接包含 `manifest.json` 的文件夹**，然后点击“选择文件夹”。不要选择 ZIP 文件，也不要选择它外面多一层的父文件夹。
8. 导入成功后，在 Edge 工具栏的扩展菜单中找到“宏译”，点击图钉将它固定到工具栏。
9. 打开一个普通网页并刷新页面。此后可以选中文字使用“译”按钮，或者点击工具栏中的“宏”打开翻译窗口。

如果 Edge 提示“清单文件缺失”或无法加载，请重新确认所选文件夹中是否直接存在 `manifest.json`。如果扩展更新过，还需要在 `edge://extensions` 中点击“宏译”的刷新按钮，并刷新此前已经打开的网页。

---

# 宏译（Microsoft Edge 扩展）

**当前版本：1.4.0.35**

“宏译”可以翻译 Edge 网页中选中的文字，也可以翻译从其他软件复制到剪贴板的文字。翻译结果会直接显示在扩展弹窗中，支持 Google、DeepSeek 和 DeepL。

## 一、主要功能

### 1. 网页划词翻译

- 在普通网页中选中文字后，鼠标松开的位置会出现蓝色“译”按钮。
- 点击“译”后，翻译卡片会尽量贴近选中文字的最后一行打开，并立即自动翻译。
- 翻译卡片保持打开时，再次选中文字会直接更新原文并重新翻译。
- 菜单栏翻译窗口已经打开时，网页中的“译”按钮仍然可以正常显示和使用。
- 支持较长文本，单次最多约 50,000 个字符。

### 2. 工具栏“宏”图标

- Edge 工具栏图标显示“宏”。
- 点击“宏”会打开翻译窗口，并默认进入置顶状态。
- 窗口右上角的小铃铛表示置顶状态，用户可以点击铃铛取消置顶。
- 取消置顶后，窗口会作为普通独立窗口保留，可以移动、缩放或切换到其他软件继续使用。
- 如果当前页面不支持置顶窗口，扩展会打开普通独立窗口。

### 3. 选中文字和剪贴板的优先级

工具栏翻译窗口遵循以下规则：

1. 当前正在使用 Edge 主页面并且有选中文字时，优先翻译选中的文字。
2. 只要选中文字仍然有效，就不会被剪贴板内容覆盖。
3. 当前没有选中文字时，把鼠标移入翻译窗口或点击翻译窗口，扩展才会检查剪贴板。
4. 切换到其他软件后，不再读取 Edge 中残留的选中文字；复制新文本后，把鼠标移入翻译窗口即可翻译。
5. 同一次选中文字或相同的剪贴板内容只识别一次，不会反复刷新。
6. 手动修改原文后，不会被相同的旧选区或旧剪贴板内容重新覆盖。
7. 取消选区后，再次选中相同文字仍可重新识别。

简而言之：**Edge 中有选中文字时优先使用选中文字；没有选中文字时，才在用户进入翻译窗口后读取剪贴板。**

### 4. 三个翻译引擎

#### Google

- 不需要 API Key。
- 翻译结果直接显示在弹窗的 Google 卡片中。
- 可以点击跳转按钮，在 Google 翻译网页中打开原文。
- 但要梯子

#### DeepSeek

- 需要填写可用的 DeepSeek API Key。
- API Key 输入框以黑点隐藏内容。
- 保存后不会再次显示完整 Key。
- 没有填写 API Key 时，勾选 DeepSeek 会提示先填写，DeepSeek 不会被启用。
- 可以点击跳转按钮打开 DeepSeek 网页。

#### DeepL

- 当前版本不需要填写 API Key。
- 翻译结果直接返回弹窗中的 DeepL 卡片，不会自动新增浏览器页面。
- 可以点击跳转按钮，在 DeepL 网页中打开原文。

### 5. 多引擎翻译

- Google、DeepSeek、DeepL 可以单选，也可以同时多选。
- 没有勾选的引擎不会显示卡片，也不会进行翻译。
- 卡片顺序按照勾选的先后顺序排列。
- 取消某个引擎后再次勾选，该引擎会排到当前顺序的最后。
- 三个引擎分别显示结果，哪个先完成就先显示哪个，不需要等待其他引擎。
- 每张结果卡片都提供：
  - 复制译文；
  - 刷新当前引擎；
  - 跳转到对应翻译网站。
- 无论翻译成功、失败或未完成，刷新符号“↻”都会保留。

### 6. 原文编辑和数量统计

- 网页翻译卡片和工具栏翻译窗口中的原文都可以编辑。
- 停止输入约 550 毫秒后会自动重新翻译。
- 按 `Ctrl+Enter` 可以立即翻译。
- 原文区域右上角显示数量，只显示阿拉伯数字：
  - 英文按照单词数量统计，不按照字母数量统计；
  - 其他语言按照非空白字符数量统计。

### 7. 窗口操作

翻译窗口支持：

- 拖动标题区域移动窗口；
- 点击关闭按钮关闭窗口；
- 固定或取消固定位置；
- 从上、下、左、右和四个角拉动改变大小；
- 拖动原文与译文之间的分隔条，调整两个区域的高度；
- 点击“↕”一键纵向拉到最大，再次点击恢复；
- 点击小铃铛开启或取消置顶。

扩展同时只保留一个翻译窗口。通过“宏”或“译”打开新窗口时，原来的翻译窗口会关闭，避免出现多个窗口。

### 8. 插件开关

- 翻译窗口中有电源按钮。
- 关闭插件后：
  - 网页选中文字时不再显示“译”；
  - 右键翻译不再触发；
  - 工具栏“宏”图标变成灰色。
- 点击灰色“宏”图标，可以重新打开并启用插件。

## 二、安装方法

1. 解压扩展压缩包。
2. 在 Edge 地址栏输入 `edge://extensions`。
3. 打开“开发人员模式”。
4. 点击“加载解压缩的扩展”。
5. 选择解压后的扩展根目录。该目录下应当直接包含 `manifest.json`。
6. 在 Edge 扩展菜单中把“宏译”固定到工具栏。



更新扩展后：

1. 在 `edge://extensions` 中点击“宏译”的刷新按钮。
2. 刷新此前已经打开的网页。

## 三、使用方式

### 方式一：翻译 Edge 网页中选中的文字

1. 在普通网页中选中文字。
2. 松开鼠标，等待蓝色“译”按钮出现。
3. 点击“译”。
4. 翻译卡片会自动打开并开始翻译。
5. 卡片打开期间，可以继续选择其他文字，结果会自动更新。

### 方式二：通过工具栏翻译当前选区

1. 在 Edge 网页中选中文字。
2. 点击工具栏中的“宏”。
3. 翻译窗口会打开并优先翻译当前选区。
4. 窗口默认置顶；如不需要置顶，点击小铃铛取消。

### 方式三：翻译剪贴板文字

1. 在 Edge 或其他软件中复制文字，例如按 `Ctrl+C`。
2. 当前没有有效的 Edge 网页选区时，把鼠标移入翻译窗口或点击窗口。
3. 扩展识别到新的剪贴板文字后会自动翻译。
4. 如果剪贴板文字没有变化，不会重复翻译同一内容。

### 方式四：手动输入或修改原文

1. 点击原文输入区域。
2. 输入、粘贴或修改文字。
3. 停止输入后自动翻译，或者按 `Ctrl+Enter` 立即翻译。
4. 如需重新请求某个翻译引擎，点击该结果卡片上的“↻”。

### 设置 DeepSeek API Key

1. 打开翻译窗口中的 DeepSeek API 设置。
2. 在密码输入框中填写 API Key。
3. 点击保存。
4. 保存成功后勾选 DeepSeek。

请不要把含有 API Key 的截图、文件或日志发送给其他人。

## 四、常见问题

### 选中文字后没有出现“译”

请检查：

- 插件是否被电源按钮关闭；
- 当前页面是否为 `edge://`、Edge 扩展商店或其他受限制页面；
- 选中的是否确实为文字；
- 扩展更新后是否刷新了当前网页。

### 点击“宏”后没有置顶

某些 Edge 内置页面不允许扩展使用完整功能，此时会打开普通独立窗口。可以切换到普通网页后再次点击“宏”。

### DeepSeek 无法勾选

需要先填写并保存有效的 DeepSeek API Key，同时确认账户可用且有足够额度。

### DeepL 或 Google 翻译较慢

免 API 翻译速度可能受到网络状态、请求频率或翻译服务状态影响。可以点击对应卡片上的“↻”单独重试。

### 更新后功能没有变化

请先在 `edge://extensions` 中刷新扩展，再刷新已经打开的网页。旧网页在刷新前可能仍使用旧版本内容。

## 五、版本更新记录

### 1.3 系列

- **1.3.1**
  - 增加网页划词“译”按钮和自动翻译卡片。
  - 增加拖动、关闭、固定、八方向缩放和分隔条调整。
  - 增加剪贴板翻译、纵向最大化、复制、右键翻译和 Google 跳转。
- **1.3.2**
  - 扩展名称改为“宏译”。
  - 工具栏图标改为“宏”，网页按钮和弹窗图标继续使用“译”。
  - 改进独立窗口的使用体验。

### 1.4.0

- 增加 Google 和 DeepSeek 多引擎选择。
- 增加 DeepSeek API Key 设置和隐藏显示。
- 未填写 API Key 时禁止启用 DeepSeek。
- 未勾选的翻译来源不再显示结果卡片。
- 改进多个翻译窗口之间的互斥关系。

### 1.4.1～1.4.4 历史尝试版本

- **1.4.1**：尝试在返回 Edge 时自动把翻译窗口放到前面。
- **1.4.2**：尝试避免点击翻译窗口时连带抬起 Edge 主窗口。
- **1.4.3**：恢复更接近普通软件窗口的独立使用方式。
- **1.4.4**：继续尝试统一“宏”和“译”的窗口方式；由于窗口层级仍不符合需要，后续回到 1.4.0 主线继续修改。

### 1.4.0.x 修复主线

- **1.4.0.1**：增加手动置顶，并增加非 Edge 软件剪贴板文本检测。
- **1.4.0.2**：修复网页“译”偶发点击无反应；增加网页需要刷新的提示。
- **1.4.0.3**：切到其他软件后，鼠标进入翻译窗口时重新检查剪贴板。
- **1.4.0.4**：提高置顶窗口读取剪贴板的成功率。
- **1.4.0.5**：修复重复窗口；改进选区传递、窗口拖动、聚焦和关闭。
- **1.4.0.6**：修复 Edge 暂时无法识别已有翻译窗口时出现的路由失败。
- **1.4.0.7**：确保已有网页选区不会被剪贴板覆盖。
- **1.4.0.8**：修复扩展后台重启后的窗口识别和复制结果；菜单栏窗口存在时仍保留“译”。
- **1.4.0.9**：网页小卡片原文改为可编辑，并增加自动翻译和 `Ctrl+Enter`。
- **1.4.0.10**：未发布。
- **1.4.0.11**：最大文本长度提高到约 50,000 字符；改进长文本选区检测和分段翻译。
- **1.4.0.12**：增加原文数量统计；英文按单词计数，其他语言按非空白字符计数。
- **1.4.0.13**：增加 DeepL 选择项、结果卡片和网页跳转。
- **1.4.0.14**：首次让免 API DeepL 结果返回翻译弹窗。
- **1.4.0.15**：改进 DeepL 连续翻译速度；失败结果增加刷新按钮。
- **1.4.0.16**：成功或失败时都保留刷新按钮；减少多个 DeepL 请求互相覆盖。
- **1.4.0.17**：DeepL 翻译不再自动打开新页面，结果直接返回当前卡片。
- **1.4.0.18**：结果卡片按照勾选先后排序；取消后重新勾选会排到最后。
- **1.4.0.19**：增加插件电源按钮和灰色“宏”图标。
- **1.4.0.20**：修复“宏”“译”和右键翻译偶发无响应。
- **1.4.0.21**：再次强化选中文字优先；三个引擎改为完成一个就先显示一个。
- **1.4.0.22**：修复网页小卡片取消 DeepSeek 后重新勾选不显示的问题。
- **1.4.0.23**：提高 DeepL 翻译速度，减少长文本等待和超时。
- **1.4.0.24**：提高菜单栏窗口接收新选中文字的速度和稳定性。
- **1.4.0.25**：增加选区识别补偿，减少菜单栏窗口漏掉网页选区。
- **1.4.0.26**：继续提高选中文字读取和传递的可靠性。
- **1.4.0.27**：修复多个 Edge 窗口之间读取选中文字的问题，并修复部分乱码提示。
- **1.4.0.28**：尝试进入 Edge 时自动锁定置顶；由于出现闪动和操作受限，后续进行了简化。
- **1.4.0.29**：取消持续抢焦点；没有选区时，鼠标进入翻译窗口才读取剪贴板。
- **1.4.0.30**：只有 Edge 主页面获得焦点时才读取选中文字；切到其他软件后不读取残留选区。
- **1.4.0.31**：改进打开工具栏窗口时的默认置顶和 Edge 焦点判断。
- **1.4.0.32**：同一次选区和相同剪贴板文本只识别一次；手动编辑原文后不再被旧内容覆盖。
- **1.4.0.33**：继续改进工具栏窗口首次打开时的自动置顶。
- **1.4.0.35**：修复网页划词“译”小卡片中 DeepSeek 勾选后偶尔不创建结果卡片的异步状态竞争问题；勾选后立即显示 DeepSeek 检查/加载卡片，并支持取消后重新勾选。本版本未改动菜单栏窗口的置顶逻辑。
- **1.4.0.34**：点击工具栏“宏”后可立即打开真正置顶窗口；取消置顶后保留当前内容并恢复普通独立窗口；进一步确保同时只保留一个翻译窗口。

## 六、说明

- 当前主线版本为 **1.4.0.35**。
- ZIP 压缩包需要先解压，再通过 Edge 的“加载解压缩的扩展”安装。
- 本 README 以用户功能和使用方式为主；历史记录仅用于说明各版本解决过的问题。






---

<!-- ENGLISH TRANSLATION -->

# First Use: Import the Extension into Microsoft Edge

If this is your first time receiving the Hongyi ZIP archive, follow the steps below to install it. **A ZIP file cannot be loaded directly into Edge and must be extracted first.**

1. Download the versioned archive, for example:

   ```text
   edge-google-selection-translator-v1.4.0.35.zip
   ```

2. Right-click the ZIP file and select **Extract All**, or extract it to a permanent folder with another archive utility.
3. Open the extracted folder and confirm that the following files and folders are visible directly inside it:

   ```text
   manifest.json
   background.js
   README.md
   content
   popup
   icons
   ```

4. Open Microsoft Edge and enter the following address in the address bar:

   ```text
   edge://extensions
   ```

5. Enable **Developer mode** on the Extensions management page.
6. Click **Load unpacked**.
7. Select the folder from step 3 that **directly contains `manifest.json`**, and then click **Select Folder**. Do not select the ZIP file or an extra parent folder outside the actual extension folder.
8. After the extension is imported, open the Extensions menu on the Edge toolbar, find Hongyi, and click the pin icon to keep it on the toolbar.
9. Open a regular webpage and refresh it. You can then select text and use the ??? button, or click ??? on the toolbar to open the translation window.

If Edge reports that the manifest is missing or the extension cannot be loaded, verify that `manifest.json` is located directly in the folder you selected. After updating the extension, also click the reload button for Hongyi on `edge://extensions` and refresh any webpages that were already open.

---

# Hongyi (Microsoft Edge Extension)

**Current version: 1.4.0.35**

Hongyi can translate text selected on Edge webpages as well as text copied to the clipboard from other applications. Translation results are displayed directly in the extension window. Google, DeepSeek, and DeepL are supported.

## 1. Main Features

### 1.1 Translate Selected Text on Webpages

- After you select text on a regular webpage, a blue “译” button appears where you release the mouse button.
- Click “译” to open a translation card near the last line of the selected text and start translating immediately.
- If the translation card remains open, selecting different text updates the source text and starts a new translation automatically.
- The webpage “译” button remains available even when the toolbar translation window is already open.
- Long text is supported, up to approximately 50,000 characters per translation.

### 1.2 Toolbar “宏” Icon

- The Edge toolbar icon displays the Chinese character “宏”.
- Clicking “宏” opens the translation window in always-on-top mode by default.
- The small bell in the upper-right corner indicates the always-on-top state. Click the bell to turn off always-on-top mode.
- After always-on-top is disabled, the translation window remains available as a regular independent window. It can be moved, resized, or used while you switch to another application.
- If the current page does not support an always-on-top window, the extension opens a regular independent window instead.

### 1.3 Priority Between Selected Text and Clipboard Text

The toolbar translation window follows these rules:

1. When the main Edge webpage is active and contains selected text, the selected text is translated first.
2. As long as the selection remains valid, clipboard content will not overwrite it.
3. When no text is selected, the extension checks the clipboard only after you move the pointer into the translation window or click the window.
4. After you switch to another application, the extension no longer reads a selection left behind in Edge. Copy new text and move the pointer into the translation window to translate it.
5. The same selection or identical clipboard content is recognized only once and will not cause repeated refreshes.
6. After you manually edit the source text, the same old selection or clipboard content will not overwrite your changes.
7. After clearing a selection, selecting the same text again can still trigger recognition.

In short: **Selected text takes priority while an Edge webpage has a valid selection. The clipboard is checked only when no text is selected and the user interacts with the translation window.**

### 1.4 Three Translation Engines

#### Google

- No API key is required.
- Results are displayed directly in the Google card inside the translation window.
- A navigation button is provided to open the source text in Google Translate.

#### DeepSeek

- A valid DeepSeek API key is required.
- The API key field masks its contents with dots.
- The complete key is not displayed again after it is saved.
- If no API key has been entered, selecting DeepSeek displays a prompt and DeepSeek will not be enabled.
- A navigation button is provided to open the DeepSeek website.

#### DeepL

- The current version does not require you to enter an API key.
- Results are returned directly to the DeepL card in the translation window without automatically opening a new browser page.
- A navigation button is provided to open the source text on the DeepL website.

### 1.5 Multiple Translation Engines

- Google, DeepSeek, and DeepL can be selected individually or in any combination.
- An engine that is not selected does not translate the text or display a result card.
- Result cards are ordered according to the order in which the engines were selected.
- If you deselect an engine and then select it again, it is moved to the end of the current order.
- Each engine displays its result independently. The first engine to finish is displayed immediately without waiting for the others.
- Every result card provides:
  - Copy translation;
  - Refresh this engine;
  - Open the corresponding translation website.
- The “↻” refresh icon remains available whether the translation succeeds, fails, or remains incomplete.

### 1.6 Source Text Editing and Count

- The source text can be edited in both the webpage translation card and the toolbar translation window.
- Translation restarts automatically about 550 milliseconds after you stop typing.
- Press `Ctrl+Enter` to translate immediately.
- The upper-right corner of the source area displays a number only:
  - English text is counted by words, not letters;
  - Other languages are counted by non-whitespace characters.

### 1.7 Window Controls

The translation window supports:

- Dragging the title area to move the window;
- Closing the window with the close button;
- Locking or unlocking its position;
- Resizing from the top, bottom, left, right, or any of the four corners;
- Dragging the divider between the source and translation areas to adjust their heights;
- Clicking “↕” to maximize the window vertically and clicking it again to restore the previous height;
- Clicking the small bell to enable or disable always-on-top mode.

The extension keeps only one translation window open at a time. Opening a new window through either “宏” or “译” closes the previous translation window and prevents duplicate windows.

### 1.8 Extension On/Off Switch

- The translation window contains a power button.
- After the extension is turned off:
  - The webpage “译” button no longer appears when text is selected;
  - Translation can no longer be triggered from the context menu;
  - The toolbar “宏” icon turns gray.
- Click the gray “宏” icon to reopen and re-enable the extension.

## 2. Installation

1. Extract the extension ZIP archive.
2. Enter `edge://extensions` in the Edge address bar.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted extension root directory. The selected directory must contain `manifest.json` directly at its root.
6. Pin Hongyi to the Edge toolbar from the Extensions menu.

On this computer, the following directory can be loaded directly:

```text
G:\chatGPT_codex\Codex\edge-google-selection-translator
```

After updating the extension:

1. Open `edge://extensions` and click the reload button on the Hongyi extension card.
2. Refresh any webpages that were already open.

## 3. How to Use

### Method 1: Translate Text Selected on an Edge Webpage

1. Select text on a regular webpage.
2. Release the mouse button and wait for the blue “译” button to appear.
3. Click “译”.
4. The translation card opens and starts translating automatically.
5. While the card remains open, select different text to update the result automatically.

### Method 2: Translate the Current Selection from the Toolbar

1. Select text on an Edge webpage.
2. Click “宏” on the toolbar.
3. The translation window opens and gives priority to the current selection.
4. The window is always on top by default. Click the small bell if you want to disable always-on-top mode.

### Method 3: Translate Clipboard Text

1. Copy text in Edge or another application, for example by pressing `Ctrl+C`.
2. When there is no valid text selection on an Edge webpage, move the pointer into the translation window or click the window.
3. After the extension detects new clipboard text, it translates the text automatically.
4. If the clipboard has not changed, the same content is not translated repeatedly.

### Method 4: Enter or Edit Source Text Manually

1. Click the source text area.
2. Type, paste, or edit the text.
3. Translation starts automatically after you stop typing, or you can press `Ctrl+Enter` to translate immediately.
4. To retry only one translation engine, click “↻” on that engine’s result card.

### Configure a DeepSeek API Key

1. Open the DeepSeek API settings in the translation window.
2. Enter the API key in the password field.
3. Click Save.
4. After the key is saved successfully, select DeepSeek.

Do not send screenshots, files, or logs containing your API key to anyone else.

## 4. Frequently Asked Questions

### The “译” Button Does Not Appear After Text Is Selected

Check the following:

- Whether the extension was turned off with the power button;
- Whether the current page is an `edge://` page, the Edge Add-ons website, or another restricted page;
- Whether actual text, rather than an image or another non-text element, was selected;
- Whether the current webpage was refreshed after the extension was updated.

### The Window Is Not Always on Top After Clicking “宏”

Some built-in Edge pages do not allow extensions to use all features. On such pages, a regular independent window opens instead. Switch to a regular webpage and click “宏” again.

### DeepSeek Cannot Be Selected

Enter and save a valid DeepSeek API key first. Also make sure that the account is available and has sufficient balance or quota.

### Google or DeepL Translation Is Slow

Translation without an API key may be affected by network conditions, request frequency, or the status of the translation service. Click “↻” on the corresponding card to retry only that engine.

### Nothing Changes After an Update

First reload the extension on `edge://extensions`, and then refresh any webpages that were already open. Until they are refreshed, old pages may still be using content from the previous extension version.

## 5. Version History

### Version 1.3 Series

- **1.3.1**
  - Added the webpage “译” button and automatic translation card.
  - Added window dragging, closing, position locking, eight-direction resizing, and divider adjustment.
  - Added clipboard translation, vertical maximization, copying, context-menu translation, and Google Translate navigation.
- **1.3.2**
  - Renamed the extension to Hongyi.
  - Changed the toolbar icon to “宏” while keeping “译” for the webpage button and translation window icon.
  - Improved the independent-window experience.

### Version 1.4.0

- Added selectable Google and DeepSeek translation engines.
- Added DeepSeek API key settings and masked display.
- Prevented DeepSeek from being enabled when no API key is configured.
- Stopped displaying result cards for unselected translation engines.
- Improved mutual exclusion between translation windows.

### Versions 1.4.1–1.4.4: Historical Experimental Versions

- **1.4.1**: Attempted to bring the translation window forward automatically when returning to Edge.
- **1.4.2**: Attempted to prevent the main Edge window from being brought forward when the translation window was clicked.
- **1.4.3**: Restored behavior closer to that of a normal independent application window.
- **1.4.4**: Continued experimenting with a shared window mode for “宏” and “译”. Because the resulting window stacking behavior still did not meet the requirements, development subsequently returned to the 1.4.0 branch.

### Version 1.4.0.x Fix Branch

- **1.4.0.1**: Added manual always-on-top mode and clipboard text detection while using non-Edge applications.
- **1.4.0.2**: Fixed occasional failures when clicking the webpage “译” button and added a prompt when the webpage needs to be refreshed.
- **1.4.0.3**: Rechecked the clipboard when the pointer entered the translation window after switching to another application.
- **1.4.0.4**: Improved the success rate of clipboard access from an always-on-top window.
- **1.4.0.5**: Fixed duplicate windows and improved selection delivery, window dragging, focusing, and closing.
- **1.4.0.6**: Fixed selection-routing failures when Edge temporarily failed to recognize an existing translation window.
- **1.4.0.7**: Ensured that clipboard content could not overwrite an existing webpage selection.
- **1.4.0.8**: Fixed window recognition and result copying after an extension background restart; kept the webpage “译” button available while the toolbar window was open.
- **1.4.0.9**: Made the source text in the webpage card editable and added automatic translation and `Ctrl+Enter`.
- **1.4.0.10**: Not released.
- **1.4.0.11**: Increased the maximum text length to approximately 50,000 characters and improved long-selection detection and segmented translation.
- **1.4.0.12**: Added the source-text count, with English counted by words and other languages by non-whitespace characters.
- **1.4.0.13**: Added the DeepL option, result card, and website navigation.
- **1.4.0.14**: First returned no-API DeepL results to the translation window.
- **1.4.0.15**: Improved continuous DeepL translation speed and added a refresh button to failed result cards.
- **1.4.0.16**: Kept the refresh button after both successful and failed translations and reduced interference between multiple DeepL requests.
- **1.4.0.17**: Stopped opening new pages automatically for DeepL translations and returned results directly to the current card.
- **1.4.0.18**: Ordered result cards by engine selection order; reselecting an engine moves it to the end.
- **1.4.0.19**: Added the extension power button and gray “宏” icon.
- **1.4.0.20**: Fixed occasional failures of the “宏” icon, “译” button, and context-menu translation.
- **1.4.0.21**: Reinforced selection priority and changed the three engines so that each result appears as soon as that engine finishes.
- **1.4.0.22**: Fixed the issue where DeepSeek did not reappear in a webpage card after being deselected and selected again.
- **1.4.0.23**: Improved DeepL translation speed and reduced long-text waiting and timeout errors.
- **1.4.0.24**: Improved the speed and reliability with which the toolbar window receives newly selected webpage text.
- **1.4.0.25**: Added selection-recognition fallback behavior to reduce missed webpage selections in the toolbar window.
- **1.4.0.26**: Further improved the reliability of reading and delivering selected text.
- **1.4.0.27**: Fixed selected-text recognition across multiple Edge windows and corrected several garbled timeout messages.
- **1.4.0.28**: Attempted to lock always-on-top mode automatically when entering Edge. This was later simplified because it caused flashing and restricted user control.
- **1.4.0.29**: Removed continuous focus stealing. Clipboard text is checked only when there is no selection and the pointer enters the translation window.
- **1.4.0.30**: Limited selection reading to times when the main Edge webpage has focus; selections left behind in Edge are ignored after switching to another application.
- **1.4.0.31**: Improved default always-on-top behavior and Edge focus detection when opening the toolbar window.
- **1.4.0.32**: Recognized the same selection or clipboard content only once and prevented old content from overwriting manually edited source text.
- **1.4.0.33**: Further improved automatic always-on-top behavior when the toolbar window first opens.
- **1.4.0.35**: Fixed an asynchronous state race that could leave DeepSeek checked in the webpage selection card without creating its result card. The DeepSeek status/loading card now appears immediately, and unchecking then rechecking DeepSeek works reliably. This release does not change the toolbar window always-on-top behavior.
- **1.4.0.34**: Made clicking the toolbar “宏” icon open a truly always-on-top window immediately; preserved the current content when always-on-top is disabled and the window returns to normal independent mode; further ensured that only one translation window remains open at a time.

## 6. Notes

- The current mainline version is **1.4.0.35**.
- A ZIP archive must be extracted before installation through Edge’s **Load unpacked** option.
- This README focuses on user-visible features and instructions. The version history is included only to explain the issues addressed by each release.


