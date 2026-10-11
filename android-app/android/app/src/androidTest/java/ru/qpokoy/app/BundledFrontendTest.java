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
        assertTrue("WebView evaluation callback unavailable",done.await(15,TimeUnit.SECONDS));return result.get();
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
                await(web,"!qPokoyAndroidCache.pending.some(r=>r.income_id===window.__auditIncome)");
                js(web,"document.querySelector('.edit-income[data-id=\"'+window.__auditIncome+'\"]').click();document.getElementById('incomeAmount').value='984';document.getElementById('saveIncome').click()");
                pollIncome(web,984);
                await(web,"!qPokoyAndroidCache.pending.some(r=>r.income_id===window.__auditIncome)");
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
                js(web,"window.__auditCleanup=false;window.__auditError='';(async()=>{let error='';try{if(window.__auditIncome){if(!await IncomeStore.remove(window.__auditIncome))error='Income cleanup failed';for(let i=0;i<100&&qPokoyAndroidCache.pending.some(r=>r.income_id===window.__auditIncome);i++)await new Promise(r=>setTimeout(r,200));if(qPokoyAndroidCache.pending.some(r=>r.income_id===window.__auditIncome))error='Income cleanup still pending';}}catch(e){error='income:'+e.status+':'+e.message;}try{if(window.__auditCategory)await qPokoyApi.deleteCategory(window.__auditCategory);}catch(e){error+=' category:'+e.status+':'+e.message;}if(error)window.__auditError=error;else window.__auditCleanup=true;})()");
                await(web,"window.__auditCleanup || window.__auditError");
                System.out.println("CRUD_CLEANUP_STATE="+js(web,"JSON.stringify({error:window.__auditError,pending:qPokoyAndroidCache.pending.length,canWrite:qPokoyAndroidCache.canWrite,diagnostic:qPokoyAndroidCache.diagnostic})"));
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

    @Test public void cleanupAbandonedCrudFixture() throws Exception {
        String since=InstrumentationRegistry.getArguments().getString("cleanupSince");org.junit.Assume.assumeTrue("Explicit cleanup of this run's TEST fixtures",since!=null);
        long cutoff=Long.parseLong(since);network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");fresh(web);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
            js(web,"window.__abandonedClean=false;(async()=>{const own=name=>{const m=/^ANDROID_(?:BUNDLE|EDIT_ONLINE|EDIT|DELETE_UPGRADE|DELETE_SINGLE|DELETE_ONLINE|DELETE)_([0-9]+)(?:_B| before)?$/.exec(name);return m&&Number(m[1])>="+cutoff+"};for(const r of await qPokoyApi.listIncomes())if(own(r.description))await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(own(c.name))await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__abandonedClean=true;})()");await(web,"window.__abandonedClean");fresh(web);
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
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");fresh(web);await(web,"qPokoyAndroidCache.canWrite");
            assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));
            int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
            String literal=org.json.JSONObject.quote("ANDROID_LOST_REPLY_"+System.currentTimeMillis());
            js(web,"window.__lossReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__lossReady=true;})()");await(web,"window.__lossReady");
            AtomicReference<android.webkit.WebViewClient> originalClient=new AtomicReference<>();
            instrumentation.runOnMainSync(()->originalClient.set(web.getWebViewClient()));
            android.webkit.WebViewClient delegate=originalClient.get();
            instrumentation.runOnMainSync(()->web.setWebViewClient(new android.webkit.WebViewClient(){
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
                    if(MainActivity.APP_ORIGIN.equals(request.getUrl().getScheme()+"://"+request.getUrl().getHost()) && "/js/api-client.js".equals(request.getUrl().getPath())){
                        try(java.io.InputStream input=instrumentation.getTargetContext().getAssets().open("public/js/api-client.js")){
                            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);
                            String shim="window.__originalFetch=window.fetch;window.__lostResponse=false;window.fetch=async(...args)=>{const response=await window.__originalFetch(...args);if(new URL(String(args[0]),location.href).pathname==='/incomes' && args[1]?.method==='POST' && response.ok){if(!window.__lostResponse){window.__firstIncomeId=JSON.parse(args[1].body).id;window.__lostResponse=true;throw new TypeError('Failed to fetch');}window.__retryStatus=response.status;}return response;};\n";
                            return new android.webkit.WebResourceResponse("application/javascript","UTF-8",new java.io.ByteArrayInputStream((shim+output.toString("UTF-8")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                        }catch(Exception error){throw new AssertionError(error);}
                    }
                    return delegate.shouldInterceptRequest(view,request);
                }
                @Override public void onPageFinished(WebView view,String url){delegate.onPageFinished(view,url);}
            }));
            js(web,"window.__beforeLossReload=true");
            instrumentation.runOnMainSync(web::reload);await(web,"!window.__beforeLossReload && window.__originalFetch && qPokoyAndroidCache?.canWrite && !document.body.classList.contains('qp-auth-checking')");
            try{
                js(web,"document.querySelector('.add-income-btn').click();document.getElementById('incomeDate').value='10.10.26';document.getElementById('incomeAmount').value='719';document.getElementById('incomeCategory').value="+literal+";document.getElementById('incomeDescription').value="+literal+";document.getElementById('saveIncome').click()");
                await(web,"window.__lostResponse && qPokoyAndroidCache.pending.length===1 && document.getElementById('incomeForm').hidden");
                assertEquals("true",js(web,"qPokoyAndroidCache.pending[0].income_id===window.__firstIncomeId && IncomeStore.load().some(r=>r.id===window.__firstIncomeId)"));
                js(web,"window.__cloudOne=false;(async()=>{const id=window.__firstIncomeId;const rows=await qPokoyApi.listIncomes();window.__cloudOne=rows.filter(r=>r.id===id && r.description==="+literal+").length===1;const saved=rows.find(r=>r.id===id);await qPokoyApi.addIncome({...saved,client_mutation_id:id});await qPokoyAndroidCache.refresh();})()");
                await(web,"window.__cloudOne && qPokoyAndroidCache.pending.length===0");
                assertEquals("200",js(web,"window.__retryStatus"));
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
        network(!"verify".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"qPokoyAndroidCache?.canWrite && qPokoyAuth.getUser()");fresh(web);
                assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));
                String label="ANDROID_OUTBOX_Длинная категория и описание для проверки переноса_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);
                int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
                js(web,"window.__outboxReady=false;(async()=>{const c=await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__outboxReady=true;})()");await(web,"window.__outboxReady");
                assertTrue(meta.edit().putString("label",label).putInt("baseline",baseline).commit());
                network(false);
                js(web,"Object.defineProperty(navigator,'onLine',{value:true,configurable:true});window.__offlinePosts=0;const originalAdd=qPokoyApi.addIncome;qPokoyApi.addIncome=(...args)=>{window.__offlinePosts++;return originalAdd(...args);};window.__nativeOffline=false;Capacitor.nativePromise('QPokoyReadCache','getNetworkState',{}).then(s=>window.__nativeOffline=s.state==='offline')");
                await(web,"window.__nativeOffline");assertEquals("true",js(web,"navigator.onLine"));
                js(web,"qPokoyAndroidNetwork.accept({state:'offline'});window.__networkProbes=0;window.__saveMs=[];window.__commitHeld=false;const nativeSave=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,args){if(method==='getNetworkState')window.__networkProbes++;if(method==='enqueue'&&!window.__commitHeld){window.__commitHeld=true;return new Promise(resolve=>window.__releaseCommit=()=>resolve(nativeSave.call(this,plugin,method,args)));}return nativeSave.call(this,plugin,method,args);};");
                for(int i=1;i<=3;i++){
                    js(web,"document.querySelector('.add-income-btn').click();document.getElementById('incomeDate').value='"+(i==1?"05":i==2?"10":"12")+".10.26';document.getElementById('incomeAmount').value='"+(710+i)+"';document.getElementById('incomeCategory').value="+literal+";document.getElementById('incomeDescription').value="+literal+";window.__saveStarted=performance.now();document.getElementById('saveIncome').click()");
                    if(i==1){await(web,"window.__commitHeld");assertEquals("false",js(web,"document.getElementById('incomeForm').hidden"));assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));js(web,"window.__saveStarted=performance.now();window.__releaseCommit()");}
                    await(web,"qPokoyAndroidCache.pending.length==="+i+" && document.getElementById('incomeForm').hidden");
                    js(web,"window.__saveMs.push(Math.round(performance.now()-window.__saveStarted))");
                }
                System.out.println("OFFLINE_ADD_COMMIT_TO_CLOSED_MS="+js(web,"window.__saveMs"));
                assertEquals("0",js(web,"window.__networkProbes"));
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").map(r=>r.date).join(',')==='12.10.26,10.10.26,05.10.26'"));
                for(int width:new int[]{320,360,375,390,412,430}){
                    scenario.onActivity(activity->{android.view.ViewGroup.LayoutParams params=web.getLayoutParams();params.width=(int)Math.floor(width*activity.getResources().getDisplayMetrics().density);web.setLayoutParams(params);});
                    await(web,"window.innerWidth==="+width);
                    js(web,"renderRecentIncomes(getSelectedIncomePeriod())");
                    assertEquals("1",js(web,"document.querySelectorAll('#incomeRecentGrid .income-recent-card').length"));
                    assertEquals("true",js(web,"document.documentElement.scrollWidth<=innerWidth"));
                    assertEquals("true",js(web,"(()=>{const card=document.querySelector('#incomeRecentGrid .income-recent-card'),amount=card.querySelector('.income-recent-amount').getBoundingClientRect(),category=card.querySelector('.income-recent-category').getBoundingClientRect(),date=card.querySelector('.income-recent-date').getBoundingClientRect(),description=card.querySelector('.income-recent-description'),d=description.getBoundingClientRect();return amount.right<=category.left+1 && date.top>=amount.bottom-1 && d.top>=date.bottom-1 && description.textContent==="+literal+";})()"));
                    assertEquals("true",js(web,"(()=>{const label=document.querySelector('#incomeRecentGrid [data-android-pending]');const box=label.getBoundingClientRect(),parent=label.parentElement.getBoundingClientRect();return label.scrollWidth<=label.clientWidth && box.left>=parent.left && box.right<=parent.right+1;})()"));
                }
                scenario.onActivity(activity->{android.view.ViewGroup.LayoutParams params=web.getLayoutParams();params.width=android.view.ViewGroup.LayoutParams.MATCH_PARENT;web.setLayoutParams(params);});
                assertEquals(String.valueOf(baseline+3),js(web,"IncomeStore.load().length"));
                assertEquals("0",js(web,"window.__offlinePosts"));
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").reduce((s,r)=>s+r.amount,0)===2136 && !qPokoyAndroidCache.snapshot.incomes.some(r=>r.description==="+literal+")"));
                js(web,"window.__logoutBlocked=false;qPokoyApi.logout().catch(e=>window.__logoutBlocked=e.code==='android_pending_logout')");await(web,"window.__logoutBlocked");
                assertEquals("true",js(web,"Boolean(qPokoyApi.getToken())"));
                return; // Keep radios off and SQLite pending for the host cold-start/reboot.
            }
            String label=meta.getString("label",null);assertNotNull(label);String literal=org.json.JSONObject.quote(label);
            await(web,"qPokoyAndroidCache?.displayed && !document.body.classList.contains('qp-auth-checking')");
            if(!"sync".equals(phase)){
                assertEquals("3",js(web,"qPokoyAndroidCache.pending.length"));
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").map(r=>r.date).join(',')==='12.10.26,10.10.26,05.10.26'"));
                assertEquals(String.valueOf(meta.getInt("baseline",0)+3),js(web,"IncomeStore.load().length"));
                js(web,"document.getElementById('incomeRecentHistory').click();document.getElementById('analyticsModeYear').click();document.getElementById('analyticsModeMonth').click()");
                assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length===3 && document.querySelectorAll('[data-android-pending]').length>=3"));
                return;
            }
            await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
            assertEquals("true",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").map(r=>r.date).join(',')==='12.10.26,10.10.26,05.10.26'"));
            js(web,"window.__outboxConfirmed=false;(async()=>{const rows=(await qPokoyApi.listIncomes()).filter(r=>r.description==="+literal+");window.__outboxConfirmed=rows.length===3 && new Set(rows.map(r=>r.id)).size===3 && rows.reduce((s,r)=>s+r.amount,0)===2136;})()");await(web,"window.__outboxConfirmed");
            assertEquals("0",js(web,"document.querySelectorAll('[data-android-pending]').length"));
            js(web,"window.__outboxClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__outboxClean=true;})()");await(web,"window.__outboxClean");
            assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));
            js(web,"window.__beforeOutboxReload=true");
            instrumentation.runOnMainSync(web::reload);await(web,"window.__beforeOutboxReload===undefined && window.IncomeStore && window.qPokoyAndroidCache?.canWrite");
            assertEquals("false",js(web,"IncomeStore.load().some(r=>r.description==="+literal+")"));meta.edit().clear().commit();
        }
    }
    @Test public void coldOfflineAdd() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("coldAddPhase");
        org.junit.Assume.assumeTrue("Explicit permitted test-account cold add phase required",phase!=null);
        android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("cold-add-test",0);
        network("prepare".equals(phase)||"sync".equals(phase)||"clean".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"qPokoyAndroidCache?.canWrite");fresh(web);
                String label="ANDROID_COLD_ADD_"+System.currentTimeMillis();String literal=org.json.JSONObject.quote(label);
                meta.edit().putString("label",label).putInt("baseline",Integer.parseInt(js(web,"IncomeStore.load().length"))).commit();
                js(web,"window.__ready=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__ready=true;})()");await(web,"window.__ready");
                network(false);return;
            }
            String literal=org.json.JSONObject.quote(meta.getString("label",null));
            await(web,"qPokoyAndroidCache?.metrics.cachedDisplay && qPokoyAuth.getUser() && !document.body.classList.contains('qp-auth-locked')");
            if("known".equals(phase)||"unknown".equals(phase)||"stale".equals(phase)){
                js(web,"window.__posts=0;const add=qPokoyApi.addIncome;qPokoyApi.addIncome=(...a)=>{window.__posts++;return add(...a);};Object.defineProperty(navigator,'onLine',{value:true,configurable:true});");
                if("stale".equals(phase))js(web,"qPokoyAndroidNetwork.accept({state:'online'});");
                if("unknown".equals(phase))js(web,"qPokoyAndroidNetwork.accept({state:'unknown'});const native=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){return m==='getNetworkState'?Promise.resolve({state:'unknown'}):native.call(this,p,m,a);};");
                js(web,"document.querySelector('.add-income-btn').click();incomeDate.value='10.10.26';incomeAmount.value='821';incomeCategory.value="+literal+";incomeDescription.value="+literal+";window.__saveStarted=performance.now();new MutationObserver(()=>{if(incomeForm.hidden && !window.__saveTrace)window.__saveTrace={commitMs:Math.round(qPokoyAndroidCache.metrics.sqliteCommit-window.__saveStarted),closedMs:Math.round(performance.now()-window.__saveStarted)};}).observe(incomeForm,{attributes:true,attributeFilter:['hidden']});saveIncome.click()");
                await(web,"document.getElementById('incomeForm').hidden || document.querySelector('.qp-notice-message')");
                System.out.println("COLD_ADD_DIAGNOSTIC="+js(web,"JSON.stringify({phase:"+org.json.JSONObject.quote(phase)+",state:qPokoyAndroidNetwork.state,pending:qPokoyAndroidCache.pending.length,displayed:qPokoyAndroidCache.displayed,error:document.querySelector('.qp-notice-message')?.textContent||'',diagnostic:qPokoyAndroidCache.diagnostic||null})"));
                assertEquals("true",js(web,"document.getElementById('incomeForm').hidden"));
                System.out.println("LOCAL_FIRST_SAVE_TRACE="+js(web,"JSON.stringify(window.__saveTrace)"));
                assertEquals("true",js(web,"window.__saveTrace.commitMs>=0 && window.__saveTrace.closedMs>=window.__saveTrace.commitMs && window.__saveTrace.closedMs<1000"));
                assertEquals("0",js(web,"window.__posts"));
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.some(r=>r.description==="+literal+") && IncomeStore.load().some(r=>r.description==="+literal+")"));
                if("known".equals(phase))return; // Host force-stops immediately after this save.
                js(web,"window.__beforeColdReload=true");
                instrumentation.runOnMainSync(web::reload);await(web,"window.__beforeColdReload===undefined && window.qPokoyAndroidCache?.metrics.cachedDisplay && window.qPokoyAuth?.getUser()");
                assertEquals("true",js(web,"IncomeStore.load().some(r=>r.description==="+literal+")"));return;
            }
            if("verify".equals(phase)){
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===3 && IncomeStore.load().filter(r=>r.description==="+literal+").length===3"));return;
            }
            await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
            js(web,"window.__clean=false;(async()=>{const rows=(await qPokoyApi.listIncomes()).filter(r=>r.description==="+literal+");window.__unique=rows.length===3&&new Set(rows.map(r=>r.id)).size===3;for(const r of rows)await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__clean=true;})()");await(web,"window.__clean");
            assertEquals("true",js(web,"window.__unique"));assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));meta.edit().clear().commit();
        }
    }

    private android.webkit.WebViewClient interceptApi(WebView web,String shim){
        AtomicReference<android.webkit.WebViewClient> original=new AtomicReference<>();
        instrumentation.runOnMainSync(()->original.set(web.getWebViewClient()));android.webkit.WebViewClient delegate=original.get();
        instrumentation.runOnMainSync(()->web.setWebViewClient(new android.webkit.WebViewClient(){
            @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
                if("/js/api-client.js".equals(request.getUrl().getPath()))try(java.io.InputStream input=instrumentation.getTargetContext().getAssets().open("public/js/api-client.js")){
                    java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);
                    return new android.webkit.WebResourceResponse("application/javascript","UTF-8",new java.io.ByteArrayInputStream((shim+"\n"+output.toString("UTF-8")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                }catch(Exception error){throw new AssertionError(error);}
                return delegate.shouldInterceptRequest(view,request);
            }
            @Override public void onPageFinished(WebView view,String url){delegate.onPageFinished(view,url);}
        }));return delegate;
    }
    private void editSave(WebView web,String id,int amount,String category,String description) throws Exception {
        js(web,"document.getElementById('incomeRecentHistory').click();document.querySelector('.edit-income[data-id=\"'+"+org.json.JSONObject.quote(id)+"+'\"]').click();incomeDate.value='11.10.26';incomeAmount.value='"+amount+"';incomeCategory.value="+org.json.JSONObject.quote(category)+";incomeDescription.value="+org.json.JSONObject.quote(description));
        js(web,"window.__editorSettled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__editorSettled=true))");await(web,"window.__editorSettled");
        js(web,"window.__editTrace=null;window.__editClick=performance.now();window.__editObserver=new MutationObserver(()=>{if(incomeForm.hidden&&!window.__editTrace){window.__editTrace={commit:Math.round(qPokoyAndroidCache.metrics.sqliteCommit-window.__editClick),closed:Math.round(performance.now()-window.__editClick)};window.__editObserver.disconnect();}});window.__editObserver.observe(incomeForm,{attributes:true,attributeFilter:['hidden']});saveIncome.click()");
        await(web,"window.__editTrace");System.out.println("EDIT_SAVE_TRACE="+js(web,"JSON.stringify(window.__editTrace)"));
        assertEquals("true",js(web,"window.__editTrace.commit>=0 && window.__editTrace.closed>=window.__editTrace.commit && window.__editTrace.closed<1000"));
        assertEquals(String.valueOf(amount),js(web,"IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount"));
    }
    @Test public void durableOfflineEdits() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("editPhase");org.junit.Assume.assumeTrue("Explicit test-account edit phase",phase!=null);
        android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("edit-test",0);
        network("prepare".equals(phase)||"sync".equals(phase)||"clean".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"qPokoyAndroidCache?.canWrite");fresh(web);assertEquals("0",js(web,"qPokoyAndroidCache.pending.length"));
                String label="ANDROID_EDIT_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label),second=label+"_B";
                int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
                js(web,"window.__editReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyApi.addCategory("+org.json.JSONObject.quote(second)+");await qPokoyLoadCategories(qPokoyAuth.getUser());const row=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-10',amount:1000,category:"+literal+",description:"+org.json.JSONObject.quote(label+" before")+"});window.__confirmedId=row.id;await qPokoyAndroidCache.refresh();window.__editReady=true;})()");await(web,"window.__editReady");
                String id=new org.json.JSONTokener(js(web,"window.__confirmedId")).nextValue().toString();
                assertTrue(meta.edit().putString("label",label).putString("id",id).putInt("baseline",baseline).commit());
                network(false);js(web,"window.__puts=0;const update=qPokoyApi.updateIncome;qPokoyApi.updateIncome=(...a)=>{window.__puts++;return update(...a)};qPokoyAndroidNetwork.accept({state:'offline'})");
                editSave(web,id,1200,second,label);assertEquals("0",js(web,"window.__puts"));
                js(web,"Object.defineProperty(navigator,'onLine',{value:true,configurable:true});qPokoyAndroidNetwork.accept({state:'online'})");editSave(web,id,1500,second,label);
                js(web,"qPokoyAndroidNetwork.accept({state:'unknown'})");editSave(web,id,1800,second,label);
                assertEquals("1",js(web,"qPokoyAndroidCache.pending.length"));assertEquals("0",js(web,"window.__puts"));
                js(web,"qPokoyAndroidNetwork.accept({state:'offline'});document.querySelector('.add-income-btn').click();incomeDate.value='10.10.26';incomeAmount.value='1000';incomeCategory.value="+literal+";incomeDescription.value="+literal+";saveIncome.click()");await(web,"incomeForm.hidden && qPokoyAndroidCache.pending.length===2");
                String addId=new org.json.JSONTokener(js(web,"qPokoyAndroidCache.pending.find(r=>r.kind==='add').income_id")).nextValue().toString();meta.edit().putString("addId",addId).commit();
                editSave(web,addId,2000,second,label);assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===2 && qPokoyAndroidCache.pending.find(r=>r.income_id==="+org.json.JSONObject.quote(addId)+").kind==='add'"));
                js(web,"window.__beforeEditReload=true");instrumentation.runOnMainSync(web::reload);await(web,"!window.__beforeEditReload && qPokoyAndroidCache?.pending.length===2 && qPokoyAuth.getUser()");
                assertEquals("true",js(web,"IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1800"));return;
            }
            String label=meta.getString("label",""),literal=org.json.JSONObject.quote(label),id=meta.getString("id",""),addId=meta.getString("addId","");assertFalse(label.isEmpty());
            if("verify".equals(phase)){
                await(web,"qPokoyAndroidCache?.metrics.cachedDisplay && qPokoyAuth.getUser()");
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===2 && IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1800 && IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(addId)+").amount===2000"));return;
            }
            await(web,"qPokoyAndroidCache?.canWrite && qPokoyAndroidCache.pending.length===0");
            if(!"clean".equals(phase))js(web,"window.__editsCloud=false;qPokoyApi.listIncomes().then(rows=>window.__editsCloud=rows.filter(r=>r.description==="+literal+").length===2 && rows.find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1800 && rows.find(r=>r.id==="+org.json.JSONObject.quote(addId)+").amount===2000)");if(!"clean".equals(phase))await(web,"window.__editsCloud");
            js(web,"window.__editsClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description.startsWith("+literal+"))await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+"||c.name==="+org.json.JSONObject.quote(label+"_B")+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__editsClean=true;})()");await(web,"window.__editsClean");assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));meta.edit().clear().commit();
        }
    }
    @Test public void onlineSlowLostAndInFlightEdits() throws Exception {
        org.junit.Assume.assumeTrue("Explicit test-account edits","true".equals(InstrumentationRegistry.getArguments().getString("localFirstEdits")));network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");fresh(web);await(web,"qPokoyAndroidCache.canWrite");int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
            String label="ANDROID_EDIT_ONLINE_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);
            js(web,"window.__editReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());const r=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-10',amount:1000,category:"+literal+",description:"+literal+"});window.__editId=r.id;await qPokoyAndroidCache.refresh();window.__editReady=true;})()");await(web,"window.__editReady");
            String id=new org.json.JSONTokener(js(web,"window.__editId")).nextValue().toString();
            String shim="window.__rawFetch=window.fetch;window.__holdPut=false;window.__holdAdd=false;window.__lostPut=false;window.__releases=[];window.__early=0;window.__putCount=0;window.fetch=(...a)=>{const path=new URL(String(a[0]),location.href).pathname,method=a[1]?.method;if(method==='PUT'&&path.startsWith('/incomes/')){window.__putCount++;if(!incomeForm.hidden||!qPokoyAndroidCache.metrics.sqliteCommit)window.__early++;if(window.__holdPut)return new Promise((resolve,reject)=>window.__releases.push(()=>window.__rawFetch(...a).then(resolve,reject)));if(window.__lostPut){window.__lostPut=false;return window.__rawFetch(...a).then(()=>{throw new TypeError('Failed to fetch simulated lost response')})}}if(method==='POST'&&path==='/incomes'&&window.__holdAdd)return window.__rawFetch(...a).then(r=>new Promise(resolve=>{window.__addApplied=true;window.__releaseAdd=()=>resolve(r)}));return window.__rawFetch(...a);};";
            android.webkit.WebViewClient delegate=interceptApi(web,shim);js(web,"window.__beforeEditReload=true");instrumentation.runOnMainSync(web::reload);await(web,"!window.__beforeEditReload && window.__rawFetch && qPokoyAndroidCache?.canWrite");
            try{
                editSave(web,id,1200,label,label);await(web,"qPokoyAndroidCache.pending.length===0");assertEquals("0",js(web,"window.__early"));
                js(web,"window.__holdPut=true");editSave(web,id,1500,label,label);await(web,"window.__releases.length>0");
                js(web,"window.__overlayChecked=false;qPokoyApi.bootstrap().then(data=>window.__overlayChecked=data.incomes.find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1500 && IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1500 && qPokoyAndroidCache.pending.length===1)");await(web,"window.__overlayChecked");
                Thread.sleep(35000);
                assertEquals("true",js(web,"incomeForm.hidden && IncomeStore.load().find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1500 && qPokoyAndroidCache.pending.length===1"));
                js(web,"window.__holdPut=false;window.__releases.splice(0).forEach(fn=>fn())");await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__lostPut=true");editSave(web,id,1800,label,label);await(web,"qPokoyAndroidCache.pending.some(r=>r.attempts>0)");fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__holdAdd=true;window.__addApplied=false;document.querySelector('.add-income-btn').click();incomeDate.value='10.10.26';incomeAmount.value='1000';incomeCategory.value="+literal+";incomeDescription.value="+literal+";saveIncome.click()");await(web,"incomeForm.hidden && window.__addApplied");
                String addId=new org.json.JSONTokener(js(web,"qPokoyAndroidCache.pending.find(r=>r.kind==='add').income_id")).nextValue().toString();
                editSave(web,addId,2000,label,label);js(web,"window.__holdAdd=false;window.__releaseAdd()");fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__cloudFinal=false;qPokoyApi.listIncomes().then(rows=>window.__cloudFinal=rows.filter(r=>r.description==="+literal+").length===2 && rows.find(r=>r.id==="+org.json.JSONObject.quote(id)+").amount===1800 && rows.find(r=>r.id==="+org.json.JSONObject.quote(addId)+").amount===2000)");await(web,"window.__cloudFinal");assertEquals("0",js(web,"window.__early"));
            }finally{
                js(web,"window.__holdPut=false;window.__holdAdd=false;window.__lostPut=false;window.__releases.splice(0).forEach(fn=>fn());window.__releaseAdd?.()");
                instrumentation.runOnMainSync(()->web.setWebViewClient(delegate));fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__editClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description.startsWith("+literal+"))await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__editClean=true;})()");await(web,"window.__editClean");
                js(web,"window.__cleanupCounts=null;qPokoyApi.listIncomes().then(rows=>window.__cleanupCounts={cloud:rows.length,owned:rows.filter(r=>r.description.startsWith("+literal+")).length,ui:IncomeStore.load().length,snapshot:qPokoyAndroidCache.snapshot.incomes.length,pending:qPokoyAndroidCache.pending.length})");await(web,"window.__cleanupCounts");System.out.println("EDIT_CLEANUP_COUNTS="+js(web,"JSON.stringify(window.__cleanupCounts)"));
                fresh(web);await(web,"IncomeStore.load().length==="+baseline);assertEquals(String.valueOf(baseline),js(web,"IncomeStore.load().length"));
            }
        }
    }
    @Test public void localFirstOnlineAndSlowPost() throws Exception {
        org.junit.Assume.assumeTrue("Explicit test-account local-first test required","true".equals(InstrumentationRegistry.getArguments().getString("localFirst")));
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.canWrite");fresh(web);
            int baseline=Integer.parseInt(js(web,"IncomeStore.load().length"));
            String literal=org.json.JSONObject.quote("ANDROID_LOCAL_FIRST_"+System.currentTimeMillis());
            js(web,"window.__ready=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());await qPokoyAndroidCache.refresh();window.__ready=true;})()");await(web,"window.__ready");
            AtomicReference<android.webkit.WebViewClient> originalClient=new AtomicReference<>();
            instrumentation.runOnMainSync(()->originalClient.set(web.getWebViewClient()));
            android.webkit.WebViewClient delegate=originalClient.get();
            instrumentation.runOnMainSync(()->web.setWebViewClient(new android.webkit.WebViewClient(){
                @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view,android.webkit.WebResourceRequest request){
                    if("/js/api-client.js".equals(request.getUrl().getPath())){
                        try(java.io.InputStream input=instrumentation.getTargetContext().getAssets().open("public/js/api-client.js")){
                            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] bytes=new byte[8192];int count;while((count=input.read(bytes))!=-1)output.write(bytes,0,count);
                            String shim="window.__realFetch=window.fetch;window.__holdPost=false;window.__releases=[];window.__earlyPosts=0;window.fetch=(...args)=>{if(args[1]?.method==='POST' && new URL(String(args[0]),location.href).pathname==='/incomes'){if(!incomeForm.hidden || !qPokoyAndroidCache.metrics.sqliteCommit)window.__earlyPosts++;if(window.__holdPost)return new Promise((resolve,reject)=>window.__releases.push(()=>window.__realFetch(...args).then(resolve,reject)));}return window.__realFetch(...args);};\n";
                            return new android.webkit.WebResourceResponse("application/javascript","UTF-8",new java.io.ByteArrayInputStream((shim+output.toString("UTF-8")).getBytes(java.nio.charset.StandardCharsets.UTF_8)));
                        }catch(Exception error){throw new AssertionError(error);}
                    }
                    return delegate.shouldInterceptRequest(view,request);
                }
                @Override public void onPageFinished(WebView view,String url){delegate.onPageFinished(view,url);}
            }));
            js(web,"window.__beforeSlowReload=true");instrumentation.runOnMainSync(web::reload);
            await(web,"!window.__beforeSlowReload && window.__realFetch && qPokoyAndroidCache?.canWrite");
            try{
                for(int i=0;i<2;i++){
                    js(web,"window.__saveTrace=null;window.__holdPost="+(i==1)+";document.querySelector('.add-income-btn').click();incomeDate.value='10.10.26';incomeAmount.value='"+(831+i)+"';incomeCategory.value="+literal+";incomeDescription.value="+literal+";window.__saveStarted=performance.now();new MutationObserver(()=>{if(incomeForm.hidden && !window.__saveTrace)window.__saveTrace={commitMs:Math.round(qPokoyAndroidCache.metrics.sqliteCommit-window.__saveStarted),closedMs:Math.round(performance.now()-window.__saveStarted)};}).observe(incomeForm,{attributes:true,attributeFilter:['hidden']});saveIncome.click()");
                    await(web,"window.__saveTrace");System.out.println("LOCAL_FIRST_ONLINE_TRACE="+js(web,"JSON.stringify(window.__saveTrace)"));
                    assertEquals("true",js(web,"window.__saveTrace.commitMs>=0 && window.__saveTrace.closedMs>=window.__saveTrace.commitMs && window.__saveTrace.closedMs<1000"));
                    assertEquals("0",js(web,"window.__earlyPosts"));
                    if(i==1){
                        await(web,"window.__releases.length>0");Thread.sleep(35000);
                        assertEquals("true",js(web,"incomeForm.hidden && qPokoyAndroidCache.pending.length===1 && IncomeStore.load().filter(r=>r.description==="+literal+").length===2"));
                        js(web,"window.__holdPost=false;for(const release of window.__releases)release();");
                    }
                    await(web,"qPokoyAndroidCache.pending.length===0");
                }
                js(web,"window.__unique=false;(async()=>{const rows=(await qPokoyApi.listIncomes()).filter(r=>r.description==="+literal+");window.__unique=rows.length===2 && new Set(rows.map(r=>r.id)).size===2;})()");await(web,"window.__unique");
            }finally{
                js(web,"window.__holdPost=false;for(const release of window.__releases)release();window.fetch=window.__realFetch;window.__clean=false;(async()=>{await qPokoyAndroidCache.refresh();for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__clean=true;})()");await(web,"window.__clean");
                assertEquals(String.valueOf(baseline),js(web,"IncomeStore.load().length"));
            }
        }
    }
    @Test public void nativeNetworkStateAndLifecycle() throws Exception {
        network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"window.qPokoyAndroidNetwork && window.qPokoyAndroidCache");
            AtomicReference<ReadCachePlugin> plugin=new AtomicReference<>();
            scenario.onActivity(activity->plugin.set((ReadCachePlugin)activity.getBridge().getPlugin("QPokoyReadCache").getInstance()));
            java.lang.reflect.Field callback=ReadCachePlugin.class.getDeclaredField("networkCallback");callback.setAccessible(true);
            assertNotNull(callback.get(plugin.get()));
            network(false);
            js(web,"Object.defineProperty(navigator,'onLine',{value:true,configurable:true});window.__networkReady=false;qPokoyAndroidNetwork.read().then(s=>window.__networkReady=s.state==='offline')");
            await(web,"window.__networkReady");assertEquals("false",js(web,"qPokoyAndroidNetwork.available"));
            network(true);
            js(web,"Object.defineProperty(navigator,'onLine',{value:false,configurable:true});window.__networkReady=false;qPokoyAndroidNetwork.read().then(s=>window.__networkReady=s.state==='online')");
            await(web,"window.__networkReady");assertEquals("true",js(web,"qPokoyAndroidNetwork.available"));
            java.lang.reflect.Field listeners=com.getcapacitor.Plugin.class.getDeclaredField("eventListeners");listeners.setAccessible(true);
            for(int i=0;i<3;i++){
                await(web,"Boolean(document.getElementById('qPokoyAuth')) && Boolean(qPokoyAndroidCache)");
                long deadline=System.currentTimeMillis()+5000;int count=0;
                do{java.util.Map<?,?> map=(java.util.Map<?,?>)listeners.get(plugin.get());Object list=map.get("networkStateChange");count=list==null?0:((java.util.List<?>)list).size();if(count==1)break;Thread.sleep(100);}while(System.currentTimeMillis()<deadline);
                assertEquals("Only one JS listener per document",1,count);
                js(web,"window.__networkReloadMarker=true");
                instrumentation.runOnMainSync(web::reload);await(web,"!window.__networkReloadMarker && window.qPokoyAndroidCache && window.qPokoyAndroidNetwork");
            }
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);assertNull(callback.get(plugin.get()));
            scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED);assertNotNull(callback.get(plugin.get()));
            ReadCachePlugin old=plugin.get();scenario.recreate();assertNull(callback.get(old));
            assertTrue(((java.util.Map<?,?>)listeners.get(old)).isEmpty());
        }finally{network(true);}
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

    private void deleteSave(WebView web,String id) throws Exception {
        String literal=org.json.JSONObject.quote(id);
        js(web,"qPokoyDeleteIncome("+literal+")");await(web,"document.querySelector('#qpConfirmOverlay [data-confirm-ok]')");
        js(web,"window.__confirmSettled=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__confirmSettled=true))");await(web,"window.__confirmSettled");
        js(web,"window.__deleteTrace=null;window.__deleteStart=performance.now();qPokoyAndroidCache.metrics.sqliteCommit=0;window.__deleteCheck=()=>{if(!IncomeStore.load().some(r=>r.id==="+literal+")&&!document.querySelector('.edit-income[data-id=\"'+"+literal+"+'\"]'))window.__deleteTrace={commit:qPokoyAndroidCache.metrics.sqliteCommit-window.__deleteStart,hidden:performance.now()-window.__deleteStart};else requestAnimationFrame(window.__deleteCheck)};document.querySelector('#qpConfirmOverlay [data-confirm-ok]').click();requestAnimationFrame(window.__deleteCheck)");
        await(web,"window.__deleteTrace");org.json.JSONObject trace=new org.json.JSONObject(new org.json.JSONTokener(js(web,"JSON.stringify(window.__deleteTrace)")).nextValue().toString());
        System.out.println("DELETE_SAVE_TRACE="+trace);assertTrue("DELETE must await SQLite before hiding",trace.getDouble("commit")>0&&trace.getDouble("hidden")>=trace.getDouble("commit"));assertTrue("DELETE UI took >=1s",trace.getDouble("hidden")<1000);
    }
    @Test public void durableOfflineDeletes() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("deletePhase");org.junit.Assume.assumeTrue("Explicit DELETE TEST account phases",phase!=null);
        android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("delete-test-meta",0);network(!"verify".equals(phase));
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);
            if("prepare".equals(phase)){
                await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");fresh(web);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
                String label="ANDROID_DELETE_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);meta.edit().putString("label",label).putInt("baseline",Integer.parseInt(js(web,"IncomeStore.load().length"))).commit();
                js(web,"window.__deleteReady=false;window.__deleteIds=[];(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());for(let i=0;i<5;i++){const r=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-11',amount:500+i,category:"+literal+",description:"+literal+"});window.__deleteIds.push(r.id)}await qPokoyAndroidCache.refresh();window.__deleteReady=true})()");await(web,"window.__deleteReady");
                String ids=js(web,"JSON.stringify(window.__deleteIds)");meta.edit().putString("ids",new org.json.JSONTokener(ids).nextValue().toString()).commit();org.json.JSONArray rows=new org.json.JSONArray(meta.getString("ids",""));
                network(false);js(web,"window.__deleteCalls=0;qPokoyAndroidNetwork.accept({state:'offline'})");
                for(int n=0;n<3;n++){
                    if(n==1)js(web,"Object.defineProperty(navigator,'onLine',{value:true,configurable:true});qPokoyAndroidNetwork.accept({state:'online'})");
                    if(n==2)js(web,"qPokoyAndroidNetwork.accept({state:'unknown'})");
                    deleteSave(web,rows.getString(n));
                }
                js(web,"qPokoyAndroidNetwork.accept({state:'offline'})");String fourth=rows.getString(3);editSave(web,fourth,750,label,label);deleteSave(web,fourth);
                js(web,"document.querySelector('.add-income-btn').click();incomeDate.value='11.10.26';incomeAmount.value='600';incomeCategory.value="+literal+";incomeDescription.value="+literal+";saveIncome.click()");await(web,"incomeForm.hidden && qPokoyAndroidCache.pending.some(r=>r.kind==='add')");
                String add=new org.json.JSONTokener(js(web,"qPokoyAndroidCache.pending.find(r=>r.kind==='add').income_id")).nextValue().toString();editSave(web,add,650,label,label);deleteSave(web,add);
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===4 && qPokoyAndroidCache.pending.every(r=>r.kind==='delete')"));
                js(web,"window.__deleteReload=true");instrumentation.runOnMainSync(web::reload);await(web,"!window.__deleteReload && qPokoyAndroidCache?.pending.length===4 && qPokoyAuth.getUser()");assertEquals("1",js(web,"IncomeStore.load().filter(r=>r.description==="+literal+").length"));return;
            }
            String label=meta.getString("label",""),literal=org.json.JSONObject.quote(label);assertFalse(label.isEmpty());
            await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");
            if("verify".equals(phase)){
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===4 && qPokoyAndroidCache.pending.every(r=>r.kind==='delete') && IncomeStore.load().filter(r=>r.description==="+literal+").length===1"));return;
            }
            fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
            js(web,"window.__deleteCloud=false;qPokoyApi.listIncomes().then(rows=>window.__deleteCloud=rows.filter(r=>r.description==="+literal+").length===1)");if(!"clean".equals(phase))await(web,"window.__deleteCloud");
            js(web,"window.__deleteClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__deleteClean=true})()");await(web,"window.__deleteClean");fresh(web);assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));meta.edit().clear().commit();
        }
    }
    @Test public void onlineSlowLostAndRacingDeletes() throws Exception {
        org.junit.Assume.assumeTrue("Explicit native DELETE TEST account","true".equals(InstrumentationRegistry.getArguments().getString("localFirstDeletes")));network(true);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");fresh(web);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
            String label="ANDROID_DELETE_ONLINE_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);
            js(web,"window.__deleteReady=false;window.__deleteIds=[];(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());for(let i=0;i<4;i++){const r=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-11',amount:700+i,category:"+literal+",description:"+literal+"});window.__deleteIds.push(r.id)}await qPokoyAndroidCache.refresh();window.__deleteReady=true})()");await(web,"window.__deleteReady");
            org.json.JSONArray ids=new org.json.JSONArray(new org.json.JSONTokener(js(web,"JSON.stringify(window.__deleteIds)")).nextValue().toString());
            String shim="window.__nativeFetch=window.fetch;window.__holdDelete=false;window.__lostDelete=false;window.__holdWrite=false;window.__writeBefore=false;window.__writeApplied=false;window.__releases=[];window.__earlyDelete=0;window.fetch=(...a)=>{const path=new URL(String(a[0]),location.href).pathname,m=a[1]?.method;if(m==='DELETE'&&path.startsWith('/incomes/')){if(!qPokoyAndroidCache.metrics.sqliteCommit||IncomeStore.load().some(r=>r.id===decodeURIComponent(path.split('/').pop())))window.__earlyDelete++;if(window.__holdDelete)return new Promise((resolve,reject)=>window.__releases.push(()=>window.__nativeFetch(...a).then(resolve,reject)));if(window.__lostDelete){window.__lostDelete=false;return window.__nativeFetch(...a).then(()=>{throw new TypeError('Failed to fetch simulated lost DELETE')})}}if(window.__holdWrite&&(m==='POST'||m==='PUT')&&path.startsWith('/incomes')){if(window.__writeBefore){window.__writeApplied=true;return new Promise((resolve,reject)=>window.__releases.push(()=>window.__nativeFetch(...a).then(resolve,reject)))}return window.__nativeFetch(...a).then(r=>{window.__writeApplied=true;return new Promise(resolve=>window.__releases.push(()=>resolve(r)))})}return window.__nativeFetch(...a)};";
            android.webkit.WebViewClient delegate=interceptApi(web,shim);js(web,"window.__deleteReload=true");instrumentation.runOnMainSync(web::reload);await(web,"!window.__deleteReload && window.__nativeFetch && qPokoyAndroidCache?.canWrite");
            try{
                deleteSave(web,ids.getString(0));await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__holdDelete=true");deleteSave(web,ids.getString(1));await(web,"window.__releases.length>0");
                js(web,"window.__tombstoneCheck=false;qPokoyApi.bootstrap().then(data=>window.__tombstoneCheck=!data.incomes.some(r=>r.id==="+org.json.JSONObject.quote(ids.getString(1))+") && qPokoyAndroidCache.pending.some(r=>r.kind==='delete'))");await(web,"window.__tombstoneCheck");Thread.sleep(35000);
                assertEquals("false",js(web,"IncomeStore.load().some(r=>r.id==="+org.json.JSONObject.quote(ids.getString(1))+")"));js(web,"window.__holdDelete=false;window.__releases.splice(0).forEach(fn=>fn())");fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__lostDelete=true");deleteSave(web,ids.getString(2));await(web,"qPokoyAndroidCache.pending.some(r=>r.attempts>0)");Thread.sleep(5500);fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__holdWrite=true;window.__writeBefore=false;window.__writeApplied=false");editSave(web,ids.getString(3),950,label,label);await(web,"window.__writeApplied");deleteSave(web,ids.getString(3));js(web,"window.__holdWrite=false;window.__releases.splice(0).forEach(fn=>fn())");fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                for(boolean before:new boolean[]{false,true}){
                    js(web,"window.__holdWrite=true;window.__writeBefore="+before+";window.__writeApplied=false;document.querySelector('.add-income-btn').click();incomeDate.value='11.10.26';incomeAmount.value='800';incomeCategory.value="+literal+";incomeDescription.value="+literal+";saveIncome.click()");await(web,"incomeForm.hidden && window.__writeApplied");
                    String id=new org.json.JSONTokener(js(web,"qPokoyAndroidCache.pending.find(r=>r.kind==='add').income_id")).nextValue().toString();deleteSave(web,id);
                    if(before){Thread.sleep(35000);assertEquals("true",js(web,"qPokoyAndroidCache.pending.some(r=>r.kind==='delete')"));js(web,"window.__tombstoneCheck=false;qPokoyApi.bootstrap().then(data=>window.__tombstoneCheck=!data.incomes.some(r=>r.id==="+org.json.JSONObject.quote(id)+") && qPokoyAndroidCache.pending.some(r=>r.kind==='delete'))");await(web,"window.__tombstoneCheck");}
                    js(web,"window.__holdWrite=false;window.__releases.splice(0).forEach(fn=>fn())");fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                }
                assertEquals("0",js(web,"window.__earlyDelete"));js(web,"window.__deleteCloud=false;qPokoyApi.listIncomes().then(rows=>window.__deleteCloud=!rows.some(r=>r.description==="+literal+"))");await(web,"window.__deleteCloud");
            }finally{
                js(web,"window.__holdWrite=false;window.__holdDelete=false;window.__releases.splice(0).forEach(fn=>fn())");instrumentation.runOnMainSync(()->web.setWebViewClient(delegate));fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");
                js(web,"window.__deleteClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__deleteClean=true})()");await(web,"window.__deleteClean");
            }
        }
    }


    @Test public void appV3UpgradeWithPendingAddAndEdit() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("upgradePhase");org.junit.Assume.assumeTrue("Explicit TEST database upgrade",phase!=null);
        network("prepare".equals(phase)||"sync".equals(phase));android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("upgrade-v3-test",0);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");
            if("prepare".equals(phase)){
                fresh(web);await(web,"qPokoyAndroidCache.pending.length===0 && qPokoyAndroidCache.canWrite");String label="ANDROID_DELETE_UPGRADE_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);
                meta.edit().putString("label",label).commit();js(web,"window.__upgradeReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());const r=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-11',amount:1000,category:"+literal+",description:"+literal+"});window.__upgradeId=r.id;await qPokoyAndroidCache.refresh();window.__upgradeReady=true})()");await(web,"window.__upgradeReady");
                network(false);js(web,"window.__upgradeQueued=false;(async()=>{await IncomeStore.update(window.__upgradeId,{date:'11.10.26',amount:1200,category:"+literal+",description:"+literal+"});await IncomeStore.add({date:'11.10.26',amount:650,category:"+literal+",description:"+literal+"});window.__upgradeQueued=true})()");await(web,"window.__upgradeQueued");assertEquals("2",js(web,"qPokoyAndroidCache.pending.length"));
                // Reconstruct the exact v3 schema with real pending rows. Reinstall
                // APK/force-stop next; no snapshot/outbox/session rows are removed.
                try(ReadCacheDatabase db=new ReadCacheDatabase(instrumentation.getTargetContext())){db.getWritableDatabase().execSQL("ALTER TABLE pending_adds DROP COLUMN sent");db.getWritableDatabase().setVersion(3);}return;
            }
            if("verify".equals(phase)){
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===2 && qPokoyAndroidCache.pending.some(r=>r.kind==='add'&&r.amount===650)&&qPokoyAndroidCache.pending.some(r=>r.kind==='update'&&r.amount===1200)&&qPokoyAndroidCache.pending.every(r=>r.sent===1)"));
                try(ReadCacheDatabase db=new ReadCacheDatabase(instrumentation.getTargetContext())){assertEquals(4,db.getWritableDatabase().getVersion());}return;
            }
            fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");String literal=org.json.JSONObject.quote(meta.getString("label",""));
            js(web,"window.__upgradeCloud=false;qPokoyApi.listIncomes().then(rows=>{const own=rows.filter(r=>r.description==="+literal+");window.__upgradeCloud=own.length===2 && own.some(r=>r.amount===1200)&&own.some(r=>r.amount===650)})");await(web,"window.__upgradeCloud");
            js(web,"window.__upgradeClean=false;(async()=>{for(const r of await qPokoyApi.listIncomes())if(r.description==="+literal+")await qPokoyApi.deleteIncome(r.id);for(const c of await qPokoyApi.listCategories())if(c.name==="+literal+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__upgradeClean=true})()");await(web,"window.__upgradeClean");meta.edit().clear().commit();
        }
    }
    @Test public void singleOfflineDeleteLifecycle() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("offlineDeletePhase");org.junit.Assume.assumeTrue("Explicit single DELETE TEST fixture",phase!=null);
        network(!"verify".equals(phase));android.content.SharedPreferences meta=instrumentation.getTargetContext().getSharedPreferences("single-delete-test",0);
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            WebView web=web(scenario);await(web,"qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");
            if("prepare".equals(phase)){
                fresh(web);await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
                String label="ANDROID_DELETE_SINGLE_"+System.currentTimeMillis(),literal=org.json.JSONObject.quote(label);meta.edit().putString("label",label).putInt("baseline",Integer.parseInt(js(web,"IncomeStore.load().length"))).commit();
                js(web,"window.__singleReady=false;(async()=>{await qPokoyApi.addCategory("+literal+");await qPokoyLoadCategories(qPokoyAuth.getUser());const r=await qPokoyApi.addIncome({id:crypto.randomUUID(),income_date:'2026-10-11',amount:777,category:"+literal+",description:"+literal+"});window.__singleId=r.id;await qPokoyAndroidCache.refresh();window.__singleReady=true})()");await(web,"window.__singleReady");
                String id=new org.json.JSONTokener(js(web,"window.__singleId")).nextValue().toString();meta.edit().putString("id",id).commit();network(false);js(web,"qPokoyAndroidNetwork.accept({state:'offline'})");deleteSave(web,id);
                js(web,"window.__singleReload=true");instrumentation.runOnMainSync(web::reload);await(web,"!window.__singleReload && qPokoyAndroidCache?.displayed && qPokoyAuth.getUser()");
            }
            String id=meta.getString("id","");assertFalse(id.isEmpty());String literal=org.json.JSONObject.quote(id);
            if(!"sync".equals(phase)){
                assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===1 && qPokoyAndroidCache.pending[0].kind==='delete' && qPokoyAndroidCache.pending[0].income_id==="+literal+" && !IncomeStore.load().some(r=>r.id==="+literal+") && !document.querySelector('.edit-income[data-id=\"'+"+literal+"+'\"]')"));return;
            }
            fresh(web);await(web,"qPokoyAndroidCache.pending.length===0");js(web,"window.__singleAbsent=false;qPokoyApi.listIncomes().then(rows=>window.__singleAbsent=!rows.some(r=>r.id==="+literal+"))");await(web,"window.__singleAbsent");
            String label=org.json.JSONObject.quote(meta.getString("label",""));js(web,"window.__singleClean=false;(async()=>{for(const c of await qPokoyApi.listCategories())if(c.name==="+label+")await qPokoyApi.deleteCategory(c.id);await qPokoyAndroidCache.refresh();window.__singleClean=true})()");await(web,"window.__singleClean");fresh(web);assertEquals(String.valueOf(meta.getInt("baseline",0)),js(web,"IncomeStore.load().length"));meta.edit().clear().commit();
        }
    }

}
