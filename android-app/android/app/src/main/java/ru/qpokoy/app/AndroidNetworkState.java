package ru.qpokoy.app;

import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import com.getcapacitor.JSObject;

/** No SSID/IP/user data. INTERNET is configuration, VALIDATED is OS reachability. */
final class AndroidNetworkState {
    static JSObject capabilities(boolean active,NetworkCapabilities caps){
        boolean internet=caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        boolean validated=internet&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        JSObject result=new JSObject();
        result.put("state",!active||(caps!=null&&!internet)?"offline":validated?"online":"unknown");
        result.put("activeNetwork",active);result.put("internet",internet);result.put("validated",validated);
        return result;
    }
    static JSObject read(ConnectivityManager manager){
        try{
            if(manager==null)return unknown();Network active=manager.getActiveNetwork();
            return capabilities(active!=null,active==null?null:manager.getNetworkCapabilities(active));
        }catch(SecurityException unavailable){return unknown();}
    }
    static JSObject unknown(){JSObject result=new JSObject();result.put("state","unknown");return result;}
}
