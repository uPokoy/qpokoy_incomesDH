package ru.qpokoy.app;

import android.app.Instrumentation;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.ParcelFileDescriptor;
import android.view.View;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.FileInputStream;
import static org.junit.Assert.*;

/** Emulator tests control network locally and restore it after each offline scenario. */
@RunWith(AndroidJUnit4.class)
public class OfflineGuardTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();

    private void network(boolean enabled) throws Exception {
        for(String radio:new String[]{"wifi","data"}) {
            try(ParcelFileDescriptor descriptor=instrumentation.getUiAutomation().executeShellCommand("svc "+radio+(enabled?" enable":" disable"));
                FileInputStream input=new FileInputStream(descriptor.getFileDescriptor())) {
                byte[] buffer=new byte[256]; while(input.read(buffer)!=-1) {}
            }
        }
        ConnectivityManager manager=(ConnectivityManager)instrumentation.getTargetContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        long end=System.currentTimeMillis()+15000;
        while(System.currentTimeMillis()<end) {
            NetworkCapabilities caps=manager.getNetworkCapabilities(manager.getActiveNetwork());
            boolean connected=caps!=null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            if(connected==enabled)return;
            Thread.sleep(100);
        }
        fail("Emulator network did not become "+enabled);
    }
    private String javascript(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);
        AtomicReference<String> result=new AtomicReference<>();
        scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue("WebView callback timeout",done.await(5,TimeUnit.SECONDS));
        return result.get();
    }

    private void waitFor(ActivityScenario<MainActivity> scenario, boolean visible) throws Exception {
        long end = System.currentTimeMillis()+25000;
        AtomicBoolean matched = new AtomicBoolean();
        while(System.currentTimeMillis()<end) {
            scenario.onActivity(activity -> matched.set(
                (activity.findViewById(R.id.qpokoyOfflineOverlay).getVisibility()==View.VISIBLE)==visible
                && (visible || !guard(activity).blocksPage())));
            if(matched.get()) return;
            Thread.sleep(100);
        }
        fail("Native offline overlay visibility did not become "+visible);
    }
    private OfflineGuard guard(MainActivity activity) {
        try {
            java.lang.reflect.Field field=MainActivity.class.getDeclaredField("offline");
            field.setAccessible(true);return (OfflineGuard)field.get(activity);
        } catch(Exception error) { throw new AssertionError(error); }
    }
    @Test public void pendingOnlineLoadStaysDarkWithoutOverlayUntilFailure() throws Exception {
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                android.webkit.WebView web=new android.webkit.WebView(activity);
                OfflineGuard pending=new OfflineGuard(activity,web,"https://qpokoy.ru/");
                View overlay=activity.findViewById(android.R.id.content);
                overlay=((android.view.ViewGroup)overlay).getChildAt(((android.view.ViewGroup)overlay).getChildCount()-1);
                try {
                    assertEquals(View.GONE,overlay.getVisibility());
                    pending.started(); // No document has committed: slow first load.
                    assertEquals(View.GONE,overlay.getVisibility());
                    android.graphics.Bitmap pixels=android.graphics.Bitmap.createBitmap(64,64,android.graphics.Bitmap.Config.ARGB_8888);
                    web.layout(0,0,64,64);
                    web.draw(new android.graphics.Canvas(pixels));
                    assertEquals(android.graphics.Color.rgb(7,12,20),pixels.getPixel(32,32));
                    pixels.recycle();
                    pending.failFirstLoad(); // Same path used by timeout / main-frame errors.
                    assertEquals(View.VISIBLE,overlay.getVisibility());
                    assertEquals("Нет подключения к интернету",((TextView)overlay.findViewById(R.id.offlineMessage)).getText().toString());
                } finally {
                    pending.destroy();
                    ((android.view.ViewGroup)overlay.getParent()).removeView(overlay);
                    web.destroy();
                }
            });
        }
    }
    @Test public void normalAndRepeatedStartupNeverShowOfflineOverlay() throws Exception {
        network(true);
        for(int launch=0;launch<2;launch++) {
            try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
                AtomicBoolean loaded=new AtomicBoolean();
                long end=System.currentTimeMillis()+25000;
                while(!loaded.get() && System.currentTimeMillis()<end) {
                    scenario.onActivity(activity -> {
                        assertEquals(View.GONE,activity.findViewById(R.id.qpokoyOfflineOverlay).getVisibility());
                        loaded.set(!guard(activity).blocksPage());
                    });
                    Thread.sleep(50);
                }
                assertTrue("Online document never committed",loaded.get());
            }
        }
    }
    @Test public void coldOfflineAndRetry() throws Exception {
        network(false);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario,true);
            scenario.onActivity(activity -> {
                assertEquals("Нет подключения к интернету",((TextView)activity.findViewById(R.id.offlineMessage)).getText().toString());
                activity.findViewById(R.id.offlineRetry).performClick();
                assertEquals(View.VISIBLE,activity.findViewById(R.id.qpokoyOfflineOverlay).getVisibility());
                assertEquals("Нет подключения к интернету",((TextView)activity.findViewById(R.id.offlineMessage)).getText().toString());
            });
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            waitFor(scenario,true);
            scenario.recreate();
            waitFor(scenario,true);
        } finally { network(true); }
    }
    @Test public void onlineAndMainFrameErrorPreservesLoadedView() throws Exception {
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario,false);
            AtomicBoolean same = new AtomicBoolean();
            scenario.onActivity(activity -> {
                android.webkit.WebView web=activity.getBridge().getWebView();
                String url=web.getUrl();
                OfflineGuard guard=guard(activity);
                guard.failFirstLoad(); // No clear, errorPath load or blocking overlay after success.
                same.set(url.equals(web.getUrl()));
                assertFalse(guard.blocksPage());
            });
            assertTrue(same.get());
        }
    }
    @Test public void automaticRecoveryThenNetworkLossKeepsSameDocument() throws Exception {
        network(false);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            waitFor(scenario,true);
            AtomicReference<MainActivity> original=new AtomicReference<>();
            scenario.onActivity(original::set);
            network(true);
            waitFor(scenario,false);
            scenario.onActivity(activity->assertSame("Recovery recreated Activity",original.get(),activity));
            assertEquals("1",javascript(scenario,"window.__qpAndroidOfflineTest=1;1"));
            network(false);
            scenario.onActivity(activity->assertEquals(View.GONE,activity.findViewById(R.id.qpokoyOfflineOverlay).getVisibility()));
            assertEquals("1",javascript(scenario,"window.__qpAndroidOfflineTest"));
            network(true);
            assertEquals("1",javascript(scenario,"window.__qpAndroidOfflineTest"));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);
            assertEquals("1",javascript(scenario,"window.__qpAndroidOfflineTest"));
            scenario.onActivity(activity->activity.getOnBackPressedDispatcher().onBackPressed());
            assertEquals("1",javascript(scenario,"window.__qpAndroidOfflineTest"));
        } finally { network(true); }
    }
}
