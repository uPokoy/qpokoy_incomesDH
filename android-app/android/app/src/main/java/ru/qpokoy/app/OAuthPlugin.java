package ru.qpokoy.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;

@CapacitorPlugin(name="QPokoyOAuth")
public class OAuthPlugin extends Plugin {
    private static WeakReference<OAuthPlugin> current=new WeakReference<>(null);
    private static final String START="https://d5d5b8ibed0vmrrd7rj6.jki8ffxa.apigw.yandexcloud.net/auth/oauth/yandex/start?client=android&attempt_id=";
    static OAuthAttempt attempts(Context context){
        android.content.SharedPreferences prefs=context.getApplicationContext().getSharedPreferences("qpokoy.oauth.attempt",Context.MODE_PRIVATE);
        return new OAuthAttempt(new OAuthAttempt.Store(){
            public String read(){return prefs.getString("pending","");}
            public boolean write(String value){return prefs.edit().putString("pending",value).commit();}
        });
    }
    @Override public void load(){current=new WeakReference<>(this);}
    static void receive(Context context,String uri){
        try{if(attempts(context).accept(uri,System.currentTimeMillis())){OAuthPlugin plugin=current.get();if(plugin!=null)plugin.signal();}}
        catch(IllegalStateException ignored){/* Remain signed out on storage failure. */}
    }
    private void signal(){notifyListeners("available",new JSObject());}
    @Override protected void handleOnResume(){signal();}
    private void trusted(PluginCall call,Runnable operation){
        // Capacitor dispatches plugin methods off the UI thread. WebView URL
        // checks and ACTION_VIEW must run on the Activity thread.
        getActivity().runOnUiThread(()->{
            try{
                String url=getBridge().getWebView().getUrl();
                if(url==null||!AppOrigin.trusts(url)){call.reject("OAuth unavailable");return;}
                operation.run();
            }catch(Exception ignored){call.reject("OAuth operation unavailable");}
        });
    }
    @PluginMethod public void begin(PluginCall call){
        trusted(call,()->{
            if(!"yandex".equals(call.getString("provider"))){call.reject("Unsupported provider");return;}
            try{
                String proof=attempts(getContext()).begin(System.currentTimeMillis());
                // Durable commit above happens before the external browser opens.
                getActivity().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(START+proof+"&code_challenge_method=S256")));
                call.resolve();
            }catch(Exception ignored){
                try{attempts(getContext()).cancel();}catch(Exception storageUnavailable){/* No success UI. */}
                call.reject("Cannot open OAuth browser");
            }
        });
    }
    @PluginMethod public void pending(PluginCall call){
        trusted(call,()->{
            String[] value=attempts(getContext()).pending(System.currentTimeMillis());JSObject result=new JSObject();
            if(value!=null){result.put("attempt_id",value[0]);result.put("code_verifier",value[1]);result.put("ticket",value[3]);result.put("error",value[4]);}
            call.resolve(result);
        });
    }
    @PluginMethod public void acknowledge(PluginCall call){
        trusted(call,()->{
            String id=call.getString("attempt_id","");if(id.matches("[A-Za-z0-9_-]{43}"))attempts(getContext()).acknowledge(id);call.resolve();
        });
    }
    @PluginMethod public void cancel(PluginCall call){
        trusted(call,()->{attempts(getContext()).cancel();call.resolve();});
    }
    @Override protected void handleOnDestroy(){if(current.get()==this)current.clear();}
}
