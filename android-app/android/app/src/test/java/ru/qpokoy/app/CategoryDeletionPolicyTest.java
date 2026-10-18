package ru.qpokoy.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class CategoryDeletionPolicyTest {
 @Test public void salaryIsProtectedIncludingCaseAndSpacing(){for(String name:new String[]{"Зарплата"," ЗАРПЛАТА "})try{CategoryDeletionPolicy.checkName(name);fail();}catch(IllegalArgumentException expected){}CategoryDeletionPolicy.checkName("Такси");}
 @Test public void onlyNeverDispatchedWithoutDependentsCanCollapse(){assertTrue(CategoryDeletionPolicy.collapse(0,0,false));assertFalse(CategoryDeletionPolicy.collapse(1,0,false));assertFalse(CategoryDeletionPolicy.collapse(0,1,false));assertFalse(CategoryDeletionPolicy.collapse(0,0,true));}
}
