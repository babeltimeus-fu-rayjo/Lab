/**
 * Registry of demos shown on the Lab landing page.
 * To add a demo: drop it in demos/<id>/ (self-contained) and add an entry here.
 * `path` is relative to the site root so it works under a GitHub Pages sub-path.
 */
export const demos = [
  {
    id: 'scratcher',
    title: 'Scratch Card',
    icon: '🪙',
    tagline: 'Drag across the card to rub the foil away and reveal the picture underneath.',
    description:
      'A canvas coating laid over any element and erased along the pointer\'s path (mouse, touch and pen). It tracks how much has been scratched and auto-reveals the rest once you pass the threshold.',
    path: 'demos/scratcher/',
    tags: ['canvas', 'pointer events', 'mouse · touch · pen'],
  },
  {
    id: 'slots',
    title: 'Slot Machine',
    icon: '🎰',
    tagline: 'Set the reels, rows and symbols, then pull the handle and watch it roll.',
    description:
      'A configurable slot machine focused on the spin itself: choose how many reels, how many rows show per reel, and exactly which symbols appear. Reels blur, roll and settle under the payline with a staggered stop. No betting or scoring.',
    path: 'demos/slots/',
    tags: ['css transforms', 'animation', 'configurable'],
  },
  {
    id: 'wheel',
    title: 'Spinning Wheel',
    icon: '🎡',
    tagline: 'Set the slices, their widths and the spin speed, then flick the prize wheel.',
    description:
      'A configurable prize wheel drawn on canvas. Choose how many slices, how wide each one is (a wider slice wins more often) and how fast it spins; give it a flick and it eases to a stop under the pointer.',
    path: 'demos/wheel/',
    tags: ['canvas', 'css transforms', 'configurable'],
  },
  {
    id: 'drop',
    title: 'Drop to Win',
    icon: '🔴',
    tagline: 'Drop balls through a Plinko peg field into prize slots — set the width, height and ball count.',
    description:
      'A drop-to-win Plinko board with simple 2D physics: balls fall under gravity, bounce off a quincunx peg field and settle into prize slots that run hot toward the edges. Configure the board width, height and how many balls drop; land a few hundred to trace a bell curve.',
    path: 'demos/drop/',
    tags: ['canvas', 'physics', 'configurable'],
  },
  {
    id: 'match',
    title: 'Scratch Match',
    icon: '🍒',
    tagline: 'Scratch a card cell by cell and match X of the same symbol before your scratches run out.',
    description:
      'A “match X to win” scratch ticket where every cell is its own mini scratch card (it reuses the Scratch Card mechanic). Reveal X of the same symbol anywhere to win. Set the grid size, your scratch budget, the per-cell reveal threshold and the match target, and force a winning card (always winnable within your scratch budget, but the match lands at a different point each time) or a losing one.',
    path: 'demos/match/',
    tags: ['canvas', 'pointer events', 'configurable'],
  },
  {
    id: 'avatar',
    title: 'Avatar Creator',
    icon: '🧍',
    tagline: 'Build an animated 2D character: swap body parts and mix costume pieces slot by slot.',
    description:
      'A bone-driven character drawn on canvas with procedural animations — idle, walk, run, jump, wave, dance. Swap the build, head, hair, eyes and mouth, then mix costume pieces slot by slot (hat, face, top, gloves, bottom, shoes, back, held item) so any combination composes and follows every animation.',
    path: 'demos/avatar/',
    tags: ['canvas', 'animation', 'configurable'],
  },
  {
    id: 'split-camera',
    title: 'Split-Screen Camera',
    icon: '🎥',
    tagline: 'Up to four players on one screen: views merge when they are together and split at an angle when they part.',
    description:
      'A local co-op camera test room. Players who are close share one seamless view; when they move apart the screen divides so each owns the area nearest their character, with dividers that point toward the others. Compare it with fixed side-by-side, stacked and four-panel layouts, try the mini map options, and drive players by keyboard, gamepad or bots.',
    path: 'demos/split-camera/',
    tags: ['pixijs', 'camera', 'local co-op'],
  },
];
