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
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

@CapacitorPlugin(name="QPokoyReadCache")
public class ReadCachePlugin extends Plugin {
    // Shared ordering across Activity instances prevents a late old write after logout.
    private static final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static final AtomicLong generation=new AtomicLong();
    private ReadCacheDatabase database;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private Network defaultNetwork;
    private String lastNetworkState;
    @Override public void load(){
        database=new ReadCacheDatabase(getContext());
        connectivity=(ConnectivityManager)getContext().getApplicationContext().getSystemService(Context.CONNECTIVITY_SERVICE);
    }
    @PluginMethod public void getNetworkState(PluginCall call){call.resolve(AndroidNetworkState.read(connectivity));}
    private synchronized void publishNetwork(JSObject state){
        if(networkCallback==null)return;
        String value=state.toString();if(value.equals(lastNetworkState))return;
        lastNetworkState=value;notifyListeners("networkStateChange",state);
    }
    private synchronized void startNetworkMonitoring(){
        if(networkCallback!=null||connectivity==null)return;
        networkCallback=new ConnectivityManager.NetworkCallback(){
            @Override public void onAvailable(Network network){
                synchronized(ReadCachePlugin.this){if(networkCallback!=this)return;defaultNetwork=network;publishNetwork(AndroidNetworkState.unknown());}
            }
            @Override public void onCapabilitiesChanged(Network network,NetworkCapabilities caps){
                synchronized(ReadCachePlugin.this){if(networkCallback==this&&network.equals(defaultNetwork))publishNetwork(AndroidNetworkState.capabilities(true,caps));}
            }
            @Override public void onLost(Network network){
                synchronized(ReadCachePlugin.this){if(networkCallback==this&&network.equals(defaultNetwork)){defaultNetwork=null;publishNetwork(AndroidNetworkState.capabilities(false,null));}}
            }
        };
        try{connectivity.registerDefaultNetworkCallback(networkCallback);publishNetwork(AndroidNetworkState.read(connectivity));}
        catch(SecurityException|IllegalArgumentException unavailable){networkCallback=null;}
    }
    private synchronized void stopNetworkMonitoring(){
        ConnectivityManager.NetworkCallback callback=networkCallback;networkCallback=null;defaultNetwork=null;lastNetworkState=null;
        if(callback!=null)try{connectivity.unregisterNetworkCallback(callback);}catch(IllegalArgumentException ignored){}
    }
    @Override protected void handleOnResume(){startNetworkMonitoring();}
    @Override protected void handleOnPause(){stopNetworkMonitoring();}
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
                database.write(call.getString("sessionHash"),call.getObject("snapshot"),call.getString("deleteAck"));
                JSObject result=new JSObject();result.put("pending",database.pending(call.getString("sessionHash"),call.getObject("snapshot").getJSONObject("user").getString("user_id")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot save read cache");}
        });
    }
    @PluginMethod public void clear(PluginCall call){
        generation.incrementAndGet();worker.execute(()->{
            // Never delete the database: it may contain unconfirmed offline operations.
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
    @PluginMethod public void enqueueEdit(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{if(epoch!=generation.get())throw new IllegalStateException("Session changed");
                database.enqueueEdit(call.getString("sessionHash"),call.getString("userId"),call.getObject("income"));
                JSObject result=new JSObject();result.put("pending",database.pending(call.getString("sessionHash"),call.getString("userId")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot save local income edit");}
        });
    }
    @PluginMethod public void enqueueDelete(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{if(epoch!=generation.get())throw new IllegalStateException("Session changed");
                database.enqueueDelete(call.getString("sessionHash"),call.getString("userId"),call.getString("operationId"),call.getString("incomeId"),call.getLong("createdAt",0L),call.getBoolean("collapseUnsentAdd",false));
                JSObject result=new JSObject();result.put("pending",database.pending(call.getString("sessionHash"),call.getString("userId")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot save local income deletion");}
        });
    }
    @PluginMethod public void beginSend(PluginCall call){
        long epoch=generation.get();worker.execute(()->{
            try{if(epoch!=generation.get())throw new IllegalStateException("Session changed");
                JSObject result=new JSObject();result.put("allowed",database.beginSend(call.getString("sessionHash"),call.getString("userId"),call.getString("operationId")));call.resolve(result);
            }catch(Exception error){call.reject("Cannot dispatch pending income");}
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
    @Override protected void handleOnDestroy(){stopNetworkMonitoring();removeAllListeners();worker.execute(()->database.close());}
}
