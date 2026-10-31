alter table public.offer_products
  add column if not exists offer_image_crops jsonb not null default '{}'::jsonb;
comment on column public.offer_products.offer_image_crops is
  'Image-path keyed crop profiles per PDF layout: fit, x/y percentages and zoom. Shared by PL/EN.';
notify pgrst, 'reload schema';
