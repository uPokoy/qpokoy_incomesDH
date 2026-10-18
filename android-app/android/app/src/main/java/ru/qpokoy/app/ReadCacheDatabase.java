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

/** Confirmed snapshots and a separately durable, account-bound create/update/delete outbox. */
final class ReadCacheDatabase extends SQLiteOpenHelper {
    static final int VERSION=1;
    static final int DATABASE_VERSION=6;
    static final String NAME="qpokoy-read-cache.db";
    ReadCacheDatabase(Context context){this(context,NAME);}
    ReadCacheDatabase(Context context,String name){super(context,name,null,DATABASE_VERSION);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE snapshots (session_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, schema_version INTEGER NOT NULL, synced_at INTEGER NOT NULL, digest TEXT NOT NULL, payload BLOB NOT NULL)");
        createOutbox(db);
        createCategoryOutbox(db);
    }
    private void createOutbox(SQLiteDatabase db){
        db.execSQL("CREATE TABLE IF NOT EXISTS pending_adds (operation_id TEXT PRIMARY KEY, income_id TEXT NOT NULL, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, income_date TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'add', sent INTEGER NOT NULL DEFAULT 0, UNIQUE(user_id,income_id))");
    }
    private void createCategoryOutbox(SQLiteDatabase db){
        db.execSQL("CREATE TABLE IF NOT EXISTS pending_categories (request_id TEXT NOT NULL, user_id TEXT NOT NULL, session_hash TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, created_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, error_code TEXT NOT NULL DEFAULT '', sent INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'category_add', category_id TEXT NOT NULL DEFAULT '', delete_requested INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id,request_id), UNIQUE(user_id,name_key))");
    }
    @Override public void onConfigure(SQLiteDatabase db){try(Cursor cursor=db.rawQuery("PRAGMA secure_delete=ON",null)){cursor.moveToFirst();}}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){
        if(oldVersion<5)createCategoryOutbox(db);
        else if(oldVersion<6){
            db.execSQL("ALTER TABLE pending_categories ADD COLUMN kind TEXT NOT NULL DEFAULT 'category_add'");
            db.execSQL("ALTER TABLE pending_categories ADD COLUMN category_id TEXT NOT NULL DEFAULT ''");
            db.execSQL("ALTER TABLE pending_categories ADD COLUMN delete_requested INTEGER NOT NULL DEFAULT 0");
        }
        if(oldVersion<2)createOutbox(db);
        else {
            if(oldVersion<3)db.execSQL("ALTER TABLE pending_adds ADD COLUMN kind TEXT NOT NULL DEFAULT 'add'");
            // Old APKs did not persist dispatch. Treat legacy operations as possibly sent.
            if(oldVersion<4)db.execSQL("ALTER TABLE pending_adds ADD COLUMN sent INTEGER NOT NULL DEFAULT 1");
        }
    }
    @Override public void onDowngrade(SQLiteDatabase db,int oldVersion,int newVersion){reset(db);}
    // A disposable snapshot may be reset; unconfirmed user operations must survive.
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
    void write(String hash,JSONObject snapshot) throws Exception {write(hash,snapshot,null);}
    void write(String hash,JSONObject snapshot,String deleteAck) throws Exception {write(hash,snapshot,deleteAck,null);}
    void write(String hash,JSONObject snapshot,String deleteAck,JSONObject categoryAck) throws Exception {
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
            db.update("pending_categories",session,"user_id=?",new String[]{uid});
            if(categoryAck!=null){
                String requestId=categoryAck.getString("request_id"),categoryId=categoryAck.getString("category_id");uuid(requestId);uuid(categoryId);
                try(Cursor operation=db.query("pending_categories",new String[]{"name","kind","delete_requested","category_id"},"user_id=? AND request_id=?",new String[]{uid,requestId},null,null,null)){
                    if(operation.moveToFirst()){
                        boolean found=false,matched=false;JSONArray categories=snapshot.getJSONArray("categories");
                        for(int i=0;i<categories.length();i++){JSONObject category=categories.getJSONObject(i);if(categoryId.equals(category.getString("id"))){found=true;matched=operation.getString(0).equals(category.getString("name"));}}
                        if(categoryAck.optBoolean("deleted",false)){
                            if(!"category_delete".equals(operation.getString(1))||!categoryId.equals(operation.getString(3))||found)throw new IllegalArgumentException("Invalid category deletion acknowledgement");
                            db.delete("pending_categories","user_id=? AND request_id=?",new String[]{uid,requestId});
                        }else{
                            if(!matched||!"category_add".equals(operation.getString(1)))throw new IllegalArgumentException("Invalid category acknowledgement");
                            if(operation.getInt(2)!=0){
                                ContentValues deletion=new ContentValues();deletion.put("kind","category_delete");deletion.put("category_id",categoryId);deletion.put("status","pending");deletion.put("attempts",0);deletion.put("next_attempt_at",0);deletion.put("error_code","");deletion.put("sent",0);
                                db.update("pending_categories",deletion,"user_id=? AND request_id=?",new String[]{uid,requestId});
                            }else db.delete("pending_categories","user_id=? AND request_id=?",new String[]{uid,requestId});
                        }
                    }
                }
            }
            if(deleteAck!=null){uuid(deleteAck);db.delete("pending_adds","session_hash=? AND user_id=? AND operation_id=? AND kind='delete'",new String[]{hash,uid,deleteAck});}
            JSONArray incomes=snapshot.getJSONArray("incomes");
            // Reconcile by immutable UUID. DELETE tombstones win over a server
            // snapshot until an explicit account-scoped DELETE ACK.
            try(Cursor pending=db.query("pending_adds",null,"user_id=?",new String[]{uid},null,null,null)){
                while(pending.moveToNext()){
                    String id=pending.getString(pending.getColumnIndexOrThrow("income_id"));
                    String kind=pending.getString(pending.getColumnIndexOrThrow("kind"));
                    JSONObject server=null;
                    for(int i=0;i<incomes.length();i++){
                        JSONObject candidate=incomes.getJSONObject(i);
                        if(id.equals(candidate.getString("id"))){server=candidate;break;}
                    }
                    if("delete".equals(kind)){
                        // Absence alone can precede an in-flight ADD: only an explicit DELETE ACK removes the tombstone.
                        continue;
                    }
                    if(server==null)continue;
                    boolean equal=server.getDouble("amount")==pending.getDouble(pending.getColumnIndexOrThrow("amount"));
                    for(String key:new String[]{"income_date","category","description"})equal &= server.getString(key).equals(pending.getString(pending.getColumnIndexOrThrow(key)));
                    if(equal)db.delete("pending_adds","user_id=? AND income_id=?",new String[]{uid,id});
                    else if("add".equals(kind)){
                        ContentValues update=new ContentValues();update.put("kind","update");update.put("status","pending");update.put("next_attempt_at",0);update.put("error_code","");
                        db.update("pending_adds",update,"user_id=? AND income_id=?",new String[]{uid,id});
                    }
                }
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
                for(String key:new String[]{"operation_id","income_id","user_id","income_date","category","description","status","error_code","kind"})row.put(key,c.getString(c.getColumnIndexOrThrow(key)));
                for(String key:new String[]{"created_at","attempts","next_attempt_at","sent"})row.put(key,c.getLong(c.getColumnIndexOrThrow(key)));
                row.put("amount",c.getDouble(c.getColumnIndexOrThrow("amount")));row.put("client_mutation_id",row.getString("income_id"));result.put(row);
            }
        }
        try(Cursor c=getReadableDatabase().query("pending_categories",null,"session_hash=? AND user_id=?",new String[]{hash,uid},null,null,"created_at,rowid")){
            while(c.moveToNext()){
                JSONObject row=new JSONObject();
                for(String key:new String[]{"request_id","user_id","name","status","error_code","kind","category_id"})row.put(key,c.getString(c.getColumnIndexOrThrow(key)));
                for(String key:new String[]{"created_at","attempts","next_attempt_at","sent","delete_requested"})row.put(key,c.getLong(c.getColumnIndexOrThrow(key)));
                row.put("operation_id",row.getString("request_id"));result.put(row);
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
    void enqueue(String hash,String uid,JSONObject row) throws Exception {enqueue(hash,uid,row,false);}
    void enqueueEdit(String hash,String uid,JSONObject row) throws Exception {enqueue(hash,uid,row,true);}
    private void enqueue(String hash,String uid,JSONObject row,boolean edit) throws Exception {
        bound(hash,uid);uuid(row.getString("operation_id"));uuid(row.getString("income_id"));
        String date=row.getString("income_date"),category=row.getString("category"),description=row.getString("description");double amount=row.getDouble("amount");
        if(!validDate(date)||!Double.isFinite(amount)||amount<=0||amount>1e12||amount!=Math.floor(amount)||category.trim().isEmpty()||category.length()>80||description.length()>5000)throw new IllegalArgumentException("Invalid income");
        boolean known=false;JSONArray cats=read(hash).getJSONArray("categories");
        for(int i=0;i<cats.length();i++)if(category.equals(cats.getJSONObject(i).getString("name")))known=true;
        if(!known)try(Cursor c=getReadableDatabase().query("pending_categories",new String[]{"name"},"session_hash=? AND user_id=? AND name=? AND delete_requested=0",new String[]{hash,uid,category},null,null,null)){known=c.moveToFirst();}
        if(!known)throw new IllegalArgumentException("Category unavailable offline");
        JSONArray confirmed=read(hash).getJSONArray("incomes");
        boolean exists=false;
        for(int i=0;i<confirmed.length();i++)if(row.getString("income_id").equals(confirmed.getJSONObject(i).getString("id")))exists=true;
        if(exists&&!edit)throw new IllegalArgumentException("Income already confirmed");
        if(row.getLong("created_at")<=0)throw new IllegalArgumentException("Invalid creation timestamp");
        ContentValues values=new ContentValues();values.put("operation_id",row.getString("operation_id"));values.put("income_id",row.getString("income_id"));values.put("user_id",uid);values.put("session_hash",hash);
        values.put("income_date",date);values.put("amount",amount);values.put("category",category);values.put("description",description);values.put("created_at",row.getLong("created_at"));values.put("status","pending");values.put("sent",0);
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            if(edit){
                String kind=null;
                try(Cursor c=db.query("pending_adds",new String[]{"kind","created_at","sent"},"session_hash=? AND user_id=? AND income_id=?",new String[]{hash,uid,row.getString("income_id")},null,null,null)){
                    if(c.moveToFirst()){kind=c.getString(0);values.put("created_at",c.getLong(1));values.put("sent",c.getInt(2));}
                }
                if("delete".equals(kind))throw new IllegalArgumentException("Income deleted locally");
                if(kind==null&&!exists)throw new IllegalArgumentException("Income unavailable locally");
                values.put("kind",kind==null?"update":kind);values.put("attempts",0);values.put("next_attempt_at",0);values.put("error_code","");
                db.delete("pending_adds","session_hash=? AND user_id=? AND income_id=?",new String[]{hash,uid,row.getString("income_id")});
            }
            db.insertOrThrow("pending_adds",null,values);db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    void enqueueDelete(String hash,String uid,String operationId,String incomeId,long createdAt,boolean collapseUnsentAdd) throws Exception {
        bound(hash,uid);uuid(operationId);uuid(incomeId);
        if(createdAt<=0)throw new IllegalArgumentException("Invalid creation timestamp");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            String oldKind=null,date=null,category=null,description=null;double amount=0;long queueCreated=createdAt;
            try(Cursor c=db.query("pending_adds",null,"session_hash=? AND user_id=? AND income_id=?",new String[]{hash,uid,incomeId},null,null,null)){
                if(c.moveToFirst()){
                    oldKind=c.getString(c.getColumnIndexOrThrow("kind"));
                    if("delete".equals(oldKind)){db.setTransactionSuccessful();return;}
                    if("add".equals(oldKind)&&collapseUnsentAdd&&c.getInt(c.getColumnIndexOrThrow("sent"))==0&&c.getInt(c.getColumnIndexOrThrow("attempts"))==0){
                        db.delete("pending_adds","session_hash=? AND user_id=? AND income_id=?",new String[]{hash,uid,incomeId});
                        db.setTransactionSuccessful();return;
                    }
                    date=c.getString(c.getColumnIndexOrThrow("income_date"));
                    category=c.getString(c.getColumnIndexOrThrow("category"));
                    description=c.getString(c.getColumnIndexOrThrow("description"));
                    amount=c.getDouble(c.getColumnIndexOrThrow("amount"));
                    queueCreated=c.getLong(c.getColumnIndexOrThrow("created_at"));
                }
            }
            if(oldKind==null){
                JSONArray confirmed=read(hash).getJSONArray("incomes");JSONObject existing=null;
                for(int i=0;i<confirmed.length();i++)if(incomeId.equals(confirmed.getJSONObject(i).getString("id"))){existing=confirmed.getJSONObject(i);break;}
                if(existing==null)throw new IllegalArgumentException("Income unavailable locally");
                date=existing.getString("income_date");category=existing.getString("category");description=existing.getString("description");amount=existing.getDouble("amount");
            }
            ContentValues values=new ContentValues();values.put("operation_id",operationId);values.put("income_id",incomeId);values.put("user_id",uid);values.put("session_hash",hash);
            values.put("income_date",date);values.put("amount",amount);values.put("category",category);values.put("description",description);values.put("created_at",queueCreated);
            values.put("status","pending");values.put("attempts",0);values.put("next_attempt_at",0);values.put("error_code","");values.put("kind","delete");values.put("sent",0);
            db.delete("pending_adds","session_hash=? AND user_id=? AND income_id=?",new String[]{hash,uid,incomeId});
            db.insertOrThrow("pending_adds",null,values);db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    // Explicit Unicode whitespace set works in both Android ICU and JVM regex.
    static String normalizeCategoryName(String raw){return raw.trim().replaceAll("[\\s\\p{Z}\\u0085]+"," ");}
    void enqueueCategory(String hash,String uid,JSONObject row) throws Exception {
        bound(hash,uid);String requestId=row.getString("request_id");uuid(requestId);
        Object raw=row.opt("name");if(!(raw instanceof String))throw new IllegalArgumentException("Invalid category name");
        String name=normalizeCategoryName((String)raw);
        if(name.isEmpty()||((String)raw).trim().length()>80||row.getLong("created_at")<=0)throw new IllegalArgumentException("Invalid category");
        String nameKey=name.toLowerCase(java.util.Locale.forLanguageTag("ru-RU"));
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            JSONArray categories=read(hash).getJSONArray("categories");
            for(int i=0;i<categories.length();i++)if(nameKey.equals(categories.getJSONObject(i).getString("name").toLowerCase(java.util.Locale.forLanguageTag("ru-RU"))))throw new IllegalArgumentException("Category already exists");
            ContentValues values=new ContentValues();values.put("request_id",requestId);values.put("user_id",uid);values.put("session_hash",hash);values.put("name",name);values.put("name_key",nameKey);values.put("created_at",row.getLong("created_at"));
            db.insertOrThrow("pending_categories",null,values);db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    void enqueueCategoryDelete(String hash,String uid,String categoryId,String operationId,long createdAt) throws Exception {
        bound(hash,uid);uuid(categoryId);uuid(operationId);if(createdAt<=0)throw new IllegalArgumentException("Invalid creation timestamp");
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            String name=null;
            try(Cursor c=db.query("pending_categories",null,"session_hash=? AND user_id=? AND (request_id=? OR category_id=?)",new String[]{hash,uid,categoryId,categoryId},null,null,null)){
                if(c.moveToFirst()){
                    name=c.getString(c.getColumnIndexOrThrow("name"));CategoryDeletionPolicy.checkName(name);
                    if(c.getInt(c.getColumnIndexOrThrow("delete_requested"))!=0){db.setTransactionSuccessful();return;}
                    boolean dependent;
                    try(Cursor incomes=db.rawQuery("SELECT COUNT(*) FROM pending_adds WHERE user_id=? AND category=? AND kind IN ('add','update')",new String[]{uid,name})){incomes.moveToFirst();dependent=incomes.getInt(0)>0;}
                    String requestId=c.getString(c.getColumnIndexOrThrow("request_id"));
                    if(CategoryDeletionPolicy.collapse(c.getInt(c.getColumnIndexOrThrow("sent")),c.getInt(c.getColumnIndexOrThrow("attempts")),dependent)){
                        db.delete("pending_categories","user_id=? AND request_id=?",new String[]{uid,requestId});
                    }else{
                        ContentValues mark=new ContentValues();mark.put("delete_requested",1);
                        db.update("pending_categories",mark,"user_id=? AND request_id=?",new String[]{uid,requestId});
                    }
                    db.setTransactionSuccessful();return;
                }
            }
            JSONArray categories=read(hash).getJSONArray("categories");
            for(int i=0;i<categories.length();i++)if(categoryId.equals(categories.getJSONObject(i).getString("id")))name=categories.getJSONObject(i).getString("name");
            if(name==null)throw new IllegalArgumentException("Category unavailable locally");CategoryDeletionPolicy.checkName(name);
            ContentValues values=new ContentValues();values.put("request_id",operationId);values.put("user_id",uid);values.put("session_hash",hash);values.put("name",name);values.put("name_key",name.toLowerCase(java.util.Locale.forLanguageTag("ru-RU")));values.put("created_at",createdAt);values.put("kind","category_delete");values.put("category_id",categoryId);values.put("delete_requested",1);
            db.insertOrThrow("pending_categories",null,values);db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }
    boolean beginSend(String hash,String uid,String operationId) throws Exception {
        bound(hash,uid);uuid(operationId);ContentValues values=new ContentValues();values.put("sent",1);
        SQLiteDatabase db=getWritableDatabase();
        return db.update("pending_adds",values,"session_hash=? AND user_id=? AND operation_id=?",new String[]{hash,uid,operationId})==1
            ||db.update("pending_categories",values,"session_hash=? AND user_id=? AND request_id=?",new String[]{hash,uid,operationId})==1;
    }
    void pendingState(String hash,String uid,String operationId,String status,long next,String code){
        checkHash(hash);uuid(operationId);
        if(!status.equals("pending")&&!status.equals("error")&&!status.equals("auth_required"))throw new IllegalArgumentException("Invalid status");
        if(!code.matches("[a-z0-9_]{0,40}"))throw new IllegalArgumentException("Invalid error metadata");
        SQLiteDatabase db=getWritableDatabase();db.execSQL("UPDATE pending_adds SET status=?,attempts=attempts+1,next_attempt_at=?,error_code=? WHERE session_hash=? AND user_id=? AND operation_id=?",new Object[]{status,next,code,hash,uid,operationId});
        db.execSQL("UPDATE pending_categories SET status=?,attempts=attempts+1,next_attempt_at=?,error_code=? WHERE session_hash=? AND user_id=? AND request_id=?",new Object[]{status,next,code,hash,uid,operationId});
    }
    int pendingCount(String hash){checkHash(hash);try(Cursor c=getReadableDatabase().rawQuery("SELECT (SELECT COUNT(*) FROM pending_adds WHERE session_hash=?)+(SELECT COUNT(*) FROM pending_categories WHERE session_hash=?)",new String[]{hash,hash})){c.moveToFirst();return c.getInt(0);}}
}
