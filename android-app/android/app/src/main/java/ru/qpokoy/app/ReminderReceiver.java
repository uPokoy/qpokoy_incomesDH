package ru.qpokoy.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderReceiver extends BroadcastReceiver {
    static boolean restores(String action){
        return Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
            ||Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action);
    }
    @Override public void onReceive(Context context,Intent intent){
        String action=intent==null?null:intent.getAction();
        if(ReminderNotifications.ACTION.equals(action)){
            try{ReminderNotifications.show(context);}finally{ReminderNotifications.schedule(context);}
        }else if(restores(action))ReminderNotifications.initialize(context);
    }
}
