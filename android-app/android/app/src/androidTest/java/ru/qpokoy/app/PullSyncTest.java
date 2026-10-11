package ru.qpokoy.app;

import android.os.SystemClock;
import android.view.MotionEvent;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real native gesture/bridge test. Isolated HTML, no account or server writes. */
@RunWith(AndroidJUnit4.class)
public class PullSyncTest {
    private String js(ActivityScenario<MainActivity> scenario,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        scenario.onActivity(a->a.getBridge().getWebView().evaluateJavascript(script,v->{value.set(v);done.countDown();}));
        assertTrue("JS callback",done.await(5,TimeUnit.SECONDS));return value.get();
    }
    private void waitFor(ActivityScenario<MainActivity> scenario,String expression) throws Exception {
        long end=SystemClock.uptimeMillis()+10000;
        while(SystemClock.uptimeMillis()<end){if("true".equals(js(scenario,expression)))return;SystemClock.sleep(100);}
        fail("Timed out: "+expression);
    }
    private void waitForNativePull(ActivityScenario<MainActivity> scenario) {
        long end=SystemClock.uptimeMillis()+5000;
        while(SystemClock.uptimeMillis()<end){
            AtomicReference<Boolean> allowed=new AtomicReference<>(false);
            scenario.onActivity(a->allowed.set(!((SyncSwipeRefreshLayout)a.getBridge().getWebView().getParent()).canChildScrollUp()));
            if(allowed.get())return;SystemClock.sleep(100);
        }
        fail("Native pull not ready");
    }
    private void gesture(ActivityScenario<MainActivity> scenario,boolean horizontal) {
        int[] box=new int[4];
        scenario.onActivity(a->{WebView w=a.getBridge().getWebView();w.getLocationOnScreen(box);box[2]=w.getWidth();box[3]=w.getHeight();});
        float x=box[0]+box[2]*.65f,y=box[1]+box[3]*.22f;
        float dx=horizontal?-box[2]*.45f:0,dy=horizontal?4:box[3]*.52f;
        long down=SystemClock.uptimeMillis();
        for(int i=0;i<=16;i++){
            int action=i==0?MotionEvent.ACTION_DOWN:i==16?MotionEvent.ACTION_UP:MotionEvent.ACTION_MOVE;
            float p=Math.min(i,15)/15f;
            MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x+dx*p,y+dy*p,0);
            InstrumentationRegistry.getInstrumentation().sendPointerSync(event);event.recycle();SystemClock.sleep(24);
        }
    }
    @Test public void nativePullKeepsPageAndDoesNotInterceptHorizontalScroll() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            waitFor(scenario,"document.readyState==='complete' && Boolean(window.qPokoyAndroidAdapter)");
            scenario.onActivity(a->a.getBridge().getWebView().loadDataWithBaseURL(MainActivity.APP_ORIGIN+"/index.html",
                "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'><style>body{margin:0;height:2200px;background:#07101c;color:white}</style></head><body><div id='marker'>isolated pull test</div><div id='incomeForm' hidden></div><script>window.calls=0;window.result='done';window.qPokoyAuth={getUser:()=>({})};window.qPokoyAndroidCache={displayed:true,manualSync:async()=>{calls++;return result;}};</script></body></html>","text/html","UTF-8",MainActivity.APP_ORIGIN+"/index.html"));
            waitFor(scenario,"Boolean(window.qPokoyAndroidAdapter && document.getElementById('marker'))");
            SystemClock.sleep(250);
            scenario.onActivity(a->{WebView w=a.getBridge().getWebView();assertTrue(w.getParent() instanceof SyncSwipeRefreshLayout);assertEquals(0,((SyncSwipeRefreshLayout)w.getParent()).getPaddingTop());});
            waitForNativePull(scenario);
            gesture(scenario,true);SystemClock.sleep(250);assertEquals("0",js(scenario,"calls"));
            js(scenario,"scrollTo(0,0)");SystemClock.sleep(150);
            waitForNativePull(scenario);
            gesture(scenario,false);waitFor(scenario,"calls===1");
            assertEquals("\"isolated pull test\"",js(scenario,"document.getElementById('marker').textContent"));
            assertEquals("\"/index.html\"",js(scenario,"location.pathname"));
            SystemClock.sleep(400);
            scenario.onActivity(a->assertFalse(((SyncSwipeRefreshLayout)a.getBridge().getWebView().getParent()).isRefreshing()));
            js(scenario,"result='offline'");gesture(scenario,false);waitFor(scenario,"calls===2");SystemClock.sleep(400);
            scenario.onActivity(a->assertFalse(((SyncSwipeRefreshLayout)a.getBridge().getWebView().getParent()).isRefreshing()));
            js(scenario,"document.getElementById('incomeForm').hidden=false");SystemClock.sleep(150);
            gesture(scenario,false);assertEquals("2",js(scenario,"calls"));
            js(scenario,"document.getElementById('incomeForm').hidden=true;scrollTo(0,500)");SystemClock.sleep(150);
            gesture(scenario,false);assertEquals("2",js(scenario,"calls"));
        }
    }
}
