package ru.qpokoy.app;

/** Only the first document load owns the blocking offline screen. */
final class InitialLoadState {
    private boolean loaded;
    private boolean loading = true;
    private boolean failed;
    private boolean connected;

    boolean isLoaded() { return loaded; }
    boolean isLoading() { return loading; }
    boolean hasFailed() { return failed; }
    boolean showsOverlay() { return !loaded && failed; }
    boolean isConnected() { return connected; }

    void started() {
        if (!loaded) { loading = true; failed = false; }
    }
    void failed() {
        if (!loaded) { loading = false; failed = true; }
    }
    boolean committed() {
        if (loaded || !loading || failed) return false;
        loaded = true; loading = false;
        return true;
    }
    boolean networkChanged(boolean available) {
        boolean restored = available && !connected;
        connected = available;
        return restored && !loaded && !loading;
    }
    boolean retry() {
        if (loaded || loading) return false;
        if (!connected) { failed(); return false; }
        started(); return true;
    }
}
