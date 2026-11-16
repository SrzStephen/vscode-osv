"""Drags the side bar sash with XTest (no xdotool here). Usage: drag.py X0 X1 Y"""
import ctypes
import sys
import time

x0, x1, y = (int(a) for a in sys.argv[1:4])
x11 = ctypes.CDLL("libX11.so.6")
xtst = ctypes.CDLL("libXtst.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
dpy = x11.XOpenDisplay(None)
if not dpy:
    sys.exit("cannot open display")

def move(x, yy):
    xtst.XTestFakeMotionEvent(ctypes.c_void_p(dpy), 0, x, yy, 0)
    x11.XFlush(ctypes.c_void_p(dpy))

move(x0, y)
time.sleep(0.4)
xtst.XTestFakeButtonEvent(ctypes.c_void_p(dpy), 1, 1, 0)
x11.XFlush(ctypes.c_void_p(dpy))
steps = 12
for i in range(1, steps + 1):
    move(x0 + (x1 - x0) * i // steps, y)
    time.sleep(0.04)
xtst.XTestFakeButtonEvent(ctypes.c_void_p(dpy), 1, 0, 0)
x11.XFlush(ctypes.c_void_p(dpy))
time.sleep(0.3)
move(1000, 600)  # park the pointer away from the content
x11.XFlush(ctypes.c_void_p(dpy))
