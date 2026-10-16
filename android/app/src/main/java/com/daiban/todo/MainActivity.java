package com.daiban.todo;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
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
    /* 选文件的回调：网页里点「导入备份」会弹出系统文件选择器，选完到这里 */
    private ValueCallback<Uri[]> uploadCb;
    private static final int REQ_PICK_FILE = 1001;

    /** 网页 ⇄ 手机 之间的通道 */
    public class Bridge {
        @JavascriptInterface
        public boolean isApp() { return true; }

        @JavascriptInterface
        public String getVersionName() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public int getVersionCode() { return BuildConfig.VERSION_CODE; }

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

    /** 写到「下载 / 待办清单」——用 MediaStore 的好处：一个权限都不用申请 */
    private void saveToDownloads(String name, String content) throws Exception {
        if (Build.VERSION.SDK_INT < 29) throw new Exception("系统版本太低");
        ContentResolver cr = getContentResolver();
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
        cv.put(MediaStore.Downloads.MIME_TYPE,
                name.endsWith(".json") ? "application/json" : "text/csv");
        cv.put(MediaStore.Downloads.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/待办清单");
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
        if (Build.VERSION.SDK_INT >= 21) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        web.setScrollbarFadingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, String url) {
                return false;   // 全部在自己的壳里打开，不跳外部浏览器
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
