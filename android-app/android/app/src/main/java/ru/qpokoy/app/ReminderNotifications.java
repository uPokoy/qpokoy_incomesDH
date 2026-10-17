package ru.qpokoy.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.TimeZone;

/** Entirely local; no session, financial data or network access. */
final class ReminderNotifications {
    static final String CHANNEL="qpokoy_income_reminders";
    static final String ACTION="ru.qpokoy.app.REMIND_INCOME";
    static final String PREFS="qpokoy.reminders";
    static final String TITLE="Просто напоминаем";
    static final String TEXT="Вы уже внесли свои доходы?";
    static final int ALARM_ID=1518;
    static final int NOTIFICATION_ID=1518;

    static SharedPreferences preferences(Context context){return context.getSharedPreferences(PREFS,Context.MODE_PRIVATE);}
    static void ensureChannel(Context context){
        if(Build.VERSION.SDK_INT<26)return;
        NotificationManager manager=context.getSystemService(NotificationManager.class);
        if(manager==null||manager.getNotificationChannel(CHANNEL)!=null)return; // Preserve user's channel choices.
        NotificationChannel channel=new NotificationChannel(CHANNEL,"Напоминания qPokoy",NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Напоминания внести доходы 1 и 15 числа");
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
    static PendingIntent alarmIntent(Context context){
        Intent intent=new Intent(context,ReminderReceiver.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context,ALARM_ID,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static void schedule(Context context){
        AlarmManager alarms=context.getSystemService(AlarmManager.class);if(alarms==null)return;
        TimeZone zone=TimeZone.getDefault();long next=ReminderSchedule.next(System.currentTimeMillis(),zone);
        // A fixed PendingIntent identity replaces the previous alarm; never append jobs.
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,next,alarmIntent(context));
        preferences(context).edit().putLong("next_trigger_at",next).putString("next_timezone",zone.getID()).apply();
    }
    static void initialize(Context context){ensureChannel(context);schedule(context);}
    static boolean permissionGranted(Context context){
        return Build.VERSION.SDK_INT<33||ContextCompat.checkSelfPermission(context,Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
    }
    static boolean markPermissionPrompt(Context context){
        SharedPreferences prefs=preferences(context);
        if(!ReminderSchedule.needsPermissionPrompt(Build.VERSION.SDK_INT,permissionGranted(context),prefs.getBoolean("permission_requested",false)))return false;
        // Persist before launch so recreation/denial/dismissal cannot prompt repeatedly.
        return prefs.edit().putBoolean("permission_requested",true).commit();
    }
    static PendingIntent openAppIntent(Context context){
        Intent intent=new Intent(context,MainActivity.class).setAction(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context,ALARM_ID,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    static Notification build(Context context){
        return new NotificationCompat.Builder(context,CHANNEL)
            .setSmallIcon(R.drawable.ic_reminder_notification)
            .setContentTitle(TITLE).setContentText(TEXT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER).setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setDefaults(Notification.DEFAULT_SOUND|Notification.DEFAULT_VIBRATE)
            .setContentIntent(openAppIntent(context)).setAutoCancel(true).build();
    }
    static boolean show(Context context){
        ensureChannel(context);
        if(!permissionGranted(context)||!NotificationManagerCompat.from(context).areNotificationsEnabled())return false;
        try{NotificationManagerCompat.from(context).notify(NOTIFICATION_ID,build(context));return true;}
        catch(SecurityException denied){return false;}
    }
}
