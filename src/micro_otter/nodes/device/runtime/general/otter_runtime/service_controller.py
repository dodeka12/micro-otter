# Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
# NOTE: This module is intended to run on a MicroPython-enabled microcontroller.
"""Network-service contract and controller for the general runtime."""


class NetworkService:
    """Protocol every network service adapter implements.

    ``start``/``stop`` must be idempotent; ``running`` reports whether the
    service is currently up so the controller can skip no-op transitions.
    ``transport_ready(network)`` is the service's own gate: the default accepts
    "station or access point is up", which connection-oriented services (e.g.
    MQTT) override with a stricter, station-only requirement.
    """

    name = "service"
    requires_network = True

    def enabled(self):
        raise NotImplementedError

    def running(self):
        raise NotImplementedError

    def transport_ready(self, network):
        if not self.requires_network:
            return True
        return bool(network.get("sta_connected") or network.get("ap_active"))

    async def start(self, network):
        raise NotImplementedError

    async def stop(self):
        raise NotImplementedError


class ServiceController:
    """Reconcile a set of services with the current network state.

    ``sync(network)`` starts every service whose own ``enabled`` flag is set and
    whose network prerequisite is met, and stops the ones that should no longer
    run. It is idempotent, so it is safe to call at boot and again on every late
    station connect. A failing service never blocks the others and never raises
    out of ``sync``: a raising ``start``/``stop`` is reported as a status event,
    and a raising ``enabled``/``running``/``transport_ready`` is logged once and
    skipped.
    """

    def __init__(self, services, *, status_callback=None):
        self._services = list(services)
        self._status_callback = status_callback
        # Last skip reason / state-check failure per service: `sync` runs on every
        # resync interval, so an unchanged reason must not be repeated on every tick.
        self._skips = {}
        self._errors = {}

    def _notify(self, state, **fields):
        if not callable(self._status_callback):
            return
        try:
            self._status_callback(state, **fields)
        except Exception:
            pass

    def _skip(self, service, reason):
        """Report why a service was not started, once per reason change."""
        if self._skips.get(service.name) == reason:
            return
        self._skips[service.name] = reason
        print("[info] service-controller: skip {}: {}".format(service.name, reason))

    @staticmethod
    def _disabled_reason(service):
        """`disabled`, plus the service's own detail when it offers one.

        A bare ``skip mqtt: disabled`` cannot be told apart from a broken adapter, so
        services may implement an optional ``disabled_reason()`` returning e.g.
        "enabled=false in /mqtt_settings.json" or "runtime import failed".
        """
        describe = getattr(service, "disabled_reason", None)
        if not callable(describe):
            return "disabled"
        try:
            detail = describe()
        except Exception:
            return "disabled"
        if not detail:
            return "disabled"
        return "disabled ({})".format(detail)

    def _fail(self, service, exc):
        """Report a broken state check once, so a hard-broken adapter cannot spam."""
        message = "{} state check failed ({})".format(service.name, exc)
        if self._errors.get(service.name) == message:
            return
        self._errors[service.name] = message
        print("[error] service-controller: " + message)

    def _clear_reasons(self, service):
        self._skips.pop(service.name, None)
        self._errors.pop(service.name, None)

    @staticmethod
    def _transport_reason(network):
        return "transport not ready (sta_connected={} ap_active={})".format(
            bool(network.get("sta_connected")), bool(network.get("ap_active"))
        )

    async def _start(self, service, network):
        try:
            print("[info] service-controller: starting {}".format(service.name))
            await service.start(network)
            self._clear_reasons(service)
            print("[success] service-controller: started {}".format(service.name))
            self._notify("service-started", service=service.name)
        except Exception as exc:
            print("[error] service-controller: start failed {} ({})".format(service.name, exc))
            self._notify("service-start-failed", service=service.name, error=str(exc))

    async def _stop(self, service, reason=None):
        if reason:
            print("[info] service-controller: stopping {} ({})".format(service.name, reason))
        else:
            print("[info] service-controller: stopping {}".format(service.name))
        try:
            await service.stop()
            self._clear_reasons(service)
            self._notify("service-stopped", service=service.name)
        except Exception as exc:
            print("[error] service-controller: stop failed {} ({})".format(service.name, exc))
            self._notify("service-stop-failed", service=service.name, error=str(exc))

    async def _sync_service(self, service, network):
        if not service.enabled():
            if service.running():
                await self._stop(service, "disabled")
            else:
                self._skip(service, self._disabled_reason(service))
            return
        if service.transport_ready(network):
            if service.running():
                self._clear_reasons(service)
                return
            await self._start(service, network)
            return
        if service.running():
            # Transport no longer ready (e.g. station link dropped): tear the
            # service down; a later transport-up sync restarts it.
            await self._stop(service, self._transport_reason(network))
        else:
            self._skip(service, self._transport_reason(network))

    async def sync(self, network):
        for service in self._services:
            try:
                await self._sync_service(service, network)
            except Exception as exc:
                # A broken adapter (`enabled`/`running`/`transport_ready` raising)
                # must not abort the reconciliation of every other service.
                self._fail(service, exc)

    async def shutdown(self):
        for service in self._services:
            try:
                if service.running():
                    await self._stop(service)
            except Exception as exc:
                self._fail(service, exc)
