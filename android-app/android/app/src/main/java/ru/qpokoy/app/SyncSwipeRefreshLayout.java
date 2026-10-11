package ru.qpokoy.app;

import android.content.Context;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/** Native vertical pull only; leave horizontal history scrolling to the WebView. */
final class SyncSwipeRefreshLayout extends SwipeRefreshLayout {
    private float startX,startY;
    private boolean horizontal;
    private final int slop;
    @SuppressWarnings("deprecation")
    SyncSwipeRefreshLayout(Context context){
        super(context);slop=ViewConfiguration.get(context).getScaledTouchSlop();
        // WebView is not a nested-scrolling child and otherwise disables native
        // interception before a pull can start. Horizontal gestures stay below.
        setLegacyRequestDisallowInterceptTouchEventEnabled(true);
    }
    @Override public boolean onInterceptTouchEvent(MotionEvent event){
        if(event.getActionMasked()==MotionEvent.ACTION_DOWN){startX=event.getX();startY=event.getY();horizontal=false;}
        if(event.getActionMasked()==MotionEvent.ACTION_MOVE && Math.abs(event.getX()-startX)>slop && Math.abs(event.getX()-startX)>Math.abs(event.getY()-startY))horizontal=true;
        if(horizontal)return false;
        return super.onInterceptTouchEvent(event);
    }
}
