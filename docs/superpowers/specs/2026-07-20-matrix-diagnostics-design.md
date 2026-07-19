# Matrix Diagnostics Design

## Goal

Reduce root-filesystem usage below 85% while preserving the current Matrix runtime and one verified rollback release, then install a low-noise host monitor that alerts the existing Build chat when disk usage or restart frequency crosses an operational threshold.

## Scope

This change covers only:

- removing obsolete `vm_debug_ci` rollback containers and their obsolete Matrix runtime images;
- preserving the running `vm_debug_ci` container on release `8acd6e9` and rollback container `vm_debug_ci_pre_8acd6e9` on release `16d70d1`;
- constraining historical systemd journal storage;
- monitoring the root filesystem, core system services, the Matrix runtime container, and the currently active stream-publisher containers;
- delivering operational alerts to the existing Build chat through the existing bot runtime.

It does not delete databases, attachments, customer or order records, protected runtime state, Docker volumes, the running container, or the retained rollback container. It does not start or re-enable disabled capabilities.

## Cleanup Design

Before deleting anything, the cleanup records the running container name, image, health state, and the selected rollback container and image. It fails closed unless these bindings exactly match:

- current container: `vm_debug_ci`;
- current image: `matrix_runtime_8acd6e9-stream-node`;
- rollback container: `vm_debug_ci_pre_8acd6e9`;
- rollback image: `matrix_runtime_16d70d1-stream-node`.

Only older containers whose names start with `vm_debug_ci_pre_` are removed. Only obsolete images in the `matrix_runtime_*` or legacy `vm_debug_ci*` family are removed after confirming they are not the current or retained rollback image and are not used by another running container. Docker volumes are never pruned.

The systemd journal is constrained with both a seven-day retention window and a 512 MB maximum retained size. The cleanup measures the root filesystem before and after every phase. If the approved cleanup cannot reduce usage below 85%, it stops and reports the remaining largest directories instead of deleting unrelated files.

## Monitoring Architecture

The host runs a neutral `matrix-diagnostics` oneshot service from a systemd timer every five minutes. The collector has three focused responsibilities:

1. Measure root-filesystem usage.
2. Read restart counters and active states for the approved service and container allowlist.
3. Write a schema-validated, redacted event into a protected spool when a threshold transition occurs.

The monitored allowlist is:

- `packaging-system.service`;
- `huasheng-packing.service`;
- `nginx.service`;
- `docker.service`;
- `vm_debug_ci`;
- the active `stream-publisher-*` containers present at installation time.

The host collector never reads Feishu credentials or chat identifiers. The spool is located under the existing `/workspace/store` bind mount with directory mode `0700` and file mode `0600`. The existing bot runtime resolves the Build chat from its protected project binding and consumes the oldest pending event.

## Thresholds and State

- Disk warning: root filesystem usage is at least 90%.
- Disk recovery: usage subsequently falls below 88%.
- Restart warning: a monitored unit or container accumulates at least three restarts within ten minutes.
- Restart recovery: the affected component remains running without another restart for fifteen minutes.
- Cooldown: the same alert class and component is emitted at most once per hour while unresolved.
- Timer interval: five minutes.

State is persisted atomically with mode `0600`. It contains only component names, counters, timestamps, thresholds, and delivery identifiers. A boot-ID change resets counter baselines so a host reboot does not look like a restart storm.

## Delivery Semantics

Each event receives a deterministic identifier derived from the alert class, component, and incident start time. The bot sends a concise Chinese card containing severity, component, observed value, threshold, first-seen time, and the next recommended action.

The sender passes the deterministic identifier as the Feishu idempotency key. After acceptance, the consumer records a receipt before deleting the pending file. A pending or inflight event is never silently overwritten. Delivery failures remain queued with bounded retry metadata and do not affect monitored production services.

The Build chat is resolved inside the bot container from the existing protected project mapping. No chat identifier, access token, cookie, secret, SMTP value, or business record is written to source control, systemd units, monitor state, or the user-level catalog.

## Failure Handling

- Missing current or rollback bindings abort cleanup before deletion.
- An unreadable metric creates a local journal error and does not fabricate an alert value.
- A missing or unhealthy bot container does not block monitoring; events remain queued.
- Corrupt state or spool files are quarantined locally and reported without exposing their contents.
- Concurrent timer executions are rejected with a filesystem lock.
- Monitoring never restarts a service or container automatically.

## Installation and Naming

The reusable command is installed under `/home/admin/.local/bin/` with the neutral `matrix-diagnostics` codename. Source and tests remain in the project. Systemd units use the same neutral codename. A single user-level catalog entry records authoritative paths, status, checks, and approval boundaries without copying operational records or protected values.

## Verification

Verification must prove:

- only the current and selected rollback Matrix runtime containers/images remain;
- the current Matrix runtime and all core business services remain healthy;
- no Docker volume was removed;
- root-filesystem usage is below 85%;
- journal retention settings are effective;
- collector unit and timer are active and successful;
- fixture-driven disk and restart transitions generate one warning and one recovery event with cooldown and boot-reset behavior;
- the bot consumer resolves only the Build chat and deduplicates replayed event identifiers;
- a dry-run delivery fixture does not call the Feishu network;
- source, state, units, catalog, and spool contain no secrets, chat identifiers, SMTP Message-IDs, or business records.

## Rollback

Monitoring rollback disables the timer, removes only the installed neutral units and command, and leaves recorded incident state for inspection unless separately approved for deletion. Runtime rollback remains available through `vm_debug_ci_pre_8acd6e9` and `matrix_runtime_16d70d1-stream-node`. Journal vacuum and deleted obsolete images are intentionally irreversible; neither affects the retained application database, Docker volumes, current release, or selected rollback release.
