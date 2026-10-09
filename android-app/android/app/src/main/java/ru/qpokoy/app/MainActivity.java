package ru.qpokoy.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintManager;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

/** Temporary HTTPS frontend prototype. No app token, OAuth secret or release key. */
public class MainActivity extends BridgeActivity {
    private String adapter;
    private WebView reportView;
    private AlertDialog reportDialog;
    private byte[] pendingDownload;
    private ActivityResultLauncher<Intent> saveDocument;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // Native inset strips use the app's existing dark background.
        getWindow().getDecorView().setBackgroundColor(android.graphics.Color.rgb(7,12,20));
        installTopSafeArea();
        try (InputStream input=getAssets().open("android-adapter.js")) {
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            byte[] buffer=new byte[4096];int count;
            while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            adapter=new String(output.toByteArray(),StandardCharsets.UTF_8);
        } catch (Exception error) { throw new IllegalStateException("Android adapter missing",error); }
        saveDocument=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),result->{
            byte[] bytes=pendingDownload;pendingDownload=null;
            if(result.getResultCode()!=RESULT_OK||result.getData()==null||bytes==null)return;
            try (OutputStream output=getContentResolver().openOutputStream(result.getData().getData())) {
                if(output==null)throw new IllegalStateException("No output stream");
                output.write(bytes);
                toast("Файл сохранён");
            } catch (Exception error) { toast("Не удалось сохранить файл"); }
        });
        WebView view=bridge.getWebView();
        installMessages(view);
        view.setWebViewClient(new BridgeWebViewClient(bridge){
            @Override public void onPageFinished(WebView web,String url) {
                super.onPageFinished(web,url);
                if(isInternal(Uri.parse(url)))web.evaluateJavascript(adapter,null);
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request) {
                if(!request.isForMainFrame())return super.shouldOverrideUrlLoading(web,request);
                Uri uri=request.getUrl();
                if(isInternal(uri))return false;
                external(uri);return true;
            }
        });
        view.setDownloadListener((url,userAgent,disposition,mime,length)->{
            if(url.startsWith("blob:https://qpokoy.ru/"))view.evaluateJavascript(
                "window.qPokoyAndroidDownload("+JSONObject.quote(url)+",'qpokoy-export',"+JSONObject.quote(mime)+")",null);
            else if(url.startsWith("https://"))external(Uri.parse(url));
        });
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){
            @Override public void handleOnBackPressed(){
                if(reportDialog!=null&&reportDialog.isShowing()){reportDialog.dismiss();return;}
                view.evaluateJavascript("Boolean(window.qPokoyAndroidBack && window.qPokoyAndroidBack())",handled->{
                    if("true".equals(handled))return;
                    if(view.canGoBack())view.goBack();
                    else new AlertDialog.Builder(MainActivity.this).setMessage("Закрыть qPokoy?")
                        .setNegativeButton("Остаться",null).setPositiveButton("Закрыть",(dialog,which)->finish()).show();
                });
            }
        });
    }
    private void installTopSafeArea(){
        // SystemBars can pass insets through on modern WebView + viewport-fit=cover.
        // Handle only the remaining top inset below its decor listener. Older
        // WebViews already get decor padding and send zero here: no double inset.
        View content=findViewById(android.R.id.content);
        int left=content.getPaddingLeft(),top=content.getPaddingTop();
        int right=content.getPaddingRight(),bottom=content.getPaddingBottom();
        ViewCompat.setOnApplyWindowInsetsListener(content,(view,insets)->{
            Insets status=insets.getInsets(WindowInsetsCompat.Type.statusBars());
            Insets cutout=insets.getInsets(WindowInsetsCompat.Type.displayCutout());
            view.setPadding(left,top+Math.max(status.top,cutout.top),right,bottom);
            // Notify WebView with a zero handled top inset, rather than CONSUMED.
            // Leave navigation, side and IME insets to the existing SystemBars path.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.statusBars(),Insets.of(status.left,0,status.right,status.bottom))
                .setInsets(WindowInsetsCompat.Type.displayCutout(),Insets.of(cutout.left,0,cutout.right,cutout.bottom))
                .build();
        });
        ViewCompat.requestApplyInsets(content);
    }
    private boolean isInternal(Uri uri){
        return "https".equals(uri.getScheme())&&"qpokoy.ru".equals(uri.getHost())&&(uri.getPort()==-1||uri.getPort()==443);
    }
    private void external(Uri uri){
        String scheme=uri.getScheme();
        if(!"https".equals(scheme)&&!"mailto".equals(scheme)&&!"tel".equals(scheme))return;
        try { startActivity(new Intent(Intent.ACTION_VIEW,uri)); }
        catch (Exception error){toast("Нет приложения для открытия ссылки");}
    }
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_SHORT).show();}
    private void installMessages(WebView view){
        if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)){
            toast("Обновите Android System WebView для печати и скачивания");return;
        }
        WebViewCompat.addWebMessageListener(view,"qPokoyAndroid",Collections.singleton("https://qpokoy.ru"),
            (web,message,origin,mainFrame,reply)->{
                if(!mainFrame||!isInternal(origin))return;
                String text=message.getData();if(text==null||text.length()>36*1024*1024)return;
                try {
                    JSONObject data=new JSONObject(text);
                    switch(data.optString("kind")){
                        case "external": external(Uri.parse(data.getString("url")));break;
                        case "print":
                            ((PrintManager)getSystemService(PRINT_SERVICE)).print("qPokoy",web.createPrintDocumentAdapter("qPokoy"),null);break;
                        case "report":
                            String html=data.getString("html");
                            if(html.length()<=5*1024*1024)openReport(html);break;
                        case "download":
                            if(pendingDownload!=null){toast("Сначала завершите сохранение файла");return;}
                            byte[] bytes=android.util.Base64.decode(data.getString("data"),android.util.Base64.DEFAULT);
                            if(bytes.length>25*1024*1024)return;
                            String mime=data.optString("mime").split(";")[0];
                            if(!mime.equals("application/pdf")&&!mime.equals("application/json")&&!mime.equals("text/html"))mime="application/octet-stream";
                            pendingDownload=bytes;
                            Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mime);
                            intent.putExtra(Intent.EXTRA_TITLE,data.optString("filename","qpokoy-export").replaceAll("[^\\p{L}\\p{N}._-]","_"));
                            try{saveDocument.launch(intent);}catch(Exception error){pendingDownload=null;toast("Не удалось открыть сохранение");}
                            break;
                    }
                } catch (Exception error){toast("Не удалось выполнить действие Android");}
            });
    }
    private void openReport(String html){
        if(reportDialog!=null)reportDialog.dismiss();
        reportView=new WebView(this);
        reportView.getSettings().setJavaScriptEnabled(true);
        installMessages(reportView);
        reportView.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView web,String url){web.evaluateJavascript(adapter,null);}
            @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request){external(request.getUrl());return true;}
        });
        WebView current=reportView;
        reportDialog=new AlertDialog.Builder(this).setView(current).setNegativeButton("Назад",(dialog,which)->dialog.dismiss()).create();
        reportDialog.setOnDismissListener(dialog->{current.destroy();if(reportView==current){reportView=null;reportDialog=null;}});
        reportDialog.show();
        current.loadDataWithBaseURL("https://qpokoy.ru/",html,"text/html","UTF-8",null);
        current.setDownloadListener((url,userAgent,disposition,mime,length)->{
            if(url.startsWith("blob:https://qpokoy.ru/"))current.evaluateJavascript(
                "window.qPokoyAndroidDownload("+JSONObject.quote(url)+",'qpokoy-report.pdf',"+JSONObject.quote(mime)+")",null);
        });
    }
}
