# Vendored from micropython-lib (MIT License): umqtt/robust.py
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import utime
from . import simple


class MQTTClient(simple.MQTTClient):
    DELAY = 2
    DEBUG = False

    def delay(self, i):
        utime.sleep(self.DELAY)

    def log(self, in_reconnect, e):
        if self.DEBUG:
            if in_reconnect:
                print("mqtt reconnect: %r" % e)
            else:
                print("mqtt: %r" % e)

    def reconnect(self):
        i = 0
        while 1:
            try:
                return super().connect(False)
            except OSError as e:
                self.log(True, e)
                i += 1
                self.delay(i)

    def ping(self):
        while 1:
            try:
                return super().ping()
            except OSError as e:
                self.log(False, e)

    def wait_msg(self):
        while 1:
            try:
                return super().wait_msg()
            except OSError as e:
                self.log(False, e)

    def check_msg(self):
        while 1:
            try:
                return super().check_msg()
            except OSError as e:
                self.log(False, e)

    def disconnect(self):
        while 1:
            try:
                return super().disconnect()
            except OSError as e:
                self.log(False, e)
