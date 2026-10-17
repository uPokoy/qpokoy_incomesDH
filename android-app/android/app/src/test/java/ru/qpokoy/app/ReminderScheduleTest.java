package ru.qpokoy.app;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReminderScheduleTest {
    private long at(String zone,int year,int month,int day,int hour,int minute){
        Calendar c=Calendar.getInstance(TimeZone.getTimeZone(zone));c.clear();c.set(year,month-1,day,hour,minute,0);return c.getTimeInMillis();
    }
    private void next(String zone,int y,int m,int d,int h,int min,int ey,int em,int ed){
        long now=at(zone,y,m,d,h,min),expected=at(zone,ey,em,ed,18,0);
        assertEquals(expected,ReminderSchedule.next(now,TimeZone.getTimeZone(zone)));
        assertTrue(expected>now);
    }
    @Test public void beforeFirst(){next("UTC",2026,4,30,23,59,2026,5,1);}
    @Test public void firstBeforeEighteen(){next("UTC",2026,5,1,17,59,2026,5,1);}
    @Test public void firstAtEighteenIsConsumed(){next("UTC",2026,5,1,18,0,2026,5,15);}
    @Test public void afterFirst(){next("UTC",2026,5,2,12,0,2026,5,15);}
    @Test public void fifteenthBeforeEighteen(){next("UTC",2026,5,15,17,59,2026,5,15);}
    @Test public void fifteenthAtEighteenIsConsumed(){next("UTC",2026,5,15,18,0,2026,6,1);}
    @Test public void afterFifteenth(){next("UTC",2026,5,16,12,0,2026,6,1);}
    @Test public void decemberToJanuary(){next("UTC",2026,12,31,23,59,2027,1,1);}
    @Test public void februaryLeapYear(){next("UTC",2028,2,29,12,0,2028,3,1);}
    @Test public void localMoscowTimezone(){next("Europe/Moscow",2026,10,17,12,0,2026,11,1);}
    @Test public void fractionalTimezone(){next("Asia/Kathmandu",2026,10,31,23,59,2026,11,1);}
    @Test public void dstSpringRetainsWallClock(){next("Europe/Berlin",2026,3,16,12,0,2026,4,1);}
    @Test public void dstAutumnRetainsWallClock(){next("America/New_York",2026,10,16,12,0,2026,11,1);}
    @Test public void timezoneChangeUsesNewZone(){
        long now=at("UTC",2026,5,1,15,30);
        assertEquals(at("Europe/Moscow",2026,5,15,18,0),ReminderSchedule.next(now,TimeZone.getTimeZone("Europe/Moscow")));
        assertEquals(at("America/New_York",2026,5,1,18,0),ReminderSchedule.next(now,TimeZone.getTimeZone("America/New_York")));
    }
    @Test public void oldAndroidNeverPrompts(){assertFalse(ReminderSchedule.needsPermissionPrompt(32,false,false));}
    @Test public void androidThirteenPromptsOnce(){assertTrue(ReminderSchedule.needsPermissionPrompt(33,false,false));assertFalse(ReminderSchedule.needsPermissionPrompt(36,false,true));}
    @Test public void grantedPermissionNeverPrompts(){assertFalse(ReminderSchedule.needsPermissionPrompt(36,true,false));}
}
