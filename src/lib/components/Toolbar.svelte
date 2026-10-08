<script lang="ts">
  import { mode, cycleMode } from "../stores/mode.ts";
  import { doc, openNew, markSaved, openFileInTab } from "../stores/doc.ts";
  import { basename } from "../utils.ts";
  import { theme } from "../theme/theme.ts";
  import { openFile, saveFile, saveAsFile, readTextFile, isTauri, isMobile } from "../tauri/fs.ts";
  import { pushRecent, recentFiles } from "../stores/recent.ts";
  import { settings, updateSettings } from "../stores/settings.ts";
  import { themePrefs, updateThemePrefs } from "../stores/themePrefs.ts";
  import { t, tr } from "../i18n/index.ts";
  import Bookmarks from "./Bookmarks.svelte";

  let busy = false;
  let showOpenMenu = false;
  let showSettings = false;

  async function handleOpen() {
    if (busy) return;
    busy = true;
    showOpenMenu = false;
    try {
      const res = await openFile();
      if (res) {
        openFileInTab(res.path, res.content);
        pushRecent(res.path);
      }
    } catch (e) {
      alert(tr("dialog.openFailed") + String(e));
    } finally {
      busy = false;
    }
  }

  async function openRecent(path: string) {
    showOpenMenu = false;
    if (!isTauri) return;
    try {
      const content = await readTextFile(path);
      openFileInTab(path, content);
      pushRecent(path);
    } catch {
      alert(tr("dialog.fileMissing"));
    }
  }

  async function handleSave() {
    if (busy) return;
    busy = true;
    try {
      const saved = await saveFile($doc.path, $doc.content);
      if (saved) {
        markSaved(saved);
        pushRecent(saved);
      }
    } catch (e) {
      alert(tr("dialog.saveFailed") + String(e));
    } finally {
      busy = false;
    }
  }

  async function handleSaveAs() {
    if (busy) return;
    busy = true;
    try {
      const saved = await saveAsFile($doc.content);
      if (saved) {
        markSaved(saved);
        pushRecent(saved);
      }
    } catch (e) {
      alert(tr("dialog.saveAsFailed") + String(e));
    } finally {
      busy = false;
    }
  }

  async function handleExportHtml() {
    if (busy) return;
    busy = true;
    try {
      const { exportHtml } = await import("../markdown/exportHtml.ts");
      const name = $doc.path ? basename($doc.path) : tr("doc.untitled");
      await exportHtml($doc.content, name);
    } catch (e) {
      alert(tr("dialog.exportFailed") + String(e));
    } finally {
      busy = false;
    }
  }

  function handleNew() {
    openNew();
  }

  function toggleOpenMenu() {
    showOpenMenu = !showOpenMenu;
  }

  // 点击外部关闭“最近文件”下拉
  function handleWindowClick(e: MouseEvent) {
    if (!showOpenMenu) return;
    const el = e.target as HTMLElement | null;
    if (el && !el.closest(".open-wrap")) {
      showOpenMenu = false;
    }
  }

  function setMode(m: "split" | "read" | "edit") {
    mode.set(m);
  }

  function toggleTheme() {
    theme.toggle();
  }

  // —— .md 文件关联（绿色版主动注册，不自动写注册表）——
  let mdAssocState: "unknown" | "registered" | "not" = "unknown";
  let assocBusy = false;

  async function checkMdAssociation() {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const ok = await invoke<boolean>("is_md_association_registered");
      mdAssocState = ok ? "registered" : "not";
    } catch {
      mdAssocState = "not";
    }
  }

  async function toggleMdAssociation() {
    if (assocBusy || mdAssocState === "unknown") return;
    assocBusy = true;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (mdAssocState === "registered") {
        if (!confirm(tr("assoc.confirmUnregister"))) return;
        await invoke<boolean>("unregister_md_association");
        mdAssocState = "not";
      } else {
        const ok = await invoke<boolean>("register_md_association");
        if (ok) {
          mdAssocState = "registered";
          // Windows UserChoice 保护：程序不能直接抢占"默认应用"，
          // 已注册 ProgID + 打开方式列表。引导用户完成最后一步。
          alert(
            tr("assoc.registered.title") + "\n\n" + tr("assoc.registered.body"),
          );
        } else {
          alert(tr("assoc.registerFailed"));
        }
      }
    } catch (e) {
      alert(tr("assoc.opFailed") + String(e));
    } finally {
      assocBusy = false;
    }
  }

  // 启动时检查一次关联状态（仅桌面端，移动端无文件关联概念）
  if (isTauri && !isMobile) void checkMdAssociation();
