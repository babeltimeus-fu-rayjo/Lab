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
];
