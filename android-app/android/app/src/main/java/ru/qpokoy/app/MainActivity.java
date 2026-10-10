package ru.qpokoy.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.print.PrintManager;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
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
    private int topSafeInset;
    private WebView reportView;
    private AlertDialog reportDialog;
    private byte[] pendingDownload;
    private ActivityResultLauncher<Intent> saveDocument;
    private OfflineGuard offline;

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
        offline=new OfflineGuard(this,view,"https://qpokoy.ru/");
        offline.setTopInset(topSafeInset);
        installMessages(view);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge){
            @Override public void onPageStarted(WebView web,String url,android.graphics.Bitmap favicon) {
                super.onPageStarted(web,url,favicon);
                if(isInternal(Uri.parse(url)))offline.started();
            }
            @Override public void onPageCommitVisible(WebView web,String url) {
                super.onPageCommitVisible(web,url);
                if(isInternal(Uri.parse(url)))offline.committed();
            }
            @Override public void onPageFinished(WebView web,String url) {
                super.onPageFinished(web,url);
                if(isInternal(Uri.parse(url))&&!offline.hasInitialFailure())web.evaluateJavascript(adapter+";"+topInsetScript(),null);
            }
            @Override public void onReceivedError(WebView web,WebResourceRequest request,WebResourceError error) {
                if(request.isForMainFrame()) {
                    // Own main-frame fallback; Capacitor's errorPath navigation would
                    // replace the current document, including after a successful load.
                    offline.failFirstLoad();return;
                }
                super.onReceivedError(web,request,error);
            }
            @Override public void onReceivedHttpError(WebView web,WebResourceRequest request,WebResourceResponse response) {
                if(request.isForMainFrame()) {offline.failFirstLoad();return;}
                super.onReceivedHttpError(web,request,response);
            }
            @Override public void onReceivedSslError(WebView web,SslErrorHandler handler,SslError error) {
                handler.cancel(); // Never bypass certificate validation.
                if(error.getUrl()!=null&&error.getUrl().equals(web.getUrl()))offline.failFirstLoad();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web,WebResourceRequest request) {
                if(!request.isForMainFrame())return super.shouldOverrideUrlLoading(web,request);
                Uri uri=request.getUrl();
                if(isInternal(uri))return !offline.allowNavigation();
                // Retain Capacitor's local error document as a secondary fallback.
                if(uri.toString().equals(bridge.getErrorUrl()))return false;
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
                if(offline.blocksPage()){confirmExit();return;}
                view.evaluateJavascript("Boolean(window.qPokoyAndroidBack && window.qPokoyAndroidBack())",handled->{
                    if("true".equals(handled))return;
                    if(view.canGoBack())view.goBack();
                    else confirmExit();
                });
            }
        });
    }
    private void confirmExit(){
        new AlertDialog.Builder(this).setMessage("Закрыть qPokoy?")
            .setNegativeButton("Остаться",null).setPositiveButton("Закрыть",(dialog,which)->finish()).show();
    }
    @Override public void onResume(){
        super.onResume();
        if(offline!=null)offline.refreshNetwork();
    }
    @Override public void onDestroy(){
        if(offline!=null)offline.destroy();
        super.onDestroy();
    }
    @SuppressWarnings("deprecation")
    private void installTopSafeArea(){
        WindowCompat.setDecorFitsSystemWindows(getWindow(),false);
        getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);
        if(Build.VERSION.SDK_INT>=28){
            WindowManager.LayoutParams attributes=getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        View decor=getWindow().getDecorView();
        // Sole inset owner (SystemBars insetsHandling is disabled). The page
        // paints behind status bar/camera; only its content gets the top inset.
        ViewCompat.setOnApplyWindowInsetsListener(decor,(view,insets)->{
            Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());
            Insets ime=insets.getInsets(WindowInsetsCompat.Type.ime());
            topSafeInset=bars.top;
            if(offline!=null)offline.setTopInset(topSafeInset);
            view.setPadding(bars.left,0,bars.right,Math.max(bars.bottom,ime.bottom));
            WebView web=bridge.getWebView();
            if(isInternal(Uri.parse(web.getUrl()==null?"":web.getUrl())))web.evaluateJavascript(topInsetScript(),null);
            // Zero handled safe areas so env() cannot add the same inset again.
            // Keep notifications/IME alive instead of returning CONSUMED.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout(),Insets.NONE)
                .build();
        });
        ViewCompat.requestApplyInsets(decor);
    }
    private String topInsetScript(){
        float cssTop=topSafeInset/getResources().getDisplayMetrics().density;
        return "window.qPokoyAndroidSetTopInset && window.qPokoyAndroidSetTopInset("+Float.toString(cssTop)+")";
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
