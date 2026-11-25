# 小牛霸王学习机

**0.3.1 累计功能更新 · 简体中文飞牛 NAS 应用**

公开源码：[songdone/XiaoNiuBaWang](https://github.com/songdone/XiaoNiuBaWang)。应用中心的开发者与发布者名称为 `6uos`，两处链接均指向此仓库。

在自己的 NAS 上整理 NES／Famicom 卡带，在浏览器里运行真实 FCEUmm WASM 模拟器。飞牛原生安装，无需 Docker；核心与七款内置 ROM 随包本地提供，不依赖 CDN，也不提供商业 ROM 下载站入口。个人卡带、存档、收藏和设置按用户隔离，NAS 原文件仍受当前用户目录授权及 ACL 限制。

界面、提示、设置、卡带标题和说明为简体中文，七款 ROM 保持原版字节；其中五款标注英文原版，网络大师和欢乐割草的画面语言保守标注 `und`。中文目录说明不代表 ROM 已汉化。

## 0.3.1 累计包含什么

- **七款授权自制游戏**：保留原五款，增加烟花守卫与记忆翻牌；原版 ROM、原作者署名、完整 GPL 和对应源码均保留。
- **全库查询和分页**：默认每页 20 条，支持 20／50／100、自定义 1–500、上下分页栏和跳页；显式选择“全部”后分批加载，可取消，虚拟列表只绘制视口附近卡片。搜索、分类、收藏、最近及排序均作用于全库。
- **目录导入和安全修复**：应用内选择并授权 NAS 目录，再浏览、勾选导入或扫描；取消保留已导入内容。Linux 祖先目录仅有遍历权限时使用 `O_PATH` 避免误拒绝，但目标目录仍需读取权限，ROM 只读打开，继续检查当前用户 ACL、授权和链接边界。
- **可见视口与整机大屏**：画面、工具栏、当前键位与虚拟手柄共同布局，控制区不遮画面；“全屏游玩”请求整台学习机的系统全屏，不允许时回退页内大屏。手机横屏方向键和 A/B 分列画面两侧。
- **双人键位与焦点输入**：显示实际保存的 1P／2P 键位，播放器可直接进入按键设置；游戏输入限定游戏焦点，文本框、菜单、工具栏和弹窗不控制卡带，暂停、失焦、隐藏及设备切换释放按键。Family/Subor 为协议适配，不宣传原装 BASIC 已验证。
- **保留进度与备份**：10 个带画面缩略图预览的即时槽位（支持槽位删除及可选离开自动存到槽位 10）、每 30 秒保存变化的 SRAM、失败快照下载与重试、条件冲突处理和应用内离开保护。ZIP 支持完整导出或仅备份存档、自定义封面与设置，恢复增量合并，内置与个人同内容卡带来源隔离，保留已有槽位与封面并列出冲突；设置与恢复防重复提交。
- **进阶游玩与整理体验**：支持单卡 `.zip` 导入与导入后立即试玩、卡带库/详情/播放器多处快捷重命名、截取游戏画面作为自定义封面、经典 WASD + J/K 键位预设与连发 A/B、2× 快进、短时时光回溯（`Backspace`）、6/8 位 Game Genie 与内存锁金手指、播放器内快捷画面设置、深浅色主题与拼音首字母搜索。
- **批准素材不变**：图标、横版 Logo、微信和支付宝两张原始赞赏码保持不变，自愿支持不影响功能。对应源码不包含私有赞赏图片，显式 `--without-support` 可重建无赞赏码版本。

## 开始使用

1. 按[安装说明](./docs/安装更新卸载.md)识别版本、构建号、架构、摘要与签名；当前为发布准备，不是已签名、已上架或设备全部通过的声明。
2. 从飞牛桌面打开应用，选卡带并点击“启动卡带”，再点击画面开始按钮启用运行与声音。
3. 上传自己有权使用的 `.nes`，或打开“服务器目录 → 添加卡带目录”，选择并授权后扫描或勾选导入。
4. 默认 1P：方向键，A=X、B=Z、开始=Enter、选择=右 Shift；2P：W/S/A/D，A=H、B=G、开始=U、选择=T。自定义后以播放器当前键位表为准。
5. 离开前确认保存成功；更新、卸载或迁移前下载完整备份并保存到应用目录之外。关闭或刷新浏览器不保证上传完成。

## 当前证据与发布边界

版本 0.3.0 是累计功能版本，不是假 1.0。品牌元数据供构建读取，二进制版本由构建注入；界面读取实际服务版本，不以写死文案伪造在线版本。实际应用中心介绍以 [manifest](./packaging/fnos/manifest) 的六节单行 HTML 为准，与中文文案同步。

构建使用 `bash scripts/build.sh --publish`：沿用官方 fnpack 1.2.3 普通打包流程，产物为未签名普通官方候选包，不是 1.3.3 `--nosign` 的本地调试包，也不表示获准发布或平台已接受。`bash scripts/build.sh --nosign` 仅供本地测试；`bash scripts/build.sh --release` 为显式选择的签名流程。三种模式互斥，实际包状态和核验结果分别记录。

| 范围 | 已有结果与限制 |
| --- | --- |
| 前端 | 当前赞赏修复后 156 项回归通过；历史播放器基线为 154 项。测试覆盖输入、播放器、视口、设置、赞赏、目录与分页，不冒充实体设备验收 |
| 真实核心 | 七款各 240 帧与键盘/SRAM 诊断；新增两款另有 638/590 帧操作对照与状态恢复，不代表通关、真人听音或实体手柄 |
| 浏览器视口 | 实际 WASM 的 1280×720、1024×600、390×844、844×390 视口检查；页内大屏与退出通过，原生全屏成功未验证，合成键盘/指针事件不是硬件多点触控 |
| NAS 安全 | 非 root 虚拟 Linux 验证授权目录 O_PATH 遍历、只读目标、ACL/链接拒绝；赞赏安装路径的同类修复已完成，新增完整 Linux 回归已编译，但尚未执行，不等同真实 NAS 授权链通过 |
| 设备 | 安装、启停与资料保留须逐设备核验，完整登录和目录浏览导入链仍待验证；公开仓库不包含测试设备身份、私人备份或登录信息 |
| 发布候选 | 双架构普通官方包及对应源码通过静态验包、真实 WASM/SQLite/ZIP 往返和私有 Unix HTTP 资源核验；未签名状态如实标注，不冒充上架批准 |

原始构建、失败记录、私人测试数据和验收日志不提交公开仓库。[兼容性报告](./docs/兼容性报告.md)说明面向用户的验证范围。

## 文档

- [使用说明](./docs/使用说明.md)：导入、分页、双人键位、整机大屏、学习键盘、进度与备份。
- [兼容性报告](./docs/兼容性报告.md)：当前证据、历史事实与未验证范围。
- [安装、更新与卸载](./docs/安装更新卸载.md)：交付识别、签名及数据安全。
- [内置游戏授权](./docs/内置游戏授权.md)：七款原版 ROM、原作版本、完整署名、GPL 与对应源码。
- [应用中心文案](./docs/应用中心文案.md)：实际 manifest 的六节中文介绍。
- [第三方组件](./docs/第三方组件.md)：核心、依赖、工具与分发边界。

## 从公开源码开发与构建

需要 Go 1.26、Node.js 22 或更新版本。先下载模块和前端依赖：

```sh
git clone https://github.com/songdone/XiaoNiuBaWang.git
cd XiaoNiuBaWang
go mod download
npm --prefix web ci
```

在一个终端运行本地服务，测试数据仅放在已忽略的 `.local-data`：

```sh
go run ./cmd/xiaoniubawang --dev-user local --listen 127.0.0.1:18763 \
  --data-dir .local-data --bundled-root web/public/games --without-support-assets
```

另一个终端启动界面；`VITE_TEST_USER` 必须与服务的 `--dev-user` 一致：

```sh
VITE_TEST_USER=local npm --prefix web run dev -- --host 127.0.0.1
npm --prefix web test
npm --prefix web run typecheck
go test ./cmd/... ./internal/... ./packaging/fnos/helpers/...
```

FPK 构建还需要官方 fnpack、Go 模块缓存及 `check-fnos-project.py` 验包工具。仓库包含固定核心输出、完整核心源码归档 `distribution/core-corresponding-source.tar.gz`、键盘补丁，以及七款游戏的原版 ROM、对应源码与许可；不包含本机工具链缓存、开发存档或私有赞赏原图。公开源码测试构建应显式使用无赞赏码模式：

```sh
bash scripts/build.sh --nosign --without-support --no-deliver \
  --build-id 20261123-fpk-source-test \
  --go /path/to/go --fnpack /path/to/fnpack --checker /path/to/check-fnos-project.py
```

上面的 `/path/to/...` 是需要替换的本地工具路径。此测试模式校验固定官方 fnpack 1.3.3；普通 `--publish` 模式使用已核对的官方 1.2.3，显式 `--release` 才启用签名。缺少工具或私有原图时不能声称已重建标准发布包；源码构建禁用赞赏图不影响发行包中的已批准两张原图。

## 实现、数据与授权

前端采用 React、TypeScript 与 Vite；服务端使用 Go 1.26 与纯 Go SQLite `modernc.org/sqlite`，专用应用用户及 Unix 套接字。飞牛数据目录为 `${TRIM_PKGVAR}/xiaoniubawang-data`。未上传快照只尝试保留在当前标签页 `sessionStorage`，失败时保留页面内存并提示下载，不是可靠备份。NAS 选择器物理路径丢弃，后续使用服务端授权的不透明句柄；本地预览不提供 NAS 权限。

核心固定提交 `77468e568d9fe9c48d684ca911f1a3fe7259fdf7` 加显式学习键盘补丁，GPL-2.0-or-later；应用许可证为 [LICENSE](./LICENSE) 中 GPL 第 3 版。历史核心重建字节一致，见[来源清单](./emulator/provenance.json)。包内源码与许可入口为 `source/source.zip`、`licenses/INDEX.txt`，最终内容以匹配交付报告为准。

内置双人乒乓球（Michael Billington，MIT）、网络大师与欢乐割草（Shiru，公有领域）、虚空枪骑兵（Riyoway／VOID LANCER contributors，MIT）、仓库推箱（Hxyspace／Cargo Shift contributors，MIT）、烟花守卫（Damian Yerrick，额外音乐 Ludwig van Beethoven，GPL-3.0-or-later）及记忆翻牌（程序/音乐 Damian Yerrick，美术 Damian Yerrick 与 Sara Crickard，GPL-3.0-or-later；原样 ROM 源码豁免仍保留对应源码）。详尽上游署名与许可见授权文档，不以应用许可替代原作许可。

本应用并非任天堂或小霸王官方产品，也未获得其官方授权。批准素材不变；素材批准不等于第三方商标授权，公开发行仍需品牌与发布核查。
