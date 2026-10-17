package ru.qpokoy.app;

import java.util.Calendar;
import java.util.TimeZone;

/** Calendar dates, not fixed day intervals: retain 18:00 across months and DST. */
final class ReminderSchedule {
    static long next(long now,TimeZone zone){
        Calendar candidate=Calendar.getInstance(zone);
        candidate.setTimeInMillis(now);
        candidate.set(Calendar.DAY_OF_MONTH,1);
        candidate.set(Calendar.HOUR_OF_DAY,18);
        candidate.set(Calendar.MINUTE,0);
        candidate.set(Calendar.SECOND,0);
        candidate.set(Calendar.MILLISECOND,0);
        if(candidate.getTimeInMillis()>now)return candidate.getTimeInMillis();
        candidate.set(Calendar.DAY_OF_MONTH,15);
        if(candidate.getTimeInMillis()>now)return candidate.getTimeInMillis();
        candidate.set(Calendar.DAY_OF_MONTH,1);
        candidate.add(Calendar.MONTH,1);
        return candidate.getTimeInMillis();
    }
    static boolean needsPermissionPrompt(int sdk,boolean granted,boolean asked){
        return sdk>=33&&!granted&&!asked;
    }
}
