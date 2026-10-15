# Android device MCP

A dependency-free local MCP server that lets Codex build, install, launch, inspect,
control, and test Android apps on an ADB-connected USB device.

## Host setup

1. Enable Developer options and USB debugging on the phone.
2. Connect it over USB and accept the RSA authorization prompt.
3. Ensure `adb devices -l` reports the device as `device`. For this repository,
   `phlip-android/tools/setup-adb-udev.sh` can install the Linux udev rules.

The server deliberately selects physical devices only. With one authorized physical
device, `serial` can be omitted; otherwise pass the exact serial returned by
`android_devices`. Emulators require an explicit `allow_emulator: true`.

All APK/project paths are restricted to `ANDROID_MCP_WORKSPACE`. Commands are passed
directly to subprocesses without a host shell.

## Tools

- `android_devices`
- `android_build_install` and `android_install_apk`
- `android_launch`
- `android_screenshot` and `android_ui_dump`
- `android_tap`, `android_swipe`, `android_input_text`, and `android_press_key`
- `android_logcat`
- `android_instrumentation_test`

Codex registration (normally done once):

```sh
codex mcp add android_device \
  --env ANDROID_MCP_WORKSPACE=/absolute/path/to/ASH \
  --env ANDROID_MCP_ADB=/absolute/path/to/adb \
  -- python3 /absolute/path/to/ASH/tools/android-device-mcp/server.py
```

Start a new Codex session after registration so its tool inventory is refreshed.
