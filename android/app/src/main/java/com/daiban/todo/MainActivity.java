package com.daiban.todo;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.DisplayCutout;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.InputMethodManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * 极简壳：整个应用就是 prototype/index.html 这一个网页。
 * 这样做的好处是「网页端和 APK 端功能完全一致」——不存在手机上少哪个功能。
 *
 * 壳只负责四件事：
 *   1. 打开 assets 里的网页，并把数据存在本机的开关（localStorage）打开
 *   2. 让网页能跨域调 AI 接口
 *   3. 把导出 / 备份文件真的写进手机的「下载 / 待办清单」目录
 *   4. 返回键先在网页里退一层，退不了才退出
 */
public class MainActivity extends Activity {

    private WebView web;
    private long lastBack = 0;
    /* 系统栏高度（状态栏 + 底部手势条，含刘海）：注入给网页当 CSS 变量用 */
    private int sysTop = 0, sysBottom = 0;
    /* 键盘补弹重试计数（首屏 focus() 常发生在窗口拿到焦点之前，键盘不弹） */
    private int kbdRetry = 0;
    /* 选文件的回调：网页里点「导入备份」会弹出系统文件选择器，选完到这里 */
    private ValueCallback<Uri[]> uploadCb;
    private static final int REQ_PICK_FILE = 1001;
    /** 下载目录名：导出的数据和更新用的 APK 都落在这儿 */
    private static final String DIR_NAME = "待办清单";

    /** 网页 ⇄ 手机 之间的通道 */
    public class Bridge {
        @JavascriptInterface
        public boolean isApp() { return true; }

        @JavascriptInterface
        public String getVersionName() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public int getVersionCode() { return BuildConfig.VERSION_CODE; }

        /* V0.4 · FR-403：网页换了配色之后告诉 App 该用深色还是浅色系统栏图标
           （Bridge 的方法跑在 WebView 线程，改 UI 必须切回主线程） */
        @JavascriptInterface
        public void setBarsDark(boolean dark) {
            runOnUiThread(() -> setSystemBarIconsDark(dark));
        }

