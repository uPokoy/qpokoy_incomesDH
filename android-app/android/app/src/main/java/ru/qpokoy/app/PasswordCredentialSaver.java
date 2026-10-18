package ru.qpokoy.app;

import android.app.Activity;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.PasswordCredential;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.NoCredentialException;
import java.util.function.BiConsumer;
import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.CreateCredentialCancellationException;
import androidx.credentials.exceptions.CreateCredentialProviderConfigurationException;
import androidx.credentials.exceptions.CreateCredentialUnsupportedException;
import java.util.function.Consumer;

/** System provider owns storage. No credentials are retained in fields or persisted. */
final class PasswordCredentialSaver {
    private CancellationSignal pending;
    void save(Activity activity,String email,String password,Consumer<String> result){
        if(pending!=null||!PasswordSavePolicy.valid(email,password)){result.accept("unavailable");return;}
        pending=new CancellationSignal();
        try{
            // No web origin override: credentials belong to this signed Android app.
            CreatePasswordRequest request=new CreatePasswordRequest(email,password,null,false,false);
            CredentialManager.create(activity).createCredentialAsync(activity,request,pending,
                ContextCompat.getMainExecutor(activity),
                new CredentialManagerCallback<CreateCredentialResponse,CreateCredentialException>(){
                    @Override public void onResult(CreateCredentialResponse response){finish("saved",result);}
                    @Override public void onError(CreateCredentialException error){
                        String status=error instanceof CreateCredentialCancellationException?"cancelled":
                            error instanceof CreateCredentialProviderConfigurationException?"provider_unavailable":
                            error instanceof CreateCredentialUnsupportedException?"unsupported":"provider_error";
                        finish(status,result);
                    }
                });
        }catch(RuntimeException ignored){finish("unavailable",result);}
    }
    void read(Activity activity,BiConsumer<String,PasswordCredential> result){
        if(pending!=null){result.accept("unavailable",null);return;}
        pending=new CancellationSignal();
        try{
            GetCredentialRequest request=new GetCredentialRequest.Builder()
                .addCredentialOption(new GetPasswordOption()).build();
            CredentialManager.create(activity).getCredentialAsync(activity,request,pending,
                ContextCompat.getMainExecutor(activity),
                new CredentialManagerCallback<GetCredentialResponse,GetCredentialException>(){
                    @Override public void onResult(GetCredentialResponse response){
                        if(response.getCredential() instanceof PasswordCredential){
                            finishRead("selected",(PasswordCredential)response.getCredential(),result);
                        }else finishRead("unavailable",null,result);
                    }
                    @Override public void onError(GetCredentialException error){
                        finishRead(error instanceof GetCredentialCancellationException?"cancelled":
                            error instanceof NoCredentialException?"not_found":"provider_error",null,result);
                    }
                });
        }catch(RuntimeException ignored){finishRead("unavailable",null,result);}
    }
    private void finishRead(String status,PasswordCredential credential,BiConsumer<String,PasswordCredential> result){
        pending=null;
        android.util.Log.i("QPokoyCredentials","get outcome: "+status);
        try{result.accept(status,credential);}catch(RuntimeException ignored){/* Activity/WebView already gone. */}
    }
    private void finish(String status,Consumer<String> result){
        pending=null;
        // Fixed status only: never log request data or provider exception messages.
        android.util.Log.i("QPokoyCredentials","save outcome: "+status);
        try{result.accept(status);}catch(RuntimeException ignored){/* Activity/WebView already gone. */}
    }
    void cancel(){if(pending!=null){pending.cancel();pending=null;}}
}
