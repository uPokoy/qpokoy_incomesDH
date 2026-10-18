package ru.qpokoy.app;

import android.app.Instrumentation;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Explicit device test. SAF is operated by the tester; only synthetic export files are created.
 * JSON import stops at the real file-input handler: the account's restore/persistence is never called.
 */
@RunWith(AndroidJUnit4.class)
public class FileTransferDeviceTest {
    private final Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    private String js(WebView web,String script) throws Exception {
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> value=new AtomicReference<>();
        instrumentation.runOnMainSync(()->web.evaluateJavascript(script,result->{value.set(result);done.countDown();}));
        assertTrue(done.await(15,TimeUnit.SECONDS));return value.get();
    }
    private Object field(MainActivity activity,String name) throws Exception {
        Field field=MainActivity.class.getDeclaredField(name);field.setAccessible(true);return field.get(activity);
    }
    private void await(WebView web,String expression) throws Exception {
        long end=System.currentTimeMillis()+60000;
        while(System.currentTimeMillis()<end){if("true".equals(js(web,"Boolean("+expression+")")))return;Thread.sleep(100);}
        fail("Device file flow did not finish: "+expression);
    }
    private void tap(WebView web,String selector) throws Exception {
        String literal=org.json.JSONObject.quote(selector);
        js(web,"document.querySelector("+literal+").scrollIntoView({block:'center'})");
        Thread.sleep(200);
        org.json.JSONArray position=new org.json.JSONArray(js(web,"(()=>{const r=document.querySelector("+literal+").getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2,innerWidth]})()"));
        int[] origin=new int[2];instrumentation.runOnMainSync(()->web.getLocationOnScreen(origin));
        float scale=web.getWidth()/(float)position.getDouble(2);
        float x=origin[0]+(float)position.getDouble(0)*scale,y=origin[1]+(float)position.getDouble(1)*scale;
        long now=android.os.SystemClock.uptimeMillis();
        android.view.MotionEvent down=android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,x,y,0);
        android.view.MotionEvent up=android.view.MotionEvent.obtain(now,now+50,android.view.MotionEvent.ACTION_UP,x,y,0);
        try{instrumentation.sendPointerSync(down);instrumentation.sendPointerSync(up);}finally{down.recycle();up.recycle();}
    }
    @Test public void systemDocumentRoundTripWithoutChangingAccount() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("fileTransfer","");
        org.junit.Assume.assumeTrue("Explicit PDF/JSON device phase required",!phase.isEmpty());
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            AtomicReference<MainActivity> activity=new AtomicReference<>();scenario.onActivity(activity::set);
            WebView web=activity.get().getBridge().getWebView();
            await(web,"window.qPokoyAndroidAdapter && window.IncomeBackup && window.IncomeStore");
            String before=js(web,"JSON.stringify(IncomeStore.load())");
            if("pdf".equals(phase)){
                js(web,"(()=>{const original=IncomeStore.load;const select=document.getElementById('printReportPeriod');const old=select.value;try{IncomeStore.load=()=>[{id:'file-provider-fixture',date:'18.10.26',amount:123,category:'FileProvider TEST',description:'Synthetic file transfer test'}];select.value='all';document.getElementById('printIncomeReportBtn').click();}finally{IncomeStore.load=original;select.value=old;}})()");
                long end=System.currentTimeMillis()+15000;WebView report=null;
                while(report==null&&System.currentTimeMillis()<end){report=(WebView)field(activity.get(),"reportView");Thread.sleep(100);}
                assertNotNull("Report did not open",report);
                await(report,"window.html2pdf && window.qPokoyAndroidDownload");
                js(report,"(()=>{const download=window.qPokoyAndroidDownload;window.qPokoyAndroidDownload=(url,name,mime)=>download(url,'qPokoy-FileProvider-test.pdf',mime);saveReportPdf();})()");
            }else if("json".equals(phase)){
                js(web,"(()=>{const old=window.incomes;const download=window.qPokoyAndroidDownload;try{window.incomes=[{id:'file-provider-fixture',date:'18.10.26',amount:123,category:'FileProvider TEST',description:'Synthetic file transfer test'}];window.qPokoyAndroidDownload=(url,name,mime)=>download(url,'qPokoy-FileProvider-test.json',mime);document.getElementById('exportDataBtn').click();}finally{window.incomes=old;}})()");
            }else if("import".equals(phase)){
                js(web,"window.__originalImport=IncomeBackup.importData;window.__fileImported=false;IncomeBackup.importData=async file=>{const payload=JSON.parse(await file.text());if(payload.format!=='qPokoy-income-backup'||payload.incomes.length!==1||payload.incomes[0].id!=='file-provider-fixture')throw Error('Invalid synthetic fixture');window.__fileImported=true;};document.getElementById('analyticsSettingsToggle').click();document.querySelector('[data-settings-tab-target=data]').click()");
                tap(web,"#importDataBtn");
                try{await(web,"window.__fileImported");}finally{js(web,"IncomeBackup.importData=window.__originalImport;delete window.__originalImport");}
            }else{fail("Unknown file phase");}
            if(!"import".equals(phase)){
                long end=System.currentTimeMillis()+30000;byte[] pending=null;
                while(pending==null&&System.currentTimeMillis()<end){pending=(byte[])field(activity.get(),"pendingDownload");Thread.sleep(100);}
                assertNotNull("SAF save did not receive generated bytes",pending);assertTrue(pending.length>100);
                if("pdf".equals(phase))assertEquals("%PDF-",new String(pending,0,5,java.nio.charset.StandardCharsets.US_ASCII));
                end=System.currentTimeMillis()+90000;
                while(field(activity.get(),"pendingDownload")!=null&&System.currentTimeMillis()<end)Thread.sleep(100);
                assertNull("Complete or cancel the system save dialog",field(activity.get(),"pendingDownload"));
            }
            assertEquals("Account records changed during file test",before,js(web,"JSON.stringify(IncomeStore.load())"));
        }
    }
}
