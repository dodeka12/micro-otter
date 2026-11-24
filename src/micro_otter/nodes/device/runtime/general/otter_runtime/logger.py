# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.

import os
import time


class Logger:
    def __init__(self, log_dir: str = "logs", log_name: str = "robot") -> None:
        self.log_dir = log_dir
        self.log_name = log_name
        if not self.exists_dir(self.log_dir):
            os.mkdir(self.log_dir)
        files: list[str] = os.listdir(self.log_dir)
        files.sort()
        last_log_file = files[-1] if files else None
        if last_log_file is None:
            counter = 0
        else:
            counter = int(last_log_file.split("_")[-1].split(".")[0]) + 1

        self.log_filename = f"{self.log_name}_{counter}.log"
        self.file_path = f"{self.log_dir}/{self.log_filename}"

        if len(files) > 3:
            for f in files[:-3]:
                os.remove(f"{self.log_dir}/{f}")

    def log(self, message: str) -> None:
        with open(self.file_path, "a") as log_file:
            log_file.write(f"{time.time_ns() // 1_000_000} ms: {message}\n")

    def exists_file(self, path: str) -> bool:
        try:
            with open(path, "r"):
                return True
        except OSError:
            return False

    def exists_dir(self, path: str) -> bool:
        try:
            os.listdir(path)
            return True
        except OSError:
            return False

    def read_logs(self) -> list[str]:
        if not self.exists_file(self.file_path):
            return []
        with open(self.file_path, "r") as log_file:
            return log_file.readlines()

    def clear_logs(self) -> None:
        if self.exists_file(self.file_path):
            os.remove(self.file_path)