</script>

<svelte:window on:click={handleWindowClick} />

<header class="toolbar">
  <div class="group">
    <button class="btn" on:click={handleNew} title={tr("toolbar.new")}>{$t("toolbar.new")}</button>
    <div class="open-wrap">
      <button class="btn" on:click={handleOpen} title={tr("toolbar.open")}>{$t("toolbar.open")}</button>
      {#if isTauri && $recentFiles.length > 0}
        <button class="btn open-caret" on:click={toggleOpenMenu} title={tr("toolbar.recent")}>▾</button>
      {/if}
      {#if showOpenMenu}
        <div class="open-menu" role="menu" on:click|stopPropagation>
          <div class="open-menu-head">{$t("toolbar.recent")}</div>
          {#each $recentFiles.slice(0, 15) as f}
            <button class="open-menu-item" on:click={() => openRecent(f.path)} title={f.path}>
              <span class="open-menu-name">{f.name}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <button class="btn primary" on:click={handleSave} title={tr("toolbar.save")}>
      {$t("toolbar.save")}{$doc.dirty ? " *" : ""}
    </button>
    <button class="btn" on:click={handleSaveAs} title={tr("toolbar.saveAs")}>{$t("toolbar.saveAs")}</button>
    <button class="btn" on:click={handleExportHtml} title={tr("toolbar.export")}>{$t("toolbar.export")}</button>
  </div>

  <div class="title" title={$doc.path ?? tr("doc.unsaved")}>
    {basename($doc.path ?? tr("doc.untitled"))}
    {#if $doc.dirty}<span class="dirty">{$t("toolbar.dirty")}</span>{/if}
  </div>

  <div class="group">
    <button
      class="btn icon"
      on:click={() => updateSettings({ sidebarVisible: !$settings.sidebarVisible })}
      title={tr("toolbar.toggleSidebar")}
      aria-label={tr("toolbar.toggleSidebar")}
    >
      {#if $settings.sidebarVisible}☰{:else}▦{/if}
    </button>
    <div class="segmented">
      <button class="seg {$mode === 'split' ? 'active' : ''}" on:click={() => setMode("split")} title={tr("toolbar.mode.split")}>{$t("toolbar.mode.split")}</button>
      <button class="seg {$mode === 'read' ? 'active' : ''}" on:click={() => setMode("read")} title={tr("toolbar.mode.read")}>{$t("toolbar.mode.read")}</button>
      <button class="seg {$mode === 'edit' ? 'active' : ''}" on:click={() => setMode("edit")} title={tr("toolbar.mode.edit")}>{$t("toolbar.mode.edit")}</button>
    </div>
    <button class="btn icon" on:click={toggleTheme} title={tr("toolbar.toggleTheme")}>
      {$theme === "dark" ? "☀" : $theme === "light" ? "☾" : "◐"}
    </button>
    <Bookmarks />
    <button class="btn icon" on:click={() => (showSettings = true)} title={tr("toolbar.settings")} aria-label={tr("toolbar.settings")}>⚙</button>
    {#if isTauri && !isMobile}
      <button
        class="btn assoc {mdAssocState === 'registered' ? 'active' : ''}"
        on:click={toggleMdAssociation}
        title={mdAssocState === "registered"
          ? tr("toolbar.md.assoc.registered")
          : tr("toolbar.md.assoc")}
        disabled={mdAssocState === "unknown" || assocBusy}
      >
        {mdAssocState === "registered" ? "✓ .md" : ".md"}
      </button>
    {/if}
  </div>
</header>

{#if showSettings}
  <div class="overlay" on:click={() => (showSettings = false)} role="presentation">
    <div class="settings-dialog" role="dialog" aria-label={tr("settings.title")} on:click|stopPropagation>
      <div class="settings-head">
        <span>{$t("settings.title")}</span>
        <button class="settings-close" on:click={() => (showSettings = false)} aria-label={tr("settings.close")}>×</button>
      </div>
      <label class="settings-row">
        <input type="checkbox" checked={$settings.autoSave} on:change={(e) => updateSettings({ autoSave: e.currentTarget.checked })} />
        <span>{$t("settings.autoSave")}</span>
      </label>
      <label class="settings-row">
        <span>{$t("settings.autoSaveDelay")}</span>
        <input type="number" min="500" max="10000" step="100" value={$settings.autoSaveDelay} on:change={(e) => updateSettings({ autoSaveDelay: Math.max(500, Number(e.currentTarget.value) || 1500) })} />
        <span class="hint">{$t("settings.ms")}</span>
      </label>
      <label class="settings-row">
        <input type="checkbox" checked={$settings.watchFiles} on:change={(e) => updateSettings({ watchFiles: e.currentTarget.checked })} />
        <span>{$t("settings.watchFiles")}</span>
      </label>
      <label class="settings-row">
        <span class="label-text">{$t("settings.language")}</span>
        <select
          class="text-input"
          value={$settings.locale}
          on:change={(e) => updateSettings({ locale: e.currentTarget.value as "zh" | "en" })}
        >
          <option value="zh">{$t("settings.language.zh")}</option>
          <option value="en">{$t("settings.language.en")}</option>
        </select>
      </label>

      <div class="settings-sep">{$t("settings.layout")}</div>
      <label class="settings-row">
        <span class="label-text">{$t("settings.fontStack")}</span>
        <input
          class="text-input"
          type="text"
          value={$themePrefs.readingFont}
          placeholder={tr("settings.fontStack.placeholder")}
          on:change={(e) => updateThemePrefs({ readingFont: e.currentTarget.value })}
        />
      </label>
      <label class="settings-row">
        <span class="label-text">{$t("settings.fontSize")}</span>
        <input type="number" min="12" max="24" step="1" value={$themePrefs.readingFontSize} on:change={(e) => updateThemePrefs({ readingFontSize: Math.max(12, Math.min(24, Number(e.currentTarget.value) || 16)) })} />
        <span class="hint">px</span>
      </label>
      <label class="settings-row">
        <span class="label-text">{$t("settings.lineHeight")}</span>
        <input type="number" min="1.2" max="2.4" step="0.1" value={$themePrefs.readingLineHeight} on:change={(e) => updateThemePrefs({ readingLineHeight: Math.max(1.2, Math.min(2.4, Number(e.currentTarget.value) || 1.7)) })} />
      </label>
      <label class="settings-row">
        <span class="label-text">{$t("settings.maxWidth")}</span>
        <input type="number" min="400" max="1400" step="20" value={$themePrefs.readingMaxWidth} on:change={(e) => updateThemePrefs({ readingMaxWidth: Math.max(400, Math.min(1400, Number(e.currentTarget.value) || 780)) })} />
        <span class="hint">px</span>
      </label>
      <label class="settings-row column">
        <span class="label-text">{$t("settings.customCss")}</span>
        <textarea
          class="css-input"
          rows="4"
          placeholder={tr("settings.customCss.placeholder")}
          value={$themePrefs.customCss}
          on:change={(e) => updateThemePrefs({ customCss: e.currentTarget.value })}
        ></textarea>
      </label>

      <div class="settings-foot">
        {$t("settings.foot")}
      </div>
    </div>
  </div>
{/if}
<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    height: var(--titlebar-h);
    padding: 0 0.6rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border-soft);
    flex-shrink: 0;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn {
    height: 30px;
    padding: 0 0.75rem;
    border-radius: var(--radius-sm);
    color: var(--fg);
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .btn:hover {
    background: var(--bg-soft);
  }
  .btn.primary {
    background: var(--accent);
    color: #fff;
  }
  .btn.primary:hover {
    background: var(--accent);
    filter: brightness(1.08);
  }
  .btn.icon {
    width: 30px;
    padding: 0;
    justify-content: center;
    font-size: 16px;
  }
  .btn.assoc {
    padding: 0 0.55rem;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-soft);
    border: 1px solid var(--border-soft);
  }
  .btn.assoc:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .btn.assoc.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .btn.assoc:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .open-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .open-caret {
    width: 18px;
    padding: 0;
    margin-left: -2px;
    height: 30px;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    font-size: 11px;
    color: var(--fg-soft);
  }
  .open-caret:hover {
    background: var(--bg-soft);
  }
  .open-menu {
    position: absolute;
    top: 32px;
    left: 0;
    min-width: 260px;
    max-width: 360px;
    max-height: 360px;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    z-index: 50;
    padding: 4px;
  }
  .open-menu-head {
    padding: 0.3rem 0.7rem;
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .open-menu-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 0.35rem 0.7rem;
    font-size: 12.5px;
    color: var(--fg-soft);
    border-radius: 4px;
  }
  .open-menu-item:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .open-menu-name {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    flex: 1;
    text-align: center;
    font-size: 13px;
    color: var(--fg-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 0.5rem;
  }
  .dirty {
    color: var(--accent);
    margin-left: 4px;
  }
  .segmented {
    display: flex;
    background: var(--bg-soft);
    border-radius: var(--radius-sm);
    padding: 2px;
    gap: 2px;
  }
  .seg {
    height: 26px;
    padding: 0 0.7rem;
    border-radius: 4px;
    font-size: 12px;
    color: var(--fg-soft);
  }
  .seg:hover {
    color: var(--fg);
  }
  .seg.active {
    background: var(--bg);
    color: var(--fg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .settings-dialog {
    width: 480px;
    max-width: 92vw;
    max-height: 88vh;
    overflow-y: auto;
    background: var(--bg);
    border: 1px solid var(--border-soft);
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
    padding: 1.2rem 1.2rem 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }
  .settings-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 15px;
    font-weight: 600;
    color: var(--fg);
    margin-bottom: 0.2rem;
  }
  .settings-close {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    font-size: 16px;
    color: var(--fg-muted);
  }
  .settings-close:hover {
    background: var(--bg-soft);
    color: var(--fg);
  }
  .settings-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 13px;
    color: var(--fg-soft);
  }
  .settings-row input[type="number"] {
    width: 80px;
    padding: 2px 6px;
    background: var(--bg-soft);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--fg);
    font-size: 12px;
  }
  .settings-row .hint {
    color: var(--fg-muted);
    font-size: 11px;
  }
  .settings-row .label-text {
    width: 64px;
    flex-shrink: 0;
    color: var(--fg-muted);
    font-size: 12px;
  }
  .settings-row .text-input {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    background: var(--bg-soft);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--fg);
    font-size: 12px;
  }
  .settings-row.column {
    flex-direction: column;
    align-items: stretch;
    gap: 0.3rem;
  }
  .settings-row.column .label-text {
    width: auto;
  }
  .css-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 8px;
    background: var(--bg-soft);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--fg);
    font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
    font-size: 11.5px;
    resize: vertical;
  }
  .settings-sep {
    margin: 0.3rem 0 -0.1rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--border-soft);
    font-size: 11px;
    color: var(--fg-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .settings-foot {
    margin-top: 0.3rem;
    font-size: 11px;
    color: var(--fg-muted);
  }
</style>
