package ru.qpokoy.app;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.UUID;
import static org.junit.Assert.*;

/** Disposable DELETE-outbox fixture; never touches the signed-in app database. */
@RunWith(AndroidJUnit4.class)
public class OfflineDeleteDatabaseTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final String name="offline-delete-tests.db";
    private final String hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    private ReadCacheDatabase db(){return new ReadCacheDatabase(context,name);}
    private JSONObject snapshot(String uid) throws Exception {
        return new JSONObject().put("schemaVersion",1).put("lastSuccessfulSync",System.currentTimeMillis())
            .put("user",new JSONObject().put("user_id",uid)).put("incomes",new JSONArray()).put("settings",new JSONArray())
            .put("categories",new JSONArray().put(new JSONObject().put("id","cat").put("user_id",uid).put("name","Test")));
    }
    private JSONObject income(String id,int amount) throws Exception {
        return new JSONObject().put("id",id).put("user_id","A").put("income_date","2026-10-10")
            .put("amount",amount).put("category","Test").put("description","Fixture");
    }
    private JSONObject pending(String id,int amount) throws Exception {
        return new JSONObject().put("operation_id",UUID.randomUUID().toString()).put("income_id",id)
            .put("income_date","2026-10-10").put("amount",amount).put("category","Test").put("description","Fixture")
            .put("created_at",System.currentTimeMillis());
    }

    @Test public void confirmedDeleteTombstoneSurvivesStaleSnapshotAndClearsWhenAbsent() throws Exception {
        context.deleteDatabase(name);String id=UUID.randomUUID().toString();JSONObject stale=snapshot("A");stale.getJSONArray("incomes").put(income(id,100));
        try(ReadCacheDatabase db=db()){
            db.write(hash,stale);
            db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),id,System.currentTimeMillis(),false);
            assertEquals("delete",db.pending(hash,"A").getJSONObject(0).getString("kind"));
            db.write(hash,stale);assertEquals(1,db.pendingCount(hash));
            db.write(hash,snapshot("A"));assertEquals(0,db.pendingCount(hash));
        }finally{context.deleteDatabase(name);}
    }

    @Test public void neverSentAddDeleteCollapsesToNothing() throws Exception {
        context.deleteDatabase(name);String id=UUID.randomUUID().toString();
        try(ReadCacheDatabase db=db()){
            db.write(hash,snapshot("A"));db.enqueue(hash,"A",pending(id,100));
            db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),id,System.currentTimeMillis(),true);
            assertEquals(0,db.pendingCount(hash));
        }finally{context.deleteDatabase(name);}
    }

    @Test public void attemptedAddAndPendingUpdateBecomeSingleDeleteTombstone() throws Exception {
        context.deleteDatabase(name);String addId=UUID.randomUUID().toString(),updateId=UUID.randomUUID().toString();
        try(ReadCacheDatabase db=db()){
            db.write(hash,snapshot("A"));JSONObject add=pending(addId,100);db.enqueue(hash,"A",add);
            db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),addId,System.currentTimeMillis(),false);
            JSONObject row=db.pending(hash,"A").getJSONObject(0);assertEquals("delete",row.getString("kind"));assertEquals(addId,row.getString("income_id"));

            JSONObject confirmed=snapshot("A");confirmed.getJSONArray("incomes").put(income(addId,100)).put(income(updateId,200));db.write(hash,confirmed);
            db.enqueueEdit(hash,"A",pending(updateId,250));
            db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),updateId,System.currentTimeMillis(),false);
            JSONArray rows=db.pending(hash,"A");assertEquals(2,rows.length());
            int deletes=0;for(int i=0;i<rows.length();i++)if("delete".equals(rows.getJSONObject(i).getString("kind")))deletes++;
            assertEquals(2,deletes);
        }finally{context.deleteDatabase(name);}
    }

    @Test public void repeatedDeleteKeepsOneDurableTombstoneAcrossReopen() throws Exception {
        context.deleteDatabase(name);String id=UUID.randomUUID().toString();JSONObject confirmed=snapshot("A");confirmed.getJSONArray("incomes").put(income(id,300));
        try(ReadCacheDatabase db=db()){
            db.write(hash,confirmed);db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),id,System.currentTimeMillis(),false);
            db.enqueueDelete(hash,"A",UUID.randomUUID().toString(),id,System.currentTimeMillis(),false);
            assertEquals(1,db.pendingCount(hash));
        }
        try(ReadCacheDatabase db=db()){
            assertEquals(1,db.pendingCount(hash));assertEquals("delete",db.pending(hash,"A").getJSONObject(0).getString("kind"));
        }finally{context.deleteDatabase(name);}
    }
}
