-- Bestehende Texte aus player_profiles.json in die DB uebernehmen,
-- damit das Profilformular vorbefuellt startet. Laeuft nur dort, wo noch
-- nichts gepflegt wurde (description is null).
update public.profiles p
set description = s.description,
    display_name = coalesce(nullif(p.display_name, p.slug), s.real_name)
from (values
  ('burni', 'Immer dicht, immer gut!', 'Burni'),
  ('vinc', 'SG GOAT, maximal kompetitiv, eskaliert komplett – guter Mann.', 'Vinc'),
  ('simon', 'Der Arzt, dem die Magic-Spieler vertrauen.', 'Simon'),
  ('silvio', 'Granddaddy of Magic – alt, aber reift noch gut.', 'Silvio'),
  ('felix', 'Wenn er nicht aufgibt, gewinnt er.', 'Felix'),
  ('david', 'Der ewige Dritte. Gelbe Shirts im Siegerfoto? Einfach gejinxt.', 'David'),
  ('ivo', 'Ivo, Master of Spelling und Lautstärke – bester Barkeeper.', 'Ivo'),
  ('niki', 'Niki – früher scheiße, dann mal über dem Durchschnitt - jetzt wieder darunter', 'Niki'),
  ('osti', 'Osti – Mittelfeld ist sein Kingdom.', 'Osti'),
  ('maugi555-gmail', 'Founding Father of Slaughter Games – Legende und Kellerfighter.', 'Mugi'),
  ('frido', 'Surfer Boy – hübsch, gibt auch völlig dicht nicht auf.', 'Frido'),
  ('luki', 'Tree4one-Mann – Mittelfeldkämpfer, schnuppert manchmal an den Topplätzen.', 'Luki'),
  ('leo', 'Grillmeister, OG-SG, Logo-Creator – absolute Legende, guter Mann.', 'Leo'),
  ('paul', 'Der Albtraum – man wird gesoykat!', 'Paul'),
  ('wenzl', 'Wenzel – GP-Winner, deutsche Magic-Legende.', 'Wenzl'),
  ('heber', 'Heber – ein Reisender, künftiger Kanzler (so hofft man).', 'Heber'),
  ('hansi', 'Hansi – Three4One-Mann, Izzet forever.', 'Hansi'),
  ('fabi', 'Fabi – kommt aus einer GP-winning Familie, die Gene hätte er.', 'Fabi'),
  ('marc', 'Marc – Meister des Wuzels und Salzburger Magic-Legende.', 'Marc'),
  ('raul', 'Von Reschen wird man verdreschen – oft.', 'Raul'),
  ('sasha', 'Sascha – baut ein Haus und ist raus.', 'Sasha')
) as s(slug, description, real_name)
where p.slug = s.slug and p.description is null;
