# Tools Docs

## Firmware Compile Tools

- [firmware-compile-reference.md](firmware-compile-reference.md) - Reference documentation for the implemented firmware compile tools, command surfaces, arguments, outputs, exit codes, and generated artifacts.
- [firmware-precompile-deploy-workflow.md](firmware-precompile-deploy-workflow.md) - End-to-end workflow for precompiling firmware with an embedded Micro-Otter runtime and deploying it to a physical device.
- [windows-usb-forwarding.md](windows-usb-forwarding.md) - Windows host steps for forwarding an ESP32 USB serial device into the Linux devcontainer so firmware flashing works.
- [windows-cp210x-wsl-setup.md](windows-cp210x-wsl-setup.md) - Repository-specific Windows setup for attaching CP210x USB-to-UART devices to WSL and verifying that the devcontainer sees `/dev/ttyUSB*`.

## MPY Runtime Workflow

- [mpy-runtime-workflow.md](mpy-runtime-workflow.md) - End-to-end guide for probing a device, compiling runtime modules to .mpy profiles, and deploying them to the device.
