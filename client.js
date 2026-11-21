/**
 * dsh-tab —— dsh Web GUI 的浏览器式会话标签页（浏览器半）。
 *
 * ## 层级
 * 标签栏是会话区的顶层：位于「会话列 + 右侧产物列」之上，下面才是会话头部、
 * 对话内容和右侧产物栏；切换标签页 = 切换整页会话（右侧产物栏跟随会话）。
 *
 * ## 外观
 * 书页标签：标签栏是一条比页面底色浅一号的「书脊」，选中的标签抬到页面底色、
 * 左右描边、不画底部横线，直接和下面的会话页连成一张纸。标签宽度跟着标题文字
 * 自适应（不留空白），普通标签最多 180px，激活标签最多 270px（1.5 倍），
 * 标题长才展开到上限。固定标签只显示图标。
 *
 * ## 右键菜单
 * 关闭标签页 / 关闭右侧标签页 / 关闭其他标签页 / 关闭全部标签页 /
 * 固定（取消固定）标签页 / 归档会话。归档有任务在跑的会话时先询问，确认后走
 * 官方的「停止并归档」路径。
 *
 * ## 座位与机制（全部官方公开 API）
 * - 标签栏 = `shell.overlay` 座位（官方全局浮层）：标签栏绝对定位在会话区顶部，
 *   横跨「会话列 + 右侧产物列」；帧布局样式把三栏整体下移 44px 让出这一行，
 *   左栏（sidebar）保持整高不动。
 * - 切换会话 = `ctx.uiWorkspace.openSession(id)`（官方侧栏行同一入口）；
 * - 新建对话 = `ctx.uiWorkspace.startSession()`（官方「新会话」入口，复用空白会话）；
 * - 归档会话 = `ctx.uiWorkspace.archiveSession(id, { stopActivity })`（官方归档入口）；
 * - 当前会话 = 官方会话目录里 `retainedBy.mainView > 0` 的那一条（官方 DocumentTitle 同款读法）；
 * - 运行/等待/未读 = 官方 `useSessionStatus` 投影；
 * - 文字 = `ctx.locale.register` + 座位 `locale` 选项注入的 `t`。
 *
 * 最右侧的产物侧栏开关沿用官方会话头部角上的按钮（位于标签栏下一行最右）。
 *
 * 标签页是视图层记录（浏览器本地 localStorage 持久化）：点击标签页切换当前会话，
 * 不并行渲染多个会话（官方 Conversation 一页一条会话）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-tabs',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-session-tabs'
    // 标签宽度/高度过渡约 140ms；等它跑完再切会话，避免和官方整页重渲染抢主线程
    const SELECT_COMMIT_DELAY = 0
    const STORAGE_KEY = 'dsh.sessionTabs.view.v1'
    const LEGACY_STORAGE_KEY = 'dsh.tab.openSessions.v1'

    // ── 文案（官方 locale 命名空间；en 为必填回退） ──────────────────────────
    const ZH = {
      'tab.list': '会话标签页',
      'tab.new': '新建会话',
      'tab.newSession': '新会话',
      'tab.untitled': '未命名',
      'tab.close': '关闭标签页：{title}',
      'tab.running': '运行中',
      'tab.pending': '等待回复',
      'tab.unread': '有新完成内容',
      'tab.pinned': '已固定',
      'tab.workspace': '工作区：{name}',
      'menu.close': '关闭标签页',
      'menu.closeRight': '关闭右侧标签页',
      'menu.closeOthers': '关闭其他标签页',
      'menu.closeAll': '关闭全部标签页',
      'menu.pin': '固定标签页',
      'menu.unpin': '取消固定标签页',
      'menu.archive': '归档会话',
      'menu.archiveRunning': '这个会话还有任务在运行。归档会先停止它，再归档。',
      'menu.archiveStop': '停止并归档',
      'menu.archiveBusy': '正在归档…',
      'menu.archiveFailed': '归档失败：{message}',
      'menu.retryStop': '停止并重试',
      'menu.cancel': '取消',
      'close.running': '任务仍在运行，关闭标签页？任务不会停止。',
    }
    const EN = {
      'tab.list': 'Conversation tabs',
      'tab.new': 'New conversation',
      'tab.newSession': 'New session',
      'tab.untitled': 'Untitled',
      'tab.close': 'Close tab: {title}',
      'tab.running': 'Running',
      'tab.pending': 'Waiting for you',
      'tab.unread': 'New completed response',
      'tab.pinned': 'Pinned',
      'tab.workspace': 'Workspace: {name}',
      'menu.close': 'Close tab',
      'menu.closeRight': 'Close tabs to the right',
      'menu.closeOthers': 'Close other tabs',
      'menu.closeAll': 'Close all tabs',
      'menu.pin': 'Pin tab',
      'menu.unpin': 'Unpin tab',
      'menu.archive': 'Archive conversation',
      'menu.archiveRunning': 'This conversation still has work running. Archiving stops it first.',
      'menu.archiveStop': 'Stop and archive',
      'menu.archiveBusy': 'Archiving…',
      'menu.archiveFailed': 'Archive failed: {message}',
      'menu.retryStop': 'Stop and retry',
      'menu.cancel': 'Cancel',
      'close.running': 'A task is still running in this conversation. Close the tab? The task keeps running.',
    }

    // ── 帧布局：标签栏上移到 Windows 原生标题行 ─────────────────────────────
    // 原版把帧改成三行、在会话区顶部让出 44px。这里改成：帧保持官方两行网格
    // （左栏 + 会话列 + 右栏 | shell.bottom），标签栏绝对定位填进 AppFrame 已经预留的
    // 标题行（html[data-windows-titlebar] 下 .frame 的 padding-top），不占会话内容高度。
    // 左缘用官方在帧上算出的左栏宽度变量（--dsh-windows-sidebar-width），标签栏只横跨
    // 会话列 + 右栏；窗口按钮在图层的右上角，标签栏右缘留出 140px 避让。
    // 侧栏折叠后左栏宽度为 0，官方把「展开侧栏 / 新会话」控件放进标题行左上角
    // （shell.leading，z-index 15，在浮层 20 之下），所以标签栏要让出这一段：
    // 帧的 data-sidebar-collapsed 只在桌面端折叠时出现。
    const FRAME_CSS = `
[data-windows-titlebar] .dsh-tab-pagebar {
  top: 0 !important;
  right: 140px !important;
  left: max(var(--dsh-windows-sidebar-width, 0px), var(--dsh-frame-leading-clearance, 24px)) !important;
  padding-left: 12px;
  border-top-left-radius: 0 !important;
  background: transparent;
  box-shadow: none;
}
/* 侧栏折叠：官方在帧上把 shell.leading 座位的两个 28px 控件排到标题行左上角
   （left: 88px，到 88+28+8+28=152），标签栏要从 x=160 起才对，右侧再留 12px 内边距 */
[data-windows-titlebar] [data-sidebar-collapsed] {
  --dsh-frame-leading-clearance: 160px;
}
/* 浏览器里没有官方标题行：由标签栏自己撑出这一行，并用左栏底色铺底。 */
html:not([data-windows-titlebar]) .dsh-tab-pagebar {
  top: 0 !important;
  left: max(var(--dsh-tab-left, 0px), var(--dsh-frame-leading-clearance, 0px)) !important;
  height: 36px;
  background: var(--dsw-specific-sidebar-fill);
  box-shadow: inset 0 -.5px 0 var(--dsw-alias-border-l2);
}
`

    // ── 标签栏外观（书页标签 + 右键菜单） ──────────────────────────────────
    const CSS = `
/* 书脊条：铺会话区底色，标签的下缘被它压住（未激活标签 -1 层），只在标签身上上色 */
.dsh-tab-pagebar{position:absolute;top:0;right:0;z-index:2;pointer-events:auto;box-sizing:border-box;
  left:max(var(--dsh-tab-left, 0px), var(--dsh-frame-leading-clearance, 0px));
  display:flex;align-items:flex-end;height:44px;padding:0 16px 0 20px;
  background:var(--dsw-alias-bg-base);
  -webkit-app-region:drag;
  --dsh-tab-max-width:180px}
/* 上移 4px，高度同步缩 4px：底边仍落在标题行内，不压到会话区 */
html[data-windows-titlebar] .dsh-tab-pagebar{top:calc(var(--dsh-windows-titlebar-height, 0px) - 4px);height:40px}
[data-rightbar-fullscreen] .dsh-tab-pagebar{display:none}
.dsh-tab-pagebar__strip{display:flex;align-items:flex-end;flex:0 1 auto;min-width:0;
  height:100%;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;scroll-padding-inline:8px;
  overscroll-behavior-x:contain;
  -webkit-app-region:no-drag}
