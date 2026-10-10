package ru.qpokoy.app;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import static org.junit.Assert.*;

/** Uses a separate test database, never the signed-in application's cache. */
@RunWith(AndroidJUnit4.class)
public class ReadCacheDatabaseTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private ReadCacheDatabase testDatabase(){return new ReadCacheDatabase(context,"read-cache-tests.db");}
    private final String a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private JSONObject snapshot(String uid,int count) throws Exception {
        JSONArray rows=new JSONArray();
        for(int i=0;i<count;i++)rows.put(new JSONObject().put("id","row-"+i).put("user_id",uid).put("income_date","2026-10-10").put("amount",i+1).put("category","Test").put("description","Read-cache benchmark "+i));
        return new JSONObject().put("schemaVersion",1).put("lastSuccessfulSync",System.currentTimeMillis()).put("user",new JSONObject().put("user_id",uid))
            .put("incomes",rows).put("categories",new JSONArray()).put("settings",new JSONArray());
    }
    @Test public void accountSwitchAndLogoutNeverReturnOldAccount() throws Exception {
        try(ReadCacheDatabase db=testDatabase()){
            db.clear();db.write(a,snapshot("A",1));assertNull(db.read(b));
            db.clear();assertNull(db.read(a));db.write(b,snapshot("B",1));assertNull(db.read(a));assertEquals("B",db.read(b).getJSONObject("user").getString("user_id"));db.clear();
        }
    }
    @Test public void invalidWriteKeepsPreviousSnapshotAndCorruptOrOldRecordIsDiscarded() throws Exception {
        try(ReadCacheDatabase db=testDatabase()){
            db.clear();db.write(a,snapshot("A",1));
            JSONObject bad=snapshot("A",2);bad.getJSONArray("incomes").getJSONObject(0).put("user_id","B");
            try{db.write(a,bad);fail("Mixed owner accepted");}catch(IllegalArgumentException expected){}
            assertEquals(1,db.read(a).getJSONArray("incomes").length());
            db.getWritableDatabase().execSQL("UPDATE snapshots SET schema_version=99");assertNull(db.read(a));
            db.write(a,snapshot("A",1));db.getWritableDatabase().execSQL("UPDATE snapshots SET payload=x'000102'");assertNull(db.read(a));db.clear();
        }
    }
    @Test public void incompatibleDatabaseVersionSafelyRecreatesOnlyCache() throws Exception {
        try(ReadCacheDatabase db=testDatabase()){db.clear();db.write(a,snapshot("A",1));db.getWritableDatabase().setVersion(99);}
        try(ReadCacheDatabase db=testDatabase()){assertNull(db.read(a));assertEquals(3,db.getWritableDatabase().getVersion());}
    }
    @Test public void snapshotsHaveNoIncomeCountLimitAndStayInPrivateStorage() throws Exception {
        assertTrue(context.getDatabasePath(ReadCacheDatabase.NAME).getCanonicalPath().startsWith(context.getDataDir().getCanonicalPath()+"/"));
        try(ReadCacheDatabase db=testDatabase()){
            for(int count:new int[]{100,1000,5000,10000}){
                long started=android.os.SystemClock.elapsedRealtime();db.write(a,snapshot("A",count));
                long saved=android.os.SystemClock.elapsedRealtime();assertEquals(count,db.read(a).getJSONArray("incomes").length());
                System.out.println("READ_CACHE_BENCH count="+count+" writeMs="+(saved-started)+" readMs="+(android.os.SystemClock.elapsedRealtime()-saved));
            }db.clear();
        }
    }
}
