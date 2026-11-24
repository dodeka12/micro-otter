# Windows USB Forwarding For Devcontainers

Use this guide when the Micro-Otter devcontainer runs on a Windows host and the container cannot see an ESP32 serial device.

## Why This Is Required

The devcontainer expects Linux serial device paths such as `/dev/ttyUSB0` or `/dev/ttyACM0`.

On Linux hosts, the container bind-mounts the host `/dev`, so USB serial adapters appear automatically.

On Windows hosts, Docker Desktop does not expose Windows COM ports into the Linux container automatically. You must forward the USB device into the Linux side first.

## Prerequisites

1. Windows 11 or a recent Windows 10 installation with current WSL support.
2. Docker Desktop installed.
3. WSL updated:

```powershell
wsl --update
```

4. `usbipd-win` installed:

```powershell
winget install --interactive --exact dorssel.usbipd-win
```

5. The ESP32 board connected by USB and visible in Windows Device Manager.

## Find The Device

Open PowerShell as Administrator and list exportable USB devices:

```powershell
usbipd list
```

Identify the board bus id from the output. Typical USB serial adapters include CP210x, CH340, FTDI, or Prolific devices.

## Share The Device From Windows

In elevated PowerShell:

```powershell
usbipd bind --busid <BUSID>
```

This share is persistent across reboots. You can verify the shared state with:

```powershell
usbipd list
```

## Attach Path A: WSL-Backed Docker

If your Docker engine is running inside WSL, attach the device to WSL from a regular PowerShell window:

```powershell
usbipd attach --wsl --busid <BUSID>
```

Then verify from a Linux shell:

```bash
find /dev -maxdepth 2 \( -name 'ttyUSB*' -o -name 'ttyACM*' \)
```

If forwarding succeeded, you should see a path such as `/dev/ttyUSB0` or `/dev/ttyACM0`.

## Attach Path B: Docker Desktop USB/IP Helper Container

If your devcontainer is running on Docker Desktop and the WSL attach path does not surface the device in the container, attach the shared device into the Docker host VM.

From Windows:

```powershell
docker run --rm -it --privileged --pid=host alpine
```

Inside that helper container:

```sh
nsenter -t 1 -m
usbip list -r host.docker.internal
usbip attach -r host.docker.internal -d <BUSID>
```

Keep that helper container running while you use the device. Exiting it can drop the attachment.

Then verify from the Micro-Otter devcontainer:

```bash
find /dev -maxdepth 2 \( -name 'ttyUSB*' -o -name 'ttyACM*' \)
```

## Flashing Example

Once the device appears in the container as a Linux serial node, use that path with the deployment command:

```bash
mo deploy-runtime --port /dev/ttyUSB0
```

Or:

```bash
mo dr --port /dev/ttyUSB0
```

## Troubleshooting

1. If `usbipd list` does not show the device, verify the USB cable and check Device Manager.
2. If the device resets during flashing, the attachment may drop; re-run the attach step and verify `/dev/ttyUSB*` again.
3. If the container still shows only `/dev/bus/usb/*/001`, you are seeing USB/IP virtual host controllers but not the forwarded serial device.
4. Windows COM ports such as `COM3` are not valid `--port` values inside this Linux container.
5. If needed, unplug and replug the board, then repeat `usbipd attach`.

## Related References

1. [firmware-precompile-deploy-workflow.md](firmware-precompile-deploy-workflow.md)
2. [firmware-compile-reference.md](firmware-compile-reference.md)