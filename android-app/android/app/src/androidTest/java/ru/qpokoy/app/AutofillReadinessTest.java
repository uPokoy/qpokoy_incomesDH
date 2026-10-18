package ru.qpokoy.app;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class AutofillReadinessTest {
    /** Read-only prerequisite: never log out with a durable operation still queued. */
    @Test public void pendingQueueMustBeEmptyBeforeManualLogout(){
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        java.io.File file=context.getDatabasePath(ReadCacheDatabase.NAME);
        if(!file.exists())return;
        try(SQLiteDatabase db=SQLiteDatabase.openDatabase(file.getAbsolutePath(),null,SQLiteDatabase.OPEN_READONLY);
            Cursor rows=db.rawQuery("SELECT (SELECT COUNT(*) FROM pending_adds)+(SELECT COUNT(*) FROM pending_categories)",null)){
            assertTrue(rows.moveToFirst());
            assertEquals("Unsynced operations: stop before logout",0,rows.getInt(0));
        }
    }
}