.dsh-tab-pagebar__strip::-webkit-scrollbar{display:none}
/* 层叠：未激活标签像贴在纸袋口里，底边落在会话区之下（z-index:-1，被下方页面压住）；
   激活标签抬高到页面之上，底边直落，和下面的会话页连成一张纸。 */
/* 短标签：书脊上的一张纸签 */
.dsh-tab-pagebar__tab{position:relative;box-sizing:border-box;display:flex;align-items:center;gap:7px;
  flex:0 1 auto;min-width:144px;max-width:var(--dsh-tab-max-width);height:32px;padding:0 6px 0 12px;
  border:.5px solid transparent;border-radius:8px 8px 0 0;
  background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:18px;
  cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-app-region:no-drag;touch-action:pan-y;
  animation:dsh-tab-enter .16s ease;
  transition:background-color .1s ease,color .1s ease,border-color .1s ease,box-shadow .1s ease,
    transform .16s cubic-bezier(.2,.75,.25,1)}
.dsh-tab-pagebar__tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
/* 选中标签：抬到页面底色、不画底边线，和下面的会话页连成一张纸；
   可用宽度是普通标签的 1.5 倍（180 → 270），标题短就按实际文字宽度收住、不留空白，
   标题长才展开到 1.5 倍。切换时宽度和高度一起过渡
   （只保留上方圆角，底部直角直接接页面，不再做额外的反圆角装饰） */
.dsh-tab-pagebar__tab[aria-selected=true]{z-index:2;position:relative;background:var(--dsw-alias-bg-base);
  border-color:transparent;border-radius:8px 8px 0 0;color:var(--dsw-alias-label-primary);
  box-shadow:0 2px 8px 0 rgba(15,20,40,.07)}
.dsh-tab-pagebar__tab[aria-selected=true]:hover{background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary)}
/* 固定标签：只剩图标、宽度固定 40px；激活时也不展开 */
.dsh-tab-pagebar__tab[data-pinned=true]{width:40px;min-width:40px;max-width:40px;flex:none;padding:0;
  justify-content:center;gap:4px}
.dsh-tab-pagebar__tab[data-pinned=true] .dsh-tab-pagebar__label,
.dsh-tab-pagebar__tab[data-pinned=true] .dsh-tab-pagebar__close{display:none}
.dsh-tab-pagebar__divider{flex:none;align-self:center;width:1px;height:20px;margin:0 6px;
  background:var(--dsw-alias-border-l2);transition:opacity .12s ease}
.dsh-tab-pagebar__tab:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
/* 拖拽排序（Chrome / Edge 式）：被拖标签抬起跟手，其余标签用 transform 过渡实时让位 */
.dsh-tab-pagebar__tab[data-dragging=true]{z-index:4;cursor:grabbing;opacity:1;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  border-color:var(--dsw-alias-border-l2);border-radius:8px 8px 0 0;
  box-shadow:0 8px 18px -6px rgba(15,20,40,.3),0 2px 6px rgba(15,20,40,.14);
  transition:none;animation:none;will-change:transform}
.dsh-tab-pagebar__tab[data-dragging=true] .dsh-tab-pagebar__close{opacity:0;pointer-events:none}
/* 左上角小角标：所属工作区（短名，悬停看全名） */
.dsh-tab-pagebar__badge{position:absolute;left:5px;top:-5px;box-sizing:border-box;max-width:50%;height:10px;
  padding:0 3px;border-radius:3px;color:#fff;font-size:8.5px;font-weight:600;line-height:10px;letter-spacing:.01em;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none;opacity:.96}
.dsh-tab-pagebar__tab[data-pinned=true] .dsh-tab-pagebar__badge{left:2px;max-width:38px;padding:0 1px;font-size:7.5px}
.dsh-tab-pagebar__icon{position:relative;flex:none;width:16px;height:16px;display:grid;place-items:center;
  color:var(--dsw-alias-label-tertiary)}
.dsh-tab-pagebar__tab[aria-selected=true] .dsh-tab-pagebar__icon{color:var(--dsw-alias-label-secondary)}
.dsh-tab-pagebar__label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-tab-pagebar__dot{flex:none;width:6px;height:6px;border-radius:50%}
.dsh-tab-pagebar__dot[data-signal=running]{background:var(--dsw-alias-state-business-primary);
  animation:dsh-tab-pulse 1.6s ease-in-out infinite}
.dsh-tab-pagebar__dot[data-signal=pending]{background:var(--dsw-alias-state-warn-primary)}
.dsh-tab-pagebar__dot[data-signal=unread]{background:var(--dsw-alias-state-success-primary)}
.dsh-tab-pagebar__close{flex:none;width:18px;height:18px;display:grid;place-items:center;padding:0;
  border:none;border-radius:5px;background:transparent;color:inherit;cursor:pointer;-webkit-app-region:no-drag;
  opacity:0;pointer-events:none;transition:opacity .1s ease,background-color .1s ease}
.dsh-tab-pagebar__tab:hover .dsh-tab-pagebar__close,
.dsh-tab-pagebar__tab[aria-selected=true] .dsh-tab-pagebar__close,
.dsh-tab-pagebar__tab:focus-within .dsh-tab-pagebar__close{opacity:1;pointer-events:auto}
.dsh-tab-pagebar__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-tab-pagebar__close:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-tab-pagebar__new{flex:none;align-self:flex-end;width:30px;height:30px;display:grid;place-items:center;padding:0;
  margin:0 0 4px 6px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;
  color:var(--dsw-alias-label-secondary);cursor:pointer;-webkit-app-region:no-drag;
  transition:background-color .12s ease,color .12s ease}
.dsh-tab-pagebar__new:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-tab-pagebar__new:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* 右键菜单 */
.dsh-tab-menu{position:fixed;z-index:100;box-sizing:border-box;min-width:188px;max-width:260px;padding:5px;
  border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv2);
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:18px;
  -webkit-app-region:no-drag;user-select:none;-webkit-user-select:none}
.dsh-tab-menu__item{display:flex;align-items:center;width:100%;height:30px;padding:0 8px;border:none;border-radius:6px;
  background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}
.dsh-tab-menu__item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-tab-menu__item:disabled{color:var(--dsw-alias-label-dimmed);cursor:default;background:transparent}
.dsh-tab-menu__item[data-danger=true]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);
  color:var(--dsw-alias-state-error-primary)}
.dsh-tab-menu__sep{height:.5px;margin:4px 6px;background:var(--dsw-alias-border-l2)}
.dsh-tab-menu__hint{padding:4px 8px 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px;
  white-space:normal}
/* 关闭正在运行的标签：确认弹层（关标签不会停任务，所以只是提醒） */
.dsh-tab-confirm-backdrop{position:fixed;inset:0;z-index:120;display:grid;place-items:center;
  background:rgba(8,10,20,.18);-webkit-app-region:no-drag}
.dsh-tab-confirm{box-sizing:border-box;width:min(340px,calc(100vw - 48px));padding:14px 16px 12px;
  border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);
  box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);font-size:13px;line-height:19px;
  user-select:none;-webkit-user-select:none}
.dsh-tab-confirm__text{margin:0 0 12px;color:var(--dsw-alias-label-secondary)}
.dsh-tab-confirm__actions{display:flex;justify-content:flex-end;gap:8px}
.dsh-tab-confirm__button{height:28px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l2);border-radius:6px;
  background:transparent;color:inherit;font:inherit;cursor:pointer}
