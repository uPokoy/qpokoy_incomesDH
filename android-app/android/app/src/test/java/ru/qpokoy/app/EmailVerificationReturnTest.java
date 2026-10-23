package ru.qpokoy.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class EmailVerificationReturnTest {
    @Test public void acceptsOnlyTheSeparateCredentialFreeCallback(){
        assertTrue(EmailVerificationReturn.accepts("ru.qpokoy.app://email/confirmed"));
        for(String value:new String[]{null,"","https://qpokoy.ru/?verify_token=secret",
                "ru.qpokoy.app://oauth/callback","ru.qpokoy.app://email/confirmed?token=secret",
                "ru.qpokoy.app://email/confirmed#secret","ru.qpokoy.app://email/confirmed/",
                "ru.qpokoy.app://user@email/confirmed","ru.qpokoy.app://email:443/confirmed",
                "ru.qpokoy.app://email/%63onfirmed","ru.qpokoy.app://evil/confirmed"}){
            assertFalse(value,EmailVerificationReturn.accepts(value));
        }
    }
}
