package ru.qpokoy.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ProviderInfo;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Environment;
import android.system.Os;
import androidx.core.content.FileProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Isolated fixtures only: no account, database, or existing user files are changed. */
@RunWith(AndroidJUnit4.class)
public class FileProviderTest {
    private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    private String authority(){return context.getPackageName()+".fileprovider";}
    private Uri uri(File file){return FileProvider.getUriForFile(context,authority(),file);}
    private void denied(File file){
        try{uri(file);fail("File outside Pictures was exposed: "+file);}
        catch(IllegalArgumentException expected){/* canonical path must be outside the only root */}
    }
    @Test public void providerIsPrivateWithTemporaryGrants(){
        ProviderInfo info=context.getPackageManager().resolveContentProvider(authority(),0);
        assertNotNull(info);assertFalse(info.exported);assertTrue(info.grantUriPermissions);
    }
    private byte[] shellRead(Uri value) throws Exception {
        try(android.os.ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .executeShellCommand("content read --uri "+value);
            java.io.FileInputStream input=new java.io.FileInputStream(descriptor.getFileDescriptor())){
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[1024];int size;
            while((size=input.read(buffer))!=-1)output.write(buffer,0,size);
            return output.toByteArray();
        }
    }
    @Test public void anotherUidNeedsAnExplicitRevocableReadGrant() throws Exception {
        File file=File.createTempFile("qpokoy-provider-grant-",".json",context.getExternalFilesDir(Environment.DIRECTORY_PICTURES));
        byte[] fixture="{\"synthetic\":true}".getBytes(StandardCharsets.UTF_8);
        Uri value=uri(file);
        try{
            try(FileOutputStream output=new FileOutputStream(file)){output.write(fixture);}
            assertFalse(java.util.Arrays.equals(fixture,shellRead(value)));
            context.grantUriPermission("com.android.shell",value,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertArrayEquals(fixture,shellRead(value));
            context.revokeUriPermission(value,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            assertFalse(java.util.Arrays.equals(fixture,shellRead(value)));
        }finally{context.revokeUriPermission(value,Intent.FLAG_GRANT_READ_URI_PERMISSION);assertTrue(file.delete());}
    }
    /** Explicit chooser/viewer inspection; no recipient is selected and no file is sent to another person. */
    @Test public void systemPdfViewerAndSharesheet() throws Exception {
        String phase=InstrumentationRegistry.getArguments().getString("providerUi","");
        org.junit.Assume.assumeTrue("Explicit system viewer/sharesheet test required",phase.equals("view")||phase.equals("share"));
        File file=File.createTempFile("qpokoy-provider-ui-",".pdf",context.getExternalFilesDir(Environment.DIRECTORY_PICTURES));
        try{
            PdfDocument document=new PdfDocument();
            try(FileOutputStream output=new FileOutputStream(file)){
                PdfDocument.Page page=document.startPage(new PdfDocument.PageInfo.Builder(400,400,1).create());
                page.getCanvas().drawText("qPokoy FileProvider TEST",30,50,new android.graphics.Paint());
                document.finishPage(page);document.writeTo(output);
            }finally{document.close();}
            Uri value=uri(file);
            Intent action=phase.equals("view")?new Intent(Intent.ACTION_VIEW).setDataAndType(value,"application/pdf"):
                new Intent(Intent.ACTION_SEND).setType("application/pdf").putExtra(Intent.EXTRA_STREAM,value);
            action.setClipData(android.content.ClipData.newRawUri("Synthetic qPokoy PDF",value));
            action.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.startActivity(Intent.createChooser(action,"qPokoy FileProvider TEST").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            Thread.sleep(30000); // Give the tester time to inspect and dismiss the system UI.
        }finally{context.revokeUriPermission(uri(file),Intent.FLAG_GRANT_READ_URI_PERMISSION);assertTrue(file.delete());}
    }
    @Test public void pdfAndJsonUrisCanBeReadAndOfferedToSystemApps() throws Exception {
        File pictures=context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        assertNotNull(pictures);assertTrue(pictures.isDirectory()||pictures.mkdirs());
        File pdf=File.createTempFile("qpokoy-provider-test-",".pdf",pictures);
        File json=File.createTempFile("qpokoy-provider-test-",".json",pictures);
        try{
            PdfDocument document=new PdfDocument();
            try(FileOutputStream output=new FileOutputStream(pdf)){
                PdfDocument.Page page=document.startPage(new PdfDocument.PageInfo.Builder(200,200,1).create());
                page.getCanvas().drawText("qPokoy test",20,40,new android.graphics.Paint());
                document.finishPage(page);document.writeTo(output);
            }finally{document.close();}
            byte[] data="{\"format\":\"qPokoy-income-backup\",\"version\":1,\"incomes\":[]}".getBytes(StandardCharsets.UTF_8);
            try(FileOutputStream output=new FileOutputStream(json)){output.write(data);}
            for(File file:new File[]{pdf,json}){
                Uri value=uri(file);assertEquals("content",value.getScheme());
                String mime=file==pdf?"application/pdf":"application/json";
                assertEquals(mime,context.getContentResolver().getType(value));
                try(java.io.InputStream input=context.getContentResolver().openInputStream(value)){
                    java.io.ByteArrayOutputStream content=new java.io.ByteArrayOutputStream();
                    byte[] buffer=new byte[4096];int size;
                    while((size=input.read(buffer))!=-1)content.write(buffer,0,size);
                    byte[] bytes=content.toByteArray();assertEquals(file.length(),bytes.length);
                    if(file==pdf)assertTrue(new String(bytes,0,5,StandardCharsets.US_ASCII).startsWith("%PDF-"));
                    else assertEquals(1,new org.json.JSONObject(new String(bytes,StandardCharsets.UTF_8)).getInt("version"));
                }
                Intent send=new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,value)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                send.setClipData(android.content.ClipData.newRawUri("qPokoy test",value));
                assertNotNull(Intent.createChooser(send,"qPokoy test").resolveActivity(context.getPackageManager()));
            }
        }finally{assertTrue(pdf.delete());assertTrue(json.delete());}
    }
    @Test public void privateCacheDatabasesAndExternalRootAreNotExposed(){
        denied(new File(context.getCacheDir(),"report.pdf"));
        denied(new File(context.getFilesDir(),"credentials.json"));
        denied(context.getDatabasePath("read-cache.db"));
        denied(new File(Environment.getExternalStorageDirectory(),"Download/report.pdf"));
        denied(new File(context.getExternalFilesDir(null),"report.pdf"));
        denied(new File(context.getExternalFilesDir(null),"Pictures-other/report.pdf"));
        denied(new File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES),"../report.pdf"));
    }
    @Test public void canonicalSymlinkCannotEscapeAllowedRoot() throws Exception {
        File pictures=context.getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        // App-private external storage may forbid symlinks (FUSE); in that case traversal is tested above.
        File link=new File(pictures,"qpokoy-provider-symlink-test");
        try{Os.symlink(context.getFilesDir().getAbsolutePath(),link.getAbsolutePath());}
        catch(android.system.ErrnoException unsupported){org.junit.Assume.assumeNoException(unsupported);return;}
        try{denied(new File(link,"private.json"));}finally{assertTrue(link.delete());}
    }
    private void systemResolves(String action,String mime) throws Exception {
        // Package visibility can hide document providers from resolveActivity(); the shell sees OS handlers.
        try(android.os.ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation()
                .executeShellCommand("cmd package resolve-activity --brief -a "+action+" -c android.intent.category.OPENABLE -t "+mime);
            java.io.FileInputStream input=new java.io.FileInputStream(descriptor.getFileDescriptor())){
            java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[1024];int size;
            while((size=input.read(buffer))!=-1)output.write(buffer,0,size);
            assertTrue("No system document handler",output.toString("UTF-8").contains("/"));
        }
    }
    @Test public void safExportAndImportRemainAvailable() throws Exception {
        for(String mime:new String[]{"application/pdf","application/json"}){
            Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime);
            systemResolves(save.getAction(),mime);
        }
        Intent open=new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json");
        systemResolves(open.getAction(),"application/json");
    }
}
