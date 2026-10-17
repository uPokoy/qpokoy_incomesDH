package ru.qpokoy.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class CategoryNameNormalizationTest {
    private String normalize(String value){return ReadCacheDatabase.normalizeCategoryName(value);}
    @Test public void ordinarySpacesRemain(){assertEquals("Taxi work",normalize("Taxi work"));}
    @Test public void repeatedSpacesCollapse(){assertEquals("Taxi work",normalize("Taxi    work"));}
    @Test public void tabsCollapse(){assertEquals("Taxi work",normalize("Taxi\t\twork"));}
    @Test public void newlinesCollapse(){assertEquals("Taxi work",normalize("Taxi\n\nwork"));}
    @Test public void mixedWhitespaceCollapses(){assertEquals("Taxi work",normalize("Taxi \t\r\n\f\u000b work"));}
    @Test public void cyrillicAndLatinArePreserved(){assertEquals("Такси Taxi доход",normalize("Такси  Taxi\tдоход"));}
    @Test public void edgesAreTrimmed(){assertEquals("Офлайн тест",normalize(" \t\nОфлайн  тест\r\n "));}
    @Test public void unicodeWhitespaceNeedsNoUnsupportedFlags(){assertEquals("Такси доход Taxi",normalize("Такси\u00a0\u202fдоход\u0085Taxi"));}
    @Test public void duplicateKeysStayEquivalent(){assertEquals(normalize("Такси доход").toLowerCase(java.util.Locale.forLanguageTag("ru-RU")),normalize(" \tТАКСИ  ДОХОД ").toLowerCase(java.util.Locale.forLanguageTag("ru-RU")));}
}
