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

-- ----------------------------- instrucciones ------------------------------
-- Texto que el timer muestra bajo el nombre del ejercicio (en el descanso,
-- el del siguiente). Posición, movimiento y error común. Requiere la columna
-- exercises.instructions (schema.sql la añade de forma idempotente).
update exercises e set instructions = v.t
from (values
  ( 1, 'De pie, pies juntos y brazos a los lados. Salta abriendo las piernas y subiendo los brazos por encima de la cabeza, y vuelve a cerrar. Aterriza suave sobre la parte delantera del pie, sin bloquear las rodillas.'),
  ( 2, 'De pie, brazos relajados a los lados. Haz círculos amplios con los hombros, primero hacia delante y luego hacia atrás. Mantén los hombros lejos de las orejas y el cuello suelto.'),
  ( 3, 'Pies a la anchura de los hombros y brazos al frente. Baja llevando la cadera atrás hasta que los muslos queden paralelos al suelo y sube empujando con los talones. Que las rodillas no se vayan hacia dentro.'),
  ( 4, 'Prepara las mancuernas y despeja el espacio para el primer ejercicio. Inspira por la nariz contando 4 tiempos y suelta el aire por la boca en 6. Relaja hombros y mandíbula.'),
  (10, 'Tumbado boca arriba, rodillas flexionadas y una mancuerna en cada mano a la altura del pecho. Empuja hacia arriba hasta estirar los brazos y baja controlando hasta que los codos toquen el suelo. Codos a unos 45 grados del cuerpo, no abiertos en cruz.'),
  (11, 'Tumbado boca arriba, rodillas flexionadas y mancuernas sobre el pecho con las palmas enfrentadas. Abre los brazos en arco hacia los lados con los codos ligeramente flexionados y vuelve a cerrar apretando el pecho. No dobles más los codos al bajar: no lo conviertas en un press.'),
  (12, 'De pie o sentado, mancuernas a la altura de los hombros con las palmas al frente. Empuja hacia arriba hasta casi estirar los brazos y baja controlando. Aprieta abdomen y glúteos para no arquear la zona lumbar.'),
  (13, 'Tumbado boca arriba con los brazos estirados sobre el pecho y una mancuerna en cada mano. Flexiona solo los codos para bajar las mancuernas junto a la cabeza y vuelve a estirar. Los codos apuntan al techo: no los abras hacia los lados.'),
  (14, 'Manos algo más abiertas que los hombros y cuerpo en línea recta de cabeza a talones; apoya las rodillas si hace falta. Baja el pecho hasta cerca del suelo y empuja para subir. No hundas ni levantes la cadera.'),
  (20, 'Pies a la anchura de los hombros. Baja llevando la cadera atrás hasta que los muslos queden paralelos al suelo y sube empujando con todo el pie. No levantes los talones ni dejes que las rodillas se vayan hacia dentro.'),
  (21, 'Espalda apoyada en la pared y baja hasta que rodillas y cadera formen un ángulo recto, rodillas sobre los tobillos. Aguanta la posición respirando con calma. No apoyes las manos en los muslos.'),
  (22, 'Tumbado boca arriba, rodillas flexionadas y una mancuerna sujeta contra el pecho. Sube el tronco despegando los omóplatos del suelo y baja despacio. No tires del cuello ni uses impulso.'),
  (23, 'Tumbado boca abajo con los brazos estirados al frente o junto al cuerpo. Eleva a la vez pecho y piernas unos centímetros, aguanta un instante y baja controlando. Mira al suelo para no forzar el cuello.'),
  (24, 'Apoya antebrazos y puntas de los pies, con los codos justo debajo de los hombros. Mantén el cuerpo en línea recta apretando abdomen y glúteos. No hundas la cadera, no la subas y no aguantes la respiración.'),
  (30, 'Apoya una rodilla y la mano del mismo lado en un banco o silla, espalda recta y la mancuerna colgando con el otro brazo. Tira llevando el codo hacia la cadera y baja controlando, sin girar el tronco. Haz la mitad del tiempo con cada brazo.'),
  (31, 'De pie, rodillas ligeramente flexionadas y mancuernas delante de los muslos. Lleva la cadera atrás bajando las mancuernas pegadas a las piernas hasta notar el estiramiento del femoral y sube apretando glúteos. No redondees la espalda.'),
  (32, 'De pie, mancuernas a los lados con las palmas hacia delante. Sube flexionando los codos y baja despacio hasta estirar los brazos. Codos pegados al cuerpo y sin balancear el tronco.'),
  (33, 'Martillo: de pie, palmas enfrentadas, sube las mancuernas flexionando los codos pegados al cuerpo. Concentrado: sentado, codo apoyado en la cara interna del muslo, sube la mancuerna hacia el hombro. En ambas, controla la bajada y no balancees.'),
  (34, 'Sujeta la mancuerna con el codo pegado al cuerpo y el antebrazo paralelo al suelo, a 90 grados. Aguanta la posición sin dejar caer la muñeca ni separar el codo. Cambia de brazo a la mitad del tiempo.'),
  (40, 'Pies a la anchura de los hombros. Baja llevando la cadera atrás hasta que los muslos queden paralelos al suelo y sube empujando con todo el pie. No levantes los talones ni dejes que las rodillas se vayan hacia dentro.'),
  (41, 'De pie, da un paso largo al frente y baja hasta que ambas rodillas formen un ángulo de 90 grados. Empuja con el pie delantero para volver y alterna de pierna. Que la rodilla delantera no se vaya hacia dentro ni pase mucho de la punta del pie.'),
  (42, 'Tumbado boca arriba, rodillas flexionadas y pies apoyados cerca de los glúteos. Eleva la cadera hasta alinear rodillas, cadera y hombros, aprieta el glúteo arriba y baja controlando. El empuje sale del glúteo, no de la zona lumbar.'),
  (43, 'Tumbado boca arriba, rodillas flexionadas y una mancuerna sujeta contra el pecho. Sube el tronco despegando los omóplatos del suelo y baja despacio. No tires del cuello ni uses impulso.'),
  (44, 'Apoya antebrazos y puntas de los pies, con los codos justo debajo de los hombros. Mantén el cuerpo en línea recta apretando abdomen y glúteos. No hundas la cadera, no la subas y no aguantes la respiración.')
) as v(id, t)
where e.id = v.id;
