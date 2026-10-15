#!/usr/bin/env python3
"""Small, dependency-free MCP server for testing Android apps over USB/ADB."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from typing import Any


SERVER_VERSION = "1.0.0"
WORKSPACE = Path(os.environ.get("ANDROID_MCP_WORKSPACE", Path(__file__).resolve().parents[2])).resolve()
ADB = os.environ.get("ANDROID_MCP_ADB", "adb")
MAX_OUTPUT = 120_000


class ToolError(Exception):
    pass


def run(argv: list[str], *, cwd: Path | None = None, timeout: int = 120, binary: bool = False) -> Any:
    try:
        result = subprocess.run(
            argv, cwd=cwd, capture_output=True, timeout=timeout,
            text=not binary, check=False,
        )
    except FileNotFoundError as exc:
        raise ToolError(f"Command not found: {argv[0]}") from exc
    except subprocess.TimeoutExpired as exc:
        raise ToolError(f"Command timed out after {timeout}s: {' '.join(argv[:3])}") from exc
    if result.returncode:
        stderr = result.stderr.decode(errors="replace") if binary else result.stderr
        stdout = result.stdout.decode(errors="replace") if binary else result.stdout
        raise ToolError((stderr or stdout or f"exit {result.returncode}").strip()[-MAX_OUTPUT:])
    return result.stdout


def adb_devices() -> list[dict[str, str]]:
    output = run([ADB, "devices", "-l"], timeout=15)
    devices = []
    for line in output.splitlines()[1:]:
        if not line.strip() or line.startswith("*"):
            continue
        fields = line.split()
        item = {"serial": fields[0], "state": fields[1] if len(fields) > 1 else "unknown"}
        for field in fields[2:]:
            if ":" in field:
                key, value = field.split(":", 1)
                item[key] = value
        item["physical"] = str(not item["serial"].startswith("emulator-")).lower()
        devices.append(item)
    return devices


def serial_from(args: dict[str, Any]) -> str:
    requested = args.get("serial")
    devices = adb_devices()
    eligible = [d for d in devices if d["state"] == "device" and d["physical"] == "true"]
    if requested:
        found = next((d for d in devices if d["serial"] == requested), None)
        if not found:
            raise ToolError(f"Device {requested!r} is not connected")
        if found["state"] != "device":
            raise ToolError(f"Device {requested!r} is {found['state']}; authorize USB debugging on the device")
        if found["physical"] != "true" and not args.get("allow_emulator", False):
            raise ToolError("Emulators are disabled by default; pass allow_emulator=true intentionally")
        return requested
    if len(eligible) != 1:
        choices = ", ".join(d["serial"] for d in eligible) or "none"
        raise ToolError(f"Expected exactly one authorized physical device, found {len(eligible)} ({choices}); pass serial")
    return eligible[0]["serial"]


def adb(args: dict[str, Any], *command: str, timeout: int = 120, binary: bool = False) -> Any:
    return run([ADB, "-s", serial_from(args), *command], timeout=timeout, binary=binary)


def adb_uninstall_if_present(args: dict[str, Any], package: str) -> str:
    """Uninstall is idempotent: adb reports failure when the package is absent."""
    serial = serial_from(args)
    result = subprocess.run([ADB, "-s", serial, "uninstall", package], capture_output=True, text=True, timeout=60)
    output = (result.stdout + result.stderr).strip()
    if result.returncode and "Unknown package" not in output and "not installed" not in output:
        raise ToolError(output or f"Could not uninstall {package}")
    return output


def workspace_path(value: str, *, must_exist: bool = True) -> Path:
    path = (WORKSPACE / value).resolve() if not Path(value).is_absolute() else Path(value).resolve()
    try:
        path.relative_to(WORKSPACE)
    except ValueError as exc:
        raise ToolError(f"Path must stay inside workspace: {WORKSPACE}") from exc
    if must_exist and not path.exists():
        raise ToolError(f"Path does not exist: {path}")
    return path


def text_result(value: Any) -> dict[str, Any]:
    text = value if isinstance(value, str) else json.dumps(value, indent=2, sort_keys=True)
    return {"content": [{"type": "text", "text": text[-MAX_OUTPUT:]}]}


def tool_specs() -> list[dict[str, Any]]:
    device = {"serial": {"type": "string", "description": "ADB serial. Optional when exactly one physical device is connected."},
              "allow_emulator": {"type": "boolean", "default": False}}
    def spec(name: str, description: str, props: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
        return {"name": name, "description": description,
                "inputSchema": {"type": "object", "properties": props, "required": required or [], "additionalProperties": False}}
    return [
        spec("android_devices", "List ADB devices and authorization state.", {}, []),
        spec("android_build_install", "Build an Android Gradle variant, install its APK on a USB device, and optionally launch it.", {
            **device, "project_dir": {"type": "string", "default": "phlip-android"},
            "gradle_task": {"type": "string", "default": ":app:assembleDebug", "pattern": "^:[A-Za-z0-9:_-]+$"},
            "apk_path": {"type": "string", "description": "Workspace-relative APK path. Defaults to app/build/outputs/apk/debug/app-debug.apk."},
            "package": {"type": "string"}, "activity": {"type": "string"},
            "uninstall_first": {"type": "boolean", "default": False}, "launch": {"type": "boolean", "default": True},
            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 1800, "default": 600}}, []),
        spec("android_install_apk", "Install an existing workspace APK on a USB device.", {
            **device, "apk_path": {"type": "string"}, "uninstall_package_first": {"type": "string"},
            "grant_runtime_permissions": {"type": "boolean", "default": True}}, ["apk_path"]),
        spec("android_launch", "Launch, force-stop, or clear an installed application.", {
            **device, "package": {"type": "string"}, "activity": {"type": "string"},
            "action": {"type": "string", "enum": ["launch", "force_stop", "clear"], "default": "launch"}}, ["package"]),
        spec("android_screenshot", "Capture the current device screen as a PNG image.", device, []),
        spec("android_ui_dump", "Return the current Android UIAutomator XML hierarchy.", device, []),
        spec("android_tap", "Tap screen coordinates.", {**device, "x": {"type": "integer", "minimum": 0}, "y": {"type": "integer", "minimum": 0}}, ["x", "y"]),
        spec("android_swipe", "Swipe between screen coordinates.", {**device, "x1": {"type": "integer"}, "y1": {"type": "integer"}, "x2": {"type": "integer"}, "y2": {"type": "integer"}, "duration_ms": {"type": "integer", "minimum": 1, "maximum": 10000, "default": 300}}, ["x1", "y1", "x2", "y2"]),
        spec("android_input_text", "Type text into the focused field using ADB input.", {**device, "text": {"type": "string", "maxLength": 2000}}, ["text"]),
        spec("android_press_key", "Press an Android key such as BACK, HOME, ENTER, or KEYCODE_4.", {**device, "key": {"type": "string", "pattern": "^[A-Za-z0-9_]+$"}}, ["key"]),
        spec("android_logcat", "Read recent device logs, optionally filtered to a package PID.", {**device, "package": {"type": "string"}, "lines": {"type": "integer", "minimum": 1, "maximum": 5000, "default": 300}, "clear_first": {"type": "boolean", "default": False}}, []),
        spec("android_instrumentation_test", "Run a Gradle connected Android test task against the selected USB device.", {**device, "project_dir": {"type": "string", "default": "phlip-android"}, "gradle_task": {"type": "string", "default": ":app:connectedDebugAndroidTest", "pattern": "^:[A-Za-z0-9:_-]+$"}, "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 3600, "default": 1200}}, []),
    ]


def call_tool(name: str, args: dict[str, Any]) -> dict[str, Any]:
    if name == "android_devices":
        return text_result(adb_devices())
    if name == "android_build_install":
        project = workspace_path(args.get("project_dir", "phlip-android"))
        task = args.get("gradle_task", ":app:assembleDebug")
        if not re.fullmatch(r":[A-Za-z0-9:_-]+", task):
            raise ToolError("Invalid Gradle task")
        gradlew = project / "gradlew"
        build = run([str(gradlew), "--console=plain", task], cwd=project, timeout=int(args.get("timeout_seconds", 600)))
        apk = workspace_path(args.get("apk_path", str(project.relative_to(WORKSPACE) / "app/build/outputs/apk/debug/app-debug.apk")))
        serial = serial_from(args)
        forwarded = {**args, "serial": serial}
        package = args.get("package", "com.phlip")
        if args.get("uninstall_first"):
            adb_uninstall_if_present(forwarded, package)
        install = adb(forwarded, "install", "-r", "-g", str(apk), timeout=180)
        launch = ""
        if args.get("launch", True):
            component = f"{package}/{args.get('activity', '.MainActivity')}"
            launch = adb(forwarded, "shell", "am", "start", "-n", component, timeout=30)
        return text_result({"serial": serial, "apk": str(apk), "build_tail": build[-4000:], "install": install.strip(), "launch": launch.strip()})
    if name == "android_install_apk":
        apk = workspace_path(args["apk_path"])
        if apk.suffix.lower() != ".apk":
            raise ToolError("apk_path must name an .apk file")
        if args.get("uninstall_package_first"):
            adb_uninstall_if_present(args, args["uninstall_package_first"])
        flags = ["install", "-r"] + (["-g"] if args.get("grant_runtime_permissions", True) else [])
        return text_result(adb(args, *flags, str(apk), timeout=180).strip())
    if name == "android_launch":
        action, package = args.get("action", "launch"), args["package"]
        if action == "force_stop": out = adb(args, "shell", "am", "force-stop", package)
        elif action == "clear": out = adb(args, "shell", "pm", "clear", package)
        else: out = adb(args, "shell", "am", "start", "-n", f"{package}/{args.get('activity', '.MainActivity')}")
        return text_result(out.strip() or "ok")
    if name == "android_screenshot":
        png = adb(args, "exec-out", "screencap", "-p", timeout=30, binary=True)
        return {"content": [{"type": "image", "data": base64.b64encode(png).decode(), "mimeType": "image/png"}]}
    if name == "android_ui_dump":
        adb(args, "shell", "uiautomator", "dump", "/sdcard/window.xml", timeout=30)
        return text_result(adb(args, "exec-out", "cat", "/sdcard/window.xml", timeout=30))
    if name == "android_tap":
        return text_result(adb(args, "shell", "input", "tap", str(args["x"]), str(args["y"])).strip() or "ok")
    if name == "android_swipe":
        values = [str(args[k]) for k in ("x1", "y1", "x2", "y2")]
        return text_result(adb(args, "shell", "input", "swipe", *values, str(args.get("duration_ms", 300))).strip() or "ok")
    if name == "android_input_text":
        # ADB input uses %s for spaces. Passing an argv element avoids host-shell injection.
        encoded = args["text"].replace("%", "%25").replace(" ", "%s")
        return text_result(adb(args, "shell", "input", "text", encoded).strip() or "ok")
    if name == "android_press_key":
        key = args["key"]
        if not re.fullmatch(r"[A-Za-z0-9_]+", key): raise ToolError("Invalid key name")
        return text_result(adb(args, "shell", "input", "keyevent", key).strip() or "ok")
    if name == "android_logcat":
        if args.get("clear_first"): adb(args, "logcat", "-c")
        command = ["logcat", "-d", "-t", str(args.get("lines", 300)), "-v", "threadtime"]
        if args.get("package"):
            pid = adb(args, "shell", "pidof", "-s", args["package"], timeout=15).strip()
            if not pid: raise ToolError(f"Package {args['package']} is not running")
            command += ["--pid", pid]
        return text_result(adb(args, *command, timeout=30))
    if name == "android_instrumentation_test":
        serial = serial_from(args)
        project = workspace_path(args.get("project_dir", "phlip-android"))
        task = args.get("gradle_task", ":app:connectedDebugAndroidTest")
        if not re.fullmatch(r":[A-Za-z0-9:_-]+", task): raise ToolError("Invalid Gradle task")
        env = os.environ.copy(); env["ANDROID_SERIAL"] = serial
        try:
            result = subprocess.run([str(project / "gradlew"), "--console=plain", task], cwd=project, env=env, capture_output=True, text=True, timeout=int(args.get("timeout_seconds", 1200)))
        except subprocess.TimeoutExpired as exc: raise ToolError(f"Tests timed out: {exc}") from exc
        output = (result.stdout + "\n" + result.stderr)[-MAX_OUTPUT:]
        if result.returncode: raise ToolError(output)
        return text_result(output)
    raise ToolError(f"Unknown tool: {name}")


def respond(message: dict[str, Any]) -> dict[str, Any] | None:
    if "id" not in message:
        return None
    request_id, method = message["id"], message.get("method")
    try:
        if method == "initialize":
            params = message.get("params", {})
            result = {"protocolVersion": params.get("protocolVersion", "2025-03-26"), "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "android-device", "version": SERVER_VERSION}}
        elif method == "tools/list": result = {"tools": tool_specs()}
        elif method == "tools/call":
            params = message.get("params", {}); result = call_tool(params.get("name", ""), params.get("arguments", {}))
        elif method == "ping": result = {}
        else: return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": f"Method not found: {method}"}}
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except (ToolError, KeyError, TypeError, ValueError) as exc:
        if method == "tools/call":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [{"type": "text", "text": str(exc)}], "isError": True}}
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32602, "message": str(exc)}}


def main() -> None:
    for line in sys.stdin.buffer:
        try:
            message = json.loads(line)
            response = respond(message)
            if response is not None:
                sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except Exception as exc:
            sys.stderr.write(f"android-device-mcp: {exc}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    main()
