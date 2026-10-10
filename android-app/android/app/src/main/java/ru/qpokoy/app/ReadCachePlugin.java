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
                JSObject result=new JSObject();result.put("snapshot",epoch==generation.get()&&snapshot!=null?snapshot:JSONObject.NULL);call.resolve(result);
            }catch(Exception error){call.reject("Read cache unavailable");}
        });
    }
    @PluginMethod public void write(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{
                if(epoch==generation.get())database.write(call.getString("sessionHash"),call.getObject("snapshot"));
                call.resolve();
            }catch(Exception error){call.reject("Cannot save read cache");}
        });
    }
    @PluginMethod public void clear(PluginCall call){
        generation.incrementAndGet();worker.execute(()->{
            try{database.clear();call.resolve();}catch(Exception error){
                database.close();
                if(getContext().deleteDatabase(ReadCacheDatabase.NAME)){database=new ReadCacheDatabase(getContext());call.resolve();}
                else call.reject("Cannot clear read cache");
            }
        });
    }
    @Override protected void handleOnDestroy(){worker.execute(()->database.close());}
}
