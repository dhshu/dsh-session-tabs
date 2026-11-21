# dsh-session-tabs

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）会话区加一排浏览器风格标签页：一个会话一个标签，标签栏嵌在窗口标题行，支持 Chrome / Edge 式的拖动排序、滚轮横向滚动、固定、关闭与归档。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-web%20%7C%20desktop-6b7280.svg)](#兼容性与限制)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4d93f8.svg)](#安装)

## 功能

- **标题行书页标签**：标签栏横跨「会话列 + 右侧产物栏」，嵌在窗口标题行里，不额外占用会话内容高度；选中的标签用白底 + 左右描边直接和下方的会话页连成一张纸。
- **拖动排序（Chrome / Edge 式）**：
  - 按住标签左右拖动，被拿起的标签跟随指针并轻轻抬起（投影、层级上浮、隐藏关闭按钮）；
  - 其余标签平滑地左右让位，松手前就能看到最终落点，不再画落点竖线；
  - 拖过固定标签与普通标签之间的分隔线时，自动切换固定 / 取消固定；
  - 指针靠近标签条两端时自动横向滚动（进入边缘 36px 后每帧滚动 16px）；
  - 水平位移超过 5px 才进入拖动，避免误触；`Esc`、窗口失焦或指针取消会放弃本次拖动；
  - 顺序写入 `localStorage`，刷新后保持。
- **滚轮横滚**：竖直滚轮在标签条上直接映射为横向滚动；触控板的横向手势仍走原生滚动；滚到尽头不会把下方会话页一起滚走。
- **标签过多**：标签宽度在 144–180px 之间随标题自适应，放不下时标签条自己横向滚动；`+` 始终可见；切换标签会自动把当前标签滚入视野。
- **固定标签**：固定后收成 40px、只显示图标并带状态点，和普通标签之间有一条分隔线；右键菜单可固定 / 取消固定。
- **工作区角标**：标签左上角显示所属工作区（颜色由工作区标识哈希得到，悬停可看全名）。
- **侧栏面板也是标签**：打开「插件」「自动化任务」等全局面板会新增或切换到对应标签，点回会话标签就收起面板；面板卸载后标签自动移除。
- **关闭与归档**：`×` / 鼠标中键 / 右键菜单（关闭标签页、关闭右侧、关闭其他、关闭全部）。关闭仍在运行任务的会话前会确认「任务仍在运行，关闭标签页？任务不会停止」——只关视图，不终止任务；归档运行中的会话则确认后走官方「停止并归档」。
- **状态点**：蓝色呼吸 = 正在运行，黄色 = 等待你回复，绿色 = 有新的完成内容。
- **键盘可达**：`Enter` / `Space` 激活标签，标签聚焦时 `←` / `→` 切换相邻标签，`Esc` 关闭菜单或取消拖动。
- **主题与语言**：颜色全部取自 `--dsw-alias-*` 主题 token，跟随浅色 / 深色；界面文案中英双语（`ctx.locale`），其他语言回退英文。
- **纯前端**：全部逻辑在 `client.js`，由 DSH 模块加载器直接加载；宿主端 `index.js` 只保留空 `apply()`；没有构建步骤。

## 安装

要求：DSH（桌面版或 Web GUI）及其随附的 `dsh` 命令行工具，Node.js >= 22（见 `package.json` 的 `engines`）。插件是纯前端 bundle，没有编译 / 打包步骤。

统一命令是：

```text
dsh plugin --profile <profile> add <包或 Git 地址>
```

`--profile` 决定装进哪个 profile：`web` 对应 Web GUI，`desktop` 对应桌面版；`add` 之后的参数原样转交给 pnpm，在该 profile 目录内执行。本包的 `package.json` 声明了 `dsh.bundle.patch`，安装后会自动加入 profile 的 `dsh.profile.bundles`，**不需要手动改 `package.json` 或 `cordis.patch.yml`**。

### 从 GitHub 安装（推荐）

```bash
# Web GUI
dsh plugin --profile web add git+https://github.com/dhshu/dsh-session-tabs.git

# 桌面版（先完全退出 DeepSeek Harness Desktop，再执行命令）
dsh plugin --profile desktop add git+https://github.com/dhshu/dsh-session-tabs.git
```

Windows 上如果 `dsh` 不在 PATH 中，用 DSH 安装目录里的 `dsh.cmd`（`<DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd`）。

确认依赖装到位：

```bash
dsh plugin --profile desktop why dsh-session-tabs
```

**重启 DSH** 后插件才会挂载生效。

### 本地目录安装（开发 / 离线）

```bash
git clone https://github.com/dhshu/dsh-session-tabs.git
cd dsh-session-tabs
dsh plugin --profile desktop add .
# 或保留软链接、便于改代码后立即生效：
dsh plugin --profile desktop add link:<dsh-session-tabs 的绝对路径>
```

相对路径以执行命令时的目录为基准；`file:` / `link:` 形式也能引用本地副本。本包没有 `scripts` / `prepare`，因此不会因为 pnpm 阻止 Git 依赖构建脚本而需要额外的 `allowBuilds` 配置。

### 其他安装方式

- 在 Agent 对话里让工具执行：

  ```text
  plugin_manager install_bundle target=<dsh-session-tabs 的绝对路径>
  ```

- 或在 DSH 界面：设置 → 插件 → 添加插件，选择 `dsh-session-tabs` 目录；装好后刷新窗口（macOS `Cmd+R`，Windows / Linux `Ctrl+R`）。

作为 npm 包名安装（`dsh plugin --profile web add dsh-session-tabs` 或 `plugin_manager install_bundle target=dsh-session-tabs`）要等包发布到 npm 后才可用，目前请从 GitHub 或本地目录安装。

## 使用

| 操作 | 方式 |
| --- | --- |
| 切换会话 | 左键点击标签页 |
| 新建会话 | 最后一个标签右侧的 `+` |
| 关闭标签页 | 标签上的 `×` / 鼠标中键 / 右键菜单 |
| 关闭一批 | 右键 → 关闭右侧 / 关闭其他 / 关闭全部 |
| 调整顺序 | 按住标签左右拖动 |
| 固定 / 取消固定 | 右键 → 固定标签页 / 取消固定标签页 |
| 打开侧栏页面 | 点侧栏的「插件」「自动化任务」等，自动新增 / 切换对应标签页 |
| 归档会话 | 右键 → 归档会话（有任务在跑时先确认是否停止） |
| 键盘切换 | 标签聚焦时 `←` / `→` |
| 标签过多 | 在标签条上滚鼠标滚轮，或按住拖动到边缘自动滚动 |

## 数据与持久化

标签顺序与固定状态保存在浏览器 `localStorage` 的 `dsh.sessionTabs.view.v1`（`{ tabs: string[], pinned: string[] }`）；旧键 `dsh.tab.openSessions.v1` 会被读取并迁移。标签本身是视图层记录，点击标签只是调用官方 `uiWorkspace.openSession`，不会并行渲染多个会话。

## 兼容性与限制

- 目标平台为 DSH Web 客户端（`package.json` 中 `dsh.client.platform = web`），在 DSH 桌面版中验证；标题行的定位样式主要面向桌面窗口，纯 Web 部署下外观可能随窗口边框不同。
- 依赖官方公开能力：`shell.overlay` 座位、`uiWorkspace.openSession / startSession / archiveSession`、`useSessionStatus`、`ctx.locale`；DSH 大版本升级后如有 API 变动需要跟随调整。

## License

[MIT](LICENSE)。

---

## English

Browser-style conversation tabs for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH), placed in the window title row. One tab per conversation; clicking a tab opens that conversation without a page reload.

