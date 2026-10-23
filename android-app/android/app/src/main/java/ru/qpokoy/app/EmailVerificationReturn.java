package ru.qpokoy.app;

/** Informational return only: never a proof of verification and never an authentication credential. */
final class EmailVerificationReturn {
    static final String CALLBACK="ru.qpokoy.app://email/confirmed";
    static boolean accepts(String value){
        // Exact match also rejects query/fragment credentials, encoded paths, ports and userinfo.
        return CALLBACK.equals(value);
    }
}
