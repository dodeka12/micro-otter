// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only

/**
 * Shared client for the bridge's ``/api/serial-ports`` endpoint.
 *
 * The server already derives a human-readable name per port (see
 * ``serial_ports_payload`` / ``format_serial_port_label`` in
 * ``micro_otter/cli/state.py``); the browser only normalizes the payload and
 * picks the right field to display, so the Device Connection view and the
 * Firmware tab's deploy chooser show identical names without either view
 * parsing OS port identifiers.
 */

/**
 * One port reported by ``/api/serial-ports``.
 */
export interface SerialPortEntry {
    /** The OS device path (``/dev/ttyUSB0``, ``COM3``); the connect/deploy value. */
    device: string;
    /** The raw OS identity (``/dev/serial/by-id`` name or pyserial description). */
    label: string | null;
    /** The server-formatted human-readable name to show in port choosers. */
    display: string | null;
}

/**
 * The bridge endpoint that lists the serial ports the host can reach.
 */
export const SERIAL_PORTS_ENDPOINT = '/api/serial-ports';

/**
 * Coerce an arbitrary ``/api/serial-ports`` response into {@link SerialPortEntry}s.
 *
 * Entries without a non-empty string ``device`` are dropped; ``label`` and
 * ``display`` become ``null`` when the server omits them or sends a non-string,
 * so an older server that predates ``display`` still works.
 *
 * @param payload The decoded JSON body returned by the bridge.
 * @returns The usable ports, in server order.
 */
export function normalizeSerialPorts(payload: unknown): SerialPortEntry[] {
    if (!Array.isArray(payload)) {
        return [];
    }

    const entries: SerialPortEntry[] = [];
    for (const item of payload) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item as Record<string, unknown>;
        if (typeof record.device !== 'string' || !record.device) {
            continue;
        }
        entries.push({
            device: record.device,
            label: typeof record.label === 'string' ? record.label : null,
            display: typeof record.display === 'string' ? record.display : null,
        });
    }
    return entries;
}

/**
 * Fetch and normalize the port list from the bridge.
 *
 * @param endpoint The port-list URL, defaulting to {@link SERIAL_PORTS_ENDPOINT}.
 * @returns The usable ports, in server order.
 * @throws {Error} When the response is missing or not ``ok``.
 */
export async function fetchSerialPorts(
    endpoint: string = SERIAL_PORTS_ENDPOINT
): Promise<SerialPortEntry[]> {
    const response = await fetch(endpoint);
    if (!response || !response.ok) {
        throw new Error(`HTTP ${response ? response.status : 'no response'}`);
    }
    return normalizeSerialPorts(await response.json());
}

/**
 * Map ports to the ``{ value, label }`` option shape ``DropdownControl`` renders.
 *
 * The display text prefers the server-formatted ``display`` name and falls back
 * to the raw ``label`` then the ``device`` path, so a payload from either a
 * current or a pre-``display`` server always produces a readable option.
 *
 * @param entries The normalized ports.
 * @returns One option per port, ready for ``DropdownControl.setOptions``.
 */
export function serialPortOptions(
    entries: SerialPortEntry[]
): Array<{ value: string; label: string }> {
    return entries.map((entry) => ({
        value: entry.device,
        label: entry.display ?? entry.label ?? entry.device,
    }));
}
