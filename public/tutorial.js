export const ruleScenes = [
  ['Your secret mission', 'Every agent gets a secret mission. Complete it without anyone figuring out what you’re doing.', '/art/tutorial-secret-mission.webp', 'mail'],
  ['Stay undercover', 'Watch the other agents carefully. Everyone’s hiding something.', '/art/tutorial-undercover.webp', 'search'],
  ['Report a suspect', 'Think you know someone’s mission? Choose the agent and describe your guess. An organizer will review it.', '/art/tutorial-report.webp', 'folder'],
  ['Protect your lives', 'You have two lives. A wrong report costs one life. Two wrong reports and you’re out.', '/art/tutorial-lives.webp', 'heart'],
  ['Don’t get caught', 'If someone correctly identifies your mission and staff approve the report, you’re eliminated immediately.', '/art/tutorial-caught.webp', 'lock'],
  ['Win Christmas', 'Finish your whole mission and stay alive until the game ends to win.', '/art/tutorial-winners.webp', 'present'],
];

export function tutorialTrack(renderScene) {
  return `<div class="tutorial-viewport">
    <div class="tutorial-track" data-tutorial-track>
      ${ruleScenes.map((scene, index) => `<div class="tutorial-frame"${index ? ' aria-hidden="true"' : ''}>${renderScene(scene, index)}</div>`).join('')}
    </div>
  </div><span class="sr-only" role="status" data-tutorial-announcement></span>`;
}

export function showTutorialSlide(root, index) {
  const track = root.querySelector('[data-tutorial-track]');
  track.style.setProperty('--tutorial-index', index);
  for (const [position, frame] of Array.from(track.children).entries()) {
    if (position === index) frame.removeAttribute('aria-hidden');
    else frame.setAttribute('aria-hidden', 'true');
  }
  root.querySelector('[data-tutorial-announcement]').textContent =
    `${ruleScenes[index][0]}, step ${index + 1} of ${ruleScenes.length}`;
}
