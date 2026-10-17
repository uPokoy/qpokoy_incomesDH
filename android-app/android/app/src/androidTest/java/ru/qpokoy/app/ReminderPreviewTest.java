package ru.qpokoy.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Explicitly selected on-device diagnostic; never adjusts the alarm or clock. */
@RunWith(AndroidJUnit4.class)
public class ReminderPreviewTest {
    @Test public void previewUsesProductionNotificationWithoutChangingSchedule(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        long before=ReminderNotifications.preferences(context).getLong("next_trigger_at",0);
        assertTrue("Notification permission required",ReminderNotifications.permissionGranted(context));
        assertTrue(ReminderNotifications.show(context));
        StatusBarNotification posted=null;
        for(StatusBarNotification row:context.getSystemService(NotificationManager.class).getActiveNotifications())if(row.getId()==ReminderNotifications.NOTIFICATION_ID)posted=row;
        assertNotNull(posted);
        assertEquals("Просто напоминаем",posted.getNotification().extras.getString(Notification.EXTRA_TITLE));
        assertEquals("Вы уже внесли свои доходы?",posted.getNotification().extras.getString(Notification.EXTRA_TEXT));
        assertEquals(before,ReminderNotifications.preferences(context).getLong("next_trigger_at",0));
    }
}
