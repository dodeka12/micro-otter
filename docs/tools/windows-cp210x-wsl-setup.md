# Windows CP210x To WSL Setup

Use this guide when an ESP32 board exposes a Silicon Labs CP210x USB-to-UART adapter on a Windows host and you want the Micro-Otter devcontainer to access it as a Linux serial device.

## Goal

Expose the Windows USB device to the WSL 2 Linux kernel so the devcontainer can see a node such as `/dev/ttyUSB0`.

This setup is required because the devcontainer uses Linux device paths. Windows COM ports such as `COM5` are not valid inside the container.

## Prerequisites

1. Docker Desktop installed and configured to use the WSL 2 backend.
2. WSL updated:

```powershell
wsl --update
```

3. `usbipd-win` installed on Windows:

```powershell
winget install --interactive --exact dorssel.usbipd-win
```

4. The board appears in `usbipd list` with a device name containing `CP210x`.

## One-Time Script Policy For The Current Terminal

If PowerShell blocks local scripts, allow them for the current terminal session only:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## Helper Script

This repository includes a helper script at:

```text
tools/attach-cp210x-to-wsl.ps1
```

The script:

1. scans `usbipd list`
2. finds devices whose name contains `cp210x` case-insensitively
3. detects whether they are `Not shared`, `Shared`, or `Attached`
4. binds devices that are not yet shared
5. attaches shared devices to WSL

## Recommended Workflow

Open Windows PowerShell as Administrator in the repository root.

First, inspect matching devices without changing anything:

```powershell
.\tools\attach-cp210x-to-wsl.ps1 -ListOnly
```

Then bind and attach:

```powershell
.\tools\attach-cp210x-to-wsl.ps1
```

Expected state progression in the script output:

1. `Not shared`
2. `Shared`
3. `Attached`

`usbipd` may report:

```text
Using WSL distribution 'Ubuntu' to attach; the device will be available in all WSL 2 distributions.
```

That is the expected result. The attachment targets the shared WSL 2 kernel, not only one user distribution.

## Verify From Inside The Devcontainer

After the script reports `Attached`, check for a Linux serial device inside the devcontainer:

```bash
find /dev -maxdepth 2 \( -name 'ttyUSB*' -o -name 'ttyACM*' \)
```

Expected result:

```text
/dev/ttyUSB0
```

The exact device number can differ.

## Flashing Example

Once the device exists inside the container, use that Linux path when flashing firmware:

```bash
mo deploy-runtime --port /dev/ttyUSB0
```

Or:

```bash
mo dr --port /dev/ttyUSB0
```

## Notes

1. You usually do not need to restart the devcontainer after attach. The container bind-mounts `/dev`, so newly created Linux serial nodes typically appear immediately.
2. `usbipd bind` is persistent.
3. `usbipd attach --wsl` is not persistent across reboot, unplug/replug, or some device resets.
4. If the board resets during flashing and the serial node disappears, run the attach script again.

## Troubleshooting

1. If the script says no devices matched `cp210x`, run `usbipd list` and inspect the actual device text shown by Windows.
2. If `usbipd attach --wsl` succeeds but the container still shows no `/dev/ttyUSB*`, confirm Docker Desktop is using the WSL 2 backend.
3. If only `/dev/bus/usb/*/001` appears in the container, you are seeing USB controllers but not the attached serial device.
4. If the helper script needs to bind a device, run it from an elevated PowerShell window.

## Related References

1. [windows-usb-forwarding.md](windows-usb-forwarding.md)
2. [firmware-precompile-deploy-workflow.md](firmware-precompile-deploy-workflow.md)
3. [firmware-compile-reference.md](firmware-compile-reference.md)