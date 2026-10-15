#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).with_name("server.py")
SPEC = importlib.util.spec_from_file_location("android_device_mcp", MODULE_PATH)
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class ServerTests(unittest.TestCase):
    def test_initialize_and_tool_list(self):
        initialized = server.respond({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26"}})
        self.assertEqual(initialized["result"]["serverInfo"]["name"], "android-device")
        listed = server.respond({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        names = {tool["name"] for tool in listed["result"]["tools"]}
        self.assertIn("android_build_install", names)
        self.assertIn("android_screenshot", names)
        self.assertIn("android_instrumentation_test", names)

    @patch.object(server, "run")
    def test_device_parser(self, command):
        command.return_value = "List of devices attached\nUSB123 device product:p model:Pixel_8 transport_id:1\nemulator-5554 device product:sdk model:sdk\n"
        devices = server.adb_devices()
        self.assertEqual(devices[0]["serial"], "USB123")
        self.assertEqual(devices[0]["physical"], "true")
        self.assertEqual(devices[1]["physical"], "false")

    def test_workspace_escape_is_rejected(self):
        with self.assertRaises(server.ToolError):
            server.workspace_path("../../etc/passwd")

    def test_stdio_protocol(self):
        request = {"jsonrpc": "2.0", "id": 7, "method": "tools/list"}
        response = server.respond(json.loads(json.dumps(request)))
        self.assertEqual(response["id"], 7)
        self.assertGreater(len(response["result"]["tools"]), 5)


if __name__ == "__main__":
    unittest.main()
