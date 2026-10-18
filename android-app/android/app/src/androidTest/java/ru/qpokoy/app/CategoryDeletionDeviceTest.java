package ru.qpokoy.app;

import android.app.Instrumentation;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Explicit opt-in phases; only unique TEST records may be mutated. No credentials leave WebView. */
@RunWith(AndroidJUnit4.class)
public class CategoryDeletionDeviceTest {
 private final Instrumentation inst=InstrumentationRegistry.getInstrumentation();
 private String js(WebView web,String code)throws Exception{
  AtomicReference<String> result=new AtomicReference<>();CountDownLatch done=new CountDownLatch(1);
  inst.runOnMainSync(()->web.evaluateJavascript(code,value->{result.set(value);done.countDown();}));
  assertTrue(done.await(10,TimeUnit.SECONDS));return result.get();
 }
 private void await(WebView web,String condition)throws Exception{
  long end=System.currentTimeMillis()+60000;
  while(System.currentTimeMillis()<end){if("true".equals(js(web,"window.__categoryTestFailed===true")))fail("Test setup stage failed");if("true".equals(js(web,"Boolean("+condition+")")))return;Thread.sleep(200);}
  fail("Device phase condition not met (no payload logged)");
 }
 @Test public void explicitTestRecordsOnly()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("categoryPhase");
  org.junit.Assume.assumeNotNull(phase);
  String marker=InstrumentationRegistry.getArguments().getString("categoryMarker","");
  assertTrue(marker.matches("TEST_CAT_DELETE_[0-9_]+"));
  String name=JSONObject.quote(marker);
  try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> ref=new AtomicReference<>();scenario.onActivity(a->ref.set(a.getBridge().getWebView()));WebView web=ref.get();
   await(web,"window.qPokoyAndroidCache?.displayed && window.qPokoyAuth?.getUser?.()");
   String own="qPokoyAndroidCache.snapshot.incomes.filter(x=>x.description==="+name+")";
   if("inspect".equals(phase)){
    System.out.println("TEST state "+js(web,"JSON.stringify({category:qPokoyGetCategories().filter(c=>c.name==="+name+").length,button:[...document.querySelectorAll('.qp-category-delete')].some(b=>qPokoyGetCategories().some(c=>c.id===b.dataset.id&&c.name==="+name+")),pending:qPokoyAndroidCache.pending.map(c=>({kind:c.kind,status:c.status})),income:"+own+".length})"));return;
   }
   if("prepare".equals(phase)){
    await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
    js(web,"window.__categoryTestDone=false;(async()=>{try{const cats=await qPokoyApi.listCategories();if(cats.some(c=>c.name==="+name+"))throw Error();await qPokoyApi.addCategory("+name+");await IncomeStore.add({date:'18.10.26',amount:137,category:"+name+",description:"+name+"});window.__categoryTestDone=true;}catch(_){window.__categoryTestFailed=true;}})()");
    await(web,"window.__categoryTestDone && qPokoyAndroidCache.pending.length===0");
   }else if("deleteOffline".equals(phase)){
    assertEquals("true",js(web,"qPokoyAndroidCache.pending.length===0"));
    js(web,"document.getElementById('analyticsSettingsToggle')?.click();document.querySelector('[data-settings-tab-target=categories]')?.click();window.__categoryTestDone=false;(async()=>{try{const c=qPokoyGetCategories().find(c=>c.name==="+name+");if(!c)throw Error();const button=[...document.querySelectorAll('.qp-category-delete')].find(b=>b.dataset.id===c.id);if(!button)throw Error();const confirm=window.qPokoyConfirm;window.qPokoyConfirm=(title,message,action)=>{window.qPokoyConfirm=confirm;return action();};button.click();window.__categoryTestDone=true;}catch(_){window.__categoryTestFailed=true;}})()");
    await(web,"window.__categoryTestDone && qPokoyAndroidCache.pending.some(c=>c.kind==='category_delete'&&c.name==="+name+")");
   }else if("synced".equals(phase)){
    // Observe automatic recovery only; do not call manualSync/refresh here.
    await(web,"qPokoyAndroidCache.canWrite && qPokoyAndroidCache.pending.length===0");
    js(web,"window.__serverChecked=false;(async()=>{const cats=await qPokoyApi.listCategories(),rows=await qPokoyApi.listIncomes();window.__serverChecked=!cats.some(c=>c.name==="+name+")&&rows.filter(x=>x.description==="+name+").length===1&&rows.find(x=>x.description==="+name+").category==="+name+";})()");
    await(web,"window.__serverChecked");
    js(web,"window.__repeatChecked=false;qPokoyApi.bootstrap().then(()=>qPokoyAndroidCache.manualSync()).then(()=>window.__repeatChecked=true)");await(web,"window.__repeatChecked && qPokoyAndroidCache.pending.length===0");
   }else if("cleanup".equals(phase)){
    js(web,"window.__cleaned=false;(async()=>{const rows=(await qPokoyApi.listIncomes()).filter(x=>x.description==="+name+"&&x.category==="+name+");if(rows.length!==1)return;await IncomeStore.remove(rows[0].id);window.__cleaned=true;})()");
    await(web,"window.__cleaned && qPokoyAndroidCache.pending.length===0");
    js(web,"window.__serverClean=false;qPokoyApi.listIncomes().then(rows=>window.__serverClean=!rows.some(x=>x.description==="+name+"))");await(web,"window.__serverClean");return;
   }else if(!"offlineRestart".equals(phase))throw new AssertionError("Unknown phase");
   assertEquals("true",js(web,own+".length===1 && "+own+"[0].category==="+name+" && "+own+"[0].amount===137 && "+own+"[0].income_date==='2026-10-18'"));
   if(!"prepare".equals(phase))assertEquals("true",js(web,"!qPokoyGetCategories().some(c=>c.name==="+name+")"));
   if("offlineRestart".equals(phase))assertEquals("true",js(web,"qPokoyAndroidCache.pending.filter(c=>c.kind==='category_delete'&&c.name==="+name+").length===1"));
  }
 }
}