- Book-style tabs merged into the page below; workspace badge; pinned tabs (40px, icon only); sidebar panels as tabs.
- Chrome/Edge-style drag reorder: the dragged tab follows the pointer and lifts, other tabs smoothly slide to make room; auto-scroll near the edges; order persisted in `localStorage`.
- Vertical wheel scrolls the tab strip horizontally; tabs shrink to a 144px minimum and the strip scrolls when crowded.
- Right-click menu: close / close to the right / close others / close all / pin / archive; closing a tab with a running task asks first (the task keeps running).
- Status dots: running, waiting for you, new completed content. Keyboard: `←` / `→` moves between tabs. Light/dark theme via DSH tokens, zh/en UI.

Install from GitHub with the DSH CLI:

```bash
dsh plugin --profile web add git+https://github.com/dhshu/dsh-session-tabs.git
# desktop profile: quit DeepSeek Harness Desktop first
dsh plugin --profile desktop add git+https://github.com/dhshu/dsh-session-tabs.git
```

`--profile` selects the target profile; `add` forwards its arguments to pnpm inside that profile. The bundle is registered automatically via `dsh.bundle.patch`; restart DSH to load it. Local/offline: `git clone` the repository, then `dsh plugin --profile desktop add .` (or `link:<absolute path>`). No build step.