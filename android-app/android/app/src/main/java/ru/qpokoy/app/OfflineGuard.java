package ru.qpokoy.app;

import android.app.Activity;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

/** Native, local fallback. Never reloads an already rendered app on network changes. */
final class OfflineGuard {
    private final Activity activity;
    private final WebView web;
    private final String home;
    private final View overlay;
    private final TextView message;
    private final TextView detail;
    private final Button retry;
    private final ConnectivityManager connectivity;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final InitialLoadState state = new InitialLoadState();
    private boolean destroyed;
    private boolean registered;
    private Toast notice;
    private final Runnable timeout = () -> failFirstLoad();
    private final ConnectivityManager.NetworkCallback callback = new ConnectivityManager.NetworkCallback() {
        private void changed() { handler.post(() -> { if (!destroyed) refreshNetwork(); }); }
        @Override public void onAvailable(Network network) { changed(); }
        @Override public void onLost(Network network) { changed(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities caps) { changed(); }
    };

    OfflineGuard(Activity activity, WebView web, String home) {
        this.activity = activity; this.web = web; this.home = home;
        web.setBackgroundColor(Color.rgb(7,12,20));
        ViewGroup content = activity.findViewById(android.R.id.content);
        overlay = activity.getLayoutInflater().inflate(R.layout.qpokoy_offline,content,false);
        content.addView(overlay);
        message = overlay.findViewById(R.id.offlineMessage);
        detail = overlay.findViewById(R.id.offlineDetail);
        retry = overlay.findViewById(R.id.offlineRetry);
        retry.setOnClickListener(view -> retry());
        connectivity = (ConnectivityManager) activity.getSystemService(Activity.CONNECTIVITY_SERVICE);
        connectivity.registerDefaultNetworkCallback(callback);
        registered = true;
        refreshNetwork();
        render();
        if (state.isLoading()) armTimeout();
    }

    private boolean connected() {
        NetworkCapabilities caps = connectivity.getNetworkCapabilities(connectivity.getActiveNetwork());
        return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }
    void refreshNetwork() {
        if (destroyed) return;
        boolean wasConnected = state.isConnected();
        boolean available = connected();
        boolean autoRetry = state.networkChanged(available);
        if (!available) {
            if (state.isLoaded()) { if (wasConnected) showNotice(); }
            else failFirstLoad();
        } else {
            if (notice != null) { notice.cancel(); notice = null; }
            if (autoRetry) retry();
        }
    }
    void started() {
        if (state.isLoaded() || destroyed) return;
        if (!connected()) { failFirstLoad(); return; }
        state.started(); render(); armTimeout();
    }
    void committed() {
        if (destroyed || !state.committed()) return;
        handler.removeCallbacks(timeout);
        overlay.setVisibility(View.GONE);
    }
    void failFirstLoad() {
        if (destroyed) return;
        if (state.isLoaded()) { web.stopLoading(); showNotice(); return; }
        state.failed();
        handler.removeCallbacks(timeout);
        web.stopLoading();
        render();
    }
    void retry() {
        if (destroyed) return;
        // Manual retry also rechecks connectivity; it never starts a retry loop.
        state.networkChanged(connected());
        if (!state.retry()) { render(); return; }
        render(); armTimeout();
        web.loadUrl(home);
    }
    private void armTimeout() {
        handler.removeCallbacks(timeout);
        handler.postDelayed(timeout,20000);
    }
    private void render() {
        overlay.setVisibility(state.showsOverlay() ? View.VISIBLE : View.GONE);
        message.setText(R.string.offline_message);
        detail.setText(R.string.offline_detail);
        retry.setEnabled(state.showsOverlay());
    }
    private void showNotice() {
        if (notice != null) notice.cancel();
        notice = Toast.makeText(activity,R.string.offline_message,Toast.LENGTH_SHORT);
        notice.show();
    }
    boolean blocksPage() { return !state.isLoaded(); }
    boolean hasInitialFailure() { return state.hasFailed(); }
    boolean allowNavigation() {
        if (state.isLoaded() && !connected()) { showNotice(); return false; }
        return true;
    }
    void setTopInset(int inset) { overlay.setPadding(0,inset,0,0); }
    void destroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        if (registered) { connectivity.unregisterNetworkCallback(callback); registered = false; }
        if (notice != null) { notice.cancel(); notice = null; }
    }
}
