-- Board marks (docs/LOCK-PROTECTION.md in the app repo): a day the member loosened their locked
-- apps ("changed locked apps") or turned FotoThis's Screen Time access off ("locks off"). Shown
-- on the board like the emergency mark, no points. 0 for days sent by older app builds.
alter table daily_progress
  add column lock_changes int not null default 0 check (lock_changes between 0 and 1),
  add column locks_off    int not null default 0 check (locks_off between 0 and 1);
