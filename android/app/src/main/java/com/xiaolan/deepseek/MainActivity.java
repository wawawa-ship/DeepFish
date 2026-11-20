package com.xiaolan.deepseek;

import android.Manifest;
import android.content.pm.PackageManager;
import android.webkit.PermissionRequest;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * 长按输入框录音需要 WebView 的 getUserMedia 权限。
 * 继承 Capacitor 自带的 BridgeWebChromeClient（避免文件选择器等功能失效），
 * 只额外重写 onPermissionRequest 放行麦克风。
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_AUDIO = 9001;
    private PermissionRequest pendingAudioRequest = null;
    private boolean chromePatched = false;

    @Override
    public void onStart() {
        super.onStart();

        if (this.bridge == null || this.bridge.getWebView() == null) return;
        if (chromePatched) return;
        chromePatched = true;

        final WebView webView = this.bridge.getWebView();

        webView.setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                boolean wantsAudio = false;
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)) {
                        wantsAudio = true;
                        break;
                    }
                }

                if (!wantsAudio) {
                    super.onPermissionRequest(request);
                    return;
                }

                if (ContextCompat.checkSelfPermission(MainActivity.this,
                        Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    return;
                }

                pendingAudioRequest = request;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.RECORD_AUDIO}, REQ_AUDIO);
                    }
                });
            }
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);

        if (requestCode == REQ_AUDIO && pendingAudioRequest != null) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingAudioRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                pendingAudioRequest.deny();
            }
            pendingAudioRequest = null;
        }
    }
}
