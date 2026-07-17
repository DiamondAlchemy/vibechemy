/**
 * Workers get a short, distinct callsign at spawn so the crew is immediately addressable by name;
 * leads stay unnamed until the operator assigns one.
 */
const NAME_POOL = [
  'Beacon',
  'Albert',
  'Ted',
  'Nova',
  'Rex',
  'Milo',
  'Juno',
  'Ace',
  'Bishop',
  'Clyde',
  'Dax',
  'Ellis',
  'Finn',
  'Gus',
  'Hank',
  'Iris',
  'Jett',
  'Kai',
  'Lola',
  'Mona',
  'Ned',
  'Otis',
  'Pax',
  'Quinn',
  'Rudy',
  'Sage',
  'Tess',
  'Ursa',
  'Vito',
  'Wren',
  'Xeno',
  'Yara',
  'Zed',
  'Bruno',
  'Cleo',
  'Duke',
  'Enzo',
  'Faye',
  'Gino',
  'Hugo',
  'Ivy',
  'Jules',
  'Koda',
  'Luca',
  'Mars',
  'Nico',
  'Opal',
  'Pierre',
  'Rocco',
  'Suki',
  'Tango',
  'Uma',
  'Vega',
  'Waldo',
  'Ximena',
  'Yuri',
  'Zara',
  'Basil',
  'Coco',
  'Dante'
]

/** Pick an unused name (pseudo-random start so crews vary); null when the pool is dry. */
export function pickCallsign(taken: Iterable<string>, seed = Date.now()): string | null {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  const start = Math.abs(seed) % NAME_POOL.length
  for (let i = 0; i < NAME_POOL.length; i++) {
    const name = NAME_POOL[(start + i) % NAME_POOL.length]
    if (!used.has(name.toLowerCase())) return name
  }
  return null
}
