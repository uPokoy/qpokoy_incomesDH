package ru.qpokoy.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Confirmed snapshots and a separately durable, account-bound create-only outbox. */
final class ReadCacheDatabase extends SQLiteOpenHelper {
    static final int VERSION=1;
    static final int DATABASE_VERSION=2;
    static final String NAME="qpokoy-read-cache.db";
    ReadCacheDatabase(Context context){this(context,NAME);}
    ReadCacheDatabase(Context context,String name){super(context,name,null,DATABASE_VERSION);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE snapshots (session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, schema_version INTEGER NOT NULL, synced_at INTEGER NOT NULL, digest TEXT NOT NULL, payload BLOB NOT NULL)");
        createOutbox(db);
    }
    private void createOutbox(SQLiteDatabase db){
        db.execSQL("CREATE TABLE IF NOT EXISTS pending_adds (operation_id TEXT PRIMARY KEY, income_id TEXT NOT NULL, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, income_date TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', UNIQUE(user_id,income_id))");
    }
    @Override public void onConfigure(SQLiteDatabase db){try(Cursor cursor=db.rawQuery("PRAGMA secure_delete=ON",null)){cursor.moveToFirst();}}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){if(oldVersion==1&&newVersion==2)createOutbox(db);else reset(db);}
    @Override public void onDowngrade(SQLiteDatabase db,int oldVersion,int newVersion){reset(db);}
    // A disposable snapshot may be reset; unconfirmed user additions must survive.
    private void reset(SQLiteDatabase db){db.execSQL("DROP TABLE IF EXISTS snapshots");onCreate(db);}
    static void checkHash(String hash){if(hash==null||!hash.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid session binding");}
    static void validate(JSONObject snapshot,String userId) throws Exception {
        if(snapshot.getInt("schemaVersion")!=VERSION||!userId.equals(snapshot.getJSONObject("user").getString("user_id")))throw new IllegalArgumentException("Incompatible snapshot");
        for(String key:new String[]{"incomes","categories","settings"}){
            JSONArray rows=snapshot.getJSONArray(key);
            for(int i=0;i<rows.length();i++)if(!userId.equals(rows.getJSONObject(i).getString("user_id")))throw new IllegalArgumentException("Account mismatch");
        }
        if(snapshot.getLong("lastSuccessfulSync")<=0)throw new IllegalArgumentException("Invalid sync timestamp");
    }
    private static String digest(byte[] bytes) throws Exception {
        StringBuilder result=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))result.append(String.format("%02x",b&255));return result.toString();
    }
    void write(String hash,JSONObject snapshot) throws Exception {
        checkHash(hash);String uid=snapshot.getJSONObject("user").getString("user_id");validate(snapshot,uid);
        byte[] bytes=snapshot.toString().getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        try(GZIPOutputStream gzip=new GZIPOutputStream(output)){gzip.write(bytes);}
        ContentValues values=new ContentValues();values.put("session_hash",hash);values.put("user_id",uid);values.put("schema_version",VERSION);
        values.put("synced_at",snapshot.getLong("lastSuccessfulSync"));values.put("digest",digest(bytes));values.put("payload",output.toByteArray());
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            // Keep only the current account/session; replacing a snapshot is atomic.
            db.delete("snapshots",null,null);db.insertOrThrow("snapshots",null,values);
            ContentValues session=new ContentValues();session.put("session_hash",hash);
            db.update("pending_adds",session,"user_id=?",new String[]{uid});
            Set<String> confirmed=new HashSet<>();JSONArray incomes=snapshot.getJSONArray("incomes");
            for(int i=0;i<incomes.length();i++)confirmed.add(incomes.getJSONObject(i).getString("id"));
            try(Cursor pending=db.query("pending_adds",new String[]{"income_id"},"user_id=?",new String[]{uid},null,null,null)){
                while(pending.moveToNext())if(confirmed.contains(pending.getString(0)))db.delete("pending_adds","user_id=? AND income_id=?",new String[]{uid,pending.getString(0)});
            }
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    JSONObject read(String hash) throws Exception {
        checkHash(hash);SQLiteDatabase db=getWritableDatabase();
        try(Cursor c=db.query("snapshots",null,"session_hash=?",new String[]{hash},null,null,null)){
            if(!c.moveToFirst())return null;
            try{
                if(c.getInt(c.getColumnIndexOrThrow("schema_version"))!=VERSION)throw new IllegalArgumentException("Old schema");
                ByteArrayOutputStream output=new ByteArrayOutputStream();
                try(GZIPInputStream input=new GZIPInputStream(new ByteArrayInputStream(c.getBlob(c.getColumnIndexOrThrow("payload"))))){
                    byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
                }
                byte[] bytes=output.toByteArray();
                if(!digest(bytes).equals(c.getString(c.getColumnIndexOrThrow("digest"))))throw new IllegalArgumentException("Damaged cache");
                JSONObject snapshot=new JSONObject(new String(bytes,StandardCharsets.UTF_8));validate(snapshot,c.getString(c.getColumnIndexOrThrow("user_id")));return snapshot;
            }catch(Exception damaged){db.delete("snapshots","session_hash=?",new String[]{hash});return null;}
        }
    }
    void clear(){getWritableDatabase().delete("snapshots",null,null);}
    private void bound(String hash,String uid) throws Exception {
        JSONObject s=read(hash);if(s==null||!uid.equals(s.getJSONObject("user").getString("user_id")))throw new IllegalArgumentException("Unverified account binding");
    }
    JSONArray pending(String hash,String uid) throws Exception {
        bound(hash,uid);JSONArray result=new JSONArray();
        try(Cursor c=getReadableDatabase().query("pending_adds",null,"session_hash=? AND user_id=?",new String[]{hash,uid},null,null,"created_at,rowid")){
            while(c.moveToNext()){
                JSONObject row=new JSONObject();
                for(String key:new String[]{"operation_id","income_id","user_id","income_date","category","description","status","error_code"})row.put(key,c.getString(c.getColumnIndexOrThrow(key)));
                for(String key:new String[]{"created_at","attempts","next_attempt_at"})row.put(key,c.getLong(c.getColumnIndexOrThrow(key)));
                row.put("amount",c.getDouble(c.getColumnIndexOrThrow("amount")));row.put("client_mutation_id",row.getString("income_id"));result.put(row);
            }
        }return result;
    }
    private void uuid(String id){if(id==null||!id.matches("(?i)[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"))throw new IllegalArgumentException("Invalid UUID");}
    // Gregorian ISO date validation without java.time (the app still supports API 24).
    private boolean validDate(String date){
        if(!date.matches("\\d{4}-\\d{2}-\\d{2}"))return false;
        int year=Integer.parseInt(date.substring(0,4)),month=Integer.parseInt(date.substring(5,7)),day=Integer.parseInt(date.substring(8,10));
        if(month<1||month>12||day<1)return false;
        int[] days={31,year%4==0&&(year%100!=0||year%400==0)?29:28,31,30,31,30,31,31,30,31,30,31};
        return day<=days[month-1];
    }
    void enqueue(String hash,String uid,JSONObject row) throws Exception {
        bound(hash,uid);uuid(row.getString("operation_id"));uuid(row.getString("income_id"));
        String date=row.getString("income_date"),category=row.getString("category"),description=row.getString("description");double amount=row.getDouble("amount");
        if(!validDate(date)||!Double.isFinite(amount)||amount<=0||amount>1e12||amount!=Math.floor(amount)||category.trim().isEmpty()||category.length()>80||description.length()>5000)throw new IllegalArgumentException("Invalid income");
        boolean known=false;JSONArray cats=read(hash).getJSONArray("categories");
        for(int i=0;i<cats.length();i++)if(category.equals(cats.getJSONObject(i).getString("name")))known=true;
        if(!known)throw new IllegalArgumentException("Category unavailable offline");
        JSONArray confirmed=read(hash).getJSONArray("incomes");
        for(int i=0;i<confirmed.length();i++)if(row.getString("income_id").equals(confirmed.getJSONObject(i).getString("id")))throw new IllegalArgumentException("Income already confirmed");
        if(row.getLong("created_at")<=0)throw new IllegalArgumentException("Invalid creation timestamp");
        ContentValues values=new ContentValues();values.put("operation_id",row.getString("operation_id"));values.put("income_id",row.getString("income_id"));values.put("user_id",uid);values.put("session_hash",hash);
        values.put("income_date",date);values.put("amount",amount);values.put("category",category);values.put("description",description);values.put("created_at",row.getLong("created_at"));values.put("status","pending");
        getWritableDatabase().insertOrThrow("pending_adds",null,values);
    }
    void pendingState(String hash,String uid,String operationId,String status,long next,String code){
        checkHash(hash);uuid(operationId);
        if(!status.equals("pending")&&!status.equals("error")&&!status.equals("auth_required"))throw new IllegalArgumentException("Invalid status");
        if(!code.matches("[a-z0-9_]{0,40}"))throw new IllegalArgumentException("Invalid error metadata");
        SQLiteDatabase db=getWritableDatabase();db.execSQL("UPDATE pending_adds SET status=?,attempts=attempts+1,next_attempt_at=?,error_code=? WHERE session_hash=? AND user_id=? AND operation_id=?",new Object[]{status,next,code,hash,uid,operationId});
    }
    int pendingCount(String hash){checkHash(hash);try(Cursor c=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM pending_adds WHERE session_hash=?",new String[]{hash})){c.moveToFirst();return c.getInt(0);}}
}
