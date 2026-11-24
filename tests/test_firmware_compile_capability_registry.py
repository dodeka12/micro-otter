from pathlib import Path

from micro_otter.tools.firmware_compile.capability_registry import CapabilityRegistry

CAPABILITIES_ROOT = (
    Path(__file__).parent.parent
    / "src"
    / "micro_otter"
    / "nodes"
    / "device"
    / "capabilities"
)


def test_registry_loads_descriptors_and_domains():
    registry = CapabilityRegistry(CAPABILITIES_ROOT)

    for capability_id in ("digital", "pwm", "pull", "adc", "dac", "touch", "uart",
                          "i2c", "spi", "i2s", "rtc", "irq", "math", "viper", "wifi",
                          "bluetooth", "ethernet"):
        assert registry.has(capability_id), capability_id

    assert registry.get_domain("viper") == "general"
    assert registry.get_domain("wifi") == "general"
    assert registry.get_domain("ethernet") == "general"
    assert registry.get_domain("math") == "general"
    assert registry.get_domain("bluetooth") == "general"
    assert registry.get_domain("pwm") == "pin"
    assert registry.get_domain("i2s") == "pin"
    assert registry.get_domain("i2c") == "pin"
    assert registry.get_domain("unknown") == "pin"

    assert registry.get("viper")["glyph"] == "V"
    assert registry.get("ethernet")["glyph"] == "E"
    assert registry.get("i2s")["limitKey"] == "i2s.controllers"
    assert registry.get("i2c")["limitKey"] == "i2c.buses"
