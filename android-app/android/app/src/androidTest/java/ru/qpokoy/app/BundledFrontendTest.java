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
    private void fresh(WebView web) throws Exception {
        js(web,"window.__cacheSettled=false;qPokoyAndroidCache.refresh().then(()=>window.__cacheSettled=true)");
        await(web,"window.__cacheSettled");
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
            WebView web=web(scenario);await(web,"window.qPokoyAuth && qPokoyAuth.getUser() && qPokoyAndroidCache.canWrite && !document.body.classList.contains('qp-auth-locked')");
            fresh(web);
            js(web,"window.__auditBaseline=IncomeStore.load().length;window.__auditPrefix='ANDROID_BUNDLE_'+Date.now();window.__auditError='';"+
                "(async()=>{try{const c=await qPokoyApi.addCategory(window.__auditPrefix);window.__auditCategory=c.id;await qPokoyLoadCategories(qPokoyAuth.getUser());window.__auditCategoryReady=true;}catch(e){window.__auditError=e.message;}})()");
            try {
                await(web,"window.__auditCategoryReady || window.__auditError");
                assertEquals("\"\"",js(web,"window.__auditError"));
                js(web,"document.getElementById('openIncomeForm').click();document.getElementById('incomeAmount').value='983';document.getElementById('incomeCategory').value=window.__auditPrefix;document.getElementById('incomeDescription').value=window.__auditPrefix;document.getElementById('saveIncome').click()");
                await(web,"IncomeStore.load().some(r=>r.description===window.__auditPrefix)");
                js(web,"window.__auditIncome=IncomeStore.load().find(r=>r.description===window.__auditPrefix)?.id");
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
            js(web,"window.__logoutCacheHash=qPokoyAndroidCache.binding;document.getElementById('analyticsSettingsToggle').click();document.querySelector('[data-settings-tab-target=data]').click();document.getElementById('qpAuthLogoutBtn').click()");
            await(web,"document.querySelector('#qpConfirmOverlay [data-confirm-ok]')");
            js(web,"document.querySelector('#qpConfirmOverlay [data-confirm-ok]').click()");
            await(web,"document.body.classList.contains('qp-auth-locked') && !qPokoyApi.getToken() && !qPokoyAuth.getUser()");
            assertEquals("0",js(web,"IncomeStore.load().length"));
            assertEquals("true",js(web,"!localStorage.getItem('qPokoyYdbSessionTokenV1') && !localStorage.getItem('qPokoyBootstrapCacheV1')"));
            js(web,"Capacitor.nativePromise('QPokoyReadCache','read',{sessionHash:window.__logoutCacheHash}).then(r=>window.__cacheRemoved=r.snapshot===null)");
            await(web,"window.__cacheRemoved");
        }
    }
    @Test public void authenticatedReadCacheOfflineAndCrud() throws Exception {
        org.junit.Assume.assumeTrue("Permitted test-account cache test required",
            "true".equals(InstrumentationRegistry.getArguments().getString("cacheTest")));
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyAndroidCache?.canWrite && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-checking')");
            fresh(web);
            int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
            String prefix="ANDROID_READ_CACHE_"+System.currentTimeMillis();String literal=org.json.JSONObject.quote(prefix);
            js(web,"window.__cacheTestError='';(async()=>{try{const c=await qPokoyApi.addCategory("+literal+");window.__cacheCategory=c.id;await qPokoyLoadCategories(qPokoyAuth.getUser());const row=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-10',amount:983,category:"+literal+",description:"+literal+"});window.__cacheIncome=row.id;await qPokoyAndroidCache.refresh();window.__cacheTestReady=true;}catch(e){window.__cacheTestError=e.message;}})()");
            try{
                await(web,"window.__cacheTestReady || window.__cacheTestError");assertEquals("\"\"",js(web,"window.__cacheTestError"));
                String id=js(web,"window.__cacheIncome"),category=js(web,"window.__cacheCategory");
                AtomicReference<android.webkit.WebViewClient> client=new AtomicReference<>();
                instrumentation.runOnMainSync(()->client.set(web.getWebViewClient()));
                android.webkit.WebViewClient delegate=client.get();
                instrumentation.runOnMainSync(()->web.setWebViewClient(new android.webkit.WebViewClient(){
                    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
                        if("/bootstrap".equals(request.getUrl().getPath()))try{Thread.sleep(1500);}catch(InterruptedException e){Thread.currentThread().interrupt();}
                        return delegate.shouldInterceptRequest(view,request);
                    }
                    @Override public void onPageFinished(WebView view,String url){delegate.onPageFinished(view,url);}
                }));
                for(int run=0;run<3;run++){
                    js(web,"window.__cacheReload=true");long started=android.os.SystemClock.elapsedRealtime();instrumentation.runOnMainSync(web::reload);
                    await(web,"!window.__cacheReload && window.qPokoyAndroidCache?.metrics.cachedDisplay && !document.body.classList.contains('qp-auth-checking')");
                    long cached=android.os.SystemClock.elapsedRealtime()-started;
                    assertEquals("false",js(web,"Boolean(qPokoyAndroidCache.metrics.serverRefresh)"));
                    assertEquals("true",js(web,"IncomeStore.load().some(r=>r.id==="+id+") && qPokoyGetCategories().some(r=>r.name==="+literal+")"));
                    await(web,"qPokoyAndroidCache.metrics.serverRefresh");
                    System.out.println("READ_CACHE_START run="+run+" displayMs="+cached+" refreshMs="+(android.os.SystemClock.elapsedRealtime()-started));
                    assertEquals(String.valueOf(baseline+1),js(web,"IncomeStore.load().length"));
                }
                network(false);js(web,"window.__cacheReload=true");instrumentation.runOnMainSync(web::reload);
                await(web,"!window.__cacheReload && window.qPokoyAndroidCache?.metrics.cachedDisplay && !document.body.classList.contains('qp-auth-checking')");
                assertEquals("true",js(web,"IncomeStore.load().some(r=>r.id==="+id+") && qPokoyGetCategories().some(r=>r.name==="+literal+")"));
                js(web,"document.getElementById('incomeRecentHistory').click();document.getElementById('analyticsModeYear').click();document.getElementById('analyticsModeMonth').click();IncomeStore.update('offline-edit-denied',{date:'10.10.26',amount:1,category:'Test',description:'MUST_NOT_QUEUE'}).catch(()=>window.__offlineWriteBlocked=true)");
                await(web,"window.__offlineWriteBlocked");
                assertEquals("true",js(web,"!localStorage.getItem('qPokoyIncomeWriteJournalV1') && !IncomeStore.load().some(r=>r.description==='MUST_NOT_QUEUE')"));
                network(true);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.metrics.serverRefresh");
                js(web,"window.__cacheEdit=false;(async()=>{await qPokoyApi.updateIncome("+id+",{income_date:'2026-10-10',amount:984,category:"+literal+",description:"+literal+"});window.__cacheEdit=true;})()");await(web,"window.__cacheEdit");
                assertEquals("true",js(web,"qPokoyAndroidCache.snapshot.incomes.some(r=>r.id==="+id+" && r.amount===984)"));
                js(web,"window.__cacheDelete=false;(async()=>{await IncomeStore.remove("+id+");await qPokoyApi.deleteCategory("+category+");window.__cacheDelete=true;})()");await(web,"window.__cacheDelete");
                assertEquals("false",js(web,"qPokoyAndroidCache.snapshot.incomes.some(r=>r.id==="+id+")"));
            }finally{
                network(true);
                js(web,"window.__cacheCleanup=false;(async()=>{try{const rows=await qPokoyApi.listIncomes();for(const r of rows.filter(r=>r.description==="+literal+"))await qPokoyApi.deleteIncome(r.id);const cats=await qPokoyApi.listCategories();for(const c of cats.filter(c=>c.name==="+literal+"))await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__cacheCleanup=true;}catch(e){window.__cacheCleanupError=e.message;}})()");
                await(web,"window.__cacheCleanup || window.__cacheCleanupError");assertEquals("true",js(web,"window.__cacheCleanup"));
                assertEquals(String.valueOf(baseline),js(web,"IncomeStore.load().length"));
            }
        }
    }
    @Test public void readCacheWebViewScaleBenchmark() throws Exception {
        org.junit.Assume.assumeTrue("Explicit test-account synthetic read benchmark required",
            "true".equals(InstrumentationRegistry.getArguments().getString("cacheBenchmark")));
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyAndroidCache?.canWrite");fresh(web);
            String original=js(web,"qPokoyAndroidCache.snapshot"),hash=js(web,"qPokoyAndroidCache.binding");
            network(false);
            try{
                for(int count:new int[]{100,1000,5000,10000}){
                    // Fixture goes only into disposable local SQLite, never into the API.
                    js(web,"window.__fixtureSaved=false;(async()=>{const s="+original+";s.incomes=Array.from({length:"+count+"},(_,i)=>({id:'cache-benchmark-'+i,user_id:s.user.user_id,income_date:'2026-10-10',amount:i+1,category:'Cache benchmark',description:'CACHE_PERFORMANCE_ONLY_'+i}));await Capacitor.nativePromise('QPokoyReadCache','write',{sessionHash:"+hash+",snapshot:s});window.__fixtureSaved=true;})()");
                    await(web,"window.__fixtureSaved");
                    js(web,"window.__benchmarkReload=true");long started=android.os.SystemClock.elapsedRealtime();instrumentation.runOnMainSync(web::reload);
                    await(web,"!window.__benchmarkReload && window.qPokoyAndroidCache?.metrics.cachedDisplay && IncomeStore.load().length==="+count+" && !document.body.classList.contains('qp-auth-checking')");
                    System.out.println("READ_CACHE_WEBVIEW count="+count+" reloadDisplayMs="+(android.os.SystemClock.elapsedRealtime()-started)+" hydrationMs="+js(web,"Math.round(qPokoyAndroidCache.metrics.cachedDisplay-qPokoyAndroidCache.metrics.started)"));
                    assertEquals("false",js(web,"qPokoyAndroidCache.canWrite"));
                }
            }finally{
                js(web,"window.__fixtureRestored=false;Capacitor.nativePromise('QPokoyReadCache','write',{sessionHash:"+hash+",snapshot:"+original+"}).then(()=>window.__fixtureRestored=true)");
                await(web,"window.__fixtureRestored");network(true);await(web,"qPokoyAndroidCache.canWrite");fresh(web);
                assertEquals("false",js(web,"IncomeStore.load().some(r=>r.description.startsWith('CACHE_PERFORMANCE_ONLY_'))"));
            }
        }finally{network(true);}
    }
    // Run prepare, then host adb force-stop, then verify: real process cold start with radios off.
    @Test public void processColdReadCache() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("coldCachePhase");
        org.junit.Assume.assumeTrue("Explicit permitted test-account cold-cache phase required",phase!=null);
        final String label="ANDROID_READ_CACHE_COLD_20261010", literal=org.json.JSONObject.quote(label);
        network("prepare".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"window.qPokoyAndroidCache?.canWrite");
                js(web,"window.__prepared=false;(async()=>{const c=await qPokoyApi.addCategory("+literal+");await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-10',amount:987,category:"+literal+",description:"+literal+"});await qPokoyAndroidCache.refresh();window.__prepared=true;})()");
                await(web,"window.__prepared");
                assertEquals("true",js(web,"qPokoyAndroidCache.snapshot.incomes.some(r=>r.description==="+literal+")"));
                return;
            }
            try{
                await(web,"window.qPokoyAndroidCache?.metrics.cachedDisplay && !document.body.classList.contains('qp-auth-checking')");
                assertEquals("false",js(web,"Boolean(qPokoyAndroidCache.metrics.serverRefresh)"));
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length===1 && qPokoyGetCategories().some(r=>r.name==="+literal+")"));
                System.out.println("READ_CACHE_COLD displayMs="+js(web,"Math.round(qPokoyAndroidCache.metrics.cachedDisplay-qPokoyAndroidCache.metrics.started)"));
                js(web,"document.getElementById('incomeRecentHistory').click();document.getElementById('analyticsModeYear').click();document.getElementById('analyticsModeMonth').click();IncomeStore.update('offline-edit-denied',{date:'10.10.26',amount:1,category:'Test',description:'MUST_NOT_QUEUE'}).catch(()=>window.__blocked=true)");
                await(web,"window.__blocked");
                assertEquals("true",js(web,"!localStorage.getItem('qPokoyIncomeWriteJournalV1') && !IncomeStore.load().some(r=>r.description==='MUST_NOT_QUEUE')"));
                network(true);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.metrics.serverRefresh");
                assertEquals("1",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length"));
            }finally{
                network(true);await(web,"qPokoyAndroidCache.canWrite");
                js(web,"window.__cleaned=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__cleaned=true;})()");
                await(web,"window.__cleaned");assertEquals("false",js(web,"IncomeStore.load().some(r=>r.description==="+literal+") || qPokoyGetCategories().some(r=>r.name==="+literal+")"));
            }
        }finally{network(true);}
    }
    @Test public void offlineLostResponseReconcilesCloudUuid() throws Exception {
        org.junit.Assume.assumeTrue("Explicit permitted test-account lost response required",
            "true".equals(InstrumentationRegistry.getArguments().getString("outboxLostResponse")));
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.canWrite");fresh(web);
            assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));
            int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
            String literal=org.json.JSONObject.quote("ANDROID_LOST_REPLY_"+System.currentTimeMillis());
            js(web,"window.__lossReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__lossReady=true;})()");await(web,"window.__lossReady");
            network(false);await(web,"!navigator.onLine");
            js(web,"window.__lossAdded=false;IncomeStore.add({id:crypto.randomUUID(),date:'10.10.26',amount:719,category:"+literal+",description:"+literal+"}).then(()=>window.__lossAdded=true)");await(web,"window.__lossAdded");
            AtomicReference<android.webkit.WebViewClient> originalClient=new AtomicReference<>();
            instrumentation.runOnMainSync(()->originalClient.set(web.getWebViewClient()));
            android.webkit.WebViewClient delegate=originalClient.get();
            instrumentation.runOnMainSync(()->web.setWebViewClient(new android.webkit.WebViewClient(){
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
                    if(MainActivity.APP_ORIGIN.equals(request.getUrl().getScheme()+"://"+request.getUrl().getHost()) && "/js/api-client.js".equals(request.getUrl().getPath())){
                        try(java.io.InputStream input=instrumentation.getTargetContext().getAssets().open("public/js/api-client.js")){
                            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);
                            String shim="window.__originalFetch=window.fetch;window.__lostResponse=false;window.fetch=async(...args)=>{const response=await window.__originalFetch(...args);if(!window.__lostResponse && new URL(String(args[0]),location.href).pathname==='/incomes' && args[1]?.method==='POST' && response.ok){window.__lostResponse=true;throw new TypeError('TEST_LOST_RESPONSE');}return response;};\n";
                            return new android.webkit.WebResourceResponse("application/javascript","UTF-8",new java.io.ByteArrayInputStream((shim+output.toString("UTF-8")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                        }catch(Exception error){throw new AssertionError(error);}
                    }
                    return delegate.shouldInterceptRequest(view,request);
                }
                @Override public void onPageFinished(WebView view,String url){delegate.onPageFinished(view,url);}
            }));
            instrumentation.runOnMainSync(web::reload);await(web,"qPokoyAndroidCache?.displayed && qPokoyAndroidCache.pending.length===1 && !document.body.classList.contains('qp-auth-checking')");
            try{
                network(true);await(web,"window.__lostResponse && qPokoyAndroidCache.pending.length===1 && qPokoyAndroidCache.pending[0].error_code==='network'");
                js(web,"window.fetch=window.__originalFetch;window.__cloudOne=false;(async()=>{const id=qPokoyAndroidCache.pending[0].income_id;const rows=await qPokoyApi.listIncomes();window.__cloudOne=rows.filter(r=>r.id===id && r.description==="+literal+").length===1;await qPokoyAndroidCache.refresh();})()");
                await(web,"window.__cloudOne && qPokoyAndroidCache.pending.length===0");
                assertEquals("1",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length"));
            }finally{
                instrumentation.runOnMainSync(()->web.setWebViewClient(delegate));
                network(true);js(web,"window.fetch=window.__originalFetch;window.__lossClean=false;(async()=>{await qPokoyAndroidCache.refresh();for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__lossClean=true;})()");
                await(web,"window.__lossClean");assertEquals(String.valueOf(baseline),js(web,"IncomeStore.load().length"));
            }
        }
    }
    // Opt-in test-account only: host force-stop/reboot between prepare and verify.
    @Test public void durableOfflineCreates() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("outboxPhase");
        org.junit.Assume.assumeTrue("Explicit test-account outbox phase required",phase!=null);
        android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("outbox-test",0);
        network("prepare".equals(phase)||"sync".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"qPokoyAndroidCache?.canWrite && qPokoyAuth.getUser()");fresh(web);
                assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));
                String label="ANDROID_OUTBOX_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);
                int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
                js(web,"window.__outboxReady=false;(async()=>{const c=await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__outboxReady=true;})()");await(web,"window.__outboxReady");
                assertTrue(meta.edit().putString("label",label).putInt("baseline",baseline).commit());
                network(false);await(web,"!navigator.onLine");
                for(int i=1;i<=3;i++){
                    js(web,"document.querySelector('.add-income-btn').click();document.getElementById('incomeDate').value='10.10.26';document.getElementById('incomeAmount').value='"+(710+i)+"';document.getElementById('incomeCategory').value="+literal+";document.getElementById('incomeDescription').value="+literal+";document.getElementById('saveIncome').click()");
                    await(web,"qPokoyAndroidCache.pending.length==="+i+" && document.getElementById('incomeForm').hidden");
                }
                assertEquals(String.valueOf(baseline+3),js(web,"IncomeStore.load().length"));
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").reduce((s,r)=>s+r.amount,0)===2136 && !qPokoyAndroidCache.snapshot.incomes.some(r=>r.description==="+literal+")"));
                js(web,"window.__logoutBlocked=false;qPokoyApi.logout().catch(e=>window.__logoutBlocked=e.code==='android_pending_logout')");await(web,"window.__logoutBlocked");
                assertEquals("true",js(web,"Boolean(qPokoyApi.getToken())"));
                return; // Keep radios off and SQLite pending for the host cold-start/reboot.
            }
            String label=meta.getString("label",null);assertNotNull(label);String literal=org.json.JSONObject.quote(label);
            await(web,"qPokoyAndroidCache?.displayed && !document.body.classList.contains('qp-auth-checking')");
            if(!"sync".equals(phase)){
                assertEquals("3",js(web,"qPokoyAndroidCache.pending.length"));
                assertEquals(String.valueOf(meta.getInt("baseline",0)+3),js(web,"IncomeStore.load().length"));
                js(web,"document.getElementById('incomeRecentHistory').click();document.getElementById('analyticsModeYear').click();document.getElementById('analyticsModeMonth').click()");
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length===3 && document.querySelectorAll('[data-android-pending]').length>=3"));
                return;
            }
            await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
            js(web,"window.__outboxConfirmed=false;(async()=>{const rows=(await qPokoyApi.listIncomes()).filter(r=>r.description==="+literal+");window.__outboxConfirmed=rows.length===3 && new Set(rows.map(r=>r.id)).size===3 && rows.reduce((s,r)=>s+r.amount,0)===2136;})()");await(web,"window.__outboxConfirmed");
            assertEquals("0",js(web,"document.querySelectorAll('[data-android-pending]').length"));
            js(web,"window.__outboxClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__outboxClean=true;})()");await(web,"window.__outboxClean");
            assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));
            instrumentation.runOnMainSync(web::reload);await(web,"qPokoyAndroidCache?.canWrite");
            assertEquals("false",js(web,"IncomeStore.load().some(r=>r.description==="+literal+")"));meta.edit().clear().commit();
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
