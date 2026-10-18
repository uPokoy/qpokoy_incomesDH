package ru.qpokoy.app;

/** Pure policy shared by SQLite deletion and JVM regression tests. */
final class CategoryDeletionPolicy {
    static void checkName(String name){
        if("зарплата".equals(ReadCacheDatabase.normalizeCategoryName(name).toLowerCase(java.util.Locale.forLanguageTag("ru-RU"))))throw new IllegalArgumentException("Protected category");
    }
    static boolean collapse(int sent,int attempts,boolean dependent){return sent==0&&attempts==0&&!dependent;}
}
