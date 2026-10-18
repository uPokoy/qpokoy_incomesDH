package ru.qpokoy.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PasswordSavePolicyTest {
    @Test public void onlyLocalAuthDocumentIsTrusted(){
        assertTrue(PasswordSavePolicy.trustedPage("https://localhost/"));
        assertTrue(PasswordSavePolicy.trustedPage("https://localhost/index.html"));
        assertFalse(PasswordSavePolicy.trustedPage("https://localhost/pricing.html"));
        assertFalse(PasswordSavePolicy.trustedPage("https://qpokoy.ru/"));
        assertFalse(PasswordSavePolicy.trustedPage("https://localhost.evil.test/"));
        assertFalse(PasswordSavePolicy.trustedPage("https://user@localhost/"));
        assertFalse(PasswordSavePolicy.trustedPage("http://localhost/"));
        assertFalse(PasswordSavePolicy.trustedPage("https://localhost:444/"));
        assertFalse(PasswordSavePolicy.trustedPage(null));
    }
    @Test public void credentialsMustMatchExistingLoginBounds(){
        assertTrue(PasswordSavePolicy.valid("fixture@example.invalid","test-fixture"));
        assertFalse(PasswordSavePolicy.valid(null,"test-fixture"));
        assertFalse(PasswordSavePolicy.valid("  ","test-fixture"));
        assertFalse(PasswordSavePolicy.valid("fixture@example.invalid",null));
        assertFalse(PasswordSavePolicy.valid("fixture@example.invalid","short"));
        assertFalse(PasswordSavePolicy.valid("fixture@example.invalid",new String(new char[1025])));
    }
}
