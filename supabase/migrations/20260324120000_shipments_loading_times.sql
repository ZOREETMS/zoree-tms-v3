-- Planned loading window at origin dock (local wall time, text for display/API parity with dock_time)
alter table public.shipments
  add column if not exists loading_start text,
  add column if not exists loading_end text;

comment on column public.shipments.loading_start is 'Origin dock loading window start (YYYY-MM-DD HH:mm local)';
comment on column public.shipments.loading_end is 'Origin dock loading window end (YYYY-MM-DD HH:mm local)';
