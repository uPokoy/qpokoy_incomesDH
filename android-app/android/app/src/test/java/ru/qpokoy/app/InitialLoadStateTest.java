package ru.qpokoy.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class InitialLoadStateTest {
    @Test public void overlayIsOnlyForFailureNotLoadingOrSuccess() {
        InitialLoadState state = new InitialLoadState();
        assertTrue(state.isLoading());
        assertFalse(state.showsOverlay());
        state.networkChanged(true); state.started();
        assertFalse(state.showsOverlay());
        state.failed();
        assertTrue(state.showsOverlay());
        assertTrue(state.retry());
        assertFalse(state.showsOverlay());
        assertTrue(state.committed());
        assertFalse(state.showsOverlay());
    }
    @Test public void coldOfflineCannotRetryUntilNetworkReturns() {
        InitialLoadState state = new InitialLoadState();
        state.failed();
        assertFalse(state.retry());
        assertTrue(state.hasFailed());
        assertTrue(state.showsOverlay());
        assertTrue(state.networkChanged(true));
        assertTrue(state.retry());
        assertTrue(state.isLoading());
        assertTrue(state.committed());
    }
    @Test public void failedMainFrameCannotBeMistakenForCommittedContent() {
        InitialLoadState state = new InitialLoadState();
        state.failed();
        assertFalse(state.committed());
        assertFalse(state.isLoaded());
    }
    @Test public void successNeverBecomesBlockingOfflineOrReloadsOnConnectivityChanges() {
        InitialLoadState state = new InitialLoadState();
        state.networkChanged(true);
        assertTrue(state.committed());
        state.failed(); state.started();
        assertTrue(state.isLoaded());
        assertFalse(state.hasFailed());
        assertFalse(state.isLoading());
        assertFalse(state.networkChanged(false));
        assertFalse(state.networkChanged(true));
        assertFalse(state.retry());
    }
    @Test public void repeatedNetworkCallbacksDoNotCauseReloadLoop() {
        InitialLoadState state = new InitialLoadState();
        state.failed();
        assertTrue(state.networkChanged(true));
        assertTrue(state.retry());
        assertFalse(state.networkChanged(true));
        assertFalse(state.retry());
        state.failed();
        assertFalse(state.networkChanged(true));
        assertFalse(state.networkChanged(true));
        assertTrue(state.retry()); // An explicit tap is still allowed.
    }
    @Test public void pendingFirstLoadCanFailOnLossAndRecoverOnce() {
        InitialLoadState state = new InitialLoadState();
        state.networkChanged(true);
        state.networkChanged(false); state.failed();
        assertFalse(state.committed());
        assertTrue(state.networkChanged(true));
        assertTrue(state.retry());
        assertFalse(state.retry());
        assertTrue(state.committed());
    }
}
