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

/** Disposable SQLite fixtures only; never uses the signed-in app database. */
@RunWith(AndroidJUnit4.class)
public class OfflineCategoryDatabaseTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private final String file="offline-category-tests.db";
    private final String hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    private final String other="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    private JSONObject snapshot(String uid) throws Exception {
        return new JSONObject().put("schemaVersion",1).put("lastSuccessfulSync",System.currentTimeMillis())
            .put("user",new JSONObject().put("user_id",uid)).put("incomes",new JSONArray()).put("settings",new JSONArray())
            .put("categories",new JSONArray().put(new JSONObject().put("id","cat").put("user_id",uid).put("name","Test")));
    }
    private JSONObject category(String name) throws Exception {
        return new JSONObject().put("request_id",UUID.randomUUID().toString()).put("name",name).put("created_at",System.currentTimeMillis());
    }
    private JSONObject income(String category) throws Exception {
        return new JSONObject().put("operation_id",UUID.randomUUID().toString()).put("income_id",UUID.randomUUID().toString())
            .put("income_date","2026-10-17").put("amount",12).put("category",category).put("description","").put("created_at",System.currentTimeMillis());
    }
    @Test public void whitespaceNormalizationDoesNotThrowOnAndroidIcu() {
        String[][] cases={{"Taxi work","Taxi work"},{"Taxi   work","Taxi work"},{"Такси\t\tдоход","Такси доход"},
            {"Такси\nдоход","Такси доход"},{" \tТакси \r\n доход \n","Такси доход"},{"Такси\u00a0\u202fдоход","Такси доход"}};
        for(String[] row:cases)assertEquals(row[1],ReadCacheDatabase.normalizeCategoryName(row[0]));
    }
    @Test public void committedCategoryAndDependentIncomeSurviveDatabaseReopen() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,snapshot("A"));db.enqueueCategory(hash,"A",row);db.enqueue(hash,"A",income("Такси"));assertEquals(2,db.pendingCount(hash));
        }
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            JSONArray rows=db.pending(hash,"A");assertEquals(2,rows.length());
            JSONObject pending=rows.getJSONObject(1);assertEquals("category_add",pending.getString("kind"));assertEquals(row.getString("request_id"),pending.getString("request_id"));
        }finally{context.deleteDatabase(file);}
    }
    @Test public void onlyExplicitAckCanRemoveCategoryAndSnapshotCommitsWithIt() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");String serverId=UUID.randomUUID().toString();
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            JSONObject state=snapshot("A");db.write(hash,state);db.enqueueCategory(hash,"A",row);
            state.getJSONArray("categories").put(new JSONObject().put("id",serverId).put("user_id","A").put("name","Такси"));
            db.write(hash,state);assertEquals(1,db.pendingCount(hash)); // Same name is not an ACK.
            JSONObject ack=new JSONObject().put("request_id",row.getString("request_id")).put("category_id",serverId);
            db.write(hash,state,null,ack);assertEquals(0,db.pendingCount(hash));assertEquals(2,db.read(hash).getJSONArray("categories").length());
        }finally{context.deleteDatabase(file);}
    }
    @Test public void invalidAckRollsBackSnapshotAndKeepsOperation() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,snapshot("A"));db.enqueueCategory(hash,"A",row);
            JSONObject bad=snapshot("A");bad.getJSONArray("settings").put(new JSONObject().put("user_id","A").put("setting_key","changed").put("setting_value","true"));
            try{db.write(hash,bad,null,new JSONObject().put("request_id",row.getString("request_id")).put("category_id",UUID.randomUUID().toString()));fail("Invalid ACK accepted");}catch(IllegalArgumentException expected){}
            assertEquals(1,db.pendingCount(hash));assertEquals(0,db.read(hash).getJSONArray("settings").length());
        }finally{context.deleteDatabase(file);}
    }
    @Test public void duplicatesAreRejectedAndFailureMetadataSurvivesRestart() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,snapshot("A"));db.enqueueCategory(hash,"A",row);
            try{db.enqueueCategory(hash,"A",category("ТАКСИ"));fail("Pending duplicate accepted");}catch(android.database.sqlite.SQLiteConstraintException expected){}
            try{db.enqueueCategory(hash,"A",category("test"));fail("Server duplicate accepted");}catch(IllegalArgumentException expected){}
            assertTrue(db.beginSend(hash,"A",row.getString("request_id")));
            db.pendingState(hash,"A",row.getString("request_id"),"error",0,"idempotency_conflict");
        }
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            JSONObject saved=db.pending(hash,"A").getJSONObject(0);assertEquals("idempotency_conflict",saved.getString("error_code"));assertEquals(1,saved.getInt("sent"));assertEquals(1,db.pendingCount(hash));
        }finally{context.deleteDatabase(file);}
    }
    @Test public void userSwitchHidesPendingButSameUserRebindRecoversIt() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,snapshot("A"));db.enqueueCategory(hash,"A",row);db.clear();db.write(other,snapshot("B"));
            assertEquals(0,db.pending(other,"B").length());assertFalse(db.beginSend(other,"B",row.getString("request_id")));
            db.write(other,snapshot("A"));assertEquals(1,db.pending(other,"A").length());assertEquals(row.getString("request_id"),db.pending(other,"A").getJSONObject(0).getString("request_id"));
        }finally{context.deleteDatabase(file);}
    }
    @Test public void versionFourUpgradePreservesExistingIncomeQueue() throws Exception {
        context.deleteDatabase(file);
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,snapshot("A"));db.enqueue(hash,"A",income("Test"));
            db.getWritableDatabase().execSQL("DROP TABLE pending_categories");db.getWritableDatabase().setVersion(4);
        }
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            assertEquals(1,db.pendingCount(hash));assertEquals("add",db.pending(hash,"A").getJSONObject(0).getString("kind"));
            db.enqueueCategory(hash,"A",category("Такси"));assertEquals(2,db.pendingCount(hash));
        }finally{context.deleteDatabase(file);}
    }

    @Test public void categoryDeleteTombstonePersistsAndAckNeverChangesIncome() throws Exception {
        context.deleteDatabase(file);String id=UUID.randomUUID().toString(),op=UUID.randomUUID().toString();JSONObject row=income("Такси");
        JSONObject state=snapshot("A");state.getJSONArray("categories").put(new JSONObject().put("id",id).put("user_id","A").put("name","Такси"));
        JSONObject confirmed=new JSONObject(row.toString()).put("id",row.getString("income_id")).put("user_id","A");state.getJSONArray("incomes").put(confirmed);String original=confirmed.toString();
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            db.write(hash,state);db.enqueueCategoryDelete(hash,"A",id,op,System.currentTimeMillis());db.enqueueCategoryDelete(hash,"A",id,UUID.randomUUID().toString(),System.currentTimeMillis());
            assertEquals(1,db.pendingCount(hash));assertEquals(original,db.read(hash).getJSONArray("incomes").getJSONObject(0).toString());
        }
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            assertEquals("category_delete",db.pending(hash,"A").getJSONObject(0).getString("kind"));
            db.write(hash,state);assertEquals(1,db.pendingCount(hash)); // A stale bootstrap cannot ACK a deletion.
            try{db.write(hash,state,null,new JSONObject().put("request_id",op).put("category_id",id).put("deleted",true));fail("Category still present");}catch(IllegalArgumentException expected){}
            state.put("categories",new JSONArray());db.write(hash,state,null,new JSONObject().put("request_id",op).put("category_id",id).put("deleted",true));
            assertEquals(0,db.pendingCount(hash));assertEquals(original,db.read(hash).getJSONArray("incomes").getJSONObject(0).toString());
        }finally{context.deleteDatabase(file);}
    }
    @Test public void unsentCategoryCanCollapseButSentCreateAndDependentIncomeMustSurvive() throws Exception {
        context.deleteDatabase(file);JSONObject row=category("Такси");
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            JSONObject state=snapshot("A");db.write(hash,state);db.enqueueCategory(hash,"A",row);db.enqueueCategoryDelete(hash,"A",row.getString("request_id"),UUID.randomUUID().toString(),System.currentTimeMillis());assertEquals(0,db.pendingCount(hash));
            db.enqueueCategory(hash,"A",row);JSONObject dependent=income("Такси");db.enqueue(hash,"A",dependent);
            assertTrue(db.beginSend(hash,"A",row.getString("request_id")));db.enqueueCategoryDelete(hash,"A",row.getString("request_id"),UUID.randomUUID().toString(),System.currentTimeMillis());assertEquals(2,db.pendingCount(hash));assertEquals(1,db.pending(hash,"A").getJSONObject(1).getInt("delete_requested"));
            String id=UUID.randomUUID().toString();state.getJSONArray("categories").put(new JSONObject().put("id",id).put("user_id","A").put("name","Такси"));
            db.write(hash,state,null,new JSONObject().put("request_id",row.getString("request_id")).put("category_id",id));
            JSONArray pending=db.pending(hash,"A");assertEquals(2,pending.length());assertEquals("Такси",pending.getJSONObject(0).getString("category"));assertEquals("category_delete",pending.getJSONObject(1).getString("kind"));assertEquals(id,pending.getJSONObject(1).getString("category_id"));
        }finally{context.deleteDatabase(file);}
    }
    @Test public void salaryAndAccountMismatchCannotDeleteAndVersionFiveUpgradePreservesQueues() throws Exception {
        context.deleteDatabase(file);String id=UUID.randomUUID().toString();
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            JSONObject state=snapshot("A");state.getJSONArray("categories").put(new JSONObject().put("id",id).put("user_id","A").put("name","Зарплата"));db.write(hash,state);
            try{db.enqueueCategoryDelete(hash,"B",id,UUID.randomUUID().toString(),System.currentTimeMillis());fail();}catch(IllegalArgumentException expected){}
            try{db.enqueueCategoryDelete(hash,"A",id,UUID.randomUUID().toString(),System.currentTimeMillis());fail();}catch(IllegalArgumentException expected){}
            db.enqueue(hash,"A",income("Test"));db.enqueueCategory(hash,"A",category("Такси"));
            db.getWritableDatabase().execSQL("ALTER TABLE pending_categories DROP COLUMN kind");db.getWritableDatabase().execSQL("ALTER TABLE pending_categories DROP COLUMN category_id");db.getWritableDatabase().execSQL("ALTER TABLE pending_categories DROP COLUMN delete_requested");db.getWritableDatabase().setVersion(5);
        }
        try(ReadCacheDatabase db=new ReadCacheDatabase(context,file)){
            assertEquals(2,db.pendingCount(hash));assertEquals("category_add",db.pending(hash,"A").getJSONObject(1).getString("kind"));
        }finally{context.deleteDatabase(file);}
    }
}
