# APK 打包手册 · 待办清单

> 这份文档只讲一件事：**改完网页之后，怎么把新的 APK 打出来**。
> 适用版本：V0.4 起。写完这份时实际打出的包是 `待办清单-V0.4.apk`（104 KB）。
> 相关文档：`docs/M4内容手册.md`（怎么用）、`docs/PRD-V0.4.md`（要开发什么）。

---

## 0. 先搞懂这层关系（30 秒）

```
prototype/index.html   ← 真正的 App（所有功能都在这一个文件里）
        │
        │  打包时被复制到 android/app/src/main/assets/
        ▼
android/               ← 一个很薄的安卓外壳（WebView + 原生桥接）
        │
        │  gradle assembleRelease
        ▼
app-release.apk        ← 装到手机上跑的就是它
```

所以：**99% 的改动只改 `prototype/index.html`，改完重新打包一次就行**，Java 那边基本不用碰。

---

## 1. 最简单的做法：双击一个 bat

```
android\build-apk.bat
```

双击它，等十几秒到两分钟，看到这两行就成功了：

```
打包成功：android\app\build\outputs\apk\release\app-release.apk
已复制到项目根目录：待办清单-V0.4.apk
```

这个脚本自己做了四件事：设好 JDK 和 Android SDK 路径 → 找到本机的 Gradle → 跑
`assembleRelease --offline` → 把产物复制到项目根目录（文件名自动带版本号）。

> ⚠️ **这个 .bat 必须存成 GBK 编码**（不是 UTF-8）。
> 中文 Windows 的 cmd 按 GBK 解析批处理文件，UTF-8 存的中文会把整行拆断，
> 表现是一堆「'se.apk" (' 不是内部或外部命令」。用记事本「另存为」选 ANSI 即可。

---

## 2. 想自己敲命令：三行

在项目根目录开一个 Git Bash 或 PowerShell：

```bash
export JAVA_HOME="E:/Files/Workbuddy/daiban261009/.toolchain/jdk"
export ANDROID_HOME="E:/Files/Workbuddy/daiban261009/.toolchain/android-sdk"

cd android
"$HOME/.gradle/wrapper/dists/gradle-8.14.3-all/"*/gradle-8.14.3/bin/gradle \
  assembleRelease --offline
```

产物固定在这个位置：

```
android/app/build/outputs/apk/release/app-release.apk
```

再手动复制到根目录并改名：

```bash
cp android/app/build/outputs/apk/release/app-release.apk "待办清单-V0.4.apk"
```

**三个参数说明白**：

| 参数 | 为什么 |
|---|---|
| `JAVA_HOME=.toolchain/jdk` | 本机默认的 `java` 是 1.8，**没有 javac**，直接跑会报「无效的源发行版 17」。这个目录是 Temurin 17 |
| `ANDROID_HOME=.toolchain/android-sdk` | 不用装 Android Studio，SDK 已经在这了 |
| `--offline` | 只用本机缓存，不联网。依赖早就下好了；去掉它也能跑，但会去网上查一遍 |

---

## 3. 这一步一定要检查（别跳过）

打完包，**看一眼体积**：

| 体积 | 说明 |
|---|---|
| **100 KB 左右** | ✅ 正常（HTML 约 180~220 KB 压缩后 + dex 17 KB） |
| **15 KB 左右** | ❌ `assets/index.html` 没打进去 —— 九成是 `copyWeb` 的路径写错了 |

想确认得更死一点：

```bash
python -c "import zipfile;z=zipfile.ZipFile('待办清单-V0.4.apk');print(z.read('assets/index.html').decode()[:60]);print(len(z.read('assets/index.html')))"
```

能打印出 HTML 开头、字节数和 `prototype/index.html` 差不多，就是对的。

> 这个坑踩过：`copyWeb` 里写 `from '../../prototype/index.html'` 是对的（相对 **app 模块**，
> 所以要退两级）。写成 `../prototype/...` 就找不到文件 —— gradle 不报错，只是悄悄打了个空壳。

---

## 4. 要升版本号，改两个地方

`android/app/build.gradle` 里：

```gradle
versionCode 4          // 整数，每次发版 +1，安卓靠它判断「谁更新」
versionName "0.4"      // 给人看的号，App 里「检查更新」比的就是它
```

以及 `prototype/index.html` 里搜 `const APPVER`（在文件靠前的位置）：

```js
const APPVER = 'V0.4（M4 · 更新与配色）';
```