        /* V0.4 · FR-401：在线更新 —— 原生这边负责把 APK 下载下来。
           为什么不从网页传二进制？WebView 的字符串通道会把二进制搞坏，
           而且一次传几百 KB 容易把 Binder 撑爆 —— 传个地址让原生自己下最稳。 */
        @JavascriptInterface
        public void installApk(String url) {
            if (url == null || (!url.startsWith("https://github.com/")
                    && !url.startsWith("https://objects.githubusercontent.com/"))) {
                Toast.makeText(this, "安装包地址不在允许的域名里", Toast.LENGTH_LONG).show();
                return;
            }
            new Thread(() -> {
                Exception err = null;
                Uri uri = null;
                try {
                    if (Build.VERSION.SDK_INT < 29) throw new Exception("系统版本太低（需要安卓 10 以上）");
                    String name = "daiban-" + System.currentTimeMillis() + ".apk";
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    cv.put(MediaStore.Downloads.MIME_TYPE, "application/vnd.android.package-archive");
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + DIR_NAME);
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    ContentResolver cr = getContentResolver();
                    Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (u == null) throw new Exception("没法在系统下载目录建文件");
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setConnectTimeout(15000); c.setReadTimeout(30000);
                    c.setInstanceFollowRedirects(true);
                    if (c.getResponseCode() >= 400) throw new Exception("下载失败（HTTP " + c.getResponseCode() + "）");
                    java.io.InputStream in = c.getInputStream();
                    java.io.OutputStream out = cr.openOutputStream(u);
                    if (out == null) throw new Exception("没法写入下载目录");
                    byte[] buf = new byte[16384];
                    int n; long total = 0;
                    while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); total += n; }
                    out.flush(); out.close(); in.close();
                    if (total < 1024) throw new Exception("下载下来的文件太小，可能没下全");
                    cv.clear();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    cr.update(u, cv, null, null);
                    uri = u;
                } catch (Exception e) { err = e; }
                final Exception e2 = err; final Uri u2 = uri;
                runOnUiThread(() -> {
                    if (e2 != null || u2 == null) {
                        Toast.makeText(this, "没下下来：" + (e2 == null ? "未知原因" : e2.getMessage()),
                                Toast.LENGTH_LONG).show();
                        return;
                    }
                    try {
                        Intent it = new Intent(Intent.ACTION_VIEW);
                        it.setDataAndType(u2, "application/vnd.android.package-archive");
                        it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(it);
                    } catch (Exception e) {
                        Toast.makeText(this, "叫不起来安装界面，去「下载 / " + DIR_NAME + "」手动装",
                                Toast.LENGTH_LONG).show();
                    }
                });
            }).start();
        }

        /* 用手机浏览器打开一个网址（更新页兜底通路） */
        @JavascriptInterface
        public void openUrl(String url) {
            try {
                Intent it = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(it);
            } catch (Exception e) { /* 没有浏览器就拉倒 */ }
        }

        /* ---- 写文件：分块传，避免一次传太大把 Binder 撑爆（1000 条待办 JSON 约 1MB）---- */
        private StringBuilder buf = new StringBuilder();
        private String pendingName = "";

        @JavascriptInterface
        public void writeBegin(String name) {
            buf = new StringBuilder();
            pendingName = name == null ? "export.txt" : name;
        }

        @JavascriptInterface
        public void writeChunk(String text) {
            if (text != null) buf.append(text);
        }

        @JavascriptInterface
        public String writeEnd() {
            String name = pendingName;
            try {
                saveToDownloads(name, buf.toString());
                buf = new StringBuilder();
                return "ok";
            } catch (Exception e) {
                return "fail:" + e.getMessage();
            }
        }
    }

    /** 把系统栏高度推成网页的 CSS 变量（--sysbar-top / --sysbar-bottom）。
     *  Insets 可能在页面加载前就到了，所以 onPageFinished 里也会再补推一次。 */
    private void pushInsets() {
        try {
            web.evaluateJavascript(
                "try{(function(d){d.documentElement.style.setProperty('--sysbar-top','" + sysTop + "px');"
                    + "d.documentElement.style.setProperty('--sysbar-bottom','" + sysBottom + "px');})(document)}catch(e){}",
                null);
        } catch (Exception e) { /* 页面还没就绪，onPageFinished 会补 */ }
    }

    /** 补弹软键盘（2026-10-18 真机 bug：首次打开 App 时输入框虽聚焦，键盘不弹；
     *  切个页面反而弹了）。原因：网页的 focus() 发生在**窗口拿到焦点之前**，那次聚焦被系统忽略。
     *  窗口一有焦点就补一次 InputMethodManager.showSoftInput。
     *  只在网页自己处在「聚焦态且焦点就在输入框」时才弹（用户在二级页 / 我的页 / 已收起时不弹），
     *  页面没加载完时重试几次（首屏慢的时候 focus 比窗口焦点晚到）。 */
    private void nudgeKeyboard() {
        if (web == null) return;
        try {
            web.evaluateJavascript(
                "(function(){try{return (typeof S!=='undefined'&&S.focused"
                    + "&&document.activeElement&&document.activeElement.id==='qi')?'1':'0'}"
                    + "catch(e){return '0'}})()",
                value -> {
                    if (value != null && value.contains("1")) {
                        kbdRetry = 0;
                        try {
                            web.requestFocus(View.FOCUS_DOWN);
                            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                            if (imm != null) imm.showSoftInput(web, InputMethodManager.SHOW_IMPLICIT);
                        } catch (Exception e) { /* 个别ROM不给弹就算了，不崩 */ }
                    } else if (kbdRetry < 8) {
                        kbdRetry++;
                        web.postDelayed(this::nudgeKeyboard, 150);
                    }
                });
        } catch (Exception e) { /* 页面还没就绪 */ }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setSystemBarIconsDark(true);   /* 个别ROM会重置这个状态，顺带补一手 */
            nudgeKeyboard();   /* 窗口拿到焦点 = 补弹键盘的第一个时机 */
        }
    }

    /** 系统栏图标（状态栏时间电量 + 底部手势条）用深色还是浅色。
     *  dark=true → 深色图标（配浅色底）。API 30+ 走 WindowInsetsController，
     *  更早的走 View 的 SYSTEM_UI_FLAG_LIGHT_*（minSdk 29 两种都覆盖）。 */
    private void setSystemBarIconsDark(boolean dark) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                WindowInsetsController c = getWindow().getInsetsController();
                if (c != null) {
                    int flag = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                             | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    c.setSystemBarsAppearance(dark ? flag : 0, flag);
                }
            } else {
                View decor = getWindow().getDecorView();
                int vis = decor.getSystemUiVisibility();
                int flag = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                decor.setSystemUiVisibility(dark ? (vis | flag) : (vis & ~flag));
            }
        } catch (Exception e) { /* 个别ROM不支持就保持系统默认，不崩 */ }
    }

    /** 写到「下载 / 待办清单」——用 MediaStore 的好处：一个权限都不用申请 */
    private void saveToDownloads(String name, String content) throws Exception {
        if (Build.VERSION.SDK_INT < 29) throw new Exception("系统版本太低");
        ContentResolver cr = getContentResolver();
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
        cv.put(MediaStore.Downloads.MIME_TYPE,
                name.endsWith(".json") ? "application/json" : "text/csv");
        cv.put(MediaStore.Downloads.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/" + DIR_NAME);
        cv.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new Exception("无法创建文件");
        try (OutputStream os = cr.openOutputStream(uri)) {
            os.write(content.getBytes(StandardCharsets.UTF_8));
        }
        cv.clear();
        cv.put(MediaStore.Downloads.IS_PENDING, 0);
        cr.update(uri, cv, null, null);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        /* 状态栏 / 底部手势条的图标用深色（2026-10-18 用户反馈：白底白字看不清）：
           App 三种主题的底色都是浅色（工作 #F8FAFC / 生活 #FFFBF5 / 我的 #FFFFFF），
           而系统默认给的是白色图标 —— 不给它标这一笔，浅底下时间和电量就糊成一片。
           别的 App「会跟着底色变」就是因为它们在底色变化时调了这个开关；
           我们底色恒为浅色，所以一次性设成深色即可。
           ⚠️ 将来若做「自定义背景图」且允许深色图，这里要改成按图片明暗动态切换
              （网页侧采样图片亮度 → AppBridge 通知原生），见 PRD §9。 */
        setSystemBarIconsDark(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // ★ 数据全靠 localStorage，这个必须开
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowUniversalAccessFromFileURLs(true);  // ★ 让 file:// 页面能跨域调 AI 接口
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);                           // 别让系统字体缩放把版面撑变形
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        /* 给网页一个「我在 APK 里」的标记：页面据此切成真机全屏形态
           （撑满屏幕、去掉原型外壳和假状态栏），见 index.html 文首认领脚本 */
        s.setUserAgentString(s.getUserAgentString() + " DaibanApp/" + BuildConfig.VERSION_NAME);
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        web.setScrollbarFadingEnabled(true);
        /* 边缘拖拽的蓝色回弹去掉 */
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        /* ★ 状态栏 / 底部手势条避让（2026-10-18 真机实测后重写）：
           原来用的 web.setFitsSystemWindows(true) **在真机上不生效** —— WebView 会自己吞掉
           WindowInsets，不翻译成 View padding，结果网页画到状态栏底下、和时钟电池重叠。
           现在改成：原生读出真实的系统栏高度（含刘海/打孔），**换算成 dp** 后注入成网页的
           CSS 变量 --sysbar-top / --sysbar-bottom，由 app-mode 样式负责留出空间。
           ⚠️ WindowInsets 给的是**物理像素**，而网页的 CSS px 是密度无关像素（dp）——
              不除密度会按屏幕密度放大 2~3 倍（2.625x 屏上 48dp 状态栏被留成 126px 空白，
              2026-10-18 真机截图实测过，这是本轮修的第二个坑）。
           env(safe-area-inset-*) 作兜底（viewport-fit=cover 已开）。 */
        final float density = getResources().getDisplayMetrics().density;
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            int topPx, bottomPx;
            if (Build.VERSION.SDK_INT >= 30) {
                topPx = insets.getInsets(WindowInsets.Type.systemBars()).top;
                bottomPx = insets.getInsets(WindowInsets.Type.systemBars()).bottom;
            } else {
                topPx = insets.getSystemWindowInsetTop();
                bottomPx = insets.getSystemWindowInsetBottom();
            }
            /* 刘海屏 / 打孔屏：安全区通常比状态栏还高一点，取大者 */
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cut = insets.getDisplayCutout();
                if (cut != null) {
                    topPx = Math.max(topPx, cut.getSafeInsetTop());
                    bottomPx = Math.max(bottomPx, cut.getSafeInsetBottom());
                }
            }
            int top = Math.round(topPx / density);       /* 物理像素 → dp */
            int bottom = Math.round(bottomPx / density);
            if (top != sysTop || bottom != sysBottom) {
                sysTop = top; sysBottom = bottom;
                pushInsets();
            }
            return insets;   /* 不消费，WebView 该拿的还给它 */
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return false;   // 全部在自己的壳里打开，不跳外部浏览器
            }
            @Override public void onPageFinished(WebView v, String url) {
                pushInsets();   // 网页就绪，把系统栏高度补推过去（insets 可能比页面先到）
                nudgeKeyboard(); // 页面加载完 = 补弹键盘的第二个时机（首屏慢的时候用得上）
            }
        });
        /* 「导入备份」要用：网页的请求文件 → 转给系统的文件选择器 */
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (uploadCb != null) uploadCb.onReceiveValue(null);   /* 上一次没结束就先收掉 */
                uploadCb = cb;
                try {
                    Intent i = params.createIntent();
                    i.setType("*/*");                                   /* 有些机型不认 application/json */
                    startActivityForResult(Intent.createChooser(i, "选择备份文件"), REQ_PICK_FILE);
                    return true;
                } catch (Exception e) {
                    uploadCb = null;
                    if (cb != null) cb.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "打不开文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });
        web.addJavascriptInterface(new Bridge(), "AppBridge");

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_PICK_FILE && uploadCb != null) {
            Uri[] uris = (res == RESULT_OK && data != null)
                    ? WebChromeClient.FileChooserParams.parseResult(res, data) : null;
            uploadCb.onReceiveValue(uris);
            uploadCb = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        web.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.evaluateJavascript("try{DB.save&&DB.save()}catch(e){}", null);  // 切走之前先落盘
    }

    /** 返回键：先给网页一个机会退一层（比如从详情页退回列表），退不了才准备退出 */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
            "(function(){try{return String((typeof window.__androidBack==='function')" +
            "? window.__androidBack() : false)}catch(e){return 'false'}})()",
            value -> {
                boolean handled = value != null && value.contains("true");
                if (handled) return;
                long now = System.currentTimeMillis();
                if (now - lastBack < 2000) {
                    finish();
                } else {
                    lastBack = now;
                    Toast.makeText(this, "再按一次退出", Toast.LENGTH_SHORT).show();
                }
            });
    }
}
