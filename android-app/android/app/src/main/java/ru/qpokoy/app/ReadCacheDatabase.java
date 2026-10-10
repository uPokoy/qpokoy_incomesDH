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
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Disposable server snapshots, never an offline write queue or credential store. */
final class ReadCacheDatabase extends SQLiteOpenHelper {
    static final int VERSION=1;
    static final String NAME="qpokoy-read-cache.db";
    ReadCacheDatabase(Context context){this(context,NAME);}
    ReadCacheDatabase(Context context,String name){super(context,name,null,VERSION);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE snapshots (session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, schema_version INTEGER NOT NULL, synced_at INTEGER NOT NULL, digest TEXT NOT NULL, payload BLOB NOT NULL)");
    }
    @Override public void onConfigure(SQLiteDatabase db){try(Cursor cursor=db.rawQuery("PRAGMA secure_delete=ON",null)){cursor.moveToFirst();}}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){reset(db);}
    @Override public void onDowngrade(SQLiteDatabase db,int oldVersion,int newVersion){reset(db);}
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
            db.delete("snapshots",null,null);db.insertOrThrow("snapshots",null,values);db.setTransactionSuccessful();
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
}
