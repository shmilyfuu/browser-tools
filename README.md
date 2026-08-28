# browser-tools

用于统一管理浏览器相关工具的代码仓库。仓库会持续收纳 Chrome / Edge / Chromium 扩展、Tampermonkey / Violentmonkey Userscript，以及其他适合独立维护的轻量级浏览器工具。

各子项目保持相对独立，可以单独开发、测试、构建、发布和维护。只有出现真实的跨项目复用需求时，才把公共代码整理到 `shared/`。

## 目录说明

- `extensions/`：Chrome、Edge 与其他 Chromium 浏览器扩展。一款扩展一个目录。
- `userscripts/`：Tampermonkey、Violentmonkey 等 Userscript。一款脚本一个目录；首次加入 Userscript 时创建该目录。
- `shared/`：跨项目公共代码。当前没有共享模块，因此暂未创建实体目录。
- `docs/`：仓库级文档、目录约定和后续迁移说明。

## 当前项目

### 浏览器扩展

- [shoe-view-downloader](./extensions/shoe-view-downloader/) — 鞋图四视图下载器。把网页鞋图拖入四格队列，记录高清原图候选，按鞋款、角度、序号和日期命名，并直接保存到指定文件夹。

### Userscript

当前仓库尚未提交 Userscript 项目。后续脚本统一放到 `userscripts/<project-name>/`。

## 仓库结构

```text
browser-tools/
├── README.md
├── .gitignore
├── extensions/
│   └── shoe-view-downloader/
│       ├── README.md
│       ├── manifest.json
│       ├── background.js
│       ├── content.js
│       ├── sidepanel.html
│       ├── sidepanel.css
│       ├── sidepanel-core.js
│       ├── sidepanel-ui.js
│       ├── sidepanel-files.js
│       ├── sidepanel-init.js
│       └── icons/
└── docs/
    └── repository-layout.md
```

`userscripts/` 与 `shared/` 会在出现第一个对应项目时创建，避免使用无意义的空目录占位文件。

## 新增项目

新增浏览器扩展：`extensions/<project-name>/`

新增油猴脚本：`userscripts/<project-name>/`

每个项目保留自己的 README、manifest、package 配置、构建脚本和发布说明。仓库根目录暂不配置 workspace；现阶段各项目没有共同 Node 构建需求。
