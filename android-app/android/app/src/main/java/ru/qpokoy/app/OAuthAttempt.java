package ru.qpokoy.app;

import java.net.URI;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Private durable attempt, shared by cold/warm delivery and the Capacitor plugin.
 * No session/provider tokens. Store.write MUST durably commit before returning. */
final class OAuthAttempt {
    interface Store { String read(); boolean write(String value); }
    static final Object LOCK = new Object();
    static final long TTL = 600000, CALLBACK_TTL = 120000;
    static final String CALLBACK = "ru.qpokoy.app://oauth/callback";
    private final Store store;
    OAuthAttempt(Store store) { this.store = store; }
    static String encode(byte[] data) {
        String alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        StringBuilder out=new StringBuilder(); int bits=0,value=0;
        for(byte b:data){value=(value<<8)|(b&255);bits+=8;while(bits>=6){bits-=6;out.append(alphabet.charAt((value>>>bits)&63));}}
        if(bits>0)out.append(alphabet.charAt((value<<(6-bits))&63));
        return out.toString();
    }
    static String random() { byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);return encode(bytes); }
    static String challenge(String verifier) {
        try{return encode(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));}
        catch(Exception error){throw new IllegalStateException("SHA-256 unavailable");}
    }
    static Map<String,String> parse(String value) {
        try {
            if(value==null||value.length()>6000)return null;
            URI uri=new URI(value);
            if(!"ru.qpokoy.app".equals(uri.getScheme())||!"oauth".equals(uri.getRawAuthority())||
                !"/callback".equals(uri.getRawPath())||uri.getUserInfo()!=null||uri.getPort()!=-1||uri.getRawFragment()!=null)return null;
            Map<String,String> result=new HashMap<>();
            String query=uri.getRawQuery();if(query==null)return null;
            // All allowed values are URL-safe; reject encoded/ambiguous aliases too.
            for(String pair:query.split("&",-1)){
                String[] parts=pair.split("=",-1);
                if(parts.length!=2||!(parts[0].equals("ticket")||parts[0].equals("attempt_id")||parts[0].equals("error"))||result.put(parts[0],parts[1])!=null)return null;
            }
            if(!result.getOrDefault("attempt_id", "").matches("[A-Za-z0-9_-]{43}"))return null;
            String ticket=result.get("ticket"),error=result.get("error");
            if((ticket==null)==(error==null)||result.size()!=2)return null;
            if(ticket!=null&&(ticket.length()>4096||!ticket.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}")))return null;
            if(error!=null&&!error.matches("[a-z_]{1,64}"))return null;
            return result;
        } catch(Exception ignored){return null;}
    }
    private String[] active(long now) {
        String raw=store.read();if(raw==null||raw.isEmpty())return null;
        try{
            String[] values=raw.split("\n",-1);
            if(values.length!=6||!values[0].matches("[A-Za-z0-9_-]{43}")||!values[1].matches("[A-Za-z0-9_-]{43}"))throw new IllegalArgumentException();
            long created=Long.parseLong(values[2]),received=Long.parseLong(values[5]);
            if(now<created||now-created>=TTL||(received>0&&(now<received||now-received>=CALLBACK_TTL)))throw new IllegalArgumentException();
            return values;
        }catch(Exception ignored){persist("");return null;}
    }
    // String.join is API 26; retain the application's existing API 24 support.
    private static String pack(String... values){
        StringBuilder result=new StringBuilder();
        for(int i=0;i<values.length;i++){if(i>0)result.append('\n');result.append(values[i]);}
        return result.toString();
    }
    private void persist(String value){if(!store.write(value))throw new IllegalStateException("Cannot commit OAuth attempt");}
    String begin(long now) {
        synchronized(LOCK){
            String id=random(),verifier=random();
            persist(pack(id,verifier,Long.toString(now),"","","0"));
            return id+"&code_challenge="+challenge(verifier);
        }
    }
    boolean accept(String uri,long now) {
        synchronized(LOCK){
            Map<String,String> callback=parse(uri);String[] values=active(now);
            if(callback==null||values==null||!values[0].equals(callback.get("attempt_id"))||!values[5].equals("0"))return false;
            values[3]=callback.getOrDefault("ticket","");values[4]=callback.getOrDefault("error","");values[5]=Long.toString(now);
            persist(pack(values));return true;
        }
    }
    String[] pending(long now){synchronized(LOCK){String[] value=active(now);return value!=null&&!value[5].equals("0")?value:null;}}
    void acknowledge(String id){synchronized(LOCK){String raw=store.read();if(raw!=null&&raw.startsWith(id+"\n"))persist("");}}
    void cancel(){synchronized(LOCK){persist("");}}
}
