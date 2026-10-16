package ru.qpokoy.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class OAuthAttemptTest {
    static class Memory implements OAuthAttempt.Store {
        String value="";boolean fail;int commits;
        public String read(){return value;}
        public boolean write(String next){if(fail)return false;value=next;commits++;return true;}
    }
    static final long NOW=1000000;
    static final String TICKET="payload."+"a".repeat(43);
    private String id(OAuthAttempt engine){return engine.begin(NOW).split("&")[0];}
    private String uri(String id){return OAuthAttempt.CALLBACK+"?ticket="+TICKET+"&attempt_id="+id;}
    @Test public void s256MatchesRfc7636Vector(){
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",OAuthAttempt.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"));
    }
    @Test public void randomAttemptAndVerifierAreCommittedBeforeStartReturns(){
        Memory memory=new Memory();OAuthAttempt engine=new OAuthAttempt(memory);String start=engine.begin(NOW);
        String[] saved=memory.value.split("\n",-1);assertEquals(6,saved.length);assertEquals(1,memory.commits);
        assertTrue(saved[0].matches("[A-Za-z0-9_-]{43}"));assertTrue(saved[1].matches("[A-Za-z0-9_-]{43}"));assertNotEquals(saved[0],saved[1]);
        assertEquals(saved[0]+"&code_challenge="+OAuthAttempt.challenge(saved[1]),start);assertNull(engine.pending(NOW));
        assertNotEquals(saved[0],id(engine));
    }
    @Test public void failedCommitCannotStartAttempt(){
        Memory memory=new Memory();memory.fail=true;
        try{new OAuthAttempt(memory).begin(NOW);fail();}catch(IllegalStateException expected){assertEquals("",memory.value);}
    }
    @Test public void coldAndWarmUseSameDurableCallbackBeforeJsListener(){
        Memory memory=new Memory();OAuthAttempt first=new OAuthAttempt(memory);String attempt=id(first);
        assertTrue(new OAuthAttempt(memory).accept(uri(attempt),NOW+1));
        String[] pending=new OAuthAttempt(memory).pending(NOW+2);assertEquals(attempt,pending[0]);assertEquals(TICKET,pending[3]);
        assertFalse(first.accept(uri(attempt),NOW+3));assertEquals(TICKET,first.pending(NOW+4)[3]);
        first.acknowledge("wrong");assertNotNull(first.pending(NOW+4));first.acknowledge(attempt);assertNull(first.pending(NOW+4));
        String next=id(first);assertTrue(first.accept(uri(next),NOW+1));assertNotNull(first.pending(NOW+2));
    }
    @Test public void exactUriBoundaryRejectsAmbiguityAndUnexpectedParameters(){
        String attempt="b".repeat(43),valid=uri(attempt);assertNotNull(OAuthAttempt.parse(valid));
        for(String invalid:new String[]{valid+"#fragment",valid+"&ticket="+TICKET,valid+"&attempt_id="+attempt,
            valid+"&return_url=evil",valid.replace("oauth/","oauth:443/"),valid.replace("oauth/","user@oauth/"),
            valid.replace("ru.qpokoy.app:","https:"),valid.replace("/callback?","/callback/?"),
            valid.replace("/callback?","/%63allback?"),valid.replace("ticket=","%74icket="),valid.replace("oauth/","evil/"),
            valid+"&error=oauth_cancelled",valid.replace(TICKET,"x".repeat(4097)),valid.replace(attempt,"unknown")})assertNull(invalid,OAuthAttempt.parse(invalid));
    }
    @Test public void unknownExpiredAndCancelledAttemptsCannotChangeSession(){
        Memory memory=new Memory();OAuthAttempt engine=new OAuthAttempt(memory);String attempt=id(engine);
        assertFalse(engine.accept(uri("c".repeat(43)),NOW+1));
        assertFalse(engine.accept(uri(attempt),NOW+OAuthAttempt.TTL));assertNull(engine.pending(NOW+OAuthAttempt.TTL));
        attempt=id(engine);engine.cancel();assertFalse(engine.accept(uri(attempt),NOW+1));assertNull(engine.pending(NOW+1));
    }
    @Test public void callbackExpiresAndErrorCallbackIsDurable(){
        Memory memory=new Memory();OAuthAttempt engine=new OAuthAttempt(memory);String attempt=id(engine);
        assertTrue(engine.accept(OAuthAttempt.CALLBACK+"?error=oauth_cancelled&attempt_id="+attempt,NOW+1));
        assertEquals("oauth_cancelled",new OAuthAttempt(memory).pending(NOW+2)[4]);
        assertNull(engine.pending(NOW+1+OAuthAttempt.CALLBACK_TTL));assertEquals("",memory.value);
    }
}