三个地方对不上的后果：`检查更新` 会误判（比如明明是最新版却提示有新版本）。
网页版拿 `APPVER`、APK 里拿 `versionName`，两边都走 `UPD.ver()` 归一成 `0.4` 这种两位格式。

---

## 5. 装到手机上

1. 把 `待办清单-V0.4.apk` 传到手机（微信文件传输助手 / 数据线 / 网盘都行）
2. 手机上点它 → 系统提示「未知来源应用」→ 允许一次
3. 装完打开，全屏运行，状态栏自动避让

**升级**（已经装过旧版）：直接装新的覆盖，**数据不会丢**（数据在 App 的本地存储里）。
前提是签名一致 —— 用的都是 `android/daiban.keystore`。

> ⚠️ **`daiban.keystore` 千万别丢**。
> 丢了就再也出不了「能覆盖安装」的更新包，只能卸载重装（本地数据跟着没）。
> 建议把它单独备份一份到网盘（它已经在 `.gitignore` 里，不会被提交）。

---

## 6. 报错对照表

| 报错 | 原因 | 怎么办 |
|---|---|---|
| `无效的源发行版: 17` / `没有 javac` | 用了本机默认的 java 1.8 | `JAVA_HOME` 指到 `.toolchain/jdk` |
| `Unable to locate Android SDK` | 没设 `ANDROID_HOME` | 同上，指到 `.toolchain/android-sdk` |
| `SDK location not found` | 同上 | 同上 |
| `程序包 xxx 不存在`（Java 编译错） | 用了 JDK 8 的 `javac` | 同第 1 行 |
| `'se.apk" (' 不是内部或外部命令` | bat 存成了 UTF-8 | 另存为 ANSI（GBK） |
| `MainActivity.Bridge 无法转换为 Context` | 内部类里 `Toast.makeText(this,…)` 的 `this` 指向 Bridge | 改成 `MainActivity.this`（V0.4 已修这 3 处） |
| APK 只有 15 KB | `copyWeb` 路径错，assets 是空的 | 检查 `from '../../prototype/index.html'` |
| `Duplicate class` / 依赖冲突 | 一般不出现（本项目零依赖） | 跑 `gradle clean` 再试 |
| 构建卡在下载 | 少了 `--offline` 又在弱网 | 加 `--offline` |

**卡住了怎么办**：先 `gradle clean`，再重跑；还不行就把 `BUILD FAILED` 上面那几行贴出来。

---

## 7. 发版到 GitHub Releases（跟「检查更新」联动）

App 里的「检查更新」是读 `AzazelKumaki/todonotes` 的 **latest Release**：

```
https://api.github.com/repos/AzazelKumaki/todonotes/releases/latest
```

所以发版要做三步：

1. 把新 APK 打出来（本文档）
2. GitHub → Releases → Draft a new release
   - **Tag**：`v0.4`（要和 `versionName` 对得上，App 用 `(\d+)\.(\d+)` 抓前两位）
   - **附件**：拖入 `待办清单-V0.4.apk`
   - 正文写更新说明（App 的更新弹窗会原样显示）
3. 发布

> ⚠️ **仓库目前是私有的** —— 匿名访问这个 API 会返回 404，App 的「检查更新」会一直说
> 「没查到」。要么把仓库改成 Public，要么把 `UPD.API` 换成一个公开可读的版本 JSON
> （比如放在 COS 上，和云同步共用那个桶）。

---

## 8. 一页速查

```bash
# 打包（最常用）
双击 android\build-apk.bat

# 或者命令行
export JAVA_HOME="E:/Files/Workbuddy/daiban261009/.toolchain/jdk"
export ANDROID_HOME="E:/Files/Workbuddy/daiban261009/.toolchain/android-sdk"
cd android && "$HOME/.gradle/wrapper/dists/gradle-8.14.3-all/"*/gradle-8.14.3/bin/gradle assembleRelease --offline

# 产物
android/app/build/outputs/apk/release/app-release.apk
→ 复制到根目录改名 待办清单-V0.4.apk

# 验签
.toolchain/android-sdk/build-tools/*/apksigner.bat verify --print-certs 待办清单-V0.4.apk
```

| 检查点 | 期望 |
|---|---|
| APK 体积 | ~100 KB（15 KB 说明 HTML 没进去） |
| `assets/index.html` | 存在，且和 `prototype/index.html` 字节数接近 |
| 签名 | CN=Daiban（自签，`daiban.keystore`） |
| `versionCode` / `versionName` / `APPVER` | 三处一致 |
