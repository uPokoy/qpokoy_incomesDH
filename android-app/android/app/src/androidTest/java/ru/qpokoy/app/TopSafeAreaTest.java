package ru.qpokoy.app;

import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.assertEquals;

@RunWith(AndroidJUnit4.class)
public class TopSafeAreaTest {
    @Test public void remainingTopIsAppliedOnceWithoutChangingNavigationOrKeyboard(){
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{
                View content=activity.findViewById(android.R.id.content);
                WindowInsetsCompat empty=new WindowInsetsCompat.Builder().build();
                ViewCompat.dispatchApplyWindowInsets(content,empty);
                int baseTop=content.getPaddingTop();
                WindowInsetsCompat incoming=new WindowInsetsCompat.Builder()
                    .setInsets(WindowInsetsCompat.Type.statusBars(),Insets.of(0,24,0,0))
                    .setInsets(WindowInsetsCompat.Type.displayCutout(),Insets.of(0,48,0,0))
                    .setInsets(WindowInsetsCompat.Type.navigationBars(),Insets.of(0,0,0,32))
                    .setInsets(WindowInsetsCompat.Type.ime(),Insets.of(0,0,0,300))
                    .build();
                WindowInsetsCompat forwarded=ViewCompat.dispatchApplyWindowInsets(content,incoming);
                assertEquals(baseTop+48,content.getPaddingTop());
                assertEquals(0,forwarded.getInsets(WindowInsetsCompat.Type.statusBars()).top);
                assertEquals(0,forwarded.getInsets(WindowInsetsCompat.Type.displayCutout()).top);
                assertEquals(32,forwarded.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom);
                assertEquals(300,forwarded.getInsets(WindowInsetsCompat.Type.ime()).bottom);
                ViewCompat.dispatchApplyWindowInsets(content,incoming);
                assertEquals(baseTop+48,content.getPaddingTop());
                ViewCompat.dispatchApplyWindowInsets(content,empty);
                assertEquals(baseTop,content.getPaddingTop());
                ViewCompat.requestApplyInsets(content);
            });
        }
    }
}
