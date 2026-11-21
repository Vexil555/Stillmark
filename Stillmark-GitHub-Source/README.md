# 刻度 STILLMARK

面向 Windows 10 22H2 x64 的离线学习计时器。浅色主题用暖白面板和朱红指针，深色主题用炭黑和暖灰。音效由程序实时合成。

## 运行便携版

1. 将 `Stillmark-1.0.0-Win10-x64.zip` 完整解压。
2. 双击 `Stillmark\Stillmark.exe`。同级的 `_internal` 文件夹包含 Python、Qt 和界面资源，请与程序放在一起。
3. 在计时台选择模式和时长，可填写学习主题。打开「沉浸锁定」后，再点击「开始专注」即可进入全屏。锁定默认关闭。

便携版随附运行时，日常使用全程离线。普通用户即可运行。

## 计时与记录

- **深度专注**默认 50 分钟，可设为 1–180 分钟。
- **番茄钟**默认 25 分钟专注、5 分钟短休、每 4 轮休息 15 分钟。专注结束即解除覆盖并开始休息。用户主动开始下一轮，休息也可手动跳过。
- **专注记录**提供近 4、12、26 周的热力图、按 24 个本地小时统计的专注分布和近期明细。总时长包含完成及提前结束的实际用时，跨日、跨小时按区间分摊。CSV 导出涵盖全部历史。
- **声音**包括时长控制的机械回馈、阶段切换提示和默认关闭的低频环境声。环境声随专注淡入、随结束淡出。音量和界面动效可单独调整，界面也遵循系统的减少动态效果设置。
- 设置和记录保存在本机的 `%LOCALAPPDATA%\Stillmark\journal.sqlite3`。在「设置 → 本地数据」可以打开该目录。程序退出后可复制整个目录备份。

## 沉浸锁定与紧急恢复

主屏以全屏窗口显示倒计时，每块副屏有单独的置顶覆盖。Windows 低级键盘钩子拦截 `Win`、`Alt+Tab`、`Alt+Esc`、`Alt+F4`、`Alt+Space`、`Ctrl+Esc` 与 `Ctrl+Shift+Esc`。达到时间后自动解除锁定。

正常提前退出时，逐字符键入 64 位随机码。输入区只显示录入进度，输错即更换验证码并归零。校验通过后等待 3 分钟，再点击「确认结束」。随时可以返回专注。

**紧急熔断**是同时按住 `Ctrl+Shift+Alt+F12` 两秒。它只在锁定时工作，快捷键也可以在「设置 → 沉浸与恢复」展开查看。独立的原生守护进程负责移除热键拦截。主界面停止响应时，守护进程会释放钩子并在必要时退出应用。Windows 的安全桌面快捷键 `Ctrl+Alt+Delete` 始终可用。

## 从源码启动或打包

| 操作 | 双击 |
| --- | --- |
| 准备开发环境、构建界面并启动桌面程序 | `Setup-and-Run.cmd` |
| 重建界面并打包 Windows 便携版 | `Build-Windows.cmd` |

首次从源码运行需要 Python 3.12 x64、Node.js 22 或 24 LTS 和网络。脚本会复用已安装工具，工具缺失时调用 Windows Package Manager 安装，随后在项目目录创建 Python 虚拟环境并安装锁定的前端依赖。再次运行可复用环境。桌面发行目录为 `release\Stillmark`。

## 源码目录

```text
Stillmark/
├─ main.py                 应用与守护进程入口
├─ desktop/
│  ├─ engine.py            单调时钟、周期状态、SQLite、提前退出协议
│  ├─ guard.py             Win32 热键拦截、独立守护进程、紧急熔断
│  └─ window.py            PySide6 窗口、多屏覆盖、WebChannel、CSV 导出
├─ ui/
│  ├─ src/
│  │  ├─ main.tsx          桌面界面、主题、原生桥接
│  │  ├─ timer.tsx         表盘、计时台、锁定与校验界面
│  │  ├─ history.tsx       热力图、时段柱图和专注记录
│  │  ├─ settings.tsx      外观、声音、番茄钟与恢复
│  │  ├─ controls.tsx      拨档开关与步进输入
│  │  ├─ model.ts          UI 与桌面端的状态契约
│  │  ├─ audio.ts          Web Audio 实时合成
│  │  └─ styles.css        两套主题、字体排印和物理动效
│  ├─ index.html
│  ├─ package.json / package-lock.json
│  └─ tsconfig.json / vite.config.ts
├─ assets/                 Windows 图标与版本元数据
├─ docs/                   设计与架构说明、第三方许可
├─ requirements.txt
├─ Stillmark.spec
├─ Stillmark.ps1
├─ Setup-and-Run.cmd
└─ Build-Windows.cmd
```
