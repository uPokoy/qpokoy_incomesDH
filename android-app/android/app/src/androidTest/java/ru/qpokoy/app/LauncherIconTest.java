package ru.qpokoy.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.AdaptiveIconDrawable;
import android.graphics.drawable.Drawable;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import static org.junit.Assert.*;

/** Uses Android's actual vector renderer, without opening WebView or user data. */
@RunWith(AndroidJUnit4.class)
public class LauncherIconTest {
    private final Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

    private Bitmap foreground(int resource, int size) {
        Bitmap image = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Drawable drawable = context.getDrawable(resource);
        drawable.setBounds(0, 0, size, size);
        drawable.draw(new Canvas(image));
        return image;
    }

    private Path mask(String kind, int size) {
        Path path = new Path();
        if (kind.equals("circle")) path.addCircle(size/2f, size/2f, size/2f, Path.Direction.CW);
        else if (kind.equals("rounded-square")) path.addRoundRect(0,0,size,size,size*.22f,size*.22f,Path.Direction.CW);
        else {
            // Squircle / One UI-like approximation. Actual Samsung mask is OEM-owned.
            float c = kind.equals("squircle") ? .10f : .16f;
            path.moveTo(size/2f,0);
            path.cubicTo(size*(1-c),0,size, size*c,size,size/2f);
            path.cubicTo(size,size*(1-c),size*(1-c),size,size/2f,size);
            path.cubicTo(size*c,size,0,size*(1-c),0,size/2f);
            path.cubicTo(0,size*c,size*c,0,size/2f,0);
            path.close();
        }
        return path;
    }

    private Bitmap icon(String kind, int size) {
        Bitmap image = Bitmap.createBitmap(size,size,Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(image);
        canvas.clipPath(mask(kind,size));
        canvas.drawColor(context.getColor(R.color.ic_launcher_background));
        // Adaptive layers are 108dp; the mask viewport is 72dp (18dp overscan).
        Drawable mark = context.getDrawable(R.drawable.ic_launcher_foreground);
        int extra = size/4;
        mark.setBounds(-extra,-extra,size+extra,size+extra);
        mark.draw(canvas);
        return image;
    }

    private void save(File folder, String name, Bitmap image) throws Exception {
        try (FileOutputStream out = new FileOutputStream(new File(folder,name))) {
            assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,out));
        }
    }

    @Test public void safeZoneMasksAndLegacyExports() throws Exception {
        assertTrue(context.getDrawable(R.mipmap.ic_launcher) instanceof AdaptiveIconDrawable);
        AdaptiveIconDrawable adaptive = (AdaptiveIconDrawable) context.getDrawable(R.mipmap.ic_launcher);
        assertNotNull(adaptive.getMonochrome());
        for (int resource : new int[]{R.drawable.ic_launcher_foreground,R.drawable.ic_launcher_monochrome}) {
            Bitmap fg = foreground(resource,432);
            int count = 0;
            for (int y=0;y<432;y++) for (int x=0;x<432;x++) {
                if (Color.alpha(fg.getPixel(x,y)) > 0) {
                    count++;
                    double dx=x+.5-216,dy=y+.5-216;
                    assertTrue("Mark outside 66dp safe circle",dx*dx+dy*dy <= 132*132);
                }
            }
            assertTrue(count > 1000);
        }
        File folder = new File(context.getExternalFilesDir(null),"icon-review");
        assertTrue(folder.isDirectory() || folder.mkdirs());
        String[] names = {"circle","rounded-square","squircle","one-ui-like"};
        Bitmap sheet = Bitmap.createBitmap(1280,360,Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(sheet);
        canvas.drawColor(Color.rgb(32,38,48));
        Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        text.setColor(Color.WHITE);text.setTextSize(20);
        for (int i=0;i<names.length;i++) {
            canvas.drawBitmap(icon(names[i],288),i*320+16,16,null);
            canvas.drawText(names[i],i*320+16,338,text);
        }
        save(folder,"adaptive-masks.png",sheet);
        save(folder,"monochrome.png",foreground(R.drawable.ic_launcher_monochrome,432));
        int[] sizes={48,72,96,144,192};
        String[] densities={"mdpi","hdpi","xhdpi","xxhdpi","xxxhdpi"};
        for (int i=0;i<sizes.length;i++) {
            save(folder,"ic_launcher-"+densities[i]+".png",icon("rounded-square",sizes[i]));
            save(folder,"ic_launcher_round-"+densities[i]+".png",icon("circle",sizes[i]));
        }
    }
}
