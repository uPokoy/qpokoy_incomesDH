package ru.qpokoy.app;

import java.net.URI;

/** Pure validation; never retains credentials. */
final class PasswordSavePolicy {
    static boolean trustedPage(String url){
        if(url==null||!AppOrigin.trusts(url))return false;
        String path=URI.create(url).getPath();
        return path==null||path.isEmpty()||path.equals("/")||path.equals("/index.html");
    }
    static boolean valid(String email,String password){
        return email!=null&&!email.trim().isEmpty()&&email.length()<=320
            &&password!=null&&password.length()>=8&&password.length()<=1024;
    }
}
