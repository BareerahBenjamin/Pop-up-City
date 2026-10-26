# Website integration on the encapsulated hardware baseline

Baseline: deployed 7dd453b (f76f379). Imported website courseware, administrator event-host reassignment, and one-day calendar navigation. Kept the existing device gateway and all hardware implementation files unchanged.

Added migration 0018_event_materials.sql without changing existing migrations. Kept the current binding-required event registration policy, deployment backups and health checks. Excluded attachment firmware, local databases, private configuration, node_modules and older hardware code.

Validation: 172 isolated regression tests; responsive browser coverage of courseware upload/replace/download/preview/delete, host permissions, calendars and maps. No live deployment or device test performed. Full details: website-merge-20261022.zh-CN.md.
