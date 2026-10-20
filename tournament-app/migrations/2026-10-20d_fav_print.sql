-- Lieblingskarte: bestimmte Edition (Scryfall-ID) statt immer der neuesten
alter table public.profiles add column if not exists favourite_card_print text;
update public.profiles set favourite_card_print = '82351724-2814-4d9e-b065-bb72c761b2e7'   -- Ihsan's Shade, Homelands
where slug = 'maugi555-gmail';
notify pgrst, 'reload schema';
