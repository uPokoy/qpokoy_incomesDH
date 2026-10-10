package ru.qpokoy.app;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.UUID;
import static org.junit.Assert.*;

/** Disposable fixture database: never touches the signed-in app's financial data. */
@RunWith(AndroidJUnit4.class)
public class OutboxDatabaseTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final String name="outbox-tests.db",a="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",b="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",c="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    private ReadCacheDatabase db(){return new ReadCacheDatabase(context,name);}
    private JSONObject snapshot(String uid) throws Exception {
        return new JSONObject().put("schemaVersion",1).put("lastSuccessfulSync",System.currentTimeMillis())
            .put("user",new JSONObject().put("user_id",uid)).put("incomes",new JSONArray()).put("settings",new JSONArray())
            .put("categories",new JSONArray().put(new JSONObject().put("id","cat").put("user_id",uid).put("name","Test")));
    }
    private JSONObject income(int amount) throws Exception {
        return new JSONObject().put("operation_id",UUID.randomUUID().toString()).put("income_id",UUID.randomUUID().toString())
            .put("income_date","2026-10-10").put("amount",amount).put("category","Test").put("description","Fixture")
            .put("created_at",1);
    }
    @Test public void durableFifoSurvivesReopenAndSnapshotClear() throws Exception {
        context.deleteDatabase(name);
        try(ReadCacheDatabase db=db()){
            db.write(a,snapshot("A"));for(int i=1;i<=3;i++)db.enqueue(a,"A",income(i));
            assertEquals(0,db.read(a).getJSONArray("incomes").length());
        }
        try(ReadCacheDatabase db=db()){
            JSONArray rows=db.pending(a,"A");assertEquals(3,rows.length());
            for(int i=0;i<3;i++)assertEquals(i+1,rows.getJSONObject(i).getInt("amount"));
            db.clear();assertEquals(3,db.pendingCount(a));assertNull(db.read(a));
            db.write(c,snapshot("A"));assertEquals(0,db.pendingCount(a));assertEquals(3,db.pending(c,"A").length());
        }finally{context.deleteDatabase(name);}
    }
    @Test public void accountIsolationAndAtomicAck() throws Exception {
        context.deleteDatabase(name);JSONObject row=income(5);
        try(ReadCacheDatabase db=db()){
            db.write(a,snapshot("A"));db.enqueue(a,"A",row);
            db.write(b,snapshot("B"));assertEquals(0,db.pending(b,"B").length());assertEquals(1,db.pendingCount(a));
            try{db.pending(b,"A");fail("Foreign queue exposed");}catch(IllegalArgumentException expected){}
            JSONObject s=snapshot("A");db.write(c,s);assertEquals(1,db.pending(c,"A").length());
            JSONObject saved=new JSONObject(row.toString()).put("id",row.getString("income_id")).put("user_id","A");
            s.getJSONArray("incomes").put(saved);db.write(c,s);
            assertEquals(0,db.pending(c,"A").length());assertEquals(1,db.read(c).getJSONArray("incomes").length());
        }finally{context.deleteDatabase(name);}
    }
    @Test public void retriesErrorsAndCorruptSnapshotNeverDeleteOutbox() throws Exception {
        context.deleteDatabase(name);JSONObject row=income(7);
        try(ReadCacheDatabase db=db()){
            db.write(a,snapshot("A"));db.enqueue(a,"A",row);
            for(String state:new String[]{"pending","auth_required","error"})db.pendingState(a,"A",row.getString("operation_id"),state,0,"http_503");
            assertEquals(3,db.pending(a,"A").getJSONObject(0).getInt("attempts"));
            assertEquals("error",db.pending(a,"A").getJSONObject(0).getString("status"));
            db.getWritableDatabase().execSQL("UPDATE snapshots SET payload=x'000102'");assertNull(db.read(a));assertEquals(1,db.pendingCount(a));
            db.write(a,snapshot("A"));assertEquals(1,db.pending(a,"A").length());
        }finally{context.deleteDatabase(name);}
    }
    @Test public void upgradeFromReadCachePreservesSnapshot() throws Exception {
        context.deleteDatabase(name);
        try(ReadCacheDatabase db=db()){
            db.write(a,snapshot("A"));SQLiteDatabase sql=db.getWritableDatabase();sql.execSQL("DROP TABLE pending_adds");sql.setVersion(1);
        }
        try(ReadCacheDatabase db=db()){
            assertNotNull(db.read(a));assertEquals(2,db.getWritableDatabase().getVersion());db.enqueue(a,"A",income(9));assertEquals(1,db.pendingCount(a));
        }finally{context.deleteDatabase(name);}
    }
    @Test public void invalidDatesCategoriesAndDuplicateIdsAreRejectedBeforeCommit() throws Exception {
        context.deleteDatabase(name);
        try(ReadCacheDatabase db=db()){
            db.write(a,snapshot("A"));
            for(String date:new String[]{"2026-02-29","1900-02-29","2026-04-31","2026-13-01","2026-01-00","26-10-10"}){
                try{db.enqueue(a,"A",income(1).put("income_date",date));fail("Invalid date accepted");}catch(IllegalArgumentException expected){}
            }
            try{db.enqueue(a,"A",income(1).put("category","Unknown"));fail("Unknown category accepted");}catch(IllegalArgumentException expected){}
            assertEquals(0,db.pendingCount(a));JSONObject row=income(1).put("income_date","2000-02-29");db.enqueue(a,"A",row);
            try{db.enqueue(a,"A",new JSONObject(row.toString()).put("operation_id",UUID.randomUUID().toString()));fail("Duplicate ID accepted");}catch(android.database.sqlite.SQLiteConstraintException expected){}
            assertEquals(1,db.pendingCount(a));
        }finally{context.deleteDatabase(name);}
    }
}
