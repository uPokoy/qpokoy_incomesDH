package ru.qpokoy.app;

import android.app.Instrumentation;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.os.ParcelFileDescriptor;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.io.FileInputStream;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class BundledFrontendTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private void network(boolean enabled) throws Exception {
        for(String radio:new String[]{"wifi","data"}) {
            try(ParcelFileDescriptor descriptor=instrumentation.getUiAutomation().executeShellCommand("svc "+radio+(enabled?" enable":" disable"));
                FileInputStream input=new FileInputStream(descriptor.getFileDescriptor())) {
                byte[] buffer=new byte[256];while(input.read(buffer)!=-1){}
            }
        }
        ConnectivityManager manager=(ConnectivityManager)instrumentation.getTargetContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        long end=System.currentTimeMillis()+15000;
        while(System.currentTimeMillis()<end){
            NetworkCapabilities caps=manager.getNetworkCapabilities(manager.getActiveNetwork());
            if((caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))==enabled)return;
            Thread.sleep(100);
        }
        fail("Emulator network did not become "+enabled);
    }
    private WebView web(ActivityScenario<MainActivity> scenario){
        AtomicReference<WebView> result=new AtomicReference<>();
        scenario.onActivity(activity->result.set(activity.getBridge().getWebView()));return result.get();
    }
    private String js(WebView web,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        instrumentation.runOnMainSync(()->web.evaluateJavascript(script,value->{result.set(value);done.countDown();}));
        assertTrue(done.await(5,TimeUnit.SECONDS));return result.get();
    }
    private void await(WebView web,String expression) throws Exception {
        long end=System.currentTimeMillis()+20000;
        while(System.currentTimeMillis()<end){if("true".equals(js(web,"Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("Local document timeout: "+expression);
    }
    @Test public void authUiValidationAndYandexStayOnLocalOrigin() throws Exception {
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyApi && window.qPokoyAuth && window.qPokoyAndroidAdapter");
            org.junit.Assume.assumeTrue("Do not disturb an authenticated account","false".equals(js(web,"Boolean(qPokoyApi.getToken())")));
            js(web,"qPokoyApi.login('android-cors-probe@invalid.example','NotARealAccount_'+Date.now()).catch(e=>window.__loginStatus=e.status)");
            await(web,"window.__loginStatus");
            assertEquals("401",js(web,"window.__loginStatus")); // POST preflight and real auth error readable locally.
            js(web,"qPokoyAuth.setMode('signup');document.getElementById('qpAuthSignupSubmit').click()");
            assertEquals("true",js(web,"!document.getElementById('qpAuthSignupForm').checkValidity()"));
            js(web,"qPokoyAuth.setMode('login');document.getElementById('qpAuthYandex').click()");
            await(web,"document.getElementById('qpAuthMessage').textContent.includes('Android')");
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
            js(web,"document.getElementById('qpAuthEmail').scrollIntoView({block:'center'})");
            org.json.JSONArray position=new org.json.JSONArray(js(web,"(()=>{const r=document.getElementById('qpAuthEmail').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth]})()"));
            int[] origin=new int[2];instrumentation.runOnMainSync(()->web.getLocationOnScreen(origin));
            float scale=web.getWidth()/(float)position.getDouble(2);
            float x=origin[0]+(float)position.getDouble(0)*scale,y=origin[1]+(float)position.getDouble(1)*scale;
            long now=android.os.SystemClock.uptimeMillis();
            android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,x,y,0);
            android.view.MotionEvent up=android.view.MotionEvent.obtain(now,now+50,android.view.MotionEvent.ACTION_UP,x,y,0);
            down.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);up.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
            try{instrumentation.getUiAutomation().injectInputEvent(down,true);instrumentation.getUiAutomation().injectInputEvent(up,true);}
            finally{down.recycle();up.recycle();}
            java.util.concurrent.atomic.AtomicBoolean keyboard=new java.util.concurrent.atomic.AtomicBoolean();
            for(int i=0;i<30&&!keyboard.get();i++){
                scenario.onActivity(activity->{
                    androidx.core.view.WindowInsetsCompat insets=androidx.core.view.ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
                    keyboard.set(insets!=null&&insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()));
                });Thread.sleep(100);
            }
            assertTrue("Keyboard did not open",keyboard.get());
            assertEquals("\"qpAuthEmail\"",js(web,"document.activeElement.id"));
            instrumentation.getUiAutomation().injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_DOWN,android.view.KeyEvent.KEYCODE_BACK),true);
            instrumentation.getUiAutomation().injectInputEvent(new android.view.KeyEvent(android.view.KeyEvent.ACTION_UP,android.view.KeyEvent.KEYCODE_BACK),true);
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
        }
    }
    // Run explicitly only after the human signs into a permitted TEST account.
    @Test public void authenticatedSessionRestored() throws Exception {
        org.junit.Assume.assumeTrue("Manual test-account login required",
            "true".equals(InstrumentationRegistry.getArguments().getString("authenticated")));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            await(web,"window.IncomeStore && window.qPokoyAuth && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-locked')");
            js(web,"qPokoyApi.listIncomes().then(rows=>{window.__sessionCount=rows.length;window.__sessionIdsUnique=new Set(rows.map(r=>String(r.id))).size===rows.length;window.__sessionNoTestRows=!rows.some(r=>(r.description||'').startsWith('ANDROID_BUNDLE_'));}).catch(e=>window.__sessionError=e.message)");
            await(web,"window.__sessionCount!==undefined || window.__sessionError");
            assertEquals(js(web,"window.__sessionCount"),js(web,"IncomeStore.load().length"));
            assertEquals("true",js(web,"window.__sessionIdsUnique && window.__sessionNoTestRows"));
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
        }
    }
    @Test public void authenticatedUiCrudAndReload() throws Exception {
        org.junit.Assume.assumeTrue("Manual test-account login required",
            "true".equals(InstrumentationRegistry.getArguments().getString("authenticated")));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyAuth && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-locked')");
            js(web,"window.__auditBaseline=IncomeStore.load().length;window.__auditPrefix='ANDROID_BUNDLE_'+Date.now();window.__auditError='';"+
                "(async()=>{try{const c=await qPokoyApi.addCategory(window.__auditPrefix);window.__auditCategory=c.id;await qPokoyLoadCategories(qPokoyAuth.getUser());window.__auditCategoryReady=true;}catch(e){window.__auditError=e.message;}})()");
            try {
                await(web,"window.__auditCategoryReady || window.__auditError");
                assertEquals("\"\"",js(web,"window.__auditError"));
                js(web,"document.getElementById('openIncomeForm').click();document.getElementById('incomeAmount').value='983';document.getElementById('incomeCategory').value=window.__auditPrefix;document.getElementById('incomeDescription').value=window.__auditPrefix;document.getElementById('saveIncome').click();window.__auditIncome=IncomeStore.load().find(r=>r.description===window.__auditPrefix)?.id");
                assertEquals("true",js(web,"Boolean(window.__auditIncome)"));
                pollIncome(web,983);
                js(web,"document.querySelector('.edit-income[data-id=\"'+window.__auditIncome+'\"]').click();document.getElementById('incomeAmount').value='984';document.getElementById('saveIncome').click()");
                pollIncome(web,984);
                js(web,"window.__auditMonth=document.getElementById('monthSwitcherName').textContent;document.getElementById('monthPrev').click();document.getElementById('monthNext').click()");
                assertEquals("true",js(web,"window.__auditMonth===document.getElementById('monthSwitcherName').textContent"));
                js(web,"document.getElementById('analyticsModeYear').click();document.getElementById('analyticsModeMonth').click();document.getElementById('incomeRecentHistory').click();document.getElementById('analyticsSettingsToggle').click()");
                for(String tab:new String[]{"categories","appearance","data"}){
                    js(web,"document.querySelector('[data-settings-tab-target="+tab+"]').click()");
                    assertEquals("\""+tab+"\"",js(web,"document.getElementById('settings').dataset.settingsTab"));
                }
                scenario.onActivity(activity->activity.getOnBackPressedDispatcher().onBackPressed());
                assertEquals("\"false\"",js(web,"document.getElementById('analyticsSettingsToggle').getAttribute('aria-expanded')"));
            } finally {
                js(web,"window.__auditCleanup=false;window.__auditError='';(async()=>{let error='';try{if(window.__auditIncome && !await IncomeStore.remove(window.__auditIncome))error='Income cleanup failed';}catch(e){error=e.message;}try{if(window.__auditCategory)await qPokoyApi.deleteCategory(window.__auditCategory);}catch(e){error=e.message;}if(error)window.__auditError=error;else window.__auditCleanup=true;})()");
                await(web,"window.__auditCleanup || window.__auditError");
                assertEquals("true",js(web,"window.__auditCleanup"));
            }
            int baseline=Integer.parseInt(js(web,"window.__auditBaseline"));
            String prefix=js(web,"window.__auditPrefix");
            js(web,"window.__auditReloadMarker=true");
            instrumentation.runOnMainSync(web::reload);
            await(web,"!window.__auditReloadMarker && window.IncomeStore && window.qPokoyAuth && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-locked')");
            assertEquals(String.valueOf(baseline),js(web,"IncomeStore.load().length"));
            assertEquals("false",js(web,"(()=>{try{return IncomeStore.load().some(r=>r.description==="+prefix+");}catch(e){return String(e)}})()"));
        }
    }
    private void pollIncome(WebView web,int amount) throws Exception {
        js(web,"window.__auditSynced=false;window.__auditError='';(async()=>{try{for(let i=0;i<30;i++){const rows=await qPokoyApi.listIncomes();if(rows.filter(r=>r.id===window.__auditIncome && r.amount==="+amount+").length===1){window.__auditSynced=true;return;}await new Promise(r=>setTimeout(r,300));}window.__auditError='Income not synced';}catch(e){window.__auditError=e.message;}})()");
        await(web,"window.__auditSynced || window.__auditError");
        assertEquals("true",js(web,"window.__auditSynced"));
    }
    @Test public void authenticatedLogoutClearsLocalState() throws Exception {
        org.junit.Assume.assumeTrue("Explicit test-account logout required",
            "true".equals(InstrumentationRegistry.getArguments().getString("logout")));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            await(web,"window.IncomeStore && window.qPokoyAuth && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-locked')");
            js(web,"document.getElementById('analyticsSettingsToggle').click();document.querySelector('[data-settings-tab-target=data]').click();document.getElementById('qpAuthLogoutBtn').click()");
            await(web,"document.querySelector('#qpConfirmOverlay [data-confirm-ok]')");
            js(web,"document.querySelector('#qpConfirmOverlay [data-confirm-ok]').click()");
            await(web,"document.body.classList.contains('qp-auth-locked') && !qPokoyApi.getToken() && !qPokoyAuth.getUser()");
            assertEquals("0",js(web,"IncomeStore.load().length"));
            assertEquals("true",js(web,"!localStorage.getItem('qPokoyYdbSessionTokenV1') && !localStorage.getItem('qPokoyBootstrapCacheV1')"));
        }
    }
    @Test public void coldOfflineLoadsLocalUiAndAllInternalPages() throws Exception {
        network(false);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            await(web,"window.qPokoyAndroidAdapter && document.getElementById('qpAuthGate')");
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
            assertEquals("0",js(web,"document.querySelectorAll('link[rel=manifest]').length"));
            assertEquals("0",js(web,"document.querySelectorAll('#qpokoyOfflineOverlay').length"));
            js(web,"fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me').catch(e=>window.__offlineError=e.message)");
            await(web,"window.__offlineError && window.__offlineError.includes('интернет')");
            for(String page:new String[]{"pricing.html","service.html","privacy.html","offer.html","about.html"}){
                instrumentation.runOnMainSync(()->web.loadUrl(MainActivity.APP_ORIGIN+"/"+page));
                await(web,"location.pathname==='/"+page+"' && window.qPokoyAndroidAdapter");
                assertEquals("true",js(web,"document.body.innerText.length>100"));
            }
        } finally{network(true);}
    }
    @Test public void apiCorsAndNetworkRecoveryDoNotNeedRestart() throws Exception {
        network(false);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyApi && window.qPokoyAndroidAdapter");
            network(true);
            js(web,"fetch('https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/me').then(r=>window.__apiStatus=r.status).catch(e=>window.__apiError=e.message)");
            await(web,"window.__apiStatus || window.__apiError");
            assertEquals("401",js(web,"window.__apiStatus")); // Real response readable through CORS, no user data.
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
        } finally{network(true);}
    }
    @Test public void reportUsesBundledPdfLibraryWithoutInternet() throws Exception {
        network(false);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyAndroidAdapter");
            String html="<html><head><script src='https://localhost/vendor/html2pdf.bundle.min.js'></script></head><body><table><tr><td>Bundled PDF 123 RUB</td></tr></table></body></html>";
            scenario.onActivity(activity->{
                try{java.lang.reflect.Method method=MainActivity.class.getDeclaredMethod("openReport",String.class);method.setAccessible(true);method.invoke(activity,html);}
                catch(Exception error){throw new AssertionError(error);}
            });
            AtomicReference<WebView> report=new AtomicReference<>();
            scenario.onActivity(activity->{
                try{java.lang.reflect.Field field=MainActivity.class.getDeclaredField("reportView");field.setAccessible(true);report.set((WebView)field.get(activity));}
                catch(Exception error){throw new AssertionError(error);}
            });
            await(report.get(),"window.html2pdf && window.qPokoyAndroidAdapter");
            js(report.get(),"html2pdf().from(document.querySelector('table')).outputPdf('datauristring').then(v=>window.__pdf=v).catch(e=>window.__pdfError=String(e))");
            await(report.get(),"window.__pdf || window.__pdfError");
            assertEquals("true",js(report.get(),"window.__pdf && window.__pdf.includes('JVBER') && window.__pdf.length>1000"));
            scenario.onActivity(activity->activity.getOnBackPressedDispatcher().onBackPressed());
            assertEquals("\"https://localhost\"",js(web,"location.origin"));
        } finally{network(true);}
    }
}