.dsh-tab-confirm__button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-tab-confirm__button[data-primary=true]{border-color:transparent;background:var(--dsw-alias-state-business-primary);color:#fff}
.dsh-tab-confirm__button[data-primary=true]:hover{opacity:.9}
.dsh-tab-confirm__button:focus-visible{outline:1.5px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
@keyframes dsh-tab-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes dsh-tab-enter{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dsh-tab-pagebar__dot[data-signal=running]{animation:none}}
@media (prefers-reduced-motion:reduce){
  .dsh-tab-pagebar__tab,.dsh-tab-pagebar__new,.dsh-tab-pagebar__close{transition:none;animation:none}
}
`

    // ── 图标（16px 线性图标，currentColor 跟随主题） ─────────────────────────
    function svg(children) {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        children,
      )
    }
    function IconConversation() {
      return svg(
        h('path', {
          d: 'M13.2 8c0 2.6-2.3 4.7-5.2 4.7-.6 0-1.2-.1-1.8-.3L3.5 13.2l.7-2c-.9-.8-1.4-2-1.4-3.2C2.8 5.4 5.1 3.3 8 3.3s5.2 2.1 5.2 4.7Z',
        }),
      )
    }
    function IconCompass() {
      return svg([
        h('circle', { key: 'c', cx: 8, cy: 8, r: 5.4 }),
        h('path', { key: 'n', d: 'M9.9 6.1 8.7 8.7 6.1 9.9l1.2-2.6 2.6-1.2Z' }),
      ])
    }
    function IconPanel() {
      return svg([
        h('rect', { key: 'a', x: 2.8, y: 2.8, width: 4.4, height: 4.4, rx: 1.2 }),
        h('rect', { key: 'b', x: 8.8, y: 2.8, width: 4.4, height: 4.4, rx: 1.2 }),
        h('rect', { key: 'c', x: 2.8, y: 8.8, width: 4.4, height: 4.4, rx: 1.2 }),
        h('rect', { key: 'd', x: 8.8, y: 8.8, width: 4.4, height: 4.4, rx: 1.2 }),
      ])
    }
    /** 官方 IconNewChatOutline16：侧栏新建对话按钮同款图标。 */
    function IconNewChat() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', {
          d: 'M8.00003 0.3237C3.76075 0.3237 0.32373 3.76072 0.32373 8C0.32373 9.17603 0.589121 10.2922 1.0632 11.2901L1.35291 11.8989L2.5705 11.3205L2.28079 10.7117C1.89079 9.89074 1.67301 8.97167 1.67301 8C1.67301 4.50546 4.50549 1.67298 8.00003 1.67298C11.4946 1.67298 14.3271 4.50546 14.3271 8C14.3271 11.4945 11.4946 14.327 8.00003 14.327C7.28473 14.327 6.76077 14.277 6.29621 14.1487C5.83857 14.0224 5.40441 13.8109 4.88514 13.4488C4.12569 12.919 3.03778 12.7316 2.141 13.2978L2.12682 13.307L2.11264 13.3171L1.34886 13.854L1.79659 15.188L2.86122 14.4384C3.19068 14.2305 3.68325 14.2542 4.11326 14.5539C4.72789 14.9826 5.30042 15.2724 5.93762 15.4484C6.56803 15.6224 7.22776 15.6763 8.00003 15.6763C12.2393 15.6763 15.6763 12.2393 15.6763 8C15.6763 3.76072 12.2393 0.3237 8.00003 0.3237ZM7.32033 4.82535V7.32536H4.82538V8.67464H7.32033V11.1747H8.6696V8.67464H11.1747V7.32536H8.6696V4.82535H7.32033Z',
          fill: 'currentColor',
        }),
      )
    }
    function IconClose() {
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: 12,
          height: 12,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6' }),
      )
    }

    // ── 持久化（视图态，不进会话日志） ───────────────────────────────────────
    function sanitizeIds(value) {
      if (!Array.isArray(value)) return []
      const seen = new Set()
      const ids = []
      for (const item of value) {
        if (typeof item !== 'string' || item.length === 0 || seen.has(item)) continue
        seen.add(item)
        ids.push(item)
      }
      return ids
    }

    function readStoredState() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw !== null) {
          const value = JSON.parse(raw)
          if (value !== null && typeof value === 'object') {
            const ids = sanitizeIds(value.tabs)
            const pinned = sanitizeIds(value.pinned).filter((id) => ids.includes(id))
            return { ids, pinned }
          }
        }
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
        if (legacy !== null) return { ids: sanitizeIds(JSON.parse(legacy)), pinned: [] }
      } catch (error) {
        /* 存储不可用 / 内容损坏：从空列表开始，标签页只是视图态 */
      }
      return { ids: [], pinned: [] }
    }

    function createTabStore() {
      const stored = readStoredState()
      let ids = stored.ids
      let pinned = stored.pinned
      const suppressed = new Set()
      let snapshot = Object.freeze({ ids: Object.freeze(ids.slice()), pinned: Object.freeze(pinned.slice()) })
      const listeners = new Set()
      const publish = () => {
        snapshot = Object.freeze({ ids: Object.freeze(ids.slice()), pinned: Object.freeze(pinned.slice()) })
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: ids, pinned }))
          localStorage.removeItem(LEGACY_STORAGE_KEY)
        } catch (error) {
          /* 无痕模式 / 存储禁用：标签页只是视图态，存不进不影响会话数据 */
        }
        for (const listener of [...listeners]) listener()
      }
      return {
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
        getSnapshot() {
          return snapshot
        },
        has(id) {
          return ids.includes(id)
        },
        add(id) {
          if (ids.includes(id)) return
          ids = [...ids, id]
          publish()
        },
        pin(id) {
          if (!ids.includes(id) || pinned.includes(id)) return
          pinned = [...pinned, id]
          publish()
        },
        unpin(id) {
          if (!pinned.includes(id)) return
          pinned = pinned.filter((item) => item !== id)
          publish()
        },
        removeMany(removed) {
          const drop = new Set(removed)
          if (drop.size === 0) return
          ids = ids.filter((item) => !drop.has(item))
          pinned = pinned.filter((item) => !drop.has(item))
          publish()
        },
        /**
         * 拖动排序（referenceId 目标标签，place 表示放在它前/后）。
         * 跨段拖动（固定 ↔ 未固定）会连带改变固定状态：落到固定段就固定，落到未固定段就取消固定。
         * ids 始终保留全部标签的真实先后，固定标签只是渲染时前置。
         */
        move(id, referenceId, place, targetPinned) {
          if (!ids.includes(id) || !ids.includes(referenceId) || id === referenceId) return
          const isPinned = pinned.includes(id)
          const nextPinned = targetPinned === undefined ? isPinned : targetPinned === true
          // 固定段按「进入固定的先后」排：新固定的标签排在固定段末尾
          if (nextPinned) pinned = [...pinned.filter((item) => item !== id), id]
          else if (isPinned) pinned = pinned.filter((item) => item !== id)
          const next = ids.filter((item) => item !== id)
          const referenceIndex = next.indexOf(referenceId)
          if (referenceIndex < 0) return
          next.splice(place === 'after' ? referenceIndex + 1 : referenceIndex, 0, id)
          ids = next
          publish()
        },
        /** 主动关掉的标签不要再被「当前会话自动入签」立刻加回来。 */
        suppress(id) {
          suppressed.add(id)
        },
        isSuppressed(id) {
          return suppressed.has(id)
        },
        unsuppress(id) {
          suppressed.delete(id)
        },
        pruneSuppressed(keepId) {
          for (const id of suppressed) if (id !== keepId) suppressed.delete(id)
        },
      }
    }

    // ── 官方会话目录里读「当前会话」 ─────────────────────────────────────────
    function currentSessionIdOf(catalog) {
      if (catalog === undefined || catalog === null) return undefined
      const rows = catalog.byId ?? {}
      for (const id of catalog.ids ?? []) {
        const row = rows[id]
        if (row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) return id
      }
      return undefined
    }

    function sessionStatusSignal(status) {
      if (status === undefined || status === null) return undefined
      if (status.pendingInteraction !== undefined && status.pendingInteraction !== null) return 'pending'
      if (status.running === true) return 'running'
      if (status.completionUnread === true) return 'unread'
      return undefined
    }

    /** 路径最后一段（兼容 / 与 \\）。 */
    function basenameOf(path) {
      if (typeof path !== 'string') return ''
      const parts = path.split(/[\\/]/).filter((part) => part.length > 0)
      return parts.length === 0 ? '' : parts[parts.length - 1]
    }

    /** 工作区名 → 角标颜色（固定色相，同一工作区在任何主题下颜色一致）。 */
    function workspaceHue(key) {
      let hash = 0
      for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) % 360
      return hash
    }

    function errorMessageOf(error) {
      if (error === undefined || error === null) return ''
      if (typeof error === 'string') return error
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    // 全局面板（侧栏「插件」「自动化任务」等）也作为标签页：用 panel:<id> 与会话 id 区分。
    const PANEL_TAB_PREFIX = 'panel:'
    const isPanelTab = (id) => typeof id === 'string' && id.startsWith(PANEL_TAB_PREFIX)
    const panelIdOf = (id) => id.slice(PANEL_TAB_PREFIX.length)
    const panelTabKey = (panelId) => `${PANEL_TAB_PREFIX}${panelId}`
    /** 宿主没有 layout 面板信息时退化成「始终在会话页」。 */
    function useNoPanelInfo(selector) {
      return selector({ activePanelId: null })
    }

    /**
     * 显示顺序：固定标签在最左（按进入固定的先后），其余按打开顺序。
     * 两者都来自同一条 ids 顺序，拖动可在两段之间自由移动（落到哪段就固定 / 取消固定）。
     * 切换标签不改变顺序；激活标签只是变宽、和下面的会话页连成一张纸。
     */
    function displayTabs(snapshot) {
      const pinnedSet = new Set(snapshot.pinned)
      const pinnedTabs = snapshot.pinned
        .filter((id) => snapshot.ids.includes(id))
        .map((id) => ({ id, pinned: true }))
      const rest = snapshot.ids.filter((id) => !pinnedSet.has(id)).map((id) => ({ id, pinned: false }))
      return [...pinnedTabs, ...rest]
    }

    // ── 单个标签页 ──────────────────────────────────────────────────────────
    function TabItem(props) {
      const { id, title, active, signal, blank, pinned, panel, badge, dragging, t, onSelect, onClose, onMenu, onArrow, onDragStart } = props
      const statusLabel =
        signal === 'running' ? t('tab.running') : signal === 'pending' ? t('tab.pending') : signal === 'unread' ? t('tab.unread') : undefined
      return h(
        'div',
        {
          className: 'dsh-tab-pagebar__tab',
          role: 'tab',
          tabIndex: active ? 0 : -1,
          'aria-selected': active,
          'data-session-id': id,
          'data-pinned': pinned ? 'true' : 'false',
          'data-panel-tab': panel ? 'true' : undefined,
          'data-dragging': dragging ? 'true' : 'false',
          title: pinned ? `${title} · ${t('tab.pinned')}` : title,
          onClick: () => onSelect(id),
          onPointerDown: (event) => {
            if (event.button !== 0) return
            const target = event.target
            if (target !== null && typeof target.closest === 'function' && target.closest('.dsh-tab-pagebar__close') !== null) return
            onDragStart(event)
          },
          onContextMenu: (event) => onMenu(event, id),
          onAuxClick: (event) => {
            if (event.button === 1) {
              event.preventDefault()
              onClose(id)
            }
          },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onSelect(id)
              return
            }
            if (event.key === 'ArrowRight') {
              event.preventDefault()
              onArrow(id, 1)
              return
            }
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              onArrow(id, -1)
            }
          },
        },
        badge === null || badge === undefined
          ? null
          : h(
              'span',
              {
                key: 'badge',
                className: 'dsh-tab-pagebar__badge',
                style: { backgroundColor: `hsl(${badge.hue} 46% 38%)` },
                title: t('tab.workspace', { name: badge.label }),
                'aria-hidden': 'true',
              },
              badge.label,
            ),
        h('span', { className: 'dsh-tab-pagebar__icon' }, panel ? h(IconPanel) : blank ? h(IconCompass) : h(IconConversation)),
        h('span', { className: 'dsh-tab-pagebar__label' }, title),
        signal !== undefined
          ? h('span', {
              key: 'dot',
              className: 'dsh-tab-pagebar__dot',
              'data-signal': signal,
              role: 'img',
              'aria-label': statusLabel,
              title: statusLabel,
            })
          : null,
        pinned
          ? null
          : h(
              'button',
              {
                type: 'button',
                tabIndex: -1,
                className: 'dsh-tab-pagebar__close',
                title: t('tab.close', { title }),
                'aria-label': t('tab.close', { title }),
                onClick: (event) => {
                  event.stopPropagation()
                  onClose(id)
                },
                onContextMenu: (event) => {
                  event.preventDefault()
                  onMenu(event, id)
                },
                onKeyDown: (event) => {
                  event.stopPropagation()
                },
              },
              h(IconClose),
            ),
      )
    }

    // ── 右键菜单 ────────────────────────────────────────────────────────────
    function TabMenu(props) {
      const { x, y, hint, items, onClose } = props
      const menuRef = useRef(null)
      const [position, setPosition] = useState({ x, y })

      // 打开后按实际尺寸夹到窗口内，避免菜单跑出屏幕
      useLayoutEffect(() => {
        const element = menuRef.current
        if (element === null) return
        const rect = element.getBoundingClientRect()
        const nextX = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
        const nextY = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))
        if (nextX !== position.x || nextY !== position.y) setPosition({ x: nextX, y: nextY })
      }, [x, y, hint, items.length])

      useEffect(() => {
        const onPointerDown = (event) => {
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return
          onClose()
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }
        const onDismiss = () => onClose()
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('scroll', onDismiss, true)
        window.addEventListener('resize', onDismiss)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('scroll', onDismiss, true)
          window.removeEventListener('resize', onDismiss)
        }
      }, [onClose])

      return h(
        'div',
        {
          ref: menuRef,
          className: 'dsh-tab-menu',
          role: 'menu',
          style: { left: `${position.x}px`, top: `${position.y}px` },
          onContextMenu: (event) => event.preventDefault(),
        },
        hint === undefined || hint === null ? null : h('div', { key: 'hint', className: 'dsh-tab-menu__hint' }, hint),
        items.map((item) =>
          item.separator === true
            ? h('div', { key: item.key, className: 'dsh-tab-menu__sep', role: 'separator' })
            : h(
                'button',
                {
                  key: item.key,
                  type: 'button',
                  role: 'menuitem',
                  className: 'dsh-tab-menu__item',
                  disabled: item.disabled === true,
                  'data-danger': item.danger === true ? 'true' : 'false',
                  onClick: () => item.run(),
                },
                item.label,
              ),
        ),
      )
    }

    // ── 关闭确认（会话仍在运行） ──────────────────────────────────────────
    function TabConfirm(props) {
      const { message, confirmLabel, cancelLabel, onConfirm, onCancel } = props
      const cancelRef = useRef(null)
      const lastFocusRef = useRef(null)
      useLayoutEffect(() => {
        lastFocusRef.current = document.activeElement
        if (cancelRef.current !== null) cancelRef.current.focus()
        return () => {
          const previous = lastFocusRef.current
          if (previous !== null && previous.isConnected === true && typeof previous.focus === 'function') {
            previous.focus({ preventScroll: true })
          }
        }
      }, [])
      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [onCancel])
      return h(
        'div',
        {
          className: 'dsh-tab-confirm-backdrop',
          onPointerDown: (event) => {
            if (event.target === event.currentTarget) onCancel()
          },
        },
        h(
          'div',
          {
            className: 'dsh-tab-confirm',
            role: 'alertdialog',
            'aria-modal': 'true',
            'aria-label': message,
            onPointerDown: (event) => event.stopPropagation(),
          },
          h('p', { className: 'dsh-tab-confirm__text' }, message),
          h(
            'div',
            { className: 'dsh-tab-confirm__actions' },
            h(
              'button',
              { key: 'cancel', ref: cancelRef, type: 'button', className: 'dsh-tab-confirm__button', onClick: onCancel },
              cancelLabel,
            ),
            h(
              'button',
              {
                key: 'confirm',
                type: 'button',
                className: 'dsh-tab-confirm__button',
                'data-primary': 'true',
                onClick: onConfirm,
              },
              confirmLabel,
            ),
          ),
        ),
      )
    }

    // ── 标签栏 ──────────────────────────────────────────────────────────────
    function createTabBar(actions) {
      return function TabBar(props) {
        const { useSessions, useSessionStatus, useWorkspaces, usePanelInfo, t } = props
        const catalog = useSessions((state) => state)
        const statuses = useSessionStatus((state) => state)
        const workspaces = useWorkspaces((state) => state)
        const snapshot = useSyncExternalStore(actions.store.subscribe, actions.store.getSnapshot)
        const [menu, setMenu] = useState(null)

        const rows = catalog?.byId ?? {}
        const archived = useMemo(() => new Set(workspaces?.archivedSessionIds ?? []), [workspaces])
        const activeId = currentSessionIdOf(catalog)

        // 全局面板（插件 / 自动化任务 …）：选中项来自官方 layout.panelInfo，
        // 面板清单与标题来自 sidebar.panellist 槽条目（由 apply 里同步进 panelStore）。
        const panels = useSyncExternalStore(actions.panelStore.subscribe, actions.panelStore.getSnapshot)
        const usePanelInfoHook = typeof usePanelInfo === 'function' ? usePanelInfo : useNoPanelInfo
        const activePanelId = usePanelInfoHook((info) => info.activePanelId)
        const activePanelKey = activePanelId === null || activePanelId === undefined ? null : panelTabKey(activePanelId)
        const activeTabId = activePanelKey === null ? activeId : activePanelKey
        const panelById = useMemo(() => new Map(panels.list.map((panel) => [panel.id, panel])), [panels.list])
        useLayoutEffect(() => {
          actions.setView({
            activePanelId: activePanelId === undefined ? null : activePanelId,
            panelList: panels.list,
            panelsReady: panels.ready,
          })
        }, [activePanelId, panels])

        // 会话 → 所属工作区（角标用）。工作区标题为空时用目录名，再退到 workspaceId。
        const workspaceBadges = useMemo(() => {
          const map = new Map()
          for (const item of workspaces?.items ?? []) {
            const title = typeof item.title === 'string' && item.title.trim().length > 0 ? item.title.trim() : ''
            const label = title || basenameOf(item.path) || (item.workspaceId === undefined ? '' : String(item.workspaceId))
            if (label.length === 0) continue
            const hue = workspaceHue(item.workspaceId === undefined ? label : String(item.workspaceId))
            for (const sessionId of item.sessionIds ?? []) if (!map.has(sessionId)) map.set(sessionId, { label, hue })
          }
          return map
        }, [workspaces])

        // 点标签时先把视觉上的「激活」切过去跑动画，等动画结束再真正切会话。
        // 官方切会话会同步重渲染整个会话页（实测一次约 60–75ms 长任务），
        // 和标签动画同时发生会直接把动画顶卡；拆开之后两段各自流畅。
        const [pendingSelect, setPendingSelect] = useState(null)
        const pendingRef = useRef(null)
        const pendingTimerRef = useRef(null)
        useEffect(() => {
          pendingRef.current = pendingSelect
        }, [pendingSelect])
        const clearPendingSelect = useCallback(() => {
          if (pendingTimerRef.current !== null) {
            clearTimeout(pendingTimerRef.current)
            pendingTimerRef.current = null
          }
          setPendingSelect(null)
        }, [])

        // 当前会话自动入签（官方侧栏点开会话、启动恢复、新建会话都走这里）
        useEffect(() => {
          actions.store.pruneSuppressed(activeId)
          if (activeId === undefined) return
          if (actions.store.isSuppressed(activeId)) return
          if (rows[activeId] === undefined) return
          if (!actions.store.has(activeId)) actions.store.add(activeId)
        }, [activeId, catalog])

        // 会话被删除 / 归档后摘签
        useEffect(() => {
          if (catalog?.phase !== 'ready') return
          const stale = actions.store.getSnapshot().ids.filter(
            (id) => !isPanelTab(id) && (rows[id] === undefined || archived.has(id)),
          )
          if (stale.length > 0) actions.store.removeMany(stale)
        }, [catalog, archived])

        const tabs = displayTabs(snapshot).filter((tab) => {
          if (isPanelTab(tab.id)) return panels.ready ? panelById.has(panelIdOf(tab.id)) : true
          return rows[tab.id] !== undefined && !archived.has(tab.id)
        })
        const pinnedCount = tabs.filter((tab) => tab.pinned).length

        // 关标签前确认：会话还在跑 / 等你回复时先问一句。关标签只摘掉视图，任务不会停。
        const [closeConfirm, setCloseConfirm] = useState(null)
        const isBusyTab = (id) => {
          if (isPanelTab(id)) return false
          const signal = sessionStatusSignal(statuses?.get(id))
          return signal === 'running' || signal === 'pending'
        }
        const requestClose = (ids, run) => {
          if (!ids.some((id) => isBusyTab(id))) {
            run()
            return
          }
          setCloseConfirm({ run })
        }
        const requestCloseOne = (id) => requestClose([id], () => actions.closeOne(id))
        const confirmClose = () => {
          const pending = closeConfirm
          setCloseConfirm(null)
          if (pending !== null) pending.run()
        }

        // 打开全局面板时给它一个独立标签（已有则复用）；面板注销后摘掉对应标签。
        useLayoutEffect(() => {
          if (activePanelKey === null) return
          if (!actions.store.has(activePanelKey)) actions.store.add(activePanelKey)
        }, [activePanelKey])
        useEffect(() => {
          if (!panels.ready) return
          const keys = new Set(panels.list.map((panel) => panelTabKey(panel.id)))
          const stale = actions.store.getSnapshot().ids.filter((id) => isPanelTab(id) && !keys.has(id))
          if (stale.length > 0) actions.store.removeMany(stale)
        }, [panels])

        const visualActiveId = pendingSelect === null ? activeTabId : pendingSelect.id
        const stripRef = useRef(null)
        const barRef = useRef(null)

        const requestSelect = useCallback(
          (id) => {
            if (id === visualActiveId) return
            const reduceMotion =
              typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
            if (reduceMotion) {
              clearPendingSelect()
              actions.activate(id)
              return
            }
            if (pendingTimerRef.current !== null) {
              clearTimeout(pendingTimerRef.current)
              pendingTimerRef.current = null
            }
            setPendingSelect({ id, fromId: activeTabId })
            pendingTimerRef.current = setTimeout(() => {
              pendingTimerRef.current = null
              const pending = pendingRef.current
              if (pending === null || pending.id !== id) return
              if (!actions.store.has(id)) {
                setPendingSelect(null)
                return
              }
              actions.activate(id)
              setPendingSelect(null)
            }, SELECT_COMMIT_DELAY)
          },
          [activeTabId, visualActiveId, actions, clearPendingSelect],
        )

        // ── 拖动排序（Chrome / Edge 式） ──────────────────────────────────────
        // 拖动期间 DOM 顺序不动，全部用 transform 做视觉预览：被拖标签 translateX
        // 直接跟手；其余标签按落点整体平移一个被拖标签的宽度，由 CSS transition 滑过去。
        // 落点 = 被拖标签左缘最接近的「空位」：抽掉被拖标签后其余标签的左缘，再加末尾
        // 一个空位；空位切换留 4px 回差，避免指针停在边界上时来回抖。松手才真正改 store。
        const [dragState, setDragState] = useState(null)
        const dragRef = useRef(null)
        const dragCleanupRef = useRef(null)
        const selectGuardRef = useRef(0)
        useEffect(
          () => () => {
            if (dragCleanupRef.current !== null) dragCleanupRef.current()
          },
          [],
        )
        const onTabSelect = useCallback(
          (id) => {
            if (performance.now() < selectGuardRef.current) return
            requestSelect(id)
          },
          [requestSelect],
        )
        const beginDrag = (event, id) => {
          if (event.button !== 0 || dragCleanupRef.current !== null) return
          const strip = stripRef.current
          if (strip === null) return
          const stripRect = strip.getBoundingClientRect()
          // 所有可见标签都参与：固定 / 未固定两段之间也能拖，落点所在段决定固定状态
          const items = [...strip.querySelectorAll('[data-session-id]')].map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              id: element.dataset.sessionId,
              el: element,
              pinned: element.dataset.pinned === 'true',
              left: rect.left - stripRect.left + strip.scrollLeft,
              width: rect.width,
            }
          })
          const selfIndex = items.findIndex((item) => item.id === id)
          if (items.length < 2 || selfIndex < 0) return
          const self = items[selfIndex]
          const slots = []
          for (let index = 0; index < items.length; index += 1) {
            if (index === selfIndex) continue
            const item = items[index]
            slots.push(index > selfIndex ? item.left - self.width : item.left)
          }
          // 末尾空位：最后一个可见标签的右缘（放在全部标签之后）
          const lastIndex = selfIndex === items.length - 1 ? selfIndex - 1 : items.length - 1
          slots.push(slots[slots.length - 1] + items[lastIndex].width)
          const drag = {
            id,
            items,
            self,
            selfIndex,
            slots,
            strip,
            stripRect,
            startClientX: event.clientX,
            startPointerX: event.clientX - stripRect.left + strip.scrollLeft,
            lastClientX: event.clientX,
            moved: false,
            k: selfIndex,
            drop: null,
            divider: null,
            pointerId: undefined,
            frame: 0,
          }
          dragRef.current = drag

          const restore = () => {
            for (const item of items) item.el.style.transform = ''
            if (drag.divider !== null) drag.divider.style.opacity = ''
          }
          const preview = (clientX, scrollLeft) => {
            const delta = clientX - stripRect.left + scrollLeft - drag.startPointerX
            self.el.style.transform = delta === 0 ? '' : `translate3d(${delta}px,0,0)`
            const draggedLeft = self.left + delta
            let nearest = 0
            let nearestDistance = Infinity
            for (let index = 0; index < slots.length; index += 1) {
              const distance = Math.abs(draggedLeft - slots[index])
              if (distance < nearestDistance) {
                nearest = index
                nearestDistance = distance
              }
            }
            if (nearest !== drag.k) {
              const currentDistance = Math.abs(draggedLeft - slots[drag.k])
              if (nearestDistance + 4 < currentDistance) drag.k = nearest
            }
            for (let index = 0; index < items.length; index += 1) {
              if (index === selfIndex) continue
              let shift = 0
              if (drag.k < selfIndex && index >= drag.k && index < selfIndex) shift = self.width
              else if (drag.k > selfIndex && index > selfIndex && index <= drag.k) shift = -self.width
              items[index].el.style.transform = shift === 0 ? '' : `translate3d(${shift}px,0,0)`
            }
            const remaining = items.filter((item, index) => index !== selfIndex)
            const reference = drag.k < remaining.length ? remaining[drag.k] : remaining[remaining.length - 1]
            const place = drag.k < remaining.length ? 'before' : 'after'
            const previous = drag.drop
            if (previous === null || previous.referenceId !== reference.id || previous.place !== place) {
              drag.drop = { referenceId: reference.id, place, pinned: reference.pinned }
            }
          }
          // 指针停在标签条两端时持续滚动（标签多到装不下时才能拖到看不见的位置）
          const tick = () => {
            if (dragRef.current !== drag) return
            drag.frame = 0
            const max = drag.strip.scrollWidth - drag.strip.clientWidth
            if (drag.moved && max > 0) {
              const rect = drag.stripRect
              const direction = drag.lastClientX < rect.left + 36 ? -1 : drag.lastClientX > rect.right - 36 ? 1 : 0
              if (direction !== 0) {
                const next = Math.max(0, Math.min(max, drag.strip.scrollLeft + direction * 16))
                if (next !== drag.strip.scrollLeft) {
                  drag.strip.scrollLeft = next
                  preview(drag.lastClientX, next)
                }
              }
            }
            drag.frame = requestAnimationFrame(tick)
          }
          const stop = () => {
            if (dragCleanupRef.current !== stop) return
            dragCleanupRef.current = null
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp, true)
            window.removeEventListener('pointercancel', onCancel, true)
            window.removeEventListener('blur', onCancel)
            document.removeEventListener('keydown', onKeyDown, true)
            if (drag.frame !== 0) {
              cancelAnimationFrame(drag.frame)
              drag.frame = 0
            }
            if (drag.pointerId !== undefined) {
              try {
                if (self.el.hasPointerCapture?.(drag.pointerId)) self.el.releasePointerCapture(drag.pointerId)
              } catch (error) {
                /* 指针已经释放 */
              }
            }
            restore()
            dragRef.current = null
            setDragState(null)
          }
          const onCancel = () => stop()
          const onKeyDown = (keyEvent) => {
            if (keyEvent.key !== 'Escape') return
            keyEvent.preventDefault()
            stop()
          }
          const onMove = (moveEvent) => {
            drag.lastClientX = moveEvent.clientX
            if (!drag.moved) {
              if (Math.abs(moveEvent.clientX - drag.startClientX) < 5) return
              drag.moved = true
              selectGuardRef.current = performance.now() + 500
              // 分段竖线保持占位、只隐去本体，拖动中标签条不会跳一下
              const divider = strip.querySelector('.dsh-tab-pagebar__divider')
              if (divider !== null) {
                drag.divider = divider
                divider.style.opacity = '0'
              }
              try {
                self.el.setPointerCapture(moveEvent.pointerId)
                drag.pointerId = moveEvent.pointerId
              } catch (error) {
                /* 不支持指针捕获时退化为 window 监听 */
              }
              setDragState({ id })
              drag.frame = requestAnimationFrame(tick)
            }
            if (moveEvent.cancelable) moveEvent.preventDefault()
            preview(moveEvent.clientX, strip.scrollLeft)
          }
          const onUp = () => {
            const moved = drag.moved
            const drop = drag.drop
            stop()
            if (!moved || drop === null) return
            // 松手后的 click 不算「切标签」：拖动已经表达了意图
            selectGuardRef.current = performance.now() + 250
            try {
              actions.store.move(id, drop.referenceId, drop.place, drop.pinned)
            } catch (error) {
              console.error('dsh-session-tabs: reordering tabs failed', error)
            }
          }
          dragCleanupRef.current = stop
          window.addEventListener('pointermove', onMove, { passive: false })
          window.addEventListener('pointerup', onUp, true)
          window.addEventListener('pointercancel', onCancel, true)
          window.addEventListener('blur', onCancel)
          document.addEventListener('keydown', onKeyDown, true)
        }

        // 外部导航（侧栏点会话 / 面板 / 新建会话 / 关闭后自动落位）打断待切换
        useEffect(() => {
          if (pendingSelect === null) return
          if (activeTabId === pendingSelect.id) return
          if (activeTabId !== pendingSelect.fromId) clearPendingSelect()
        }, [activeTabId, pendingSelect, clearPendingSelect])

        useEffect(
          () => () => {
            if (pendingTimerRef.current !== null) clearTimeout(pendingTimerRef.current)
          },
          [],
        )

        // 当前标签滚入可见范围（只滚标签条自身，不滚页面）；切换标签时平滑滚动，
        // 标签条因侧栏拖动变宽变窄时直接对齐。
        useEffect(() => {
          const strip = stripRef.current
          if (strip === null) return undefined
          const reduceMotion =
            typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
          const revealActive = (smooth) => {
            const active = strip.querySelector('[aria-selected="true"]')
            if (active === null) return
            const left = active.offsetLeft
            const right = left + active.offsetWidth
            let target = strip.scrollLeft
            if (left < strip.scrollLeft) target = Math.max(0, left - 8)
            else if (right > strip.scrollLeft + strip.clientWidth) target = right - strip.clientWidth + 8
            if (Math.abs(target - strip.scrollLeft) < 1) return
            if (!smooth || reduceMotion || typeof strip.scrollTo !== 'function') strip.scrollLeft = target
            else strip.scrollTo({ left: target, behavior: 'smooth' })
          }
          revealActive(true)
          if (typeof ResizeObserver !== 'function') return undefined
          const observer = new ResizeObserver(() => revealActive(false))
          observer.observe(strip)
          return () => observer.disconnect()
        }, [visualActiveId, tabs.length])

        // 竖滚轮映射成横滚：标签条装不下时，鼠标停在标签上直接滚就能左右移动。
        // 触控板/Shift+滚轮的横向增量（deltaX 更大）交给浏览器原生处理；Ctrl+滚轮留给缩放。
        // 有溢出时即使滚到头也拦下，避免指针在标签条上时把下面的会话页滚走。
        useEffect(() => {
          const strip = stripRef.current
          if (strip === null) return undefined
          const onWheel = (event) => {
            if (event.ctrlKey || event.metaKey) return
            if (strip.scrollWidth <= strip.clientWidth) return
            if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1
            const step = event.deltaY * unit
            if (step === 0) return
            const max = strip.scrollWidth - strip.clientWidth
            strip.scrollLeft = Math.max(0, Math.min(max, strip.scrollLeft + step))
            event.preventDefault()
          }
          strip.addEventListener('wheel', onWheel, { passive: false })
          return () => strip.removeEventListener('wheel', onWheel)
        }, [])

        // 标签栏在 shell.overlay 里绝对定位：左边缘跟住左栏宽度（左栏折叠时为 0，
        // 桌面端折叠侧栏时由 CSS 的 clearance 变量继续右移，避开窗口按钮）
        useEffect(() => {
          const bar = barRef.current
          const overlay = bar === null ? null : bar.closest('[data-shell-overlay]')
          const frame = overlay === null ? null : overlay.parentElement
          if (frame === null) return undefined
          let sidebarCol = null
          const resolveSidebarCol = () => {
            const sidebarSlot = document.querySelector('[data-slot="sidebar"]')
            if (sidebarSlot === null) return null
            return [...frame.children].find((el) => el.contains(sidebarSlot)) ?? null
          }
          const sync = () => {
            if (sidebarCol !== null && !sidebarCol.isConnected) sidebarCol = null
            if (sidebarCol === null) {
              sidebarCol = resolveSidebarCol()
              if (sidebarCol !== null && observer !== undefined) observer.observe(sidebarCol)
            }
            const width = sidebarCol === null ? 0 : sidebarCol.getBoundingClientRect().width
            bar.style.setProperty('--dsh-tab-left', `${Math.round(width)}px`)
          }
          let observer
          if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(sync)
            observer.observe(frame)
          }
          sidebarCol = resolveSidebarCol()
          if (sidebarCol !== null && observer !== undefined) observer.observe(sidebarCol)
          sync()
          // 座位可能比 sidebar 晚挂载：补几次重试，避免左缘永远算成 0
          const retryTimers = [100, 500, 1500].map((delay) => setTimeout(sync, delay))
          return () => {
            for (const timer of retryTimers) clearTimeout(timer)
            if (observer !== undefined) observer.disconnect()
          }
        }, [])

        // 菜单指向的标签被关掉 / 归档后自动收起
        useEffect(() => {
          if (menu === null) return
          if (!tabs.some((tab) => tab.id === menu.tabId)) setMenu(null)
        }, [menu, tabs])

        const dismissMenu = useCallback(() => setMenu(null), [])
        const openMenu = useCallback((event, tabId) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({ x: event.clientX, y: event.clientY, tabId, step: 'list', error: undefined })
        }, [])

        const menuTabIndex = menu === null ? -1 : tabs.findIndex((tab) => tab.id === menu.tabId)
        const menuTab = menuTabIndex < 0 ? undefined : tabs[menuTabIndex]
        const menuTabIsPanel = menuTab !== undefined && isPanelTab(menuTab.id)

        const runMenu = (fn) => () => {
          dismissMenu()
          fn()
        }

        const startArchive = (stopActivity) => {
          if (menu === null) return
          const tabId = menu.tabId
          setMenu((current) => (current === null ? current : { ...current, step: 'busy', error: undefined }))
          actions.archive(tabId, stopActivity).then((result) => {
            if (result.ok) {
              setMenu((current) => (current !== null && current.tabId === tabId ? null : current))
              return
            }
            setMenu((current) =>
              current !== null && current.tabId === tabId ? { ...current, step: 'error', error: result.message } : current,
            )
          })
        }

        // 方向键在标签之间移动并激活（自动激活式 tablist）。
        // 切换会话后官方会把焦点交给输入框，所以这里延后一两帧把焦点抢回标签。
        const focusRelative = (id, direction) => {
          if (tabs.length < 2) return
          const index = tabs.findIndex((tab) => tab.id === id)
          if (index < 0) return
          const target = tabs[(index + direction + tabs.length) % tabs.length]
          if (target === undefined) return
          requestSelect(target.id)
          const focusTarget = () => {
            const strip = stripRef.current
            if (strip === null) return
            const element = strip.querySelector(`[data-session-id="${target.id}"]`)
            if (element !== null && typeof element.focus === 'function') element.focus({ preventScroll: true })
          }
          focusTarget()
          if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
              focusTarget()
              setTimeout(focusTarget, 60)
            })
          }
        }

        let menuHint
        let menuItems = []
        if (menu !== null) {
          if (menu.step === 'busy') {
            menuHint = t('menu.archiveBusy')
          } else if (menu.step === 'error') {
            menuHint = t('menu.archiveFailed', { message: menu.error ?? '' })
            menuItems = [
              { key: 'retry-stop', label: t('menu.retryStop'), danger: true, run: () => startArchive(true) },
              { key: 'cancel', label: t('menu.cancel'), run: dismissMenu },
            ]
          } else if (menu.step === 'archive-confirm') {
            menuHint = t('menu.archiveRunning')
            menuItems = [
              { key: 'archive-stop', label: t('menu.archiveStop'), danger: true, run: () => startArchive(true) },
              { key: 'cancel', label: t('menu.cancel'), run: dismissMenu },
            ]
          } else if (menuTab !== undefined) {
            const rightTabs = tabs.slice(menuTabIndex + 1)
            const otherTabs = tabs.filter((tab) => tab.id !== menuTab.id && !tab.pinned)
            menuItems = [
              { key: 'close', label: t('menu.close'), run: runMenu(() => requestCloseOne(menuTab.id)) },
              {
                key: 'close-right',
                label: t('menu.closeRight'),
                disabled: rightTabs.length === 0,
                run: runMenu(() => requestClose(rightTabs.map((tab) => tab.id), () => actions.closeRight(menuTab.id))),
              },
              {
                key: 'close-others',
                label: t('menu.closeOthers'),
                disabled: otherTabs.length === 0,
                run: runMenu(() => requestClose(otherTabs.map((tab) => tab.id), () => actions.closeOthers(menuTab.id))),
              },
              { key: 'sep-1', separator: true },
              {
                key: 'close-all',
                label: t('menu.closeAll'),
                run: runMenu(() => requestClose(tabs.map((tab) => tab.id), () => actions.closeAll())),
              },
              { key: 'sep-2', separator: true },
              menuTab.pinned
                ? { key: 'unpin', label: t('menu.unpin'), run: runMenu(() => actions.unpin(menuTab.id)) }
                : { key: 'pin', label: t('menu.pin'), run: runMenu(() => actions.pin(menuTab.id)) },
              ...(menuTabIsPanel
                ? []
                : [
                    { key: 'sep-3', separator: true },
                    {
                      key: 'archive',
                      label: t('menu.archive'),
                      danger: true,
                      run: runMenu(() => {
                        const status = statuses?.get(menuTab.id)
                        const busy =
                          status?.running === true ||
                          (status?.pendingInteraction !== undefined && status?.pendingInteraction !== null)
                        if (busy)
                          setMenu({
                            x: menu.x,
                            y: menu.y,
                            tabId: menuTab.id,
                            step: 'archive-confirm',
                            error: undefined,
                          })
                        else startArchive(false)
                      }),
                    },
                  ]),
            ]
          }
        }

        return h(
          React.Fragment,
          null,
          h(
            'div',
            {
              ref: barRef,
              className: 'dsh-tab-pagebar',
              'data-dsh-tab-bar': '',
              'data-tabs': String(tabs.length),
              'data-empty': tabs.length === 0 ? 'true' : 'false',
              'data-window-drag': '',
            },
            h('style', { key: 'style' }, CSS),
            h(
              'div',
              {
                key: 'strip',
                ref: stripRef,
                className: 'dsh-tab-pagebar__strip',
                role: 'tablist',
                'aria-label': t('tab.list'),
              },
              (() => {
                const orderIndex = new Map(tabs.map((tab, index) => [tab.id, index]))
                const renderTab = (tab) => {
                  const panelTab = isPanelTab(tab.id)
                  const panel = panelTab ? panelById.get(panelIdOf(tab.id)) : undefined
                  const row = panelTab ? undefined : rows[tab.id]
                  const cwdLabel = panelTab ? '' : basenameOf(row?.cwd)
                  const badge = panelTab
                    ? null
                    : workspaceBadges.get(tab.id) ?? (cwdLabel.length === 0 ? null : { label: cwdLabel, hue: workspaceHue(cwdLabel) })
                  const index = orderIndex.get(tab.id) ?? 0
                  const node = h(TabItem, {
                    key: tab.id,
                    id: tab.id,
                    active: tab.id === visualActiveId,
                    blank: panelTab ? false : row?.blank === true,
                    pinned: tab.pinned,
                    panel: panelTab,
                    badge,
                    dragging: dragState !== null && dragState.id === tab.id,
                    title: panelTab
                      ? panel?.label ?? panelIdOf(tab.id)
                      : row?.blank === true
                        ? t('tab.newSession')
                        : row?.displayTitle || row?.title || t('tab.untitled'),
                    signal: panelTab ? undefined : sessionStatusSignal(statuses?.get(tab.id)),
                    t,
                    onSelect: onTabSelect,
                    onClose: requestCloseOne,
                    onMenu: openMenu,
                    onArrow: focusRelative,
                    onDragStart: (event) => beginDrag(event, tab.id),
                  })
                  const isLastPinned = tab.pinned && index === pinnedCount - 1 && tabs.length > pinnedCount
                  return isLastPinned
                    ? [node, h('span', { key: 'divider', className: 'dsh-tab-pagebar__divider', 'aria-hidden': true })]
                    : [node]
                }
                return tabs.flatMap((tab) => renderTab(tab))
              })(),
            ),
            h(
              'button',
              {
                key: 'new',
                type: 'button',
                className: 'dsh-tab-pagebar__new',
                title: t('tab.new'),
                'aria-label': t('tab.new'),
                onClick: actions.create,
              },
              h(IconNewChat),
            ),
          ),
          menu === null
            ? null
            : h(TabMenu, {
                key: 'menu',
                x: menu.x,
                y: menu.y,
                hint: menuHint,
                items: menuItems,
                onClose: dismissMenu,
              }),
          closeConfirm === null
            ? null
            : h(TabConfirm, {
                key: 'close-confirm',
                message: t('close.running'),
                confirmLabel: t('menu.close'),
                cancelLabel: t('menu.cancel'),
                onConfirm: confirmClose,
                onCancel: () => setCloseConfirm(null),
              }),
        )
      }
    }

    // ── 插件入口 ────────────────────────────────────────────────────────────
    return {
      inject: ['slots', 'locale', 'sessions', 'uiWorkspace', 'workspaces', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-session-tabs: dictionaries')

        // 帧布局样式：让 shell.bottom 这行排到三栏上方、横跨会话列 + 右栏列
        ctx.effect(() => {
          const style = document.createElement('style')
          style.dataset.plugin = 'dsh-tab'
          style.dataset.pluginCss = 'dsh-tab/frame.css'
          style.textContent = FRAME_CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'dsh-session-tabs: frame layout')

        const sessions = ctx.sessions
        const uiWorkspace = ctx.uiWorkspace
        const layout = ctx.layout
        const store = createTabStore()

        // 侧栏「全局面板」清单：sidebar.panellist 的条目就是可打开的面板（id + 本地化标题）。
        const createPanelStore = () => {
          let snapshot = Object.freeze({ ready: false, list: Object.freeze([]) })
          const listeners = new Set()
          return {
            subscribe(listener) {
              listeners.add(listener)
              return () => listeners.delete(listener)
            },
            getSnapshot() {
              return snapshot
            },
            setList(list) {
              snapshot = Object.freeze({ ready: true, list: Object.freeze(list.slice()) })
              for (const listener of [...listeners]) listener()
            },
          }
        }
        const panelStore = createPanelStore()
        const resolvePanelLabel = (label) => (typeof label === 'function' ? label() : label)
        const syncPanels = () => {
          try {
            const list = ctx.slots
              .entriesOfSlot('sidebar.panellist')
              .map(({ options }) => ({
                id: options.id,
                order: options.order ?? 0,
                label: resolvePanelLabel(options.label) ?? options.id,
              }))
              .sort((left, right) => left.order - right.order)
            panelStore.setList(list)
          } catch (error) {
            console.error('dsh-session-tabs: reading global panels failed', error)
          }
        }
        ctx.effect(() => {
          syncPanels()
          const offPanels = ctx.slots.subscribe('sidebar.panellist', syncPanels)
          const offLocale = ctx.locale.subscribe(syncPanels)
          return () => {
            offPanels()
            offLocale()
          }
        }, 'dsh-session-tabs: global panel entries')

        // 组件把当前视图态同步进来，关闭操作据此判断「正在显示的标签」是会话还是面板。
        const viewState = { activePanelId: null, panelList: [], panelsReady: false }

        /** 当前显示顺序（与渲染层同一套过滤规则，供关闭操作计算左右邻位）。 */
        const tabsNow = () => {
          const catalog = sessions.list.getSnapshot()
          const rows = catalog?.byId ?? {}
          const archived = new Set(ctx.workspaces.list.getSnapshot().archivedSessionIds ?? [])
          const panelKeys = new Set(viewState.panelList.map((panel) => panelTabKey(panel.id)))
          return displayTabs(store.getSnapshot()).filter((tab) => {
            if (isPanelTab(tab.id)) return viewState.panelsReady ? panelKeys.has(tab.id) : true
            return rows[tab.id] !== undefined && !archived.has(tab.id)
          })
        }

        // 关掉当前标签后 official 「新建会话」会复用空白会话，导航完成时当前会话可能不变，
        // 这种情形下补一次「当前会话入签」，避免标签栏空着。
        const ensureTimers = new Set()
        ctx.effect(
          () => () => {
            for (const timer of ensureTimers) clearTimeout(timer)
            ensureTimers.clear()
          },
          'dsh-session-tabs: settle timers',
        )
        const scheduleEnsureCurrentTab = (closedCurrent) => {
          for (const delay of [500, 1500]) {
            const timer = setTimeout(() => {
              ensureTimers.delete(timer)
              try {
                const current = currentSessionIdOf(sessions.list.getSnapshot())
                if (current === undefined) return
                // 导航还没完成时当前会话仍是刚被关掉的旧会话：不要把它加回来
                if (current === closedCurrent) return
                store.unsuppress(current)
                if (!store.has(current)) store.add(current)
              } catch (error) {
                console.error('dsh-session-tabs: settling current tab failed', error)
              }
            }, delay)
            ensureTimers.add(timer)
          }
        }

        /** 切到某个标签：会话标签走 openSession，面板标签走 layout.selectPanel。 */
        const activate = (id) => {
          if (isPanelTab(id)) {
            try {
              layout.selectPanel(panelIdOf(id))
            } catch (error) {
              console.error('dsh-session-tabs: switching to global panel failed', error)
            }
            return
          }
          try {
            const current = currentSessionIdOf(sessions.list.getSnapshot())
            // 同一个会话在面板页下面时，只需要把面板收回、露出会话。
            if (current === id) {
              layout.selectPanel(null)
              return
            }
            uiWorkspace.openSession(id)
          } catch (error) {
            console.error('dsh-session-tabs: switching conversation failed', error)
          }
        }

        /** 关掉一批标签；正在显示的标签在被关列表里时按 nextId / 首个剩余标签 / 新建会话的次序落位。 */
        const closeIds = (idsToClose, nextId) => {
          if (idsToClose.length === 0) return
          const catalog = sessions.list.getSnapshot()
          const current = currentSessionIdOf(catalog)
          const currentRow = current === undefined ? undefined : catalog?.byId?.[current]
          const activePanelId = viewState.activePanelId
          const activePanelKey = activePanelId === null || activePanelId === undefined ? null : panelTabKey(activePanelId)
          const activeKey = activePanelKey ?? (current === undefined ? null : current)
          const allTabs = displayTabs(store.getSnapshot())
          const closingAll = allTabs.every((tab) => idsToClose.includes(tab.id))
          // 全关且当前显示的是空白「新会话」：官方「新建会话」只会复用同一个空白会话，
          // 所以保留它当新的新会话页，避免标签栏空着或导航竞态把旧标签加回来。
          if (
            closingAll &&
            activePanelKey === null &&
            current !== undefined &&
            currentRow?.blank === true &&
            idsToClose.includes(current)
          ) {
            const others = idsToClose.filter((id) => id !== current)
            for (const id of others) if (!isPanelTab(id)) store.suppress(id)
            store.removeMany(others)
            return
          }
          for (const id of idsToClose) if (!isPanelTab(id)) store.suppress(id)
          store.removeMany(idsToClose)
          if (activeKey === null || !idsToClose.includes(activeKey)) return
          if (nextId !== undefined && store.has(nextId) && nextId !== activeKey) {
            activate(nextId)
            return
          }
          const remaining = tabsNow()
          if (remaining.length > 0) {
            activate(remaining[0].id)
            return
          }
          // 从面板标签一路关到空：收回面板、回到当前会话，并补回它的标签（不新建会话）。
          if (activePanelKey !== null && current !== undefined) {
            layout.selectPanel(null)
            store.unsuppress(current)
            if (!store.has(current)) store.add(current)
            return
          }
          uiWorkspace.startSession()
          scheduleEnsureCurrentTab(current)
        }

        const actions = {
          store,
          panelStore,
          setView(next) {
            viewState.activePanelId = next.activePanelId
            viewState.panelList = next.panelList
            viewState.panelsReady = next.panelsReady
          },
          activate,
          select(id) {
            activate(id)
          },
          closeOne(id) {
            try {
              const tabs = tabsNow()
              const index = tabs.findIndex((tab) => tab.id === id)
              const next = tabs[index + 1]?.id ?? tabs[index - 1]?.id
              closeIds([id], next)
            } catch (error) {
              console.error('dsh-session-tabs: closing tab failed', error)
            }
          },
          closeRight(id) {
            try {
              const tabs = tabsNow()
              const index = tabs.findIndex((tab) => tab.id === id)
              if (index < 0) return
              closeIds(
                tabs.slice(index + 1).map((tab) => tab.id),
                id,
              )
            } catch (error) {
              console.error('dsh-session-tabs: closing tabs to the right failed', error)
            }
          },
          closeOthers(id) {
            try {
              const closing = tabsNow().filter((tab) => tab.id !== id && !tab.pinned).map((tab) => tab.id)
              closeIds(closing, id)
            } catch (error) {
              console.error('dsh-session-tabs: closing other tabs failed', error)
            }
          },
          closeAll() {
            try {
              const all = store.getSnapshot().ids
              closeIds(all, undefined)
            } catch (error) {
              console.error('dsh-session-tabs: closing all tabs failed', error)
            }
          },
          pin(id) {
            store.pin(id)
          },
          unpin(id) {
            store.unpin(id)
          },
          archive(sessionId, stopActivity) {
            return uiWorkspace
              .archiveSession(sessionId, stopActivity === true ? { stopActivity: true } : undefined)
              .then(() => {
                store.suppress(sessionId)
                store.removeMany([sessionId])
                return { ok: true }
              })
              .catch((error) => {
                console.error('dsh-session-tabs: archiving conversation failed', error)
                return { ok: false, message: errorMessageOf(error) }
              })
          },
          create() {
            try {
              uiWorkspace.startSession()
            } catch (error) {
              console.error('dsh-session-tabs: creating conversation failed', error)
            }
          },
        }

        const TabBar = createTabBar(actions)
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'dsh-session-tabs-bar',
              order: -100,
              locale: NS,
            },
            TabBar,
          ),
        )
      },
    }
  },
})
