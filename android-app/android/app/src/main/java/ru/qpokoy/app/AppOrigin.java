package ru.qpokoy.app;

import java.net.URI;

/** Exact origin boundary for the privileged Android bridge. */
final class AppOrigin {
    static final String VALUE="https://localhost";
    static boolean trusts(String value) {
        try {
            URI uri=URI.create(value);
            return "https".equals(uri.getScheme())&&"localhost".equals(uri.getHost())
                &&(uri.getPort()==-1||uri.getPort()==443)&&uri.getUserInfo()==null;
        } catch(IllegalArgumentException error) { return false; }
    }
}
