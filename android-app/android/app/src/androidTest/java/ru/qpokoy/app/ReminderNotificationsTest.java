package ru.qpokoy.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ReminderNotificationsTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    @Test public void notificationChannelAndContent(){
        ReminderNotifications.ensureChannel(context);Notification n=ReminderNotifications.build(context);
        assertEquals("Просто напоминаем",n.extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Вы уже внесли свои доходы?",n.extras.getString(Notification.EXTRA_TEXT));
        assertEquals(Notification.CATEGORY_REMINDER,n.category);
        if(Build.VERSION.SDK_INT<26)assertEquals(Notification.DEFAULT_SOUND|Notification.DEFAULT_VIBRATE,n.defaults&(Notification.DEFAULT_SOUND|Notification.DEFAULT_VIBRATE));
        assertNotNull(n.getSmallIcon());assertNotNull(n.contentIntent);
        assertTrue((n.flags&Notification.FLAG_AUTO_CANCEL)!=0);
        if(Build.VERSION.SDK_INT>=26){
            NotificationChannel channel=context.getSystemService(NotificationManager.class).getNotificationChannel(ReminderNotifications.CHANNEL);
            assertEquals(NotificationManager.IMPORTANCE_DEFAULT,channel.getImportance());assertNotNull(channel.getSound());assertTrue(channel.shouldVibrate());
        }
    }
    @Test public void stableAlarmAndTapIdentityPreventDuplicates(){
        PendingIntent before=ReminderNotifications.alarmIntent(context);
        ReminderNotifications.schedule(context);ReminderNotifications.schedule(context);
        assertEquals(before,ReminderNotifications.alarmIntent(context));
        assertEquals(context.getPackageName(),ReminderNotifications.openAppIntent(context).getCreatorPackage());
        assertEquals(ReminderNotifications.openAppIntent(context),ReminderNotifications.openAppIntent(context));
    }
    @Test public void rebootUpdateAndClockChangesRestoreNextCalendarAlarm(){
        ReminderReceiver receiver=new ReminderReceiver();
        for(String action:new String[]{Intent.ACTION_BOOT_COMPLETED,Intent.ACTION_MY_PACKAGE_REPLACED,Intent.ACTION_TIME_CHANGED,Intent.ACTION_TIMEZONE_CHANGED}){
            assertTrue(ReminderReceiver.restores(action));receiver.onReceive(context,new Intent(action));
            long next=ReminderNotifications.preferences(context).getLong("next_trigger_at",0);
            assertEquals(ReminderSchedule.next(System.currentTimeMillis(),java.util.TimeZone.getDefault()),next);
        }
        assertFalse(ReminderReceiver.restores("unrelated"));
    }
    @Test public void unknownBroadcastDoesNotPostOrChangeSchedule(){
        long before=ReminderNotifications.preferences(context).getLong("next_trigger_at",0);
        new ReminderReceiver().onReceive(context,new Intent("unrelated"));
        assertEquals(before,ReminderNotifications.preferences(context).getLong("next_trigger_at",0));
    }
}
