package ru.qpokoy.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

@CapacitorPlugin(name="QPokoyReadCache")
public class ReadCachePlugin extends Plugin {
    // Shared ordering across Activity instances prevents a late old write after logout.
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static final AtomicLong generation=new AtomicLong();
    private ReadCacheDatabase database;
    @Override public void load(){database=new ReadCacheDatabase(getContext());}
    @PluginMethod public void read(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{
                JSONObject snapshot=database.read(call.getString("sessionHash"));
                JSObject result=new JSObject();boolean valid=epoch==generation.get()&&snapshot!=null;
                result.put("snapshot",valid?snapshot:JSONObject.NULL);
                result.put("pending",valid?database.pending(call.getString("sessionHash"),snapshot.getJSONObject("user").getString("user_id")):new org.json.JSONArray());call.resolve(result);
            }catch(Exception error){call.reject("Read cache unavailable");}
        });
    }
    @PluginMethod public void write(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{
                if(epoch!=generation.get()){call.reject("Session changed");return;}
                database.write(call.getString("sessionHash"),call.getObject("snapshot"));
                JSObject result=new JSObject();result.put("pending",database.pending(call.getString("sessionHash"),call.getObject("snapshot").getJSONObject("user").getString("user_id")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot save read cache");}
        });
    }
    @PluginMethod public void clear(PluginCall call){
        generation.incrementAndGet();worker.execute(()->{
            // Never delete the database: it may contain unconfirmed offline additions.
            try{database.clear();call.resolve();}catch(Exception error){call.reject("Cannot clear read cache");}
        });
    }
    @PluginMethod public void enqueue(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{if(epoch!=generation.get())throw new IllegalStateException("Session changed");
                database.enqueue(call.getString("sessionHash"),call.getString("userId"),call.getObject("income"));
                JSObject result=new JSObject();result.put("pending",database.pending(call.getString("sessionHash"),call.getString("userId")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot save offline income");}
        });
    }
    @PluginMethod public void pendingState(PluginCall call){worker.execute(()->{
        try{database.pendingState(call.getString("sessionHash"),call.getString("userId"),call.getString("operationId"),call.getString("status"),call.getLong("nextAttempt",0L),call.getString("code",""));call.resolve();}
        catch(Exception error){call.reject("Cannot update pending status");}
    });}
    @PluginMethod public void pendingCount(PluginCall call){worker.execute(()->{
        try{JSObject result=new JSObject();result.put("count",database.pendingCount(call.getString("sessionHash")));call.resolve(result);}
        catch(Exception error){call.reject("Cannot check pending incomes");}
    });}
    @Override protected void handleOnDestroy(){worker.execute(()->database.close());}
}
