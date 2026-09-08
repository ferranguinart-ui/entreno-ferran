-- Training Tracker — datos semilla
-- Fuente: Plan_Entrenamiento_Ferran.docx (formato por tiempo fijo, 40 seg trabajo).
-- Idempotente: se puede re-ejecutar (upsert por id).

-- ------------------------------- settings ----------------------------------
insert into settings (id, goal_weight_kg, phase, moving_avg_window)
values (1, 70, 'deficit', 7)
on conflict (id) do update set goal_weight_kg = excluded.goal_weight_kg;

-- ---------------------------- training_days -------------------------------
-- id | name | focus | rounds/min/max/deload | work | rest_ex | rest_round | note
insert into training_days
  (id, name, focus, rounds, rounds_min, rounds_max, rounds_deload, work_sec, rest_ex_sec, rest_round_sec, sort_order, note)
values
  (0, 'Calentamiento', 'Todos los días (~2 min)', 1, 1, 1, 1, 40,  0,  0, 0,
      'Encadenado, una sola vuelta. Cada paso tiene su propio tiempo.'),
  (1, 'Empuje',         'Empuje (mancuernas)',    3, 2, 6, 2, 40, 25, 90, 1,
      'Plan: 3 rondas. Ajustable antes del entreno. ~16-18 min.'),
  (2, 'HIIT + core',    'HIIT + core (peso corporal)', 3, 2, 6, 2, 40, 20, 60, 2,
      'Plan: 3-4 rondas. Defecto 3, ajustable antes del entreno. ~16-20 min.'),
  (3, 'Tracción',       'Tracción (mancuernas)',  3, 2, 6, 2, 40, 25, 90, 3,
      'Plan: 3 rondas. Ajustable antes del entreno. ~16-18 min.'),
  (4, 'Piernas + core', 'Piernas + core (peso corporal)', 3, 2, 6, 2, 40, 20, 60, 4,
      'Plan: 3-4 rondas. Defecto 3, ajustable antes del entreno. ~16-20 min.'),
  (5, 'Libre',          'Día 5 opcional: full body mixto o el bloque corto de la semana',
      3, 1, 6, 2, 40, 20, 60, 5,
      'Sin ejercicios fijos. Solo registro manual.')
on conflict (id) do update set
  name=excluded.name, focus=excluded.focus, note=excluded.note,
  rounds=excluded.rounds, rounds_min=excluded.rounds_min, rounds_max=excluded.rounds_max,
  rounds_deload=excluded.rounds_deload, work_sec=excluded.work_sec,
  rest_ex_sec=excluded.rest_ex_sec, rest_round_sec=excluded.rest_round_sec,
  sort_order=excluded.sort_order;

-- ------------------------------- exercises --------------------------------
insert into exercises
  (id, day_id, block, name, muscle_primary, muscle_secondary, work_sec, rest_sec, rounds, is_optional, note, sort_order)
values
  -- Calentamiento (day 0)
  ( 1, 0, 'warmup', 'Jumping jacks',            'Cardiovascular general, cuerpo completo', null, 30, 0, null, false, null, 1),
  ( 2, 0, 'warmup', 'Rotación de hombros',      'Movilidad de hombro',                     null, 20, 0, null, false, null, 2),
  ( 3, 0, 'warmup', 'Sentadillas al aire',      'Cuádriceps, glúteo (activación)',         null, 30, 0, null, false, null, 3),
  ( 4, 0, 'warmup', 'Transición / respiración', null,                                      null, 20, 0, null, false, null, 4),

  -- Día 1 — Empuje (day 1)
  (10, 1, 'main',   'Press de pecho en suelo',  'Pectoral',                       'Tríceps, hombro anterior', null, null, null, false, null, 1),
  (11, 1, 'main',   'Aperturas en suelo',       'Pectoral (fibras externas)',     'Hombro anterior',          null, null, null, false, null, 2),
  (12, 1, 'main',   'Press militar',            'Hombro / deltoides',             'Tríceps',                  null, null, null, false, null, 3),
  (13, 1, 'main',   'Rompe cráneos en suelo',   'Tríceps (cabeza larga)',         null,                       null, null, null, false, null, 4),
  (14, 1, 'remate', 'Flexiones',                'Pectoral, tríceps',              'Core, hombro',             null, null, 1,    true,  'Se ofrece al acabar el entreno (pre-marcado: no). 1 ronda de 40 seg.', 5),

  -- Día 2 — HIIT + core (day 2)
  (20, 2, 'main',   'Sentadillas',              'Cuádriceps, glúteo',             'Core',                     null, null, null, false, null, 1),
  (21, 2, 'main',   'Wall sit',                 'Cuádriceps (isométrico)',        null,                       null, null, null, false, null, 2),
  (22, 2, 'main',   'Crunch con peso al pecho', 'Recto abdominal',                null,                       null, null, null, false, null, 3),
  (23, 2, 'main',   'Lumbares',                 'Zona lumbar',                    'Glúteo',                   null, null, null, false, null, 4),
  (24, 2, 'remate', 'Plancha estática',         'Core completo (isométrico)',     null,                       null, null, 1,    false, 'Se ofrece al acabar el entreno (pre-marcado: sí). 1 ronda de 40 seg.', 5),

  -- Día 3 — Tracción (day 3)
  (30, 3, 'main',   'Remo a una mano',              'Dorsal ancho',               'Bíceps, hombro posterior', null, null, null, false, null, 1),
  (31, 3, 'main',   'Peso muerto rumano',           'Femoral, glúteo',            'Zona lumbar',              null, null, null, false, null, 2),
  (32, 3, 'main',   'Curl bíceps',                  'Bíceps',                     'Antebrazo',                null, null, null, false, null, 3),
  (33, 3, 'main',   'Curl martillo / concentrado',  'Bíceps, braquial',           'Antebrazo',                null, null, null, false, null, 4),
  (34, 3, 'remate', 'Curl isométrico a 90°',        'Bíceps (tiempo bajo tensión)', null,                     30,   null, 1,    true,  'Se ofrece al acabar el entreno (pre-marcado: no). Intervalo único de 30 seg; cambia de brazo a la mitad.', 5),

  -- Día 4 — Piernas + core (day 4)
  (40, 4, 'main',   'Sentadillas',              'Cuádriceps, glúteo',             'Core',                     null, null, null, false, null, 1),
  (41, 4, 'main',   'Zancadas alternas',        'Cuádriceps, glúteo (unilateral)','Equilibrio / core',        null, null, null, false, null, 2),
  (42, 4, 'main',   'Puente de glúteo',         'Glúteo',                        'Femoral, lumbar',          null, null, null, false, null, 3),
  (43, 4, 'main',   'Crunch con peso al pecho', 'Recto abdominal',                null,                       null, null, null, false, null, 4),
  (44, 4, 'remate', 'Plancha estática',         'Core completo (isométrico)',     null,                       null, null, 1,    false, 'Se ofrece al acabar el entreno (pre-marcado: sí). 1 ronda de 40 seg.', 5)
on conflict (id) do update set
  day_id=excluded.day_id, block=excluded.block, name=excluded.name,
  muscle_primary=excluded.muscle_primary, muscle_secondary=excluded.muscle_secondary,
  work_sec=excluded.work_sec, rest_sec=excluded.rest_sec, rounds=excluded.rounds,
  is_optional=excluded.is_optional, note=excluded.note, sort_order=excluded.sort_order;
