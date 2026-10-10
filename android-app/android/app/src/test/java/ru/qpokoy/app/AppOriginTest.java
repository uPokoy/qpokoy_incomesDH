package ru.qpokoy.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class AppOriginTest {
    @Test public void localPagesAndExplicitHttpsPortAreTrusted() {
        assertTrue(AppOrigin.trusts("https://localhost/"));
        assertTrue(AppOrigin.trusts("https://localhost:443/privacy.html?q=1#section"));
    }
    @Test public void remoteOriginsAndLookalikesCannotReachNativeBridge() {
        for(String value:new String[]{"https://qpokoy.ru/","http://localhost/","https://localhost.evil/",
            "https://localhost:444/","https://user@localhost/","file:///index.html","https://evil@localhost/","bad url"})
            assertFalse(value,AppOrigin.trusts(value));
    }
}
